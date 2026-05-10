// Picvert v2 frontend — vanilla JS shell, no bundler.
//
// Talks to Tauri's Rust core via window.__TAURI__.core.invoke() (made
// available by withGlobalTauri: true). All conversion work goes through
// the picvert-engine sidecar over JSON-RPC, dispatched by Rust.

import { SUPPORTED_LANGS, getLang, setLang, onLangChange, t, translations } from "./i18n.js";

// ─── early sanity check ──────────────────────────────────────────────────

if (!window.__TAURI__) {
  document.addEventListener("DOMContentLoaded", () => {
    document.body.innerHTML =
      '<div style="padding:2rem;font-family:system-ui;color:#b56b6b">' +
      "<h2>Picvert init failed</h2>" +
      "<p><code>window.__TAURI__</code> is not injected. Open Tauri shell, not the raw HTML.</p>" +
      "</div>";
  });
  throw new Error("__TAURI__ not injected");
}

const { invoke, convertFileSrc } = window.__TAURI__.core;

/** Resolve the current webview window across the names Tauri 2 might expose. */
function resolveAppWindow() {
  const ns = window.__TAURI__;
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
const appWindow = resolveAppWindow();

// ─── DOM refs ─────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);
const dropzone = $("dropzone");
const fileInput = $("file-input");
const formatSelect = $("format-select");
const convertBtn = $("convert-btn");
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

// ─── state ────────────────────────────────────────────────────────────────

const LS_OUTPUT = "picvert.outputFolder";
const IMAGE_EXT = /\.(png|jpe?g|jfif|bmp|gif|tiff?|webp|ico|ppm|tga|jp2|heic)$/i;

let files = [];
let outputFolder = null;
let busy = false;

// engineState is a tagged union so applyTranslations() can reproduce the
// localised footer text after a language change.
let engineState = { kind: "loading" };

let supportedFormats = { input_extensions: [], output_formats: [] };

// ─── small helpers ────────────────────────────────────────────────────────

const errMessage = (err) =>
  err && typeof err === "object" ? (err.message || err.kind || JSON.stringify(err)) : String(err);

const fileBadge = (name) => {
  const ext = name.split(".").pop().toLowerCase();
  return { pdf: "PDF", docx: "DOC", xlsx: "XLS", csv: "CSV", svg: "SVG" }[ext] || ext.toUpperCase();
};

function langName(lang) {
  return { en: "english", es: "spanish", ru: "russian", zh: "chinese" }[lang] || "english";
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

// ─── i18n bootstrap ───────────────────────────────────────────────────────

function applyTranslations() {
  document.documentElement.setAttribute("lang", getLang());
  document.title = t("title");
  for (const el of document.querySelectorAll("[data-i18n]")) {
    el.textContent = t(el.getAttribute("data-i18n"));
  }
  renderEngineStatus();
  render();
  // Push label updates to the tray menu.
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
    engineState = { kind: "error", err: errMessage(err) };
    renderEngineStatus();
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
  } catch (err) {
    console.error("list_formats failed", err);
  }
}

// ─── file pickers / drop ──────────────────────────────────────────────────

fileInput.addEventListener("change", () => {
  const items = [...fileInput.files].map((f) => ({ path: f.path || f.name, name: f.name }));
  addFiles(items);
});

dropzone.addEventListener("click", () => fileInput.click());
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
  appWindow.listen("tauri://drag-drop", (event) => {
    dropzone.classList.remove("dragover");
    const paths = event.payload?.paths || [];
    addFiles(paths.map((p) => ({ path: p, name: p.split(/[\\/]/).pop() })));
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
  if (added > 0) render();
}

const removeFile = (idx) => {
  files.splice(idx, 1);
  render();
};

// ─── output folder UI ─────────────────────────────────────────────────────

changeOutputBtn.addEventListener("click", async () => {
  const folder = await invoke("pick_output_folder");
  if (folder) setOutputFolder(folder);
});

openOutputBtn.addEventListener("click", async () => {
  if (!outputFolder) return;
  try { await invoke("open_path", { path: outputFolder }); }
  catch (err) { console.error("open_path failed", err); }
});

// ─── conversion loop ──────────────────────────────────────────────────────

convertBtn.addEventListener("click", async () => {
  if (files.length === 0) {
    alert(t("msg_no_files"));
    return;
  }
  if (!outputFolder) {
    const picked = await invoke("pick_output_folder");
    if (!picked) return;
    setOutputFolder(picked);
  }

  setUiBusy(true);
  progressEl.classList.remove("hidden");
  progressSummary.classList.add("hidden");
  barFill.style.width = "0%";
  let done = 0, ok = 0, err = 0;
  const fmt = formatSelect.value;

  for (const f of files) {
    f.statusKey = "running";
    render();
    try {
      const r = await invoke("convert_one", { input: f.path, outDir: outputFolder, format: fmt });
      f.statusKey = "ok";
      f.statusParams = { n: r.written };
      f.statusClass = "ok";
      ok++;
    } catch (e) {
      f.statusKey = "err";
      f.statusParams = { err: errMessage(e) };
      f.statusClass = "err";
      err++;
    }
    done++;
    barFill.style.width = `${(done / files.length) * 100}%`;
    progressText.textContent = `${done} / ${files.length}`;
    render();
  }

  progressSummary.textContent = t("summary_done", { ok, err });
  progressSummary.classList.remove("hidden");
  setUiBusy(false);
});

clearBtn.addEventListener("click", () => {
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
}

// ─── render file list ─────────────────────────────────────────────────────

function render() {
  listCountEl.textContent = String(files.length);

  if (files.length === 0) {
    fileListEl.innerHTML = "";
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = t("list_empty");
    fileListEl.appendChild(p);
    return;
  }

  const frag = document.createDocumentFragment();
  files.forEach((f) => {
    const row = document.createElement("div");
    row.className = "file-row";

    const thumb = document.createElement("div");
    thumb.className = "thumb";
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
    updateStatusEl.textContent = t("update_failed", { err: errMessage(err) });
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
window.addEventListener("picvert:show-help", openHelp);

// Suppress dev context menu in production.
window.addEventListener("contextmenu", (e) => e.preventDefault());

init();
