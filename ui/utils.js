// Tiny shared helpers used by both main.js and compact.js.
// Keep this file dependency-free (no DOM, no Tauri imports inside the
// helpers themselves so they can be unit-tested if we ever add tests).

/** querySelector by id shortcut. */
export const $ = (id) => document.getElementById(id);

/** Best-effort error → string for tauri/JS errors of various shapes. */
export function errMessage(err) {
  if (!err) return "unknown";
  if (typeof err === "string") return err;
  if (err.message) return err.message;
  if (err.kind) return err.kind;
  try { return JSON.stringify(err); } catch { return String(err); }
}

/** Resolve the current Tauri webview window across the names Tauri 2 might
 *  expose under window.__TAURI__ (varies between minor versions). */
export function currentWebviewWindow() {
  const ns = (typeof window !== "undefined" && window.__TAURI__) || {};
  const candidates = [
    ns.webviewWindow?.getCurrentWebviewWindow,
    ns.webviewWindow?.getCurrent,
    ns.window?.getCurrentWindow,
    ns.window?.getCurrent,
  ];
  for (const fn of candidates) {
    if (typeof fn === "function") {
      try { return fn(); } catch {}
    }
  }
  return null;
}

/** Suppress the WebKit context menu (Reload / Inspect Element) so end users
 *  don't see dev-only items in production. */
export function suppressContextMenu() {
  window.addEventListener("contextmenu", (e) => e.preventDefault());
}
