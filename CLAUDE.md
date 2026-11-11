# Tota Reads

A reading helper for children (Class 1–5) in regional-medium schools in India. The child photographs a page of their own textbook, taps a line to hear it read aloud with each word highlighted, and taps **Simplify** to hear what it means in simple words, in the page's language or in English.

Built for the **Google Startup Buildathon India 2026** (Hyderabad city round 20–21 Nov, Hyderabad Regional Showcase 27 Nov, finale 2 Dec at Google Bengaluru). Judging criteria: founder profile, product potential, market viability, technical architecture, and **how deeply Google AI and Google Cloud power the product**. Prefer Google's stack (Gemini, Gemma, Cloud Run, Secret Manager, Firestore, etc.) when adding features.

## Product rules

- **Users are young children**, often struggling readers. Every screen must work with one hand, big tap targets (at least 48px), very little text, no typing.
- **All app UI (buttons, labels, messages) is in English.** Page text and simplified text stay in the page's own language and script.
- Supported page languages live in `lib/languages.js` (Telugu, Hindi, Tamil, Kannada, Malayalam, Marathi, Bengali, Gujarati, Punjabi, Odia, Urdu, English). Telugu is the primary market; test Telugu first.
- Each "line" card is one **sentence**, not one printed line, because printed lines often cut a sentence in half.
- Core flow, which must never break: Scan a page → line cards → tap a line (reads it aloud, highlights words) → Listen / Simplify / Next line → Simplify box with a page-language ⇄ English switch and its own Listen button.
- The app opens on a built-in **sample Telugu page** (`SAMPLE` in `public/app.js`), so a demo works with no network or key. Keep it working.
- Why not "just use Gemini": a child can't type prompts or read Gemini's text reply. This app's value is the child-friendly experience on top of Gemini (one tap, slow read-aloud, word highlighting, class-level explanations) plus, on the roadmap, the teacher view.

## Architecture

```
public/ (phone web app, plain HTML/CSS/JS)  ──▶  server.js (Node, Cloud Run)  ──▶  Gemini API
```

- `server.js`: the HTTP server. Serves `public/`, exposes the API, keeps the Gemini key, caches answers (LRU), rate-limits per client IP, sends security headers (CSP).
- `lib/gemini.js`: every Gemini call and **every prompt** (`READ_PROMPT`, `simplifyPrompt`, `speakPrompt`). Converts TTS PCM audio to WAV (`pcmToWav`).
- `lib/languages.js`: supported languages (`code`, `name`, BCP-47 `tag`).
- `public/index.html`, `public/app.css`, `public/app.js`: the phone app. No framework, no build step.
- `test/server.test.js`: `node:test` suite with a fake Gemini server.
- `Dockerfile`, `deploy.sh`: Cloud Run deploy (region `asia-south1`), key in Secret Manager as `gemini-api-key`.

### API

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/status` | | `{ ready, voices, languages }` |
| POST | `/api/read` | `{ image: <base64>, mimeType }` | `{ language, lines }` |
| POST | `/api/simplify` | `{ line, grade, language, target: "page" \| "en" }` | `{ text, language }` |
| POST | `/api/speak` | `{ text, voice, language }` | `audio/wav` |
| GET | `/healthz` | | `ok` (works locally; on `*.run.app` Google's front end returns 404 for paths ending in `z`, so check `/api/status` instead) |

Errors are `{ error, code }`. `error` is a sentence shown directly to the user.

### Models (env vars)

- `GEMINI_MODEL` (default `gemini-3.6-flash`): reads the page (structured JSON output) and simplifies.
- `GEMINI_TTS_MODEL` (default `gemini-3.8-flash-tts`): read-aloud. Returns raw 16-bit mono PCM (`audio/L16;rate=24000`); the server wraps it in a WAV header.
- `GEMINI_API_KEY`, `GEMINI_API_BASE`, `RATE_LIMIT_PER_MINUTE`, `PORT`.
- Model names change over time. If one is retired, update the default in `server.js` (`loadConfig`) and the README. Check current names in the Gemini API docs before changing them.

## Commands

```bash
npm test                                  # run all tests (no key or internet needed)
GEMINI_API_KEY=your-key npm start         # run locally at http://localhost:8080
PROJECT_ID=your-project ./deploy.sh       # deploy to Cloud Run
```

Run `npm test` after every change, and add or update tests for any server change.

Android APK: a Trusted Web Activity built with Bubblewrap in `../tota-reads-android/` (package `com.totareads.app`). It loads the live Cloud Run service `tota-reads` (https://tota-reads-297128331697.asia-south1.run.app), so web changes need no APK rebuild. The signing key lives outside the repo in `C:\Users\LENOVO\android-tools\tota-reads-keys\`; `public/.well-known/assetlinks.json` must match its SHA-256 fingerprint. See the README.

## Conventions

- **No npm dependencies.** The server uses only Node built-ins (`http`, `fs`, `fetch`, `node:test`), and the app is plain JS. Ask before adding any package or framework.
- Node 20+ (Docker uses `node:22-slim`). CommonJS on the server.
- Keep the Gemini key on the server only. Never send it to the browser or log it.
- Prompts belong in `lib/gemini.js`. When changing a prompt, keep the instruction that the output stays in the requested language and script, with no lists or headings (it is read aloud).
- Validate every API input (length limits, allowed values) the way the existing routes do, and return a friendly `HttpError`.
- User-facing copy: plain English, short sentences, says what happened and what to do next ("No text found in this photo. Hold the phone straight over the page, in good light, and try again."). No jargon like "API", "500", "OCR" in messages a child or parent sees.
- CSS: all colours are tokens in `:root` in `public/app.css`, with dark-mode values in both the `prefers-color-scheme` block and `:root[data-theme="dark"]`. Keep a phone-first single column, max width 620px, 16px side gutter, no horizontal scroll at 360px wide.
- Fonts: the Baloo family covers each Indian script (`--font-read` in `app.css`); Urdu uses Noto Nastaliq Urdu. Set `lang` and `dir="auto"` on any element holding page text (use `setLang()` in `app.js`).
- Respect `prefers-reduced-motion`, keep visible focus outlines, and keep buttons as real `<button>` elements.
- If you add new external hosts (fonts, scripts, APIs called from the browser), update the CSP in `server.js` (`SECURITY_HEADERS`).

## Gotchas

- **Phone audio:** browsers only play sound after a tap. `speak()` in `app.js` unlocks the audio element inside the tap before fetching. Keep audio starting from a user tap.
- **Word highlighting** for Gemini audio is estimated from word length versus playback position (`weightsOf` / `wordAt`), not real timestamps. The browser-voice fallback uses `onboundary` events.
- **Fallbacks:** if the server isn't connected to Gemini, the sample page still works and the phone's own voice (`speechSynthesis`) reads aloud. Many phones lack Telugu voices, so the Gemini voice is the main path.
- **Photos** are shrunk in the browser to 1600px JPEG before upload. The server accepts up to 8 MB of JSON.
- **Caches** are in memory per Cloud Run instance and are lost on restart. That's fine for now; use Firestore or Cloud Storage if persistence is needed.
- **Telugu rendering** needs the web font. Headless test browsers without Indic fonts show broken glyphs; that is not an app bug.
- Thinking is kept low for speed (`fastConfig` in `lib/gemini.js`): `thinkingBudget: 0` for `gemini-2.5-flash*`, `thinkingLevel: "minimal"` for `gemini-3.x-flash` (3.x cannot turn it fully off).

## Roadmap (in priority order)

1. **Deploy and test with real textbook pages** (Telangana/AP state Telugu textbooks, small print, tilted photos, dim light). Measure word accuracy; this number goes in the pitch.
2. **Tap a single word** to hear it and get its meaning.
3. **Read-back practice:** the child reads the line aloud, and the app checks it and praises them (Gemini Live or speech-to-text).
4. **Teacher view:** which lines and words each child asked for help with (Firestore + simple sign-in). This is what schools would pay for.
5. **Save pages** so a child can reopen tonight's homework page.
6. **Offline / low-cost device** version with Gemma.

## Working with me

I'm a product manager, not a full-time engineer. When you make changes:
- Explain what you changed and why in plain language.
- Keep changes small and the app runnable after each step.
- Tell me anything I need to do myself (keys, Google Cloud settings, deploying).
