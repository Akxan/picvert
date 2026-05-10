// Picvert frontend i18n — pure JS, no IPC needed.
// All UI text lives here so language switching is instant.

export const SUPPORTED_LANGS = ["en", "es", "ru", "zh"];

export const translations = {
  en: {
    title: "Picvert",
    subtitle: "Batch image / PDF / document converter",
    drop_prompt: "Drop files here or click to select",
    label_output_format: "Output format:",
    btn_convert: "Start Conversion",
    btn_clear: "Clear",
    list_empty: "No files yet.",
    engine_loading: "Engine: ⏳ starting…",
    engine_ready: "Engine: ✅ ready",
    engine_error: "Engine: ❌ {err}",
    status_queued: "queued",
    status_running: "running…",
    status_ok: "ok ({n})",
    status_err: "error: {err}",
    msg_no_files: "Add some files first.",
    label_lang: "Language",
    lang_english: "English",
    lang_spanish: "Spanish",
    lang_russian: "Russian",
    lang_chinese: "Chinese",
  },
  es: {
    title: "Picvert",
    subtitle: "Conversor por lotes de imágenes / PDF / documentos",
    drop_prompt: "Suelta los archivos aquí o haz clic para seleccionar",
    label_output_format: "Formato de salida:",
    btn_convert: "Iniciar Conversión",
    btn_clear: "Borrar",
    list_empty: "Aún no hay archivos.",
    engine_loading: "Motor: ⏳ iniciando…",
    engine_ready: "Motor: ✅ listo",
    engine_error: "Motor: ❌ {err}",
    status_queued: "en cola",
    status_running: "ejecutando…",
    status_ok: "ok ({n})",
    status_err: "error: {err}",
    msg_no_files: "Añade algunos archivos primero.",
    label_lang: "Idioma",
    lang_english: "Inglés",
    lang_spanish: "Español",
    lang_russian: "Ruso",
    lang_chinese: "Chino",
  },
  ru: {
    title: "Picvert",
    subtitle: "Пакетный конвертер изображений / PDF / документов",
    drop_prompt: "Перетащите файлы сюда или нажмите, чтобы выбрать",
    label_output_format: "Формат вывода:",
    btn_convert: "Начать конвертацию",
    btn_clear: "Очистить",
    list_empty: "Файлов пока нет.",
    engine_loading: "Движок: ⏳ запуск…",
    engine_ready: "Движок: ✅ готов",
    engine_error: "Движок: ❌ {err}",
    status_queued: "в очереди",
    status_running: "выполняется…",
    status_ok: "ок ({n})",
    status_err: "ошибка: {err}",
    msg_no_files: "Сначала добавьте файлы.",
    label_lang: "Язык",
    lang_english: "Английский",
    lang_spanish: "Испанский",
    lang_russian: "Русский",
    lang_chinese: "Китайский",
  },
  zh: {
    title: "Picvert",
    subtitle: "批量图片 / PDF / 文档格式转换",
    drop_prompt: "将文件拖到此处或点击选择",
    label_output_format: "输出格式：",
    btn_convert: "开始转换",
    btn_clear: "清空",
    list_empty: "暂无文件。",
    engine_loading: "引擎：⏳ 启动中…",
    engine_ready: "引擎：✅ 就绪",
    engine_error: "引擎：❌ {err}",
    status_queued: "排队中",
    status_running: "处理中…",
    status_ok: "完成 ({n})",
    status_err: "错误: {err}",
    msg_no_files: "请先添加文件。",
    label_lang: "语言",
    lang_english: "English",
    lang_spanish: "Español",
    lang_russian: "Русский",
    lang_chinese: "中文",
  },
};

const LS_KEY = "picvert.lang";

function detectDefault() {
  const saved = localStorage.getItem(LS_KEY);
  if (saved && SUPPORTED_LANGS.includes(saved)) return saved;
  // Map browser/system language to one of our supported ones, default to en.
  const nav = (navigator.language || "en").slice(0, 2).toLowerCase();
  return SUPPORTED_LANGS.includes(nav) ? nav : "en";
}

let current = detectDefault();
const subscribers = new Set();

export function getLang() {
  return current;
}

export function setLang(lang) {
  if (!SUPPORTED_LANGS.includes(lang)) return;
  current = lang;
  localStorage.setItem(LS_KEY, lang);
  subscribers.forEach((fn) => fn(current));
}

export function onLangChange(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

export function t(key, params = {}) {
  const dict = translations[current] || translations.en;
  let s = dict[key] || translations.en[key] || key;
  for (const [k, v] of Object.entries(params)) {
    s = s.replace(`{${k}}`, String(v));
  }
  return s;
}
