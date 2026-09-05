/* Texupan — offline dictionary demo app (vanilla JS, no build step)
 *
 * Maps to offline-dictionary-plan/ARCHITECTURE.md:
 *   data/<lang>.json            <-> per-language core6-<lang>.sqlite (entries table,
 *                                   pre-merged AnalyzeResult rows from analyze.py export)
 *   LEXICONS[lang]              <-> Core6DictionaryProvider.lookup() / lookupContext()
 *   entry.plus (ud_lexemes)     <-> ud_lexemes table, Plus tier only (lookupUd())
 *   typeahead()                 <-> lookupContext() typeahead over per-language entries
 *   i18n/<lang>.json            <-> per-language UI strings (localized interface)
 *   API mode (Lingua Mundi)     <-> GET /analyze on a configurable API base — one app,
 *                                   two datasets (bundled offline + live API), per C5.
 *
 * The production app swaps the JSON fetch below for sql.js WASM SQLite + the
 * linguistic-core provider; this demo keeps the identical two-step shape:
 * surface query -> lemma -> pre-merged row, with a simulated Plus gate.
 */
"use strict";

var LANGS = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "ja", label: "日本語" },
  { code: "fr", label: "Français" },
  { code: "it", label: "Italiano" },
  { code: "pt", label: "Português" }
];

/* Lingua Mundi API language codes (GET /analyze?language=...) */
var API_LANG = { en: "eng", es: "spa", ja: "jpn", fr: "fra", it: "ita", pt: "por" };

var LEXICONS = {};   // code -> { language, entries[] } (bundled lexicon, free tier)
var I18N = {};       // code -> { key: string } UI strings
var STATE = { lang: "en", uiLang: null, query: "", results: [], activeIndex: -1 };

var DEBOUNCE_MS = 250; // typeahead debounce window

function $(id) {
  return document.getElementById(id);
}

/* ---------- i18n (localized interface, per selected UI language) ---------- */

function t(key, vars) {
  var table = I18N[STATE.uiLang || STATE.lang] || I18N.en || {};
  var s = table[key] != null ? table[key] : (I18N.en ? I18N.en[key] : key);
  if (vars) {
    Object.keys(vars).forEach(function (k) {
      s = s.replace(new RegExp("\\{" + k + "\\}", "g"), String(vars[k]));
    });
  }
  return s;
}

function applyI18n() {
  var lang = STATE.uiLang || STATE.lang;
  document.documentElement.lang = lang;
  Array.prototype.forEach.call(document.querySelectorAll("[data-i18n]"), function (el) {
    el.innerHTML = t(el.getAttribute("data-i18n"));
  });
  Array.prototype.forEach.call(document.querySelectorAll("[data-i18n-placeholder]"), function (el) {
    el.setAttribute("placeholder", t(el.getAttribute("data-i18n-placeholder")));
  });
  var input = $("searchInput");
  if (input) {
    input.setAttribute("aria-label", t("search.aria"));
  }
}

function loadI18n() {
  var codes = LANGS.map(function (l) { return l.code; });
  codes.push("en");
  var seen = {};
  return Promise.all(codes.filter(function (c) { return seen[c] ? false : (seen[c] = true); }).map(function (code) {
    return fetch("i18n/" + code + ".json")
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        if (data) I18N[code] = data;
      })
      .catch(function () { /* missing locale -> English fallback */ });
  }));
}

/* ---------- loading (stands in for lazy sql.js per-language DB open) ---------- */

function loadAll() {
  return Promise.all(
    LANGS.map(function (lang) {
      return fetch("data/" + lang.code + ".json")
        .then(function (res) {
          if (!res.ok) {
            throw new Error("failed to load data/" + lang.code + ".json");
          }
          return res.json();
        })
        .then(function (data) {
          LEXICONS[lang.code] = data;
        })
        .catch(function (err) {
          LEXICONS[lang.code] = { language: lang.code, entries: [] };
          console.error(err);
        });
    })
  );
}

function lexicon(lang) {
  return (LEXICONS[lang] && LEXICONS[lang].entries) || [];
}

function totalEntries() {
  var n = 0;
  LANGS.forEach(function (l) {
    n += lexicon(l.code).length;
  });
  return n;
}

/* ---------- Lingua Mundi API mode (C5: one app, two datasets) ---------- */

function apiBase() {
  try {
    return localStorage.getItem("texupan.apiBase") || "http://127.0.0.1:8765";
  } catch (e) {
    return "http://127.0.0.1:8765";
  }
}

function apiModeEnabled() {
  var el = $("apiMode");
  return !el || el.checked;
}

function apiLookup(text, lang) {
  var base = apiBase();
  var apiLang = API_LANG[lang] || lang;
  var url = base + "/analyze?text=" + encodeURIComponent(text) + "&language=" + encodeURIComponent(apiLang);
  return fetch(url, { headers: { Accept: "application/json" } }).then(function (res) {
    if (!res.ok) {
      throw new Error("API HTTP " + res.status);
    }
    return res.json();
  }).then(function (data) {
    if (!data || data.lemma == null) return null;
    return {
      lemma: data.lemma,
      furigana: data.furigana || null,
      part_of_speech: data.part_of_speech || "",
      senses: (data.senses || []).map(function (s) { return typeof s === "string" ? s : (s.gloss || s.definition || JSON.stringify(s)); }),
      example: data.example ? { text: data.example.text || "", translation: data.example.translation || null } : null,
      source: data.sources || ["Lingua Mundi API"],
      plus: null,
      _api: true
    };
  });
}

function renderApiAction(entry, query, lang) {
  var html =
    '<div class="api-action">' +
    '<button type="button" id="apiLookupBtn" class="api-btn">' + t("api.lookup") + "</button>" +
    '<span class="api-base">' + apiBase() + "</span>" +
    "</div>";
  $("detail").insertAdjacentHTML("beforeend", html);
  var btn = $("apiLookupBtn");
  if (btn) {
    btn.addEventListener("click", function () {
      btn.disabled = true;
      btn.textContent = "…";
      apiLookup(query, lang).then(function (entry2) {
        if (entry2) {
          renderDetail(entry2);
        } else {
          renderDetail(null);
          var d = $("detail");
          d.insertAdjacentHTML("beforeend", '<p class="detail-empty">' + t("api.none") + "</p>");
        }
      }).catch(function (err) {
        btn.disabled = false;
        btn.textContent = t("api.lookup");
        var d = $("detail");
        d.insertAdjacentHTML("beforeend", '<p class="detail-error">' + t("api.error", { base: apiBase() }) + "</p>");
      });
    });
  }
}

/* ---------- language tabs ---------- */

function renderTabs() {
  var nav = $("langTabs");
  nav.setAttribute("aria-label", t("tabs.aria"));
  var html = "";
  LANGS.forEach(function (lang) {
    html +=
      '<button type="button" class="lang-tab" role="tab" data-lang="' +
      lang.code +
      '" aria-selected="' +
      (lang.code === STATE.lang ? "true" : "false") +
      '">' +
      lang.label +
      "</button>";
  });
  nav.innerHTML = html;
  Array.prototype.forEach.call(nav.querySelectorAll(".lang-tab"), function (tab) {
    tab.addEventListener("click", function () {
      setLanguage(tab.getAttribute("data-lang"));
    });
  });
}

function setLanguage(code) {
  STATE.lang = code;
  STATE.query = "";
  STATE.results = [];
  STATE.activeIndex = -1;
  renderTabs();
  var input = $("searchInput");
  if (input) {
    input.value = "";
    input.focus();
  }
  hideTypeahead();
  renderDetail(null);
  renderTierStatus();
  applyI18n();
}

/* ---------- typeahead (lookupContext equivalent) ---------- */

function normalize(s) {
  return String(s || "").toLowerCase().normalize("NFC");
}

function entryMatches(entry, q) {
  var hay = normalize(entry.lemma);
  if (entry.furigana) {
    hay += " " + normalize(entry.furigana);
  }
  (entry.senses || []).forEach(function (s) {
    hay += " " + normalize(s);
  });
  return hay.indexOf(q) !== -1;
}

function typeahead(query, lang) {
  var q = normalize(query.trim());
  if (!q) {
    return [];
  }
  var hits = [];
  lexicon(lang).forEach(function (entry) {
    if (entryMatches(entry, q)) {
      hits.push(entry);
    }
  });
  // rank: prefix matches on the lemma first
  hits.sort(function (a, b) {
    var ap = normalize(a.lemma).indexOf(q) === 0 ? 0 : 1;
    var bp = normalize(b.lemma).indexOf(q) === 0 ? 0 : 1;
    return ap - bp;
  });
  return hits.slice(0, 12);
}

function debounce(fn, ms) {
  var timer = null;
  return function () {
    var args = arguments;
    var self = this;
    clearTimeout(timer);
    timer = setTimeout(function () {
      fn.apply(self, args);
    }, ms);
  };
}

function renderTypeahead() {
  var list = $("typeahead");
  if (!list) {
    return;
  }
  list.setAttribute("aria-label", t("typeahead.aria"));
  if (!STATE.query || STATE.results.length === 0) {
    hideTypeahead();
    return;
  }
  var html = "";
  STATE.results.forEach(function (entry, i) {
    var furi = entry.furigana ? '<span class="th-furi">' + entry.furigana + "</span>" : "";
    html +=
      '<li role="option" data-index="' +
      i +
      '" aria-selected="' +
      (i === STATE.activeIndex ? "true" : "false") +
      '"><span class="th-lemma">' +
      escapeHtml(entry.lemma) +
      "</span>" +
      furi +
      '<span class="th-pos">' +
      escapeHtml(entry.part_of_speech) +
      "</span></li>";
  });
  list.innerHTML = html;
  list.hidden = false;
  Array.prototype.forEach.call(list.querySelectorAll("li"), function (li) {
    li.addEventListener("click", function () {
      selectResult(Number(li.getAttribute("data-index")));
    });
  });
}

function hideTypeahead() {
  var list = $("typeahead");
  if (list) {
    list.innerHTML = "";
    list.hidden = true;
  }
  STATE.activeIndex = -1;
}

function moveActive(dir) {
  if (STATE.results.length === 0) {
    return;
  }
  STATE.activeIndex += dir;
  if (STATE.activeIndex < 0) {
    STATE.activeIndex = 0;
  }
  if (STATE.activeIndex >= STATE.results.length) {
    STATE.activeIndex = STATE.results.length - 1;
  }
  renderTypeahead();
}

function selectResult(i) {
  if (i >= 0 && i < STATE.results.length) {
    var entry = STATE.results[i];
    var input = $("searchInput");
    if (input) {
      input.value = entry.lemma;
    }
    hideTypeahead();
    renderDetail(entry);
  }
}

/* ---------- keyboard navigation ---------- */

function onSearchKeydown(e) {
  if (STATE.results.length === 0) {
    return;
  }
  if (e.key === "ArrowDown") {
    e.preventDefault();
    moveActive(1);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    moveActive(-1);
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (STATE.activeIndex >= 0) {
      selectResult(STATE.activeIndex);
    } else {
      selectResult(0);
    }
  } else if (e.key === "Escape") {
    e.preventDefault();
    hideTypeahead();
  }
}

/* ---------- word detail panel ---------- */

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderLemma(entry) {
  if (STATE.lang === "ja" && entry.furigana) {
    return (
      "<ruby>" + escapeHtml(entry.lemma) + "<rt>" + escapeHtml(entry.furigana) + "</rt></ruby>"
    );
  }
  return escapeHtml(entry.lemma);
}

/* Plus tier gate: an entry whose pre-merged row would carry UD grammar data
 * (ud_lexemes / J-UniMorph inflection features). In production this is the
 * lookupUd() entitlement check; in the demo it is simulated and always locked. */
function hasPlus(entry) {
  return !!(entry && entry.plus && entry.plus.ud_upos);
}

function renderSourceBadges(entry) {
  var badges = (entry.source || []).map(function (s) {
    var cls = "badge";
    var name = s.toLowerCase();
    if (name === "wordnet") {
      cls += " wordnet";
    } else if (name === "j-unimorph" || name === "unimorph") {
      cls += " junimorph";
    }
    return '<span class="' + cls + '">' + escapeHtml(s) + "</span>";
  });
  if (hasPlus(entry)) {
    badges.push('<span class="badge ud">UD</span>');
  }
  return badges.join("");
}

function renderPlusLock(entry) {
  if (!hasPlus(entry)) {
    return "";
  }
  var p = entry.plus;
  var feats = (p.features || []).map(function (f) {
    return "<code>" + escapeHtml(f) + "</code>";
  }).join(" ");
  return (
    '<div class="plus-lock" role="status" title="' + t("plus.locked") + '">' +
    t("plus.locked") + "</div>" +
    '<div class="plus-block">' +
    '<p class="pb-title">' + t("plus.title") + "</p>" +
    "<p>" + t("plus.body1", { upos: escapeHtml(p.ud_upos), source: escapeHtml(p.inflection_source) }) + "</p>" +
    (feats ? " &middot; inflection " + feats : "") +
    ".</p>" +
    "<p>" + t("plus.body2") + "</p>" +
    "</div>"
  );
}

function renderDetail(entry) {
  var panel = $("detail");
  if (!entry) {
    panel.innerHTML = '<p class="detail-empty">' + t("detail.empty") + "</p>";
    var q = (STATE.query || "").trim();
    if (q && apiModeEnabled()) {
      renderApiAction(null, q, STATE.lang);
    }
    return;
  }
  var langName = "en";
  LANGS.forEach(function (l) {
    if (l.code === STATE.lang) {
      langName = l.label;
    }
  });
  var example = "";
  if (entry.example && entry.example.text) {
    example =
      '<blockquote class="example"><p class="ex-text">&ldquo;' +
      escapeHtml(entry.example.text) +
      '&rdquo;</p>' +
      (entry.example.translation
        ? '<p class="ex-trans">' + escapeHtml(entry.example.translation) + "</p>"
        : "") +
      "</blockquote>";
  }
  var senses =
    '<p class="senses-title">' + t("senses.title") + "</p><ol class=\"senses\">" +
    (entry.senses || [])
      .map(function (s) {
        return "<li>" + escapeHtml(s) + "</li>";
      })
      .join("") +
    "</ol>";

  panel.innerHTML =
    '<div class="word-head">' +
    '<h2 class="word-lemma">' +
    renderLemma(entry) +
    "</h2>" +
    '<span class="word-pos">' +
    escapeHtml(entry.part_of_speech) +
    "</span>" +
    '<span class="word-lang">' +
    escapeHtml(langName) +
    (entry._api ? ' <span class="badge api">API</span>' : "") +
    "</span>" +
    "</div>" +
    senses +
    example +
    '<div class="badges">' +
    renderSourceBadges(entry) +
    "</div>" +
    renderPlusLock(entry);
}

/* ---------- tier status line ---------- */

function renderTierStatus() {
  var el = $("tierStatus");
  if (!el) {
    return;
  }
  var n = totalEntries();
  el.innerHTML =
    '<span class="tier-free">' + t("tier.free", { n: n }) + "</span> &bull; " +
    '<span class="tier-plus">' + t("tier.plus") + "</span>";
}

/* ---------- boot ---------- */

function init() {
  renderTabs();
  renderTierStatus();

  var uiSel = $("uiLang");
  if (uiSel) {
    try {
      var saved = localStorage.getItem("texupan.uiLang");
      if (saved) uiSel.value = saved;
    } catch (e) { /* ignore */ }
    STATE.uiLang = uiSel.value;
    uiSel.addEventListener("change", function () {
      STATE.uiLang = uiSel.value;
      try { localStorage.setItem("texupan.uiLang", STATE.uiLang); } catch (e) { /* ignore */ }
      applyI18n();
      renderTabs();
      renderTierStatus();
      renderDetail(null);
    });
  }

  var input = $("searchInput");
  if (input) {
    var debounced = debounce(function () {
      STATE.query = input.value;
      STATE.activeIndex = -1;
      STATE.results = typeahead(STATE.query, STATE.lang);
      renderTypeahead();
      if (STATE.results.length === 0) {
        renderDetail(null);
      }
    }, DEBOUNCE_MS);

    input.addEventListener("input", debounced);
    input.addEventListener("keydown", onSearchKeydown);
  }

  Promise.all([loadAll(), loadI18n()]).then(function () {
    renderTierStatus(); // now shows the real bundled word count
    applyI18n();
  });
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", init);
}

/* Exposed for the smoke test / debugging */
window.__CORE6__ = {
  init: init,
  typeahead: typeahead,
  debounce: debounce,
  hasPlus: hasPlus,
  setLanguage: setLanguage,
  t: t,
  apiLookup: apiLookup,
  apiBase: apiBase,
  LEXICONS: LEXICONS,
  I18N: I18N,
  STATE: STATE
};
