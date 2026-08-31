/* offline-db.js — bundled Lingua Mundi SQLite lookup (sql.js/WASM).
 *
 * Mirrors the export schema from lingua-mundi/scripts/export_sqlite.py:
 *   entries(lemma, language, part_of_speech, furigana, sources, data)
 *     data = the full AnalyzeResult JSON (same shape as GET /analyze)
 *   surface_forms(surface_form, language, lemma, features, hits)
 *
 * The database file is NOT shipped with the web GUI (it is ~235 MB and
 * lives in the release bundle / Android APK instead). If the file is
 * present next to this page, lookups work fully offline.
 */
"use strict";

const OFFLINE_DB_FILE = "lingua-mundi-jpn.sqlite";

let offlineDb = null;   // SQL.Database once loaded
let offlineReady = false;
let offlineFailed = false;

async function initOfflineDb() {
  if (offlineReady || offlineFailed) return offlineReady;
  try {
    const head = await fetch(OFFLINE_DB_FILE, { method: "HEAD" });
    if (!head.ok) { offlineFailed = true; return false; }
    const [SQL, bytes] = await Promise.all([
      loadSqlJs(),
      fetch(OFFLINE_DB_FILE).then((r) => r.arrayBuffer()),
    ]);
    offlineDb = new SQL.Database(new Uint8Array(bytes));
    offlineReady = true;
    return true;
  } catch (e) {
    offlineFailed = true;
    return false;
  }
}

/* Returns an AnalyzeResult-shaped object or null (mirrors /analyze). */
function offlineLookup(text, language) {
  if (!offlineDb) return null;
  const q = text.trim();
  if (!q) return null;
  let entry = queryEntry(q, language);
  if (entry) return entry;
  // Not a known lemma — try an inflected surface form (J-UniMorph).
  const sf = querySurfaceForm(q, language);
  if (!sf) return null;
  entry = queryEntry(sf.lemma, language);
  if (!entry) return null;
  return Object.assign({}, entry, {
    queried_text: q,
    inflected_from: { base_lemma: sf.lemma, features: sf.features, hits: sf.hits },
  });
}

function queryEntry(lemma, language) {
  const stmt = offlineDb.prepare(
    "SELECT data FROM entries WHERE lemma = ? AND language = ? LIMIT 1");
  try {
    stmt.bind([lemma, language]);
    if (!stmt.step()) return null;
    return JSON.parse(stmt.getAsObject().data);
  } finally {
    stmt.free();
  }
}

function querySurfaceForm(surfaceForm, language) {
  const stmt = offlineDb.prepare(
    "SELECT lemma, features, hits FROM surface_forms WHERE surface_form = ? AND language = ? LIMIT 1");
  try {
    stmt.bind([surfaceForm, language]);
    if (!stmt.step()) return null;
    const row = stmt.getAsObject();
    return { lemma: row.lemma, features: JSON.parse(row.features), hits: row.hits };
  } finally {
    stmt.free();
  }
}

/* sql.js loader — uses the bundled sql-wasm.js + sql-wasm.wasm next to the page. */
function loadSqlJs() {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "sql-wasm.js";
    script.onload = () => {
      if (typeof initSqlJs !== "function") return reject(new Error("initSqlJs missing"));
      resolve(initSqlJs({ locateFile: (f) => f }));
    };
    script.onerror = () => reject(new Error("sql-wasm.js failed to load"));
    document.head.appendChild(script);
  });
}
