# Tota Reads

A reading helper for children in regional-medium schools. The child photographs a page from their own textbook, taps a line to hear it read aloud with each word highlighted, and taps **Simplify** to hear what it means in simple words, in the page's language or in English.

- The app's buttons and labels are in English.
- The page can be in Telugu, Hindi, Tamil, Kannada, Malayalam, Marathi, Bengali, Gujarati, Punjabi, Odia, Urdu or English. Gemini works out the language from the photo.
- Before any scan, the app opens on a sample Telugu page, so a demo works even without a connection.

## How it works

```
Phone (browser)                 Cloud Run (server.js)                Gemini API
───────────────                 ─────────────────────                ──────────
Scan a page      ── photo ──▶   POST /api/read      ── image ──▶     gemini-3.6-flash
                 ◀─ lines ───   { language, lines }  ◀─ JSON ───      (reads the page)

Tap Simplify     ── line ───▶   POST /api/simplify  ── prompt ─▶     gemini-3.6-flash
                 ◀─ text ────   { text }             ◀─ text ───      (explains at the child's class level)

Tap a line /     ── text ───▶   POST /api/speak     ── text ───▶     gemini-3.8-flash-tts
Listen           ◀─ WAV ─────   audio/wav            ◀─ PCM ────      (reads aloud in the page's language)
```

The Gemini key lives only on the server, in Secret Manager. The phone never sees it. The server also caches answers, so tapping the same line twice costs one Gemini call, and limits each phone to 40 requests a minute.

## Run it on your laptop

You need Node.js 20 or newer and a free Gemini API key from https://aistudio.google.com/apikey.

```bash
cd tota-reads
GEMINI_API_KEY=your-key npm start
```

Open http://localhost:8080. To try it on your phone, connect the phone to the same Wi-Fi and open `http://<your-laptop-ip>:8080`.

Without `GEMINI_API_KEY` the app still runs, but only the sample page works and the phone's own voice reads aloud.

## Deploy to Google Cloud Run

You need the `gcloud` CLI, signed in (`gcloud auth login`), and a Google Cloud project with billing turned on. Cloud Run's free tier covers a buildathon demo.

```bash
cd tota-reads
PROJECT_ID=your-project-id ./deploy.sh
```

The script turns on the needed services, stores your Gemini key in Secret Manager (it asks you to paste it once), gives the app permission to read it, and deploys to Cloud Run in Mumbai (`asia-south1`). It prints the public URL at the end. On the phone, use the browser's "Add to Home screen" to get an app icon.

To change the key later:

```bash
printf '%s' 'new-key' | gcloud secrets versions add gemini-api-key --data-file=-
PROJECT_ID=your-project-id ./deploy.sh
```

## Android app (APK)

The Android app is a Trusted Web Activity: a thin Android shell that opens the live Cloud Run app full screen in Chrome. App changes go live by deploying to Cloud Run; you only rebuild the APK to change its name, icon or web address.

- Build settings: `android/twa-manifest.json` in this repo. Build files are generated into `../tota-reads-android/` (made with Google's [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap)).
- Signing key: `C:\Users\LENOVO\android-tools\tota-reads-keys\` (never in this folder). **Back it up.** Without it you can't publish updates.
- `public/.well-known/assetlinks.json` holds the key's public fingerprint. It proves the app and the site belong together, which hides the browser address bar. If the key or package name changes, update this file.
- To rebuild: copy `android/twa-manifest.json` into `../tota-reads-android/`, raise `appVersionCode`, then run `bubblewrap update` and `bubblewrap build` there. Copy the updated `twa-manifest.json` back here.

## Settings

Server (environment variables):

| Variable | Default | What it does |
|---|---|---|
| `GEMINI_API_KEY` | (none) | Gemini key from Google AI Studio |
| `GEMINI_MODEL` | `gemini-3.6-flash` | Model that reads the page and simplifies |
| `GEMINI_TTS_MODEL` | `gemini-3.8-flash-tts` | Model that reads aloud |
| `RATE_LIMIT_PER_MINUTE` | `40` | Requests allowed per phone per minute |
| `PORT` | `8080` | Port to listen on (Cloud Run sets this) |

If Google renames a model, change `GEMINI_MODEL` or `GEMINI_TTS_MODEL`; the app shows a clear message when a model name is wrong.

In the app (gear button, saved on the phone): the child's class (1–5), whether Simplify uses the page's language or English, and the voice.

## API

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/status` | | `{ ready, voices, languages }` |
| POST | `/api/read` | `{ image: <base64>, mimeType }` | `{ language, lines }` |
| POST | `/api/simplify` | `{ line, grade, language, target: "page" \| "en" }` | `{ text, language }` |
| POST | `/api/speak` | `{ text, voice, language }` | `audio/wav` |
| GET | `/healthz` | | `ok` |

Errors come back as `{ error, code }` with a message written for the person using the app.

## Tests

```bash
npm test
```

The tests start a fake Gemini server and check every route, the caching, the error messages and the file serving. They need no API key and no internet.

## Files

```
server.js            HTTP server: API routes, static files, rate limits, caches
lib/gemini.js        Gemini calls and prompts; turns TTS audio into WAV
lib/languages.js     Supported page languages
public/              The phone app (index.html, app.js, app.css, icon, manifest)
test/                Automated tests with a fake Gemini
Dockerfile           Container for Cloud Run
deploy.sh            One-command Cloud Run deploy with Secret Manager
```

## Next steps

- Teacher view: which lines and words each child asked for help with.
- Pronunciation practice: the child reads the line back and the app checks it (Gemini Live).
- Offline mode on a low-cost device with Gemma.
