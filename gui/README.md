# Lingua Mundi GUI — lightweight dictionary interface

A zero-dependency, static web prototype for the Lingua Mundi dictionary API
(`/analyze`). Vanilla HTML + CSS + JS, one page, no build step — open
`index.html` and it works.

```
lingua-mundi-gui/
├── index.html   # the whole app: search, typeahead, detail panel, sample data
├── styles.css   # mobile-first styles, solid brand palette, no gradients
└── README.md    # this file
```

## Pointing it at the API

1. Start the Lingua Mundi FastAPI app (from `lingua-mundi/`):

   ```bash
   venv/bin/uvicorn api.main:app --host 127.0.0.1 --port 8765
   ```

   (Set `DATABASE_URL` if your Postgres isn't on the default `localhost:5432` —
   e.g. `DATABASE_URL=postgresql+psycopg2://postgres@localhost:5433/lingua_mundi`.)

2. Open `index.html` in a browser.

3. The page reads a single config constant at the top of `index.html`:

   ```js
   const API_BASE = "http://localhost:8765";
   const API_LIVE = true;   // set false to force sample-data mode
   ```

   Change `API_BASE` to point at any deployed instance.

> **CORS note (2026-08-30).** The FastAPI app now ships `CORSMiddleware`
> (`api/main.py`), so a browser page served from a different origin can call
> the API directly. The UI still detects a failed fetch and drops into
> bundled sample-data mode with a visible banner — that is the graceful
> fallback, not a crash. The GUI is also served from the launch site at
> `/gui/` (deployed via `deploy-to-github-pages.sh`).

## API base override

The API root is resolved in this order:

1. `?api=<url>` query parameter (e.g. `index.html?api=https://api.example.com`)
2. `localStorage["lm-api"]` (persisted across visits)
3. the `API_BASE_DEFAULT` constant in `index.html` (`http://localhost:8765`)

This lets any deployment — local, tunneled, or hosted — point the GUI at a
real API without editing files. The API also exposes `GET /lookup` (alias of
`/analyze`) and `GET /kanji?text=日本語` (per-character kanji details).

## Demo without the API

The prototype ships three real responses captured from the live API
(猫, 食べる, cat — exact `AnalyzeResult` JSON from `schemas/analyze.py`), so the
full interaction is demonstrable offline:

- type **猫** → suggestion with furigana ねこ; Enter opens the detail panel
  (senses, readings, kanji breakdown: 11 strokes / grade 8 / JLPT 2 / freq 1702)
- type **食べ** → matches 食べる; its card shows the inflection 食べません with
  J-UniMorph features `V · PRS · IPFV · POL · FOREG · NEG`
- type **cat** (switch the language select to English) → the reverse dictionary
  direction, JMdict-sourced

If the API is unreachable, the banner reads
**“API not reachable — showing bundled sample data”**. The sample matcher does a
simple substring scan over lemma / furigana / readings / sense text, which is
deliberately dumber than the real API — it exists only to keep the UI
demonstrable.

## Interactions

| Action | Result |
| --- | --- |
| Type in the search box | debounced (250 ms) lookup-as-you-type against `/analyze` |
| `↑` / `↓` | move through typeahead suggestions |
| `Enter` | open the highlighted (or first) suggestion |
| `Esc` | close the suggestion list |
| Click a suggestion | open it immediately |
| 日本語 / EN toggle (header) | `jpn` (日本語 → EN) or `eng` (English → JP) — re-runs the current query |
| `?` button (header) | opens the plain-language "how to use" panel |
| ✕ clear button | reset the search |

## What the detail panel shows

- **Headword** — large Japanese serif (Hiragino Mincho / Noto Serif JP fallback),
  with ruby furigana rendered per character when the lengths align, else kana
  shown beside the lemma
- **Part of speech** tag + language tag
- **Inflected-form note** — e.g. 食べません → lemma 食べる with morphological
  features and corpus hit count
- **Senses** — numbered, with definition language, per-sense POS, and the
  Princeton WordNet synset label/URI when present
- **Readings** — on-yomi / kun-yomi / kana / kanji rows, common readings
  starred, sourced from JMdict + KANJIDIC2
- **Related forms** — other known inflections (J-UniMorph)
- **Kanji breakdown** — strokes, school grade, JLPT level, frequency rank
  (KANJIDIC2)
- **Sources** — provenance badges (JMdict, KANJIDIC2, Princeton WordNet,
  J-UniMorph, EJDict…) per the API's own `sources` field

## Design decisions

- **No framework, no build step.** One HTML file + one CSS file. The API is
  REST and the payload is small, so a single debounced `fetch` and a handful of
  render functions are all that is needed. Lighter than Takoboto, cleaner to
  read than Wiktionary's dense article markup.
- **Mobile-first.** A single column that stacks: search on top, detail below.
  ≥720 px adds breathing room but no re-architecture. The search field is the
  first thing focused on load.
- **Solid brand palette, no gradients.** `#004070` primary (header, lemma
  panel, sense numbers), `#0060a0` accent (focus rings, tags, links),
  `#101418` ink, `#f5f6f8` page background. Visual hierarchy comes from color
  blocks, borders, and one soft shadow — not gradient fills.
- **Japanese-first typography.** Hiragino → Noto Sans JP → Yu Gothic for body
  Japanese; Hiragino Mincho / Noto Serif JP for headwords, which reads more
  like a dictionary entry than a sans-serif. Ruby (`<ruby><rt>`) for furigana
  so readings sit above the kanji like a real Japanese dictionary.
- **Honest fallback.** The API contract is exact-match (`/analyze` returns one
  merged lexeme or `null`), so the live typeahead shows at most one suggestion
  per query — the UI treats a direct hit as “open it immediately”, matching how
  Takoboto jumps to a word card. Sample-data mode is a labelled, visible
  stand-in, never a silent fake.

## Inspiration notes

- **Takoboto** — lookup-as-you-type, big clear word cards, furigana on the
  headword, sense-by-sense definitions, kanji stats block, related forms.
  The single-column card layout and the “suggestion → open card” flow are
  direct nods.
- **Wiktionary** — part-of-speech sections, numbered senses, provenance
  transparency. The “Sources” badges and the per-sense synset links come from
  Wiktionary's habit of showing exactly where a gloss came from.

## Future ideas (not built)

- Pitch accent display when the API exposes it
- Etymology section (Wiktionary import is in the pipeline; excluded from the
  paid data package for licensing — see `docs/DATA_LICENSES.md`)
- Deeper kanji view (radicals, compounds) once `/kanji`-style endpoints exist
- History of recent lookups; shareable `#/word` deep links
