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
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_updater::UpdaterExt;
use tauri_plugin_notification::NotificationExt;
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
/// `child` is wrapped in Option so engine_cancel can `take()` it and call
/// the consuming `CommandChild::kill()`.
struct Engine {
    child: Mutex<Option<CommandChild>>,
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
        // by id, and deliver. On engine death we also drain pending (sending
        // an error to each waiter) AND null out EngineHandle.inner so the
        // next request will re-spawn instead of writing to a dead pipe.
        let pump_pending = pending.clone();
        let pump_app = app.clone();
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
                        // Wake every pending caller with an error so the
                        // UI doesn't hang forever waiting for a reply.
                        let mut pend = pump_pending.lock().unwrap();
                        for (id, tx) in pend.drain() {
                            let _ = tx.send(serde_json::json!({
                                "id": id, "ok": false,
                                "error": { "kind": "engine_died",
                                           "message": "engine process terminated" }
                            }));
                        }
                        // Drop the dead Arc<Engine> so next get_or_spawn
                        // creates a fresh subprocess.
                        let state: State<EngineHandle> = pump_app.state();
                        *state.inner.lock().unwrap() = None;
                        break;
                    }
                    _ => {}
                }
            }
        });

        let engine = Arc::new(Engine {
            child: Mutex::new(Some(child)),
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
        let mut guard = engine.child.lock().unwrap();
        let child = guard.as_mut().ok_or_else(|| {
            engine.pending.lock().unwrap().remove(&id);
            anyhow!("engine not running (was killed)")
        })?;
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
    quality: Option<u32>,
    max_dim: Option<u32>,
) -> Result<Value, EngineErr> {
    let mut req = serde_json::json!({
        "action": "convert",
        "input": input,
        "output": out_dir,
        "format": format,
    });
    if let Some(q) = quality { req["quality"] = json!(q); }
    if let Some(m) = max_dim { req["maxDim"] = json!(m); }
    run_engine(&app, req).await
}

#[tauri::command]
async fn pick_output_folder(app: AppHandle) -> Option<String> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog().file().pick_folder(move |folder| {
        let _ = tx.send(folder);
    });
    rx.recv().ok().flatten().map(|p| p.to_string())
}

/// Supported file extensions — kept here in lower case so a folder walk
/// doesn't have to round-trip to the engine. Mirrors picvert/constants.py
/// SUPPORTED_EXTS.
const SUPPORTED_EXTS: &[&str] = &[
    ".png", ".jpg", ".jpeg", ".jfif", ".bmp", ".gif", ".tiff", ".tif",
    ".webp", ".ico", ".ppm", ".tga", ".jp2", ".heic",
    ".pdf", ".svg",
    ".docx", ".xlsx", ".csv",
];

fn is_supported_ext(name: &str) -> bool {
    if let Some(ext_pos) = name.rfind('.') {
        let ext = name[ext_pos..].to_lowercase();
        SUPPORTED_EXTS.iter().any(|s| *s == ext.as_str())
    } else {
        false
    }
}

/// Recursively walk a folder and collect every supported file path. Stops
/// at MAX_FILES_PER_DROP to avoid the UI choking on a 50k-file directory.
fn walk_folder(root: &std::path::Path, out: &mut Vec<String>) {
    const MAX_FILES_PER_DROP: usize = 5000;
    if out.len() >= MAX_FILES_PER_DROP {
        return;
    }
    let entries = match std::fs::read_dir(root) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        if out.len() >= MAX_FILES_PER_DROP {
            return;
        }
        let path = entry.path();
        if path.is_dir() {
            walk_folder(&path, out);
        } else if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
            if is_supported_ext(name) {
                if let Some(s) = path.to_str() {
                    out.push(s.to_string());
                }
            }
        }
    }
}

/// Given a list of paths (mix of files and folders), expand any folders
/// recursively into their supported files. Used by the drag-drop and
/// file-picker handlers so users can drag a whole folder of images.
#[tauri::command]
fn expand_folders(paths: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for p in paths {
        let path = std::path::PathBuf::from(&p);
        if path.is_dir() {
            walk_folder(&path, &mut out);
        } else if path.is_file() {
            out.push(p);
        }
    }
    out
}

/// Open a regular file with the OS's default app (Preview, Adobe Reader,
/// etc). Used when the user clicks a thumbnail to inspect the source.
/// Refuses anything that's not an absolute path to an existing regular
/// file — keeps the renderer from using this as a generic URL opener.
#[tauri::command]
async fn open_file(app: AppHandle, path: String) -> Result<(), String> {
    let p = std::path::PathBuf::from(&path);
    if !p.is_absolute() {
        return Err("refused: path must be absolute".into());
    }
    let meta = std::fs::symlink_metadata(&p).map_err(|e| format!("stat: {e}"))?;
    if !meta.is_file() {
        return Err("refused: path is not a regular file".into());
    }
    app.shell()
        .open(p.to_string_lossy().to_string(), None)
        .map_err(|e| format!("open failed: {e}"))
}

/// Ask the sidecar to render a small thumbnail of a PDF's first page.
/// Returns a base64 data URL the UI can drop straight into <img src>.
#[tauri::command]
async fn preview_pdf(app: AppHandle, path: String) -> Result<String, String> {
    match run_engine(&app, json!({ "action": "preview", "input": path })).await {
        Ok(result) => result
            .get("dataurl")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| "engine returned no dataurl".to_string()),
        Err(e) => Err(e.message),
    }
}

/// Open a multi-select file picker. Returns absolute paths the renderer
/// can hand straight back to convert_one. Used instead of HTML `<input
/// type="file">` because that doesn't expose absolute paths in Tauri's
/// WebKit/WebView2.
#[tauri::command]
async fn pick_input_files(app: AppHandle) -> Vec<String> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog().file().pick_files(move |paths| {
        let _ = tx.send(paths);
    });
    rx.recv()
        .ok()
        .flatten()
        .map(|paths| paths.into_iter().map(|p| p.to_string()).collect())
        .unwrap_or_default()
}

#[derive(Serialize)]
struct UpdateCheckResult {
    available: bool,
    version: Option<String>,
}

/// Ask tauri-plugin-updater whether a newer release is on the configured
/// endpoint. We don't auto-install — the dialog wants to tell the user first.
#[tauri::command]
async fn check_for_updates(app: AppHandle) -> Result<UpdateCheckResult, String> {
    let updater = app
        .updater()
        .map_err(|e| format!("updater unavailable: {e}"))?;
    match updater.check().await {
        Ok(Some(update)) => Ok(UpdateCheckResult {
            available: true,
            version: Some(update.version.clone()),
        }),
        Ok(None) => Ok(UpdateCheckResult {
            available: false,
            version: None,
        }),
        Err(e) => Err(format!("check failed: {e}")),
    }
}

/// Called by the frontend whenever the user changes the UI language so the
/// tray menu stays in sync.
#[tauri::command]
fn set_tray_labels(app: AppHandle, labels: TrayLabels) -> Result<(), String> {
    build_tray_with_labels(&app, &labels).map_err(|e| format!("rebuild tray: {e:#}"))
}

/// JS-driven hide-main-and-show-capsule, called after the main window's
/// exit animation has finished. We don't intercept the OS close event in
/// Rust any more (that ran before the animation could play).
///
/// IMPORTANT: do NOT hide main here. Defer to show_compact_window which
/// guarantees a visible window across the transition (otherwise we
/// race a moment where all webview windows are hidden and macOS may
/// quietly tear down the app before compact finishes building).
#[tauri::command]
fn hide_main_show_compact(app: AppHandle) -> Result<(), String> {
    show_compact_window(app)
}

/// Hard-cancel any in-flight conversion by killing the sidecar subprocess.
/// The pump's `Terminated` handler will drain pending oneshots (so the
/// awaiting JS call returns an `engine_died` error) and clear
/// EngineHandle.inner. The next request automatically respawns — onedir
/// cold start is ~0.17 s.
#[tauri::command]
fn engine_cancel(app: AppHandle) -> Result<(), String> {
    let handle: State<EngineHandle> = app.state();
    let maybe_engine = handle.inner.lock().unwrap().clone();
    if let Some(engine) = maybe_engine {
        if let Some(child) = engine.child.lock().unwrap().take() {
            let _ = child.kill();
        }
    }
    Ok(())
}

/// Send a system notification (macOS Notification Center / Windows Action Center).
#[tauri::command]
async fn notify(app: AppHandle, title: String, body: String) -> Result<(), String> {
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e| format!("notify: {e}"))
}

/// Hosts the renderer is allowed to fetch via http_get_text. Without
/// this, a JS injection or future bug could turn the command into a
/// generic SSRF tunnel (AWS IMDS, internal admin panels, file:// etc.)
/// since the request goes through Rust's reqwest, NOT the webview's
/// CSP-enforced fetch.
const HTTP_GET_HOST_ALLOWLIST: &[&str] = &[
    "ipwho.is",
    "ipapi.co",
    "api.open-meteo.com",
];

/// HTTPS-only GET that returns the response body as text. Used by the
/// compact weather widget for IP geolocation + Open-Meteo. The host MUST
/// be in HTTP_GET_HOST_ALLOWLIST or the call is refused.
#[tauri::command]
async fn http_get_text(url: String) -> Result<String, String> {
    // Parse + enforce scheme + host allowlist BEFORE any network access.
    let parsed = url::Url::parse(&url).map_err(|e| format!("bad url: {e}"))?;
    if parsed.scheme() != "https" {
        return Err("refused: only https:// allowed".into());
    }
    let host = parsed.host_str().ok_or("refused: missing host")?;
    if !HTTP_GET_HOST_ALLOWLIST.contains(&host) {
        return Err(format!("refused: host {host} not in allowlist"));
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(6))
        .user_agent("Picvert/1.1 (https://github.com/Akxan/picvert)")
        .build()
        .map_err(|e| format!("client build: {e}"))?;
    let r = client
        .get(parsed)
        .send()
        .await
        .map_err(|e| format!("request: {e}"))?;
    if !r.status().is_success() {
        return Err(format!("HTTP {}", r.status()));
    }
    r.text().await.map_err(|e| format!("body: {e}"))
}

/// Open a folder in the OS file manager.
///
/// Hardened against the renderer being able to use this as a generic URL
/// opener: the path must be an absolute, existing **directory** on disk.
/// Anything else (URLs, files, custom URL schemes) is refused.
#[tauri::command]
async fn open_path(app: AppHandle, path: String) -> Result<(), String> {
    let p = std::path::PathBuf::from(&path);
    if !p.is_absolute() {
        return Err("refused: path must be absolute".into());
    }
    if !p.is_dir() {
        return Err("refused: path is not a directory or does not exist".into());
    }
    // ShellExt is already imported at the top of the module.
    app.shell()
        .open(p.to_string_lossy().to_string(), None)
        .map_err(|e| format!("open failed: {e}"))
}

#[tauri::command]
fn show_main_window(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    } else {
        // Window was destroyed (e.g. user hit ⌘W before we wired the close
        // interceptor). Re-create from the same URL the bundle ships with.
        let _ = WebviewWindowBuilder::new(&app, "main", WebviewUrl::App("index.html".into()))
            .title("Picvert")
            .inner_size(720.0, 720.0)
            .min_inner_size(480.0, 480.0)
            .resizable(true)
            .build();
    }
    if let Some(w) = app.get_webview_window("compact") {
        let _ = w.hide();
    }
    Ok(())
}

#[tauri::command]
fn show_compact_window(app: AppHandle) -> Result<(), String> {
    // Show or create compact FIRST, then hide main. The reverse order has
    // a window of milliseconds where neither window is visible — on macOS
    // that occasionally trips an "all windows closed" path and the app
    // exits instead of transitioning to the capsule.
    if let Some(w) = app.get_webview_window("compact") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        // Re-trigger the entrance animation each time the window is shown.
        // Crucially also strip ".leaving" — when the user clicks the capsule
        // to expand to main, expandToMain() adds .leaving for the exit
        // animation; if the user then re-opens compact, the stale .leaving
        // would keep the body at opacity:0 / scaled out, making the capsule
        // appear to "not show up" at all.
        let _ = w.eval(
            "document.body.classList.remove('leaving');\
             document.body.classList.remove('entering');\
             void document.body.offsetWidth;\
             document.body.classList.add('entering');",
        );
        if let Some(m) = app.get_webview_window("main") {
            let _ = m.hide();
        }
        return Ok(());
    }
    // First time: create the compact window.
    //   - transparent(true): NSWindow becomes non-opaque + WKWebView gets
    //     drawsBackground:NO. The HTML body sets `background: transparent`
    //     so we end up with a click-through-to-desktop window painted only
    //     where the capsule's pixels are.
    //   - shadow(false): kills the macOS NSWindow halo (rectangular).
    //   - 200×200: room for the CSS drop-shadow without rectangular clipping.
    //
    // DO NOT set background_color(...) here — on macOS that targets the
    // NSWindow layer (per Tauri docs the webview-layer impl is a no-op),
    // and an explicit Color even with alpha=0 marks the window as having
    // a background, defeating transparent(true). Past iterations of this
    // file added it "to be safe" and it caused a visible dark square halo.
    // Capsule is now a horizontal weather widget (time + date + current
    // weather + city). 280×140 gives ~30 px breathing room around the
    // 220×84 card for the soft drop-shadow.
    let win = WebviewWindowBuilder::new(&app, "compact", WebviewUrl::App("compact.html".into()))
        .title("Picvert")
        .inner_size(280.0, 140.0)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(true)
        .build()
        .map_err(|e| e.to_string())?;
    // Park near the top-right of the active monitor.
    if let Ok(Some(monitor)) = win.current_monitor() {
        let size = monitor.size();
        let pos = monitor.position();
        let x = pos.x + size.width as i32 - 320; // 280 + 40 gutter
        let y = pos.y + 60;
        let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
    }
    // Compact is now visible — safe to hide main.
    if let Some(m) = app.get_webview_window("main") {
        let _ = m.hide();
    }
    Ok(())
}

// ----------------------------------------------------------------- entry point

/// Strings for the tray menu — JS sends these via `set_tray_labels` whenever
/// the user changes language in the main panel, so the menu stays in sync.
/// `serde(default)` + `deny_unknown_fields = false` (default) means extra
/// fields the frontend may send (legacy `language`, `langEnglish`, etc.)
/// are silently ignored.
#[derive(Default, Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrayLabels {
    show: String,
    compact: String,
    about: String,
    check_updates: String,
    quit: String,
}

impl TrayLabels {
    fn english_default() -> Self {
        Self {
            show: "Show Picvert".into(),
            compact: "Compact Mode".into(),
            about: "About Picvert".into(),
            check_updates: "Check for Updates…".into(),
            quit: "Quit".into(),
        }
    }
}

fn build_tray_with_labels(app: &AppHandle, labels: &TrayLabels) -> Result<()> {
    let show_item = MenuItem::with_id(app, "show", &labels.show, true, None::<&str>)?;
    let compact_item = MenuItem::with_id(app, "compact", &labels.compact, true, None::<&str>)?;
    let about_item = MenuItem::with_id(app, "about", &labels.about, true, None::<&str>)?;
    let updates_item =
        MenuItem::with_id(app, "check_updates", &labels.check_updates, true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit_item = PredefinedMenuItem::quit(app, Some(&labels.quit))?;

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

    // Reuse the existing tray icon if it's already on the menu bar; otherwise
    // create one. This is what makes language switching feel instant —
    // updating the menu in place rather than spawning a new icon each time.
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_menu(Some(menu));
        return Ok(());
    }

    // Per-platform tray icon:
    //   macOS  → tray.png        (black template, system handles theme)
    //   Windows → tray-win.png   (khaki — visible on light AND dark taskbars)
    //   Linux   → tray-linux.png (khaki, smaller indicator size)
    let icon_resource = if cfg!(target_os = "macos") {
        "icons/tray.png"
    } else if cfg!(target_os = "windows") {
        "icons/tray-win.png"
    } else {
        "icons/tray-linux.png"
    };
    let tray_icon_image = app
        .path()
        .resolve(icon_resource, tauri::path::BaseDirectory::Resource)
        .ok()
        .and_then(|p| std::fs::read(&p).ok())
        .and_then(|bytes| tauri::image::Image::from_bytes(&bytes).ok())
        .unwrap_or_else(|| app.default_window_icon().cloned().unwrap());

    let mut builder = TrayIconBuilder::with_id("main")
        .icon(tray_icon_image)
        // template-mode is macOS-only and only meaningful for the black icon;
        // the coloured Windows/Linux icons should render as-is.
        .icon_as_template(cfg!(target_os = "macos"))
        .menu(&menu);
    // macOS users expect left-click to open the menu (no primary action set);
    // Windows users expect right-click. Match the convention per platform.
    #[cfg(target_os = "macos")]
    {
        builder = builder.show_menu_on_left_click(true);
    }
    builder
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => {
                if let Err(e) = show_main_window(app.clone()) {
                    eprintln!("tray show_main_window failed: {e}");
                }
            }
            "compact" => {
                if let Err(e) = show_compact_window(app.clone()) {
                    eprintln!("tray show_compact_window failed: {e}");
                }
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
        .plugin(tauri_plugin_notification::init())
        .manage(EngineHandle::default())
        .invoke_handler(tauri::generate_handler![
            engine_ping,
            engine_list_formats,
            convert_one,
            pick_output_folder,
            pick_input_files,
            preview_pdf,
            open_file,
            expand_folders,
            show_main_window,
            show_compact_window,
            open_path,
            check_for_updates,
            set_tray_labels,
            http_get_text,
            notify,
            hide_main_show_compact,
            engine_cancel,
        ])
        // The main window's close button is intercepted in JS now (so the
        // exit animation can play). We still prevent the default OS-level
        // close (which would destroy the webview) — but the actual hide /
        // show-compact happens via the hide_main_show_compact command after
        // the animation finishes.
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    // Tell JS to play the leave animation; JS will then call
                    // hide_main_show_compact when the animation is done.
                    if let Some(w) = window.app_handle().get_webview_window("main") {
                        let _ = w.eval(
                            "window.dispatchEvent(new Event('picvert:close-requested'))",
                        );
                    }
                }
            }
        })
        .setup(|app| {
            // macOS app menu — Tauri 2's auto-generated default has many
            // items we don't use (File / View / Help with empty contents).
            // Replace with a minimal Picvert + Edit + Window setup. Edit
            // is required for ⌘C/⌘V/⌘A to work inside text inputs.
            #[cfg(target_os = "macos")]
            {
                let h = app.handle();
                let about_md = tauri::menu::AboutMetadata {
                    name: Some("Picvert".into()),
                    version: Some(env!("CARGO_PKG_VERSION").into()),
                    ..Default::default()
                };
                let app_menu = Submenu::with_items(
                    h,
                    "Picvert",
                    true,
                    &[
                        &PredefinedMenuItem::about(h, None, Some(about_md))?,
                        &PredefinedMenuItem::separator(h)?,
                        &PredefinedMenuItem::services(h, None)?,
                        &PredefinedMenuItem::separator(h)?,
                        &PredefinedMenuItem::hide(h, None)?,
                        &PredefinedMenuItem::hide_others(h, None)?,
                        &PredefinedMenuItem::show_all(h, None)?,
                        &PredefinedMenuItem::separator(h)?,
                        &PredefinedMenuItem::quit(h, None)?,
                    ],
                )?;
                let edit_menu = Submenu::with_items(
                    h,
                    "Edit",
                    true,
                    &[
                        &PredefinedMenuItem::undo(h, None)?,
                        &PredefinedMenuItem::redo(h, None)?,
                        &PredefinedMenuItem::separator(h)?,
                        &PredefinedMenuItem::cut(h, None)?,
                        &PredefinedMenuItem::copy(h, None)?,
                        &PredefinedMenuItem::paste(h, None)?,
                        &PredefinedMenuItem::select_all(h, None)?,
                    ],
                )?;
                let window_menu = Submenu::with_items(
                    h,
                    "Window",
                    true,
                    &[
                        &PredefinedMenuItem::minimize(h, None)?,
                        &PredefinedMenuItem::close_window(h, None)?,
                    ],
                )?;
                let menu = Menu::with_items(h, &[&app_menu, &edit_menu, &window_menu])?;
                app.set_menu(menu)?;
            }

            // Tray icon — always present, even when no windows are open.
            if let Err(e) = build_tray_with_labels(app.handle(), &TrayLabels::english_default()) {
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
