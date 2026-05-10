// Capsule (compact mode) window logic.
// Click → expand into the main window. Drag a file onto the capsule → also
// expand (file paths picked up via tauri://drag-drop and forwarded).
// `data-tauri-drag-region` on body lets the user drag the window itself.

if (!window.__TAURI__) {
  document.body.innerHTML = "<p style='padding:1rem'>__TAURI__ missing</p>";
  throw new Error("no __TAURI__");
}

const { invoke } = window.__TAURI__.core;
const listen = window.__TAURI__.event ? window.__TAURI__.event.listen : null;

const capsule = document.getElementById("capsule");

// Distinguish a click from the end of a drag so we don't expand whenever the
// user finishes dragging. A click counts only when the mouse moved < 4 px
// between mousedown and mouseup.
let pressStart = null;
capsule.addEventListener("mousedown", (e) => {
  pressStart = { x: e.clientX, y: e.clientY };
});
capsule.addEventListener("mouseup", (e) => {
  if (!pressStart) return;
  const dx = Math.abs(e.clientX - pressStart.x);
  const dy = Math.abs(e.clientY - pressStart.y);
  pressStart = null;
  if (dx < 4 && dy < 4) {
    invoke("show_main_window");
  }
});

// Drag-drop visual feedback (HTML5 events).
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

// When the OS reports a drag-drop, expand to the main window (which will
// receive the same event since both windows share the listener).
if (listen) {
  listen("tauri://drag-drop", () => {
    invoke("show_main_window");
  });
}
