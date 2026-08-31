/*
 * i18n-site.js — minimal, standards-shaped localization for static pages.
 * - BCP 47 locale tags (es, ja, zh-Hans, zh-Hant, yue, hi, ar, ko + en)
 * - Intl-based number/date formatting where used
 * - lang + dir handled per W3C i18n guidance (ar -> rtl)
 * - detection: ?lang= override > localStorage > navigator.language (nearest
 *   BCP 47 match); explicit choice always wins and persists
 * - data-i18n="key" elements get text; data-i18n-placeholder for inputs
 * Catalogs: /localize/locales/<tag>.json (built from localize/catalogs.py)
 */
(function () {
  "use strict";
  var LOCALES = {
    en: { name: "English", dir: "ltr" },
    es: { name: "Español", dir: "ltr" },
    ja: { name: "日本語", dir: "ltr" },
    "zh-Hans": { name: "简体中文", dir: "ltr" },
    "zh-Hant": { name: "繁體中文", dir: "ltr" },
    yue: { name: "粵語", dir: "ltr" },
    hi: { name: "हिन्दी", dir: "ltr" },
    ar: { name: "العربية", dir: "rtl" },
    ko: { name: "한국어", dir: "ltr" }
  };
  var STORAGE_KEY = "i18n-locale";
  var current = "en";
  var catalog = {};
  var ready = [];

  function nearestTag(preferred) {
    // navigator.language may be "es-419", "zh-Hant-TW", "yue-HK"...
    var tags = Object.keys(LOCALES);
    var exact = preferred.split("-").slice(0, 2).join("-");
    var primary = preferred.split("-")[0];
    if (tags.indexOf(exact) !== -1) return exact;
    if (tags.indexOf(primary) !== -1) return primary;
    // zh ambiguous -> default zh-Hans unless the script is Hant
    if (primary === "zh") return preferred.indexOf("Hant") !== -1 ? "zh-Hant" : "zh-Hans";
    return "en";
  }

  function load(locale, done) {
    var s = document.createElement("script");
    s.src = "localize/locales/" + locale + ".js";
    s.onload = function () { done(); };
    s.onerror = function () { done(); }; // missing catalog -> English keys
    document.head.appendChild(s);
  }
  window.__I18N_CATALOG__ = function (data) { catalog = data || {}; };

  function apply() {
    document.documentElement.lang = current;
    document.documentElement.dir = LOCALES[current].dir;
    document.title = t("meta.title") || document.title;
    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      var v = t(el.getAttribute("data-i18n"));
      if (v) el.textContent = v;
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach(function (el) {
      var v = t(el.getAttribute("data-i18n-placeholder"));
      if (v) el.setAttribute("placeholder", v);
    });
    ready.forEach(function (fn) { fn(current); });
    ready = [];
  }

  function t(key) {
    if (catalog && Object.prototype.hasOwnProperty.call(catalog, key)) return catalog[key];
    return key;
  }

  function switchTo(locale) {
    if (!LOCALES[locale]) return;
    current = locale;
    try { localStorage.setItem(STORAGE_KEY, locale); } catch (e) { /* private mode */ }
    var url = new URL(window.location.href);
    url.searchParams.set("lang", locale);
    history.replaceState(null, "", url.toString());
    load(locale, apply);
  }

  function init(opts) {
    var params = new URL(window.location.href).searchParams;
    var explicit = params.get("lang") || (function () {
      try { return localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
    })();
    current = explicit && LOCALES[explicit] ? explicit : nearestTag(navigator.language || "en");
    if (opts && opts.onReady) ready.push(opts.onReady);
    if (opts && opts.renderSwitcher) opts.renderSwitcher(LOCALES, current, switchTo);
    load(current, apply);
  }

  window.i18n = { init: init, t: t, switchTo: switchTo, locales: LOCALES, current: function () { return current; } };
})();
