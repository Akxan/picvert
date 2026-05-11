// Picvert capsule v3 — premium glass weather widget.
//
// Shows time + date + timezone (DST aware) + current weather, all driven by
// the user's REAL public IP via ipwho.is. Clicking expands the main window.
// Dragging anywhere on the card moves the window.
//
// External services (CSP-allowed in tauri.conf.json):
//   • https://ipwho.is — IP geolocation + timezone (free, HTTPS, no key)
//   • https://ipapi.co — fallback geolocator (rate-limited)
//   • https://api.open-meteo.com — current weather (free, HTTPS, no key)

import { $, currentWebviewWindow, suppressContextMenu } from "./utils.js";

if (!window.__TAURI__) {
  document.body.innerHTML = "<p style='padding:1rem;color:#b00'>__TAURI__ missing</p>";
  throw new Error("no __TAURI__");
}

const { invoke } = window.__TAURI__.core;

// ─────────────────────────── tiny i18n ────────────────────────────────────
// The capsule shares the LS key with the main window and listens for
// picvert:lang-changed events so it switches in real time.

const LS_LANG = "picvert.lang";
const STR = {
  en: { drag_hint: "Drag to move · Click to expand", offline: "offline" },
  es: { drag_hint: "Arrastra para mover · Clic para expandir", offline: "sin conexión" },
  ru: { drag_hint: "Перетащите · Кликните, чтобы развернуть", offline: "офлайн" },
  zh: { drag_hint: "按住拖动 · 点击展开", offline: "离线" },
};

/** Chinese-only translation of common timezone abbreviations.
 * Other languages keep the IATA-style abbreviation (CEST, EST, …).
 * Falls back to the abbr itself for codes we don't have. */
const TZ_ZH = {
  UTC: "协调世界时", GMT: "格林威治时间",
  CET: "中欧时间",   CEST: "中欧夏令时",
  WET: "西欧时间",   WEST: "西欧夏令时",
  EET: "东欧时间",   EEST: "东欧夏令时",
  BST: "英国夏令时", IST: "印度标准时间",
  EST: "美东标准时间", EDT: "美东夏令时",
  CST: "中部标准时间", CDT: "中部夏令时",
  MST: "山地标准时间", MDT: "山地夏令时",
  PST: "太平洋标准时间", PDT: "太平洋夏令时",
  AKST: "阿拉斯加标准时间", AKDT: "阿拉斯加夏令时",
  HST: "夏威夷标准时间",
  AST: "大西洋标准时间", ADT: "大西洋夏令时",
  NST: "纽芬兰标准时间", NDT: "纽芬兰夏令时",
  JST: "日本标准时间", KST: "韩国标准时间",
  HKT: "香港时间",     SGT: "新加坡时间",
  AEST: "澳东标准时间", AEDT: "澳东夏令时",
  ACST: "澳中标准时间", ACDT: "澳中夏令时",
  AWST: "澳西标准时间",
  NZST: "新西兰标准时间", NZDT: "新西兰夏令时",
  MSK: "莫斯科时间",   "MSK+1": "莫斯科+1",
  SAST: "南非标准时间",
  ART: "阿根廷时间",   BRT: "巴西时间", BRST: "巴西夏令时",
  CLT: "智利标准时间", CLST: "智利夏令时",
};

const DST_BADGE_ZH = "夏令时";
const DST_BADGE_EN = "DST";

/** Country name → Chinese for the city/country line.
 * Uses ISO-3166 alpha-2 codes; falls back to the English name if missing. */
const COUNTRY_ZH = {
  CN: "中国", HK: "香港", TW: "台湾", MO: "澳门",
  US: "美国", CA: "加拿大", MX: "墨西哥", BR: "巴西", AR: "阿根廷", CL: "智利",
  GB: "英国", IE: "爱尔兰", FR: "法国", DE: "德国", IT: "意大利", ES: "西班牙",
  PT: "葡萄牙", NL: "荷兰", BE: "比利时", CH: "瑞士", AT: "奥地利",
  SE: "瑞典", NO: "挪威", FI: "芬兰", DK: "丹麦", IS: "冰岛",
  PL: "波兰", CZ: "捷克", HU: "匈牙利", GR: "希腊", RO: "罗马尼亚", UA: "乌克兰",
  RU: "俄罗斯", BY: "白俄罗斯", TR: "土耳其",
  JP: "日本", KR: "韩国", KP: "朝鲜",
  IN: "印度", PK: "巴基斯坦", BD: "孟加拉国", LK: "斯里兰卡",
  ID: "印度尼西亚", TH: "泰国", VN: "越南", MY: "马来西亚", SG: "新加坡",
  PH: "菲律宾", KH: "柬埔寨", LA: "老挝", MM: "缅甸",
  AU: "澳大利亚", NZ: "新西兰",
  AE: "阿联酋", SA: "沙特阿拉伯", IR: "伊朗", IQ: "伊拉克", IL: "以色列",
  ZA: "南非", EG: "埃及", NG: "尼日利亚", KE: "肯尼亚", MA: "摩洛哥",
};

function readLang() {
  try {
    const saved = localStorage.getItem(LS_LANG);
    if (saved && STR[saved]) return saved;
  } catch {}
  const nav = (navigator.language || "en").slice(0, 2).toLowerCase();
  return STR[nav] ? nav : "en";
}
let lang = readLang();
const tt = (key) => (STR[lang] || STR.en)[key] || key;

const appWindow = currentWebviewWindow();

const capsule = $("capsule");
const timeEl = $("time");
const dateEl = $("date");
const tzEl = $("tz");
const tempEl = $("temp");
const cityEl = $("city");
const countryEl = $("country");
const iconEl = $("weather-icon");

let geo = null;
let lastOffline = false;

function applyLangText() {
  capsule.title = tt("drag_hint");
  if (lastOffline) cityEl.textContent = tt("offline");
  if (geo) countryEl.textContent = localizedCountry(geo);
}
applyLangText();

// ─────────────────────────── time / date ──────────────────────────────────

function dateLocale() {
  // Pick a real BCP-47 tag based on the chosen UI lang.
  return ({ en: "en-US", es: "es-ES", ru: "ru-RU", zh: "zh-CN" })[lang] || "en-US";
}

function updateClock() {
  const now = new Date();
  const tz = geo?.timezone?.id;

  timeEl.textContent = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit", minute: "2-digit", hour12: false,
    ...(tz ? { timeZone: tz } : {}),
  }).format(now);

  dateEl.textContent = new Intl.DateTimeFormat(dateLocale(), {
    weekday: "short", year: "numeric", month: "short", day: "numeric",
    ...(tz ? { timeZone: tz } : {}),
  }).format(now);

  // Timezone line: abbr + UTC offset, with a DST badge if active.
  // Chinese gets full translation; the localised abbr already contains
  // "夏令时" so the trailing badge is omitted to avoid repetition.
  if (geo?.timezone) {
    const { abbr, utc, is_dst } = geo.timezone;
    const utcPart = utc ? `UTC${utc}` : "";
    if (lang === "zh") {
      const localized = TZ_ZH[abbr] || abbr || "";
      tzEl.textContent = [localized, utcPart].filter(Boolean).join(" ");
    } else {
      tzEl.innerHTML = [abbr || "", utcPart].filter(Boolean).join(" ") +
        (is_dst ? ` <span class="dst">${DST_BADGE_EN}</span>` : "");
    }
  } else {
    tzEl.textContent = "—";
  }
}

// ─────────────────────────── weather ──────────────────────────────────────

const WMO = {
  0:  { icon: sunIcon,           color: "#ffd97a" },
  1:  { icon: sunIcon,           color: "#ffd97a" },
  2:  { icon: partlyCloudyIcon,  color: "#ffd97a" },
  3:  { icon: cloudIcon,         color: "#cdd2da" },
  45: { icon: fogIcon,           color: "#bcc1c9" },
  48: { icon: fogIcon,           color: "#bcc1c9" },
  51: { icon: rainIcon,          color: "#7cb6ff" },
  53: { icon: rainIcon,          color: "#7cb6ff" },
  55: { icon: rainIcon,          color: "#7cb6ff" },
  61: { icon: rainIcon,          color: "#7cb6ff" },
  63: { icon: rainIcon,          color: "#7cb6ff" },
  65: { icon: rainIcon,          color: "#7cb6ff" },
  71: { icon: snowIcon,          color: "#e8f0ff" },
  73: { icon: snowIcon,          color: "#e8f0ff" },
  75: { icon: snowIcon,          color: "#e8f0ff" },
  80: { icon: rainIcon,          color: "#7cb6ff" },
  81: { icon: rainIcon,          color: "#7cb6ff" },
  82: { icon: rainIcon,          color: "#7cb6ff" },
  95: { icon: thunderIcon,       color: "#a78bfa" },
  96: { icon: thunderIcon,       color: "#a78bfa" },
  99: { icon: thunderIcon,       color: "#a78bfa" },
};

function sunIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="4"/>
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2 M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
  </svg>`;
}
function cloudIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
    <path d="M17.5 19a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.7 1.7A4 4 0 0 0 6.5 19h11z"/>
  </svg>`;
}
function partlyCloudyIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="8" cy="8" r="3"/>
    <path d="M3 8h0M8 3v0M13 8h0M5 5l0 0M11 5l0 0"/>
    <path d="M17.5 21a4.5 4.5 0 0 0 0-9 5 5 0 0 0-9.5 1A4 4 0 0 0 7.5 21h10z"/>
  </svg>`;
}
function fogIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
    <path d="M3 8h18M5 13h14M3 18h18"/>
  </svg>`;
}
function rainIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
    <path d="M17 14a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.7 1.7A4 4 0 0 0 6 14h11z"/>
    <path d="M9 18l-1 3M13 18l-1 3M17 18l-1 3"/>
  </svg>`;
}
function snowIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
    <path d="M17 14a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.7 1.7A4 4 0 0 0 6 14h11z"/>
    <path d="M9 19l0 .01M13 19l0 .01M17 19l0 .01M11 21l0 .01M15 21l0 .01"/>
  </svg>`;
}
function thunderIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
    <path d="M17 14a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.7 1.7A4 4 0 0 0 6 14h11z"/>
    <path d="M11 14l-2 4h3l-2 4"/>
  </svg>`;
}

function setWeather({ tempC, code }) {
  const w = WMO[code] || WMO[3];
  iconEl.innerHTML = w.icon();
  iconEl.style.setProperty("--w-color", w.color);
  tempEl.textContent = `${Math.round(tempC)}°`;
}

// ─────────────────────────── geo + weather fetch ─────────────────────────

/** Fetch a URL through the Rust side (bypasses WKWebView CSP/CORS). */
async function httpJson(url) {
  const text = await invoke("http_get_text", { url });
  return JSON.parse(text);
}

/** Try several free IP-geolocation providers and normalise to one shape. */
async function geolocate() {
  // Primary: ipwho.is — free HTTPS, no rate-limit issues.
  try {
    const j = await httpJson("https://ipwho.is/");
    if (j.success !== false && j.latitude != null) {
      return {
        ip: j.ip,
        latitude: j.latitude,
        longitude: j.longitude,
        city: j.city,
        country: j.country,
        countryCode: j.country_code,
        timezone: j.timezone, // { id, abbr, is_dst, offset, utc }
      };
    }
  } catch (e) { console.warn("ipwho.is failed", e); }
  // Fallback: ipapi.co — rate-limited but useful as a backup.
  try {
    const j = await httpJson("https://ipapi.co/json/");
    if (!j.error && j.latitude != null) {
      return {
        ip: j.ip,
        latitude: j.latitude,
        longitude: j.longitude,
        city: j.city,
        country: j.country_name,
        countryCode: j.country_code,
        timezone: {
          id: j.timezone,
          abbr: j.timezone || "",
          is_dst: false,
          utc: j.utc_offset
            ? `${j.utc_offset.slice(0, 3)}:${j.utc_offset.slice(3)}`
            : "",
        },
      };
    }
  } catch (e) { console.warn("ipapi.co failed", e); }
  throw new Error("all geo providers failed");
}

function localizedCountry(geo) {
  if (lang === "zh" && geo.countryCode && COUNTRY_ZH[geo.countryCode]) {
    return COUNTRY_ZH[geo.countryCode];
  }
  return geo.country || geo.countryCode || "—";
}

async function refreshWeather() {
  try {
    geo = await geolocate();
    lastOffline = false;
    cityEl.textContent = geo.city || "—";
    countryEl.textContent = localizedCountry(geo);
    cityEl.title = `${geo.city || ""} — IP ${geo.ip || "?"}`;

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${geo.latitude}&longitude=${geo.longitude}&current_weather=true`;
    const wj = await httpJson(url);
    const cw = wj.current_weather;
    setWeather({ tempC: cw.temperature, code: cw.weathercode });

    updateClock();
  } catch (err) {
    console.warn("weather/geo failed", err);
    lastOffline = true;
    iconEl.innerHTML = cloudIcon();
    iconEl.style.setProperty("--w-color", "#7a7d88");
    tempEl.textContent = "—";
    cityEl.textContent = tt("offline");
    countryEl.textContent = "—";
    cityEl.title = String(err);
  }
}

// Pause both timers while the window is hidden — saves CPU + a network
// request every 15 min the user can't see anyway. document.visibilityState
// flips reliably on window hide/show in Tauri's WebKit/WebView2.

let clockTimer = null;
let weatherTimer = null;

function startTimers() {
  if (clockTimer == null) clockTimer = setInterval(updateClock, 30_000);
  if (weatherTimer == null) weatherTimer = setInterval(refreshWeather, 15 * 60 * 1000);
}
function stopTimers() {
  if (clockTimer != null) { clearInterval(clockTimer); clockTimer = null; }
  if (weatherTimer != null) { clearInterval(weatherTimer); weatherTimer = null; }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    updateClock();        // immediate refresh
    startTimers();
  } else {
    stopTimers();
  }
});

updateClock();
refreshWeather();
startTimers();

// ─────────────────────────── drag / click ─────────────────────────────────

const DRAG_THRESHOLD = 4;
let press = null;
let dragging = false;

capsule.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  press = { x: e.screenX, y: e.screenY };
  dragging = false;
});

document.addEventListener("mousemove", async (e) => {
  if (!press || dragging) return;
  if (Math.abs(e.screenX - press.x) > DRAG_THRESHOLD ||
      Math.abs(e.screenY - press.y) > DRAG_THRESHOLD) {
    dragging = true;
    if (appWindow?.startDragging) {
      try { await appWindow.startDragging(); }
      catch (err) { console.error("startDragging failed", err); }
    }
  }
});

document.addEventListener("mouseup", () => {
  if (!press) return;
  const wasDrag = dragging;
  press = null;
  dragging = false;
  if (!wasDrag) expandToMain();
});

capsule.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    expandToMain();
  }
});

/** Play the leave animation, then ask Rust to show the main window. */
function expandToMain() {
  triggerClickFx();
  document.body.classList.add("leaving");
  setTimeout(() => {
    invoke("show_main_window").finally(() => {
      // Reset for next time the capsule is shown — otherwise the .leaving
      // class sticks on the hidden body, and on re-show the capsule paints
      // invisibly (opacity:0 / scaled out).
      document.body.classList.remove("leaving");
    });
  }, 200);
}

function triggerClickFx() {
  capsule.classList.remove("is-clicked");
  void capsule.offsetWidth;
  capsule.classList.add("is-clicked");
  setTimeout(() => capsule.classList.remove("is-clicked"), 600);
}

// ─────────────────────────── drag-drop visuals ───────────────────────────

document.body.addEventListener("dragover", (e) => {
  e.preventDefault();
  document.body.classList.add("dragover");
});
document.body.addEventListener("dragleave", () => document.body.classList.remove("dragover"));
document.body.addEventListener("drop", (e) => {
  e.preventDefault();
  document.body.classList.remove("dragover");
});
if (appWindow?.listen) {
  appWindow.listen("tauri://drag-drop", () => invoke("show_main_window")).catch(() => {});
}

// Sync language whenever the main window's picker changes it.
if (window.__TAURI__?.event?.listen) {
  window.__TAURI__.event
    .listen("picvert:lang-changed", (event) => {
      const code = event.payload;
      if (typeof code === "string" && STR[code]) {
        lang = code;
        applyLangText();
        updateClock(); // re-render localized date
      }
    })
    .catch(() => {});
}

suppressContextMenu();
