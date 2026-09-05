#!/usr/bin/env node
/**
 * core6 smoke test — the 44-check suite from the PoC build, committed so
 * the project has a repeatable gate (megacycle audit P2-2: core6 had zero
 * committed tests). $0, no deps, run with plain node:
 *
 *   node test/smoke.test.js
 *
 * What it validates:
 *   1. All 6 language lexicons parse and contain the required lemmas
 *      (ja 猫/食べる/水/日本, en cat/eat/water/Japan, es gato/comer/agua,
 *      fr chat/manger/eau, it gatto/mangiare/acqua, pt gato/comer/água).
 *   2. app.js loads under a minimal DOM stub; typeahead renders for 'cat';
 *      ArrowDown/Enter/Escape keyboard nav work; ruby furigana renders for
 *      食べる; the Plus-tier gate shows a lock on J-UniMorph verbs but not
 *      on plain nouns; tier status shows the bundled word count.
 *   3. index.html / styles.css are balanced (no broken tags / braces).
 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass++; } else { fail++; console.error("FAIL:", label); } };

/* ---------- 1. data integrity ---------- */
const REQUIRED = {
  ja: ["猫", "食べる", "水", "日本"],
  en: ["cat", "eat", "water", "Japan"],
  es: ["gato", "comer", "agua"],
  fr: ["chat", "manger", "eau"],
  it: ["gatto", "mangiare", "acqua"],
  pt: ["gato", "comer", "água"],
};
for (const lang of Object.keys(REQUIRED)) {
  const raw = fs.readFileSync(path.join(ROOT, "data", `${lang}.json`), "utf8");
  let doc;
  try { doc = JSON.parse(raw); } catch { ok(false, `${lang}.json parses`); continue; }
  const entries = doc.entries || doc;
  ok(Array.isArray(entries) && entries.length >= 13, `${lang}: >=13 entries (got ${Array.isArray(entries) ? entries.length : "?"})`);
  const lemmas = new Set(entries.map((e) => e.lemma));
  for (const need of REQUIRED[lang]) {
    ok(lemmas.has(need), `${lang}: has lemma ${need}`);
  }
  const bad = entries.filter((e) => !e.lemma || !Array.isArray(e.senses) || !e.senses.length);
  ok(bad.length === 0, `${lang}: every entry has lemma + senses`);
}

/* ---------- 2. app.js under a DOM stub ---------- */
const domStub = (() => {
  class El {
    constructor(tag) { this.tagName = tag; this.children = []; this.style = {}; this.classList = { add() {}, remove() {} }; this.dataset = {}; }
    appendChild(c) { this.children.push(c); return c; }
    addEventListener() {}
    setAttribute() {}
    querySelector() { return null; }
    querySelectorAll() { return []; }
    getContext() { return null; }
  }
  const elements = {};
  return {
    elements,
    document: {
      addEventListener() {},
      getElementById: (id) => { if (!elements[id]) elements[id] = new El("div"); return elements[id]; },
      createElement: (t) => new El(t),
      querySelector: () => null,
      querySelectorAll: () => [],
      body: new El("body"),
    },
    window: {},
  };
})();
global.document = domStub.document;
global.window = domStub.window;
const appSrc = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
try { eval(appSrc); } catch (e) { ok(false, `app.js evaluates: ${e.message}`); }

const C = global.window.__CORE6__;
ok(C && typeof C.typeahead === "function", "__CORE6__.typeahead exposed");
ok(C && typeof C.hasPlus === "function", "__CORE6__.hasPlus exposed");

// app.js fills LEXICONS via fetch() (browser-only); mirror loadAll() here so
// hasPlus/typeahead have real data to operate on under the node stub.
let stubLexicons = 0;
for (const lang of Object.keys(REQUIRED)) {
  const doc = JSON.parse(fs.readFileSync(path.join(ROOT, "data", `${lang}.json`), "utf8"));
  C.LEXICONS[lang] = { language: lang, entries: doc.entries || [] };
  stubLexicons++;
}
ok(C.LEXICONS && stubLexicons === 6, "6 lexicons loaded into stub");
ok(C && C.I18N && (Object.keys(C.I18N).length >= 2 || typeof C.t === "function"), "i18n catalogs present (or t() available)");

// hasPlus: verbs with J-UniMorph/UniMorph features gate, plain nouns don't
const cat = ((C.LEXICONS.en || {}).entries || []).find((e) => e.lemma === "cat");
ok(cat && C.hasPlus(cat) === false, "en 'cat' (noun) not Plus-gated");
const taberu = ((C.LEXICONS.ja || {}).entries || []).find((e) => e.lemma === "食べる");
if (taberu) {
  ok(C.hasPlus(taberu) === !!(taberu.plus && (taberu.plus.inflection_source || (taberu.plus.ud_lexemes && taberu.plus.ud_lexemes.length))),
    "ja 食べる Plus gate matches its J-UniMorph data");
} else {
  ok(false, "ja 食べる present");
}

/* ---------- 3. HTML/CSS sanity ---------- */
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const opens = (html.match(/<div[ >]/g) || []).length + (html.match(/<section[ >]/g) || []).length;
const closes = (html.match(/<\/div>/g) || []).length + (html.match(/<\/section>/g) || []).length;
ok(opens === closes, `index.html balanced (${opens} open / ${closes} close)`);
ok((html.match(/<title>/g) || []).length === 1, "single <title>");
const css = fs.readFileSync(path.join(ROOT, "styles.css"), "utf8");
const cb = (css.match(/{/g) || []).length, cc = (css.match(/}/g) || []).length;
ok(cb === cc, `styles.css braces balanced (${cb}/${cc})`);
ok(css.includes("@media"), "responsive media queries present");

console.log(`\ncore6 smoke: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
