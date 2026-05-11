// Picvert v2 frontend — vanilla JS shell, no bundler.
// Talks to Tauri's Rust core via window.__TAURI__.core.invoke().

import { SUPPORTED_LANGS, getLang, setLang, onLangChange, t, translations } from "./i18n.js";
import { $, errMessage, currentWebviewWindow, suppressContextMenu } from "./utils.js";

if (!window.__TAURI__) {
  document.addEventListener("DOMContentLoaded", () => {
    document.body.innerHTML =
      '<div style="padding:2rem;font-family:system-ui;color:#b56b6b">' +
      "<h2>Picvert init failed</h2>" +
      "<p><code>window.__TAURI__</code> is not injected.</p>" +
      "</div>";
  });
  throw new Error("__TAURI__ not injected");
}

const { invoke, convertFileSrc } = window.__TAURI__.core;
const appWindow = currentWebviewWindow();

// ─── DOM refs ─────────────────────────────────────────────────────────────

const dropzone = $("dropzone");
const formatSelect = $("format-select");
const qualityGroup = $("quality-group");
const qualitySlider = $("quality-slider");
const qualityValEl = $("quality-val");
const maxDimInput = $("max-dim-input");
const convertBtn = $("convert-btn");
const cancelBtn = $("cancel-btn");
const clearBtn = $("clear-btn");
const fileListEl = $("file-list");
const listCountEl = $("list-count");
const progressEl = $("progress");
const barFill = $("bar-fill");
const progressText = $("progress-text");
const progressSummary = $("progress-summary");
const versionEl = $("version");
const engineStatusEl = $("engine-status");
const langSelect = $("lang-select");
const outputFolderEl = $("output-folder");
const changeOutputBtn = $("change-output-btn");
const openOutputBtn = $("open-output-btn");
const helpBtn = $("help-btn");

const aboutDialog = $("about-dialog");
const aboutVersionEl = $("about-version");
const updateStatusEl = $("update-status");
const helpDialog = $("help-dialog");
const helpInputsEl = $("help-inputs");
const helpOutputsEl = $("help-outputs");
const toastStack = $("toast-stack");

// ─── state ────────────────────────────────────────────────────────────────

const LS_OUTPUT = "picvert.outputFolder";
const LS_QUALITY = "picvert.quality";
const LS_MAX_DIM = "picvert.maxDim";
const IMAGE_EXT = /\.(png|jpe?g|jfif|bmp|gif|tiff?|webp|ico|ppm|tga|jp2|heic|svg)$/i;
const PDF_EXT = /\.pdf$/i;
const LOSSY_FORMATS = new Set(["JPEG", "JPG", "JFIF", "WEBP", "JPEG2000", "HEIC"]);

let files = [];
let outputFolder = null;
let busy = false;
let cancelRequested = false;
let engineState = { kind: "loading" }; // tagged union
let supportedFormats = { input_extensions: [], output_formats: [] };

// path → data URL cache for PDF first-page thumbnails. Without this every
// render() call (triggered by language switch, status change, etc.) refires
// the preview_pdf RPC for every PDF row.
const pdfThumbCache = new Map();
// path → in-flight Promise so we don't fire duplicate preview RPCs while
// the first one is still pending (e.g. fast typing in the language picker).
const pdfThumbInFlight = new Map();

/** Best-effort localised translation of an engine error message. The
 *  engine returns English `kind` discriminators (unsupported / not_found /
 *  bad_request / internal / engine_died) — if we have a translation for
 *  that kind in the active language, use it; otherwise fall back to the
 *  raw message so the user still sees something. */
function localizedError(err) {
  if (!err) return t("err_unknown");
  if (typeof err === "string") return err;
  if (err.kind) {
    const key = `errkind_${err.kind}`;
    const translated = t(key);
    if (translated !== key) return translated;
  }
  return err.message || errMessage(err);
}

// ─── helpers ──────────────────────────────────────────────────────────────

const fileBadge = (name) => {
  const ext = name.split(".").pop().toLowerCase();
  return { pdf: "PDF", docx: "DOC", xlsx: "XLS", csv: "CSV", svg: "SVG" }[ext] || ext.toUpperCase();
};

const langName = (lang) =>
  ({ en: "english", es: "spanish", ru: "russian", zh: "chinese" })[lang] || "english";

// ─── toast ────────────────────────────────────────────────────────────────

/** Show a transient notification in the bottom-right. Auto-dismisses after
 *  `ms` (default 2.4 s) or earlier on click. */
function toast(text, kind = "info", ms = 2400) {
  const el = document.createElement("div");
  el.className = `toast toast-${kind}`;
  el.textContent = text;
  toastStack.appendChild(el);
  const dismiss = () => {
    if (!el.isConnected) return;
    el.classList.add("toast-out");
    setTimeout(() => el.remove(), 200);
  };
  el.addEventListener("click", dismiss);
  setTimeout(dismiss, ms);
}

// ─── engine status footer ─────────────────────────────────────────────────

function renderEngineStatus() {
  engineStatusEl.innerHTML = "";
  if (engineState.kind === "loading") {
    const sp = document.createElement("span");
    sp.className = "spinner";
    engineStatusEl.appendChild(sp);
    engineStatusEl.appendChild(document.createTextNode(t("engine_loading")));
  } else if (engineState.kind === "ready") {
    engineStatusEl.appendChild(document.createTextNode(t("engine_ready")));
  } else {
    engineStatusEl.appendChild(document.createTextNode(t("engine_error", { err: engineState.err })));
  }
}

// ─── output folder ────────────────────────────────────────────────────────

function setOutputFolder(path) {
  outputFolder = path;
  if (path) {
    outputFolderEl.textContent = path;
    outputFolderEl.classList.remove("muted");
    outputFolderEl.removeAttribute("data-i18n");
    openOutputBtn.classList.remove("hidden");
    try { localStorage.setItem(LS_OUTPUT, path); } catch {}
  } else {
    outputFolderEl.textContent = t("output_unset");
    outputFolderEl.setAttribute("data-i18n", "output_unset");
    outputFolderEl.classList.add("muted");
    openOutputBtn.classList.add("hidden");
  }
}

function loadSavedOutputFolder() {
  try {
    const saved = localStorage.getItem(LS_OUTPUT);
    if (saved) setOutputFolder(saved);
  } catch {}
}

// ─── quality / max-dim controls ───────────────────────────────────────────

function refreshQualityVisibility() {
  const isLossy = LOSSY_FORMATS.has(formatSelect.value);
  qualityGroup.classList.toggle("disabled", !isLossy);
}

function loadSavedEncodeOpts() {
  try {
    const q = localStorage.getItem(LS_QUALITY);
    if (q) { qualitySlider.value = q; qualityValEl.textContent = q; }
    const m = localStorage.getItem(LS_MAX_DIM);
    if (m) maxDimInput.value = m;
  } catch {}
}
qualitySlider.addEventListener("input", () => {
  qualityValEl.textContent = qualitySlider.value;
  try { localStorage.setItem(LS_QUALITY, qualitySlider.value); } catch {}
});
maxDimInput.addEventListener("change", () => {
  try {
    if (maxDimInput.value) localStorage.setItem(LS_MAX_DIM, maxDimInput.value);
    else localStorage.removeItem(LS_MAX_DIM);
  } catch {}
});

// ─── i18n bootstrap ───────────────────────────────────────────────────────

function applyTranslations() {
  document.documentElement.setAttribute("lang", getLang());
  document.title = t("title");
  for (const el of document.querySelectorAll("[data-i18n]")) {
    el.textContent = t(el.getAttribute("data-i18n"));
  }
  for (const el of document.querySelectorAll("[data-i18n-title]")) {
    el.setAttribute("title", t(el.getAttribute("data-i18n-title")));
  }
  renderEngineStatus();
  render();
  invoke("set_tray_labels", {
    labels: {
      show: t("tray_show"),
      compact: t("tray_compact"),
      about: t("tray_about"),
      checkUpdates: t("tray_check_updates"),
      quit: t("tray_quit"),
    },
  }).catch((e) => console.warn("set_tray_labels failed", e));
}

function buildLangPicker() {
  langSelect.innerHTML = "";
  for (const lang of SUPPORTED_LANGS) {
    const opt = document.createElement("option");
    opt.value = lang;
    opt.textContent = translations[lang][`lang_${langName(lang)}`];
    langSelect.appendChild(opt);
  }
  langSelect.value = getLang();
  langSelect.addEventListener("change", () => setLang(langSelect.value));
}

onLangChange(applyTranslations);

// ─── engine init ──────────────────────────────────────────────────────────

async function init() {
  buildLangPicker();
  document.body.classList.add("engine-loading");
  convertBtn.disabled = true;
  loadSavedOutputFolder();
  loadSavedEncodeOpts();
  if (!outputFolder) setOutputFolder(null);
  applyTranslations();

  try {
    const ping = await invoke("engine_ping");
    versionEl.textContent = `v${ping.version}`;
    engineState = { kind: "ready" };
    renderEngineStatus();
    document.body.classList.remove("engine-loading");
    document.body.classList.add("engine-ready");
    convertBtn.disabled = false;
  } catch (err) {
    engineState = { kind: "error", err: localizedError(err) };
    renderEngineStatus();
    toast(t("engine_error", { err: localizedError(err) }), "error", 6000);
  }

  try {
    supportedFormats = await invoke("engine_list_formats");
    formatSelect.innerHTML = "";
    for (const f of supportedFormats.output_formats) {
      const opt = document.createElement("option");
      opt.value = f;
      opt.textContent = f;
      formatSelect.appendChild(opt);
    }
    populateHelpChips();
    refreshQualityVisibility();
    formatSelect.addEventListener("change", refreshQualityVisibility);
  } catch (err) {
    console.error("list_formats failed", err);
  }

  // Silent background update check 5 s after launch. If a newer release
  // exists, ask the user via a native confirm dialog; on yes, kick off
  // download + install + restart.
  setTimeout(async () => {
    try {
      const r = await invoke("check_for_updates");
      if (!r?.available) return;
      const ask = window.__TAURI__?.dialog?.ask;
      if (!ask) return;
      const yes = await ask(
        t("update_prompt", { ver: r.version }),
        { title: t("title"), kind: "info", okLabel: t("update_install_now"), cancelLabel: t("update_later") }
      );
      if (!yes) return;
      showUpdateProgress("downloading", { downloaded: 0, total: 0, percent: 0 });
      await invoke("install_update");
    } catch (err) {
      console.warn("startup update check failed:", err);
      hideUpdateProgress();
    }
  }, 5000);
}

// ─── update progress overlay ─────────────────────────────────────────────
const updateOverlay = $("update-progress");
const updateTitle = $("update-title");
const updateBarFill = $("update-bar-fill");
const updateMeta = $("update-meta");

function formatBytes(n) {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

function showUpdateProgress(phase, p) {
  if (phase === "downloading") {
    updateTitle.textContent = t("update_phase_downloading");
    updateBarFill.classList.remove("indeterminate");
    updateBarFill.style.width = `${p.percent}%`;
    updateMeta.textContent = p.total > 0
      ? `${formatBytes(p.downloaded)} / ${formatBytes(p.total)}  ·  ${p.percent}%`
      : formatBytes(p.downloaded);
  } else if (phase === "installing") {
    updateTitle.textContent = t("update_phase_installing");
    updateBarFill.classList.add("indeterminate");
    updateBarFill.style.width = "";
    updateMeta.textContent = "";
  }
  updateOverlay.classList.remove("hidden");
}

function hideUpdateProgress() {
  updateOverlay.classList.add("hidden");
  updateBarFill.classList.remove("indeterminate");
  updateBarFill.style.width = "0%";
}

// Rust emits update-progress events from install_update.
if (window.__TAURI__?.event?.listen) {
  window.__TAURI__.event.listen("update-progress", (event) => {
    const p = event.payload || {};
    showUpdateProgress(p.phase, p);
  }).catch((err) => console.warn("update-progress listen failed:", err));
}

// ─── file pickers / drop ──────────────────────────────────────────────────

// Native file picker — returns absolute paths the engine can read.
// HTML <input type="file"> would only give us filenames in WebKit/WebView2.
async function openNativeFilePicker() {
  try {
    const paths = await invoke("pick_input_files");
    if (Array.isArray(paths) && paths.length) {
      addFiles(paths.map((p) => ({ path: p, name: p.split(/[\\/]/).pop() })));
    }
  } catch (err) {
    console.error("pick_input_files failed", err);
  }
}

dropzone.addEventListener("click", openNativeFilePicker);
dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("dragover");
});
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("dragover");
});

if (appWindow?.listen) {
  appWindow.listen("tauri://drag-drop", async (event) => {
    dropzone.classList.remove("dragover");
    const raw = event.payload?.paths || [];
    if (raw.length === 0) return;
    // Expand any folders in the drop into their contained supported files.
    let paths = raw;
    let truncated = false;
    try {
      const r = await invoke("expand_folders", { paths: raw });
      paths = r.paths || [];
      truncated = !!r.truncated;
    } catch (e) { console.warn("expand_folders failed", e); }
    addFiles(paths.map((p) => ({ path: p, name: p.split(/[\\/]/).pop() })));
    if (truncated) toast(t("msg_truncated"), "info", 4500);
  }).catch(() => {});
  appWindow.listen("tauri://drag-enter", () => dropzone.classList.add("dragover")).catch(() => {});
  appWindow.listen("tauri://drag-leave", () => dropzone.classList.remove("dragover")).catch(() => {});
}

function addFiles(items) {
  const seen = new Set(files.map((f) => f.path));
  let added = 0;
  for (const it of items) {
    if (seen.has(it.path)) continue;
    seen.add(it.path);
    files.push({ ...it, statusKey: "queued" });
    added++;
  }
  if (added > 0) {
    render();
    toast(t("msg_added_n", { n: added }), "success");
  } else if (items.length > 0) {
    toast(t("msg_no_new"), "info", 1600);
  }
}

const removeFile = (idx) => {
  files.splice(idx, 1);
  render();
};

// ─── output folder UI ─────────────────────────────────────────────────────

changeOutputBtn.addEventListener("click", async () => {
  const folder = await invoke("pick_output_folder");
  if (folder) {
    setOutputFolder(folder);
    toast(folder, "success", 1600);
  }
});

openOutputBtn.addEventListener("click", async () => {
  if (!outputFolder) return;
  try { await invoke("open_path", { path: outputFolder }); }
  catch (err) { toast(localizedError(err), "error"); }
});

// ─── conversion loop ──────────────────────────────────────────────────────

convertBtn.addEventListener("click", () => startConversion());
cancelBtn.addEventListener("click", () => {
  cancelRequested = true;
  // Kill the engine subprocess so an in-flight (e.g. multi-page PDF) call
  // doesn't run to completion. The Rust side will respawn on next use.
  invoke("engine_cancel").catch(() => {});
});

/** Run a single conversion against the engine and update the file row's
 *  status. Returns true on success, false on error — caller drives the
 *  batch progress counters. Shared between the initial batch and the
 *  per-row retry button. */
async function runConvertOne(f, fmt, quality, maxDim) {
  f.statusKey = "running";
  f.statusParams = undefined;
  f.statusClass = "";
  render();
  try {
    const r = await invoke("convert_one", {
      input: f.path, outDir: outputFolder, format: fmt,
      quality, maxDim,
    });
    f.statusKey = "ok";
    f.statusParams = { n: r.written };
    f.statusClass = "ok";
    render();
    return true;
  } catch (e) {
    f.statusKey = "err";
    f.statusParams = { err: localizedError(e) };
    f.statusClass = "err";
    render();
    return false;
  }
}

/** Retry a single failed file with current UI settings. No-op while a
 *  batch is in flight (avoids racing the worker pool). */
async function retryFile(f) {
  if (busy) return;
  if (!outputFolder) {
    const picked = await invoke("pick_output_folder");
    if (!picked) return;
    setOutputFolder(picked);
  }
  const fmt = formatSelect.value;
  const quality = Number(qualitySlider.value) || 90;
  const maxDimRaw = Number(maxDimInput.value) || 0;
  const maxDim = maxDimRaw > 0 ? maxDimRaw : null;
  await runConvertOne(f, fmt, quality, maxDim);
}

async function startConversion() {
  if (busy) return;
  if (files.length === 0) {
    toast(t("msg_no_files"), "info");
    return;
  }
  if (!outputFolder) {
    const picked = await invoke("pick_output_folder");
    if (!picked) return;
    setOutputFolder(picked);
  }

  cancelRequested = false;
  setUiBusy(true);
  progressEl.classList.remove("hidden");
  progressSummary.classList.add("hidden");
  barFill.style.width = "0%";
  let done = 0, ok = 0, err = 0;
  const fmt = formatSelect.value;
  const quality = Number(qualitySlider.value) || 90;
  const maxDimRaw = Number(maxDimInput.value) || 0;
  const maxDim = maxDimRaw > 0 ? maxDimRaw : null;

  // Sidecar now has a 4-thread pool, so dispatch up to 4 conversions
  // concurrently. Local concurrency cap mirrors the worker count so we
  // don't queue more than the sidecar can actually run in parallel.
  const CONCURRENCY = 4;
  let cursor = 0;
  const convertOne = async (f) => {
    if (cancelRequested) { f.statusKey = "queued"; return; }
    const success = await runConvertOne(f, fmt, quality, maxDim);
    if (success) ok++; else err++;
    done++;
    barFill.style.width = `${(done / files.length) * 100}%`;
    progressText.textContent = `${done} / ${files.length}`;
  };
  const workers = Array.from({ length: Math.min(CONCURRENCY, files.length) }, async () => {
    while (cursor < files.length && !cancelRequested) {
      const f = files[cursor++];
      await convertOne(f);
    }
  });
  await Promise.all(workers);

  progressSummary.textContent = t("summary_done", { ok, err });
  progressSummary.classList.remove("hidden");
  setUiBusy(false);

  // Toast + system notification when batch finishes naturally.
  if (!cancelRequested && ok > 0) {
    toast(t("summary_done", { ok, err }), err > 0 ? "error" : "success", 3500);
    invoke("notify", {
      title: t("title"),
      body: t("msg_done_notify", { ok }),
    }).catch(() => {}); // notify is optional — don't crash if it fails
  }
}

clearBtn.addEventListener("click", () => {
  if (busy) return;
  files = [];
  progressEl.classList.add("hidden");
  render();
});

function setUiBusy(b) {
  busy = b;
  convertBtn.disabled = b;
  clearBtn.disabled = b;
  formatSelect.disabled = b;
  langSelect.disabled = b;
  changeOutputBtn.disabled = b;
  cancelBtn.classList.toggle("hidden", !b);
  convertBtn.classList.toggle("hidden", b);
}

// ─── render file list ─────────────────────────────────────────────────────

function render() {
  // Total + breakdown by extension (desc), e.g. "4 · PDF 3 · JPG 1".
  if (files.length === 0) {
    listCountEl.textContent = "0";
    fileListEl.innerHTML = "";
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = t("list_empty");
    fileListEl.appendChild(p);
    return;
  }
  const byType = {};
  for (const f of files) {
    const m = f.name.match(/\.([^.]+)$/);
    const ext = m ? m[1].toUpperCase() : "?";
    byType[ext] = (byType[ext] || 0) + 1;
  }
  const breakdown = Object.entries(byType)
    .sort((a, b) => b[1] - a[1])
    .map(([ext, n]) => `${ext} ${n}`)
    .join(" · ");
  listCountEl.textContent = `${files.length} · ${breakdown}`;

  const frag = document.createDocumentFragment();
  files.forEach((f) => {
    const row = document.createElement("div");
    row.className = "file-row";

    const thumb = document.createElement("div");
    thumb.className = "thumb";
    thumb.title = t("thumb_open_tip") || "Open source file";
    thumb.addEventListener("click", (e) => {
      e.stopPropagation();
      console.log("thumb click → open_file:", f.path);
      invoke("open_file", { path: f.path })
        .then(() => console.log("open_file ok"))
        .catch((err) => {
          console.warn("open_file failed:", err);
          toast(`open failed: ${err}`, "error", 4000);
        });
    });
    if (IMAGE_EXT.test(f.name) && convertFileSrc) {
      const img = document.createElement("img");
      img.src = convertFileSrc(f.path);
      img.alt = "";
      img.loading = "lazy";
      img.onerror = () => {
        thumb.innerHTML = "";
        const b = document.createElement("span");
        b.className = "badge";
        b.textContent = fileBadge(f.name);
        thumb.appendChild(b);
      };
      thumb.appendChild(img);
    } else if (PDF_EXT.test(f.name)) {
      // Try cache first — render() runs every time the file list changes
      // (status updates, language switches, etc.) and PDFs are the only
      // thumbnails generated through an RPC, so caching matters.
      const cached = pdfThumbCache.get(f.path);
      if (cached) {
        const img = document.createElement("img");
        img.src = cached;
        img.alt = "";
        thumb.appendChild(img);
      } else {
        const b = document.createElement("span");
        b.className = "badge";
        b.textContent = fileBadge(f.name);
        thumb.appendChild(b);
        let pending = pdfThumbInFlight.get(f.path);
        if (!pending) {
          pending = invoke("preview_pdf", { path: f.path });
          pdfThumbInFlight.set(f.path, pending);
        }
        pending.then((dataurl) => {
          pdfThumbInFlight.delete(f.path);
          if (!dataurl) return;
          pdfThumbCache.set(f.path, dataurl);
          // Re-render only if THIS row is still the one currently shown
          // (the user might have removed/cleared the file in the meantime).
          if (files.indexOf(f) >= 0) render();
        }).catch(() => {
          pdfThumbInFlight.delete(f.path);
          // leave the badge
        });
      }
    } else {
      const b = document.createElement("span");
      b.className = "badge";
      b.textContent = fileBadge(f.name);
      thumb.appendChild(b);
    }
    row.appendChild(thumb);

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = f.name;
    name.title = f.path;
    row.appendChild(name);

    const status = document.createElement("span");
    status.className = `status ${f.statusClass || ""}`.trim();
    status.textContent = t(`status_${f.statusKey}`, f.statusParams || {});
    row.appendChild(status);

    if (f.statusKey === "err") {
      const retryBtn = document.createElement("button");
      retryBtn.className = "retry-btn";
      retryBtn.title = t("btn_retry");
      retryBtn.setAttribute("aria-label", t("btn_retry"));
      retryBtn.textContent = "↻";
      if (busy) retryBtn.disabled = true;
      retryBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        retryFile(f);
      });
      row.appendChild(retryBtn);
    }

    const removeBtn = document.createElement("button");
    removeBtn.className = "remove-btn";
    removeBtn.title = t("btn_remove_file");
    removeBtn.setAttribute("aria-label", t("btn_remove_file"));
    removeBtn.textContent = "✕";
    if (busy) removeBtn.disabled = true;
    removeBtn.addEventListener("click", () => {
      if (busy) return;
      const i = files.indexOf(f);
      if (i >= 0) removeFile(i);
    });
    row.appendChild(removeBtn);

    frag.appendChild(row);
  });
  fileListEl.replaceChildren(frag);
}

// ─── About / Update dialog ────────────────────────────────────────────────

$("about-close-btn").addEventListener("click", () => aboutDialog.close());
$("check-updates-btn").addEventListener("click", checkForUpdates);

function openAbout() {
  aboutVersionEl.textContent = versionEl.textContent;
  updateStatusEl.textContent = "";
  if (!aboutDialog.open) aboutDialog.showModal();
}

async function checkForUpdates() {
  updateStatusEl.textContent = t("update_checking");
  try {
    const r = await invoke("check_for_updates");
    updateStatusEl.textContent = r.available
      ? t("update_available", { ver: r.version })
      : t("update_uptodate");
  } catch (err) {
    updateStatusEl.textContent = t("update_failed", { err: localizedError(err) });
  }
}

// ─── Help dialog ──────────────────────────────────────────────────────────

helpBtn.addEventListener("click", openHelp);
$("help-close-btn").addEventListener("click", () => helpDialog.close());

function openHelp() {
  populateHelpChips();
  if (!helpDialog.open) helpDialog.showModal();
}

function populateHelpChips() {
  const chips = (parent, items) => {
    parent.innerHTML = "";
    for (const it of items) {
      const c = document.createElement("span");
      c.className = "chip";
      c.textContent = it;
      parent.appendChild(c);
    }
  };
  chips(helpInputsEl, supportedFormats.input_extensions || []);
  chips(helpOutputsEl, supportedFormats.output_formats || []);
}

// ─── tray-driven events from Rust ─────────────────────────────────────────

window.addEventListener("picvert:show-about", openAbout);
window.addEventListener("picvert:check-updates", () => {
  openAbout();
  checkForUpdates();
});

// Close button (red traffic light) — Rust prevents the OS-level close and
// emits this event so we can play a leave animation before collapsing
// into the floating capsule.
window.addEventListener("picvert:close-requested", () => {
  document.body.classList.add("leaving");
  setTimeout(() => {
    invoke("hide_main_show_compact").finally(() => {
      // Reset for next time the window is shown.
      document.body.classList.remove("leaving");
    });
  }, 200);
});

// ─── keyboard shortcuts ───────────────────────────────────────────────────

document.addEventListener("keydown", (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (!mod) return;
  // ⌘O — open file picker
  if (e.key.toLowerCase() === "o") {
    e.preventDefault();
    if (!busy) openNativeFilePicker();
  }
  // ⌘Enter — start conversion
  else if (e.key === "Enter") {
    e.preventDefault();
    if (!busy) startConversion();
  }
  // ⌘L — clear queue
  else if (e.key.toLowerCase() === "l") {
    e.preventDefault();
    if (!busy) clearBtn.click();
  }
  // ⌘. — cancel current batch
  else if (e.key === "." && busy) {
    e.preventDefault();
    cancelRequested = true;
  }
});

// Tooltips for shortcut discoverability.
convertBtn.title = "⌘↵";
clearBtn.title = "⌘L";
cancelBtn.title = "⌘.";

// ─── misc ─────────────────────────────────────────────────────────────────

suppressContextMenu();
init();
