// Picvert v2 frontend.
// Talks to Tauri Rust commands; engine work goes through the picvert-engine
// sidecar via JSON-RPC (handled in src-tauri/src/lib.rs).

import { SUPPORTED_LANGS, getLang, setLang, onLangChange, t, translations } from "./i18n.js";

if (!window.__TAURI__) {
  document.addEventListener("DOMContentLoaded", () => {
    document.body.innerHTML =
      '<div style="padding:2rem;font-family:system-ui;color:#b00">' +
      "<h2>Picvert init failed</h2>" +
      "<p>window.__TAURI__ is not defined.</p>" +
      "</div>";
  });
  throw new Error("__TAURI__ not injected");
}

const { invoke, convertFileSrc } = window.__TAURI__.core;
const listen = window.__TAURI__.event ? window.__TAURI__.event.listen : null;

// ─────────────────────────────────────────────────── DOM refs

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("file-input");
const formatSelect = document.getElementById("format-select");
const convertBtn = document.getElementById("convert-btn");
const clearBtn = document.getElementById("clear-btn");
const fileListEl = document.getElementById("file-list");
const progressEl = document.getElementById("progress");
const barFill = document.getElementById("bar-fill");
const progressText = document.getElementById("progress-text");
const progressSummary = document.getElementById("progress-summary");
const versionEl = document.getElementById("version");
const engineStatusEl = document.getElementById("engine-status");
const langSelect = document.getElementById("lang-select");
const outputFolderEl = document.getElementById("output-folder");
const changeOutputBtn = document.getElementById("change-output-btn");
const openOutputBtn = document.getElementById("open-output-btn");

// ─────────────────────────────────────────────────── state

let files = [];
let outputFolder = null;
let engineReadyMessage = null;
const isImageExt = (name) =>
  /\.(png|jpe?g|jfif|bmp|gif|tiff?|webp|ico|ppm|tga|jp2|heic)$/i.test(name);

// ─────────────────────────────────────────────────── helpers

function errMessage(err) {
  if (err && typeof err === "object") {
    return err.message || err.kind || JSON.stringify(err);
  }
  return String(err);
}

function setEngineStatus(state, message) {
  engineStatusEl.innerHTML = "";
  if (state === "loading") {
    const sp = document.createElement("span");
    sp.className = "spinner";
    engineStatusEl.appendChild(sp);
  }
  engineStatusEl.appendChild(document.createTextNode(message));
}

function setOutputFolder(path) {
  outputFolder = path;
  if (path) {
    outputFolderEl.textContent = path;
    outputFolderEl.classList.remove("muted");
    outputFolderEl.removeAttribute("data-i18n");
    openOutputBtn.classList.remove("hidden");
  } else {
    outputFolderEl.textContent = t("output_unset");
    outputFolderEl.setAttribute("data-i18n", "output_unset");
    outputFolderEl.classList.add("muted");
    openOutputBtn.classList.add("hidden");
  }
}

// ─────────────────────────────────────────────────── i18n bootstrap

function applyTranslations() {
  document.documentElement.setAttribute("lang", getLang());
  document.title = t("title");
  for (const el of document.querySelectorAll("[data-i18n]")) {
    el.textContent = t(el.getAttribute("data-i18n"));
  }
  if (engineReadyMessage) {
    const state = document.body.classList.contains("engine-loading")
      ? "loading"
      : document.body.classList.contains("engine-ready")
        ? "ready"
        : "error";
    setEngineStatus(state, engineReadyMessage(t));
  }
  render();
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

function langName(lang) {
  return { en: "english", es: "spanish", ru: "russian", zh: "chinese" }[lang] || "english";
}

onLangChange(applyTranslations);

// ─────────────────────────────────────────────────── engine init

async function init() {
  buildLangPicker();
  document.body.classList.add("engine-loading");
  engineReadyMessage = (tt) => tt("engine_loading");
  convertBtn.disabled = true;
  setOutputFolder(null);
  applyTranslations();
  setEngineStatus("loading", t("engine_loading"));

  try {
    const ping = await invoke("engine_ping");
    versionEl.textContent = `v${ping.version}`;
    engineReadyMessage = (tt) => tt("engine_ready");
    setEngineStatus("ready", engineReadyMessage(t));
    document.body.classList.remove("engine-loading");
    document.body.classList.add("engine-ready");
    convertBtn.disabled = false;
  } catch (err) {
    engineReadyMessage = (tt) => tt("engine_error", { err: errMessage(err) });
    setEngineStatus("error", engineReadyMessage(t));
  }

  try {
    const fmts = await invoke("engine_list_formats");
    formatSelect.innerHTML = "";
    for (const f of fmts.output_formats) {
      const opt = document.createElement("option");
      opt.value = f;
      opt.textContent = f;
      formatSelect.appendChild(opt);
    }
  } catch (err) {
    console.error("list_formats failed", err);
  }
}

// ─────────────────────────────────────────────────── file pickers

fileInput.addEventListener("change", () => {
  const added = [];
  for (const f of fileInput.files) added.push({ path: f.path || f.name, name: f.name });
  addFiles(added);
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

if (listen) {
  listen("tauri://drag-drop", (event) => {
    const paths = event.payload?.paths || [];
    addFiles(paths.map((p) => ({ path: p, name: p.split(/[\\/]/).pop() })));
  });
  listen("tauri://drag-enter", () => dropzone.classList.add("dragover"));
  listen("tauri://drag-leave", () => dropzone.classList.remove("dragover"));
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

function removeFile(idx) {
  files.splice(idx, 1);
  render();
}

// ─────────────────────────────────────────────────── output folder

changeOutputBtn.addEventListener("click", async () => {
  const folder = await invoke("pick_output_folder");
  if (folder) setOutputFolder(folder);
});

openOutputBtn.addEventListener("click", async () => {
  if (!outputFolder) return;
  try {
    await invoke("open_path", { path: outputFolder });
  } catch (err) {
    console.error("open_path failed", err);
  }
});

// ─────────────────────────────────────────────────── conversion

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
  let done = 0;
  let okCount = 0;
  let errCount = 0;

  const fmt = formatSelect.value;
  for (const f of files) {
    f.statusKey = "running";
    render();
    try {
      const r = await invoke("convert_one", {
        input: f.path,
        outDir: outputFolder,
        format: fmt,
      });
      f.statusKey = "ok";
      f.statusParams = { n: r.written };
      f.statusClass = "ok";
      okCount++;
    } catch (err) {
      f.statusKey = "err";
      f.statusParams = { err: errMessage(err) };
      f.statusClass = "err";
      errCount++;
    }
    done++;
    barFill.style.width = `${(done / files.length) * 100}%`;
    progressText.textContent = `${done} / ${files.length}`;
    render();
  }

  progressSummary.textContent = t("summary_done", { ok: okCount, err: errCount });
  progressSummary.classList.remove("hidden");
  setUiBusy(false);
});

clearBtn.addEventListener("click", () => {
  files = [];
  progressEl.classList.add("hidden");
  render();
});

function setUiBusy(busy) {
  convertBtn.disabled = busy;
  clearBtn.disabled = busy;
  formatSelect.disabled = busy;
  langSelect.disabled = busy;
  changeOutputBtn.disabled = busy;
}

// ─────────────────────────────────────────────────── render

function fileBadge(name) {
  const ext = name.split(".").pop().toLowerCase();
  return { pdf: "PDF", docx: "DOC", xlsx: "XLS", csv: "CSV", svg: "SVG" }[ext] || ext.toUpperCase();
}

function render() {
  if (files.length === 0) {
    fileListEl.innerHTML = "";
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = t("list_empty");
    fileListEl.appendChild(p);
    return;
  }
  fileListEl.innerHTML = "";
  files.forEach((f, idx) => {
    const row = document.createElement("div");
    row.className = "file-row";

    // Thumbnail (image preview via tauri's asset protocol; otherwise type badge).
    const thumb = document.createElement("div");
    thumb.className = "thumb";
    if (isImageExt(f.name) && convertFileSrc) {
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
    removeBtn.addEventListener("click", () => removeFile(idx));
    row.appendChild(removeBtn);

    fileListEl.appendChild(row);
  });
}

// ─────────────────────────────────────────────────── misc

window.addEventListener("contextmenu", (e) => e.preventDefault());

// About / updates dialog (also triggered by the tray menu).
const aboutDialog = document.getElementById("about-dialog");
const aboutVersionEl = document.getElementById("about-version");
const updateStatusEl = document.getElementById("update-status");
const checkUpdatesBtn = document.getElementById("check-updates-btn");
document
  .getElementById("about-close-btn")
  .addEventListener("click", () => aboutDialog.close());

function openAbout() {
  aboutVersionEl.textContent = versionEl.textContent;
  updateStatusEl.textContent = "";
  if (!aboutDialog.open) aboutDialog.showModal();
}

async function checkForUpdates() {
  updateStatusEl.textContent = t("update_checking");
  try {
    const updater = window.__TAURI__.updater;
    if (!updater || !updater.check) {
      updateStatusEl.textContent = t("update_failed", { err: "updater plugin unavailable" });
      return;
    }
    const update = await updater.check();
    if (update && update.available) {
      updateStatusEl.textContent = t("update_available", { ver: update.version });
    } else {
      updateStatusEl.textContent = t("update_uptodate");
    }
  } catch (err) {
    updateStatusEl.textContent = t("update_failed", { err: errMessage(err) });
  }
}

checkUpdatesBtn.addEventListener("click", checkForUpdates);
window.addEventListener("picvert:show-about", openAbout);
window.addEventListener("picvert:check-updates", () => {
  openAbout();
  checkForUpdates();
});

init();
