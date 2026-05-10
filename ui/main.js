// Picvert v2 frontend — minimal vanilla-JS shell.
// Talks to the Tauri Rust core via window.__TAURI__.core.invoke().
//
// Tauri commands exposed by src-tauri/src/lib.rs:
//   - engine_ping()                    -> { version }
//   - engine_list_formats()            -> { input_extensions, output_formats }
//   - convert_one(input, outDir, fmt)  -> { written }
//   - pick_output_folder()             -> string | null
//
// Requires `withGlobalTauri: true` in tauri.conf.json so the namespace is
// injected for vanilla HTML/JS (i.e. no npm/bundler in the loop).

if (!window.__TAURI__) {
  document.addEventListener("DOMContentLoaded", () => {
    document.body.innerHTML =
      '<div style="padding:2rem;font-family:system-ui;color:#b00">' +
      '<h2>Picvert init failed</h2>' +
      '<p>window.__TAURI__ is not defined. The shell did not inject the API.</p>' +
      '<p>This means <code>withGlobalTauri</code> is not enabled, or the page was opened outside Tauri.</p>' +
      "</div>";
  });
  throw new Error("__TAURI__ not injected");
}

const { invoke } = window.__TAURI__.core;
const listen = window.__TAURI__.event ? window.__TAURI__.event.listen : null;

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("file-input");
const formatSelect = document.getElementById("format-select");
const convertBtn = document.getElementById("convert-btn");
const clearBtn = document.getElementById("clear-btn");
const fileListEl = document.getElementById("file-list");
const progressEl = document.getElementById("progress");
const barFill = document.getElementById("bar-fill");
const progressText = document.getElementById("progress-text");
const versionEl = document.getElementById("version");
const engineStatusEl = document.getElementById("engine-status");

let files = []; // [{ path, name, status }]
let outputFolder = null;

// ---------------------------------------------------------------------- init
async function init() {
  try {
    const ping = await invoke("engine_ping");
    versionEl.textContent = `v${ping.version}`;
    engineStatusEl.textContent = "Engine: ✅ ready";
  } catch (err) {
    engineStatusEl.textContent = `Engine: ❌ ${err}`;
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

// ---------------------------------------------------------------- file pickers
fileInput.addEventListener("change", () => {
  for (const f of fileInput.files) addFile({ path: f.path || f.name, name: f.name });
  render();
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

// Tauri's native file-drop event gives us real OS paths.
if (listen) {
  listen("tauri://drag-drop", (event) => {
    const paths = event.payload?.paths || [];
    for (const path of paths) {
      addFile({ path, name: path.split(/[\\/]/).pop() });
    }
    render();
  });
}

function addFile(f) {
  if (files.some((existing) => existing.path === f.path)) return;
  files.push({ ...f, status: "queued" });
}

// ---------------------------------------------------------------- conversion
convertBtn.addEventListener("click", async () => {
  if (files.length === 0) {
    alert("Add some files first.");
    return;
  }
  if (!outputFolder) {
    outputFolder = await invoke("pick_output_folder");
    if (!outputFolder) return;
  }

  setUiBusy(true);
  progressEl.classList.remove("hidden");
  barFill.style.width = "0%";
  let done = 0;

  const fmt = formatSelect.value;
  for (const f of files) {
    f.status = "running";
    render();
    try {
      const r = await invoke("convert_one", {
        input: f.path,
        outDir: outputFolder,
        format: fmt,
      });
      f.status = `ok (${r.written})`;
      f.statusClass = "ok";
    } catch (err) {
      f.status = `error: ${err}`;
      f.statusClass = "err";
    }
    done++;
    barFill.style.width = `${(done / files.length) * 100}%`;
    progressText.textContent = `${done} / ${files.length}`;
    render();
  }

  setUiBusy(false);
});

clearBtn.addEventListener("click", () => {
  files = [];
  outputFolder = null;
  progressEl.classList.add("hidden");
  render();
});

function setUiBusy(busy) {
  convertBtn.disabled = busy;
  clearBtn.disabled = busy;
  formatSelect.disabled = busy;
}

// ------------------------------------------------------------------- render
function render() {
  if (files.length === 0) {
    fileListEl.innerHTML = '<p class="empty">No files yet.</p>';
    return;
  }
  fileListEl.innerHTML = "";
  for (const f of files) {
    const row = document.createElement("div");
    row.className = "file-row";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = f.name;
    const status = document.createElement("span");
    status.className = `status ${f.statusClass || ""}`.trim();
    status.textContent = f.status;
    row.appendChild(name);
    row.appendChild(status);
    fileListEl.appendChild(row);
  }
}

init();
