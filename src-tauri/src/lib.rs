// Picvert v2 Tauri shell — bridges the web UI to the picvert-engine sidecar.
//
// Sidecar layout: src-tauri/binaries/picvert-engine-<target-triple>(.exe)
// Tauri's `tauri-plugin-shell` `sidecar()` API picks the right one at runtime.

use std::sync::Mutex;

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_shell::ShellExt;

const SIDECAR_NAME: &str = "picvert-engine";

// --------------------------------------------------------------------- types

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

#[derive(Default)]
struct EngineState {
    next_id: Mutex<u64>,
}

impl EngineState {
    fn next_id(&self) -> String {
        let mut n = self.next_id.lock().unwrap();
        *n += 1;
        n.to_string()
    }
}

// ---------------------------------------------------------------- engine I/O

/// Run a single JSON request through the sidecar via `--json` (one-shot mode).
/// Returns the `result` payload on success, or an `EngineErr` on failure.
async fn run_engine(app: &AppHandle, mut request: Value) -> Result<Value, EngineErr> {
    // Stamp an id if the caller didn't.
    let state: State<EngineState> = app.state();
    if request.get("id").is_none() {
        request["id"] = Value::String(state.next_id());
    }

    let payload = serde_json::to_string(&request)
        .map_err(|e| anyhow!("serialize request: {e}"))?;

    let output = app
        .shell()
        .sidecar(SIDECAR_NAME)
        .map_err(|e| anyhow!("locate sidecar {SIDECAR_NAME}: {e}"))?
        .args(["--json", &payload])
        .output()
        .await
        .map_err(|e| anyhow!("spawn sidecar: {e}"))?;

    if !output.status.success() {
        return Err(EngineErr {
            kind: "internal".into(),
            message: format!(
                "sidecar exited with status {:?}: {}",
                output.status.code(),
                String::from_utf8_lossy(&output.stderr).trim()
            ),
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    // The sidecar emits one JSON line per response; the last line is the answer
    // we want (earlier lines, if any, are status / log lines we ignore).
    let last_line = stdout
        .lines()
        .filter(|l| !l.trim().is_empty())
        .last()
        .ok_or_else(|| anyhow!("sidecar produced no output"))?;

    let resp: Value = serde_json::from_str(last_line)
        .map_err(|e| anyhow!("parse sidecar reply: {e}\nraw: {last_line}"))?;

    if resp.get("ok").and_then(Value::as_bool) == Some(true) {
        Ok(resp.get("result").cloned().unwrap_or(json!({})))
    } else {
        let err = resp.get("error").cloned().unwrap_or_else(|| {
            json!({"kind": "unknown", "message": "engine returned ok=false with no error block"})
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
    run_engine(&app, json!({"action": "ping"})).await
}

#[tauri::command]
async fn engine_list_formats(app: AppHandle) -> Result<Value, EngineErr> {
    run_engine(&app, json!({"action": "list_formats"})).await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConvertArgs {
    input: String,
    out_dir: String,
    format: String,
}

#[tauri::command]
async fn convert_one(app: AppHandle, args: ConvertArgs) -> Result<Value, EngineErr> {
    run_engine(
        &app,
        json!({
            "action": "convert",
            "input": args.input,
            "output": args.out_dir,
            "format": args.format,
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

// ----------------------------------------------------------------- entry point

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(EngineState::default())
        .invoke_handler(tauri::generate_handler![
            engine_ping,
            engine_list_formats,
            convert_one,
            pick_output_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
