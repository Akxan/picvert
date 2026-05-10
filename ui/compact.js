// Picvert capsule (compact mode) — drag + click handling.
//
// We don't use `data-tauri-drag-region` because mixing it with click
// detection in the WKWebView turned out flaky on macOS. Instead the JS
// listens for mousedown and explicitly calls window.startDragging() once
// the cursor moves > 4 px. If the cursor doesn't move (≤ 4 px before
// mouseup), it's a click → invoke show_main_window.

if (!window.__TAURI__) {
  document.body.innerHTML = "<p style='padding:1rem;color:#b00'>__TAURI__ missing</p>";
  throw new Error("no __TAURI__");
}

const { invoke } = window.__TAURI__.core;

/** Resolve the current webview window across the names Tauri 2 might expose. */
function currentWebviewWindow() {
  const ns = window.__TAURI__;
  if (ns.webviewWindow) {
    if (typeof ns.webviewWindow.getCurrentWebviewWindow === "function")
      return ns.webviewWindow.getCurrentWebviewWindow();
    if (typeof ns.webviewWindow.getCurrent === "function")
      return ns.webviewWindow.getCurrent();
  }
  if (ns.window) {
    if (typeof ns.window.getCurrentWindow === "function")
      return ns.window.getCurrentWindow();
    if (typeof ns.window.getCurrent === "function") return ns.window.getCurrent();
  }
  console.warn("[picvert] could not resolve current window — drag will not work");
  return null;
}
const appWindow = currentWebviewWindow();

const capsule = document.getElementById("capsule");

const DRAG_THRESHOLD = 4;
let press = null;
let dragging = false;

capsule.addEventListener("mousedown", (e) => {
  // Only the primary button.
  if (e.button !== 0) return;
  press = { x: e.screenX, y: e.screenY };
  dragging = false;
});

document.addEventListener("mousemove", async (e) => {
  if (!press || dragging) return;
  const dx = Math.abs(e.screenX - press.x);
  const dy = Math.abs(e.screenY - press.y);
  if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
    dragging = true;
    if (appWindow && typeof appWindow.startDragging === "function") {
      try {
        await appWindow.startDragging();
      } catch (err) {
        console.error("startDragging failed", err);
      }
    } else {
      console.warn("[picvert] appWindow.startDragging not available");
    }
  }
});

document.addEventListener("mouseup", () => {
  if (!press) return;
  const wasDrag = dragging;
  press = null;
  dragging = false;
  if (!wasDrag) {
    triggerClickFx();
    invoke("show_main_window");
  }
});

// Keyboard activation.
capsule.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    triggerClickFx();
    invoke("show_main_window");
  }
});

/** Brief ripple animation on the capsule when activated. */
function triggerClickFx() {
  capsule.classList.remove("is-clicked");
  // force reflow so the animation restarts even on rapid repeats
  // eslint-disable-next-line no-unused-expressions
  void capsule.offsetWidth;
  capsule.classList.add("is-clicked");
  setTimeout(() => capsule.classList.remove("is-clicked"), 600);
}

// HTML5 drag-drop visual feedback.
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

// OS-level drop event scoped to THIS window.
if (appWindow && typeof appWindow.listen === "function") {
  appWindow.listen("tauri://drag-drop", () => invoke("show_main_window")).catch(() => {});
}

// Suppress dev context menu.
window.addEventListener("contextmenu", (e) => e.preventDefault());
