// Capsule (compact mode) window logic.
//
// Click → expand into the main window.
// Drag (anywhere outside the button) → moves the window.
// Drag a file onto the capsule → also expands.

if (!window.__TAURI__) {
  document.body.innerHTML = "<p style='padding:1rem'>__TAURI__ missing</p>";
  throw new Error("no __TAURI__");
}

const { invoke } = window.__TAURI__.core;
const webviewWindow = window.__TAURI__.webviewWindow;
const listen = window.__TAURI__.event ? window.__TAURI__.event.listen : null;

const capsule = document.getElementById("capsule");

// Click vs drag detection — using screen coords (not client) so the capsule
// button itself can also start a drag without us mistaking the post-drag
// mouseup for a click. We compare screenX/Y between mousedown and mouseup.
//
// NOTE: data-tauri-drag-region was REMOVED from the button so the JS
// mousedown/mouseup actually fire reliably; we manually call startDragging()
// after a small movement threshold.
const DRAG_THRESHOLD = 4;
let press = null;
let dragging = false;
let appWindow = null;

if (webviewWindow && webviewWindow.getCurrentWindow) {
  appWindow = webviewWindow.getCurrentWindow();
}

capsule.addEventListener("mousedown", (e) => {
  press = { x: e.screenX, y: e.screenY };
  dragging = false;
});

capsule.addEventListener("mousemove", async (e) => {
  if (!press || dragging) return;
  const dx = Math.abs(e.screenX - press.x);
  const dy = Math.abs(e.screenY - press.y);
  if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
    dragging = true;
    if (appWindow && appWindow.startDragging) {
      try {
        await appWindow.startDragging();
      } catch (err) {
        console.error("startDragging failed", err);
      }
    }
  }
});

capsule.addEventListener("mouseup", () => {
  if (!press) return;
  const wasDrag = dragging;
  press = null;
  dragging = false;
  if (!wasDrag) invoke("show_main_window");
});

// Reset state if mouse leaves window mid-drag.
capsule.addEventListener("mouseleave", () => {
  press = null;
  dragging = false;
});

// Drag-drop visual feedback.
document.body.addEventListener("dragover", (e) => {
  e.preventDefault();
  document.body.classList.add("dragover");
});
document.body.addEventListener("dragleave", () => {
  document.body.classList.remove("dragover");
});
document.body.addEventListener("drop", (e) => {
  e.preventDefault();
  document.body.classList.remove("dragover");
});

// Scope the OS drop event to THIS window so dropping on the capsule does not
// also trigger the main window's add-files handler (and vice versa).
if (appWindow && appWindow.listen) {
  appWindow.listen("tauri://drag-drop", () => {
    invoke("show_main_window");
  }).catch(() => {});
} else if (listen) {
  // Fallback to global listener.
  listen("tauri://drag-drop", () => invoke("show_main_window"));
}

// Suppress dev context menu in production.
window.addEventListener("contextmenu", (e) => e.preventDefault());
