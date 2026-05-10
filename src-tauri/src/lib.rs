// Picvert v2 Tauri shell — bridges the web UI to the picvert-engine sidecar.
//
// The engine is a PyInstaller --onefile binary whose cold start is ~6-7 s on
// macOS (it self-extracts to /tmp on every launch). We therefore spawn it
// **once** in `--line-mode` and reuse the same process for every request.
// Each call writes one JSON line to stdin, the engine writes one JSON line to
// stdout, and a background thread routes responses back to waiting callers
// using request IDs.

use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc, Mutex,
};

use anyhow::{anyhow, Result};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tokio::sync::oneshot;

const SIDECAR_BIN: &str = if cfg!(windows) {
    "picvert-engine.exe"
} else {
    "picvert-engine"
};

/// Locate the picvert-engine binary inside the bundle's resources.
/// In dev (`cargo tauri dev`) this resolves under target/.../resources/engine/;
/// in a built .app it lands under Picvert.app/Contents/Resources/engine/.
fn engine_path(app: &AppHandle) -> Result<std::path::PathBuf> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| anyhow!("resolve resource_dir: {e}"))?;
    Ok(resource_dir.join("engine").join(SIDECAR_BIN))
}

// ---------------------------------------------------------------- error type

#[derive(Serialize, Debug)]
pub struct EngineErr {
    kind: String,
    message: String,
}

impl From<anyhow::Error> for EngineErr {
    fn from(e: anyhow::Error) -> Self {
        EngineErr {
            kind: "internal".into(),
            message: format!("{:#}", e),
        }
    }
}

// ---------------------------------------------------------------- engine state

/// One persistent sidecar process and the plumbing to talk to it.
struct Engine {
    child: Mutex<CommandChild>,
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>>,
    next_id: AtomicU64,
}

impl Engine {
    fn next_id(&self) -> String {
        self.next_id.fetch_add(1, Ordering::Relaxed).to_string()
    }
}

#[derive(Default)]
struct EngineHandle {
    inner: Mutex<Option<Arc<Engine>>>,
}

impl EngineHandle {
    fn get_or_spawn(&self, app: &AppHandle) -> Result<Arc<Engine>, EngineErr> {
        // Fast path: already running.
        if let Some(e) = self.inner.lock().unwrap().as_ref() {
            return Ok(e.clone());
        }

        // Slow path: spawn the sidecar in line-mode, hook up stdout pump.
        let mut guard = self.inner.lock().unwrap();
        if let Some(e) = guard.as_ref() {
            return Ok(e.clone());
        }

        let path = engine_path(app)?;
        let (mut rx, child) = app
            .shell()
            .command(&path)
            .args(["--line-mode"])
            .spawn()
            .map_err(|e| anyhow!("spawn engine at {}: {e}", path.display()))?;

        let pending: Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>> =
            Arc::new(Mutex::new(HashMap::new()));

        // Pump: read each stdout line, look up the matching pending oneshot
        // by id, and deliver. tauri-plugin-shell delivers stdout as
        // CommandEvent::Stdout per line.
        let pump_pending = pending.clone();
        tauri::async_runtime::spawn(async move {
            while let Some(event) = rx.recv().await {
                match event {
                    CommandEvent::Stdout(bytes) => {
                        let line = String::from_utf8_lossy(&bytes).trim().to_string();
                        if line.is_empty() {
                            continue;
                        }
                        let resp: Value = match serde_json::from_str(&line) {
                            Ok(v) => v,
                            Err(e) => {
                                eprintln!("engine emitted non-JSON line: {line:?} ({e})");
                                continue;
                            }
                        };
                        let id = resp
                            .get("id")
                            .and_then(Value::as_str)
                            .map(str::to_string);
                        if let Some(id) = id {
                            let waiter = pump_pending.lock().unwrap().remove(&id);
                            if let Some(tx) = waiter {
                                let _ = tx.send(resp);
                            }
                        }
                    }
                    CommandEvent::Stderr(bytes) => {
                        let line = String::from_utf8_lossy(&bytes);
                        eprintln!("engine stderr: {line}");
                    }
                    CommandEvent::Error(e) => {
                        eprintln!("engine event error: {e}");
                    }
                    CommandEvent::Terminated(payload) => {
                        eprintln!(
                            "engine terminated (code={:?}, signal={:?})",
                            payload.code, payload.signal
                        );
                        break;
                    }
                    _ => {}
                }
            }
        });

        let engine = Arc::new(Engine {
            child: Mutex::new(child),
            pending,
            next_id: AtomicU64::new(1),
        });
        *guard = Some(engine.clone());
        Ok(engine)
    }
}

/// Send a request, wait for the matching response.
async fn run_engine(app: &AppHandle, mut request: Value) -> Result<Value, EngineErr> {
    let handle: State<EngineHandle> = app.state();
    let engine = handle.get_or_spawn(app)?;

    // Stamp / overwrite an id; we always need to track our own.
    let id = engine.next_id();
    request["id"] = Value::String(id.clone());

    let (tx, rx) = oneshot::channel();
    engine.pending.lock().unwrap().insert(id.clone(), tx);

    let payload = serde_json::to_string(&request)
        .map_err(|e| anyhow!("serialize request: {e}"))?;
    {
        let mut child = engine.child.lock().unwrap();
        child
            .write(format!("{payload}\n").as_bytes())
            .map_err(|e| {
                engine.pending.lock().unwrap().remove(&id);
                anyhow!("write to sidecar stdin: {e}")
            })?;
    }

    let resp = rx
        .await
        .map_err(|_| anyhow!("sidecar dropped reply (process died?)"))?;

    if resp.get("ok").and_then(Value::as_bool) == Some(true) {
        Ok(resp.get("result").cloned().unwrap_or(json!({})))
    } else {
        let err = resp.get("error").cloned().unwrap_or_else(|| {
            json!({"kind":"unknown","message":"engine returned ok=false with no error block"})
        });
        Err(EngineErr {
            kind: err
                .get("kind")
                .and_then(Value::as_str)
                .unwrap_or("unknown")
                .to_string(),
            message: err
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("(no message)")
                .to_string(),
        })
    }
}

// --------------------------------------------------------------- commands

#[tauri::command]
async fn engine_ping(app: AppHandle) -> Result<Value, EngineErr> {
    run_engine(&app, json!({"action":"ping"})).await
}

#[tauri::command]
async fn engine_list_formats(app: AppHandle) -> Result<Value, EngineErr> {
    run_engine(&app, json!({"action":"list_formats"})).await
}

#[tauri::command(rename_all = "camelCase")]
async fn convert_one(
    app: AppHandle,
    input: String,
    out_dir: String,
    format: String,
) -> Result<Value, EngineErr> {
    run_engine(
        &app,
        json!({
            "action": "convert",
            "input": input,
            "output": out_dir,
            "format": format,
        }),
    )
    .await
}

#[tauri::command]
async fn pick_output_folder(app: AppHandle) -> Option<String> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog().file().pick_folder(move |folder| {
        let _ = tx.send(folder);
    });
    rx.recv().ok().flatten().map(|p| p.to_string())
}

#[tauri::command]
async fn open_path(app: AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_shell::ShellExt;
    app.shell()
        .open(path, None)
        .map_err(|e| format!("open failed: {e}"))
}

#[tauri::command]
fn show_main_window(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
    if let Some(w) = app.get_webview_window("compact") {
        let _ = w.hide();
    }
    Ok(())
}

#[tauri::command]
fn show_compact_window(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
    if let Some(w) = app.get_webview_window("compact") {
        let _ = w.show();
        let _ = w.set_focus();
        return Ok(());
    }
    // First time: create the compact window.
    WebviewWindowBuilder::new(&app, "compact", WebviewUrl::App("compact.html".into()))
        .title("Picvert")
        .inner_size(96.0, 96.0)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(true)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ----------------------------------------------------------------- entry point

fn build_tray(app: &AppHandle) -> Result<()> {
    let show_item = MenuItem::with_id(app, "show", "Show Picvert", true, None::<&str>)?;
    let compact_item = MenuItem::with_id(app, "compact", "Compact Mode", true, None::<&str>)?;
    let about_item = MenuItem::with_id(app, "about", "About Picvert", true, None::<&str>)?;
    let updates_item =
        MenuItem::with_id(app, "check_updates", "Check for Updates…", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit_item = PredefinedMenuItem::quit(app, Some("Quit"))?;

    let menu = Menu::with_items(
        app,
        &[
            &show_item,
            &compact_item,
            &separator,
            &about_item,
            &updates_item,
            &separator,
            &quit_item,
        ],
    )?;

    TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().cloned().unwrap())
        .icon_as_template(true) // macOS: render as a template (auto light/dark)
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => {
                let _ = show_main_window(app.clone());
            }
            "compact" => {
                let _ = show_compact_window(app.clone());
            }
            "about" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.eval("window.dispatchEvent(new Event('picvert:show-about'))");
                    let _ = w.set_focus();
                }
            }
            "check_updates" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.eval("window.dispatchEvent(new Event('picvert:check-updates'))");
                    let _ = w.set_focus();
                }
            }
            _ => {}
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // macOSPrivateApi is enabled via tauri.conf.json + Cargo feature
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(EngineHandle::default())
        .invoke_handler(tauri::generate_handler![
            engine_ping,
            engine_list_formats,
            convert_one,
            pick_output_folder,
            show_main_window,
            show_compact_window,
            open_path,
        ])
        .setup(|app| {
            // Tray icon — always present, even when no windows are open.
            if let Err(e) = build_tray(app.handle()) {
                eprintln!("failed to build tray icon: {e:#}");
            }

            // Pre-spawn the sidecar so the ~200 ms onedir cold start happens
            // in parallel with the window and JS bootstrapping.
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = run_engine(&app_handle, json!({"action": "ping"})).await {
                    eprintln!("engine pre-spawn failed: {} — {}", e.kind, e.message);
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
