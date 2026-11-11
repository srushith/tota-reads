'use strict';

/**
 * Tota Reads server.
 * Serves the phone app from ./public and keeps the Gemini key on the server.
 *
 *   POST /api/read      { image: <base64>, mimeType }               -> { language, lines: [...] }
 *   POST /api/simplify  { line, grade, language, target: page|en }  -> { text }
 *   POST /api/speak     { text, voice, language }                   -> audio/wav
 *   GET  /api/status                                                -> { ready, voices, languages }
 *   GET  /healthz                                                   -> ok
 */

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createGemini, GeminiError } = require('./lib/gemini');
const { LANGUAGES, languageFor } = require('./lib/languages');

const OTHER_LANGUAGE = { code: 'other', name: 'Other', tag: '' };

const PUBLIC_DIR = path.join(__dirname, 'public');
const VOICES = ['Kore', 'Aoede', 'Leda', 'Zephyr', 'Puck', 'Charon'];
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json', // /.well-known/assetlinks.json links the Android app to this site
};

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'content-security-policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com',
    "img-src 'self' blob: data:",
    "media-src 'self' blob:",
    "connect-src 'self'",
    "manifest-src 'self'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join('; '),
};

function loadConfig(env = process.env) {
  return {
    port: Number(env.PORT) || 8080,
    apiKey: (env.GEMINI_API_KEY || '').trim(),
    apiBase: (env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, ''),
    model: env.GEMINI_MODEL || 'gemini-3.6-flash',
    ttsModel: env.GEMINI_TTS_MODEL || 'gemini-3.8-flash-tts',
    ratePerMinute: Number(env.RATE_LIMIT_PER_MINUTE) || 40,
  };
}

class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Small least-recently-used cache so repeated taps don't cost another Gemini call. */
class Lru {
  constructor(max) {
    this.max = max;
    this.map = new Map();
  }
  get(key) {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key);
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }
  set(key, value) {
    this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
  }
}

/** Token bucket per client, so a public URL can't drain the Gemini quota. */
function createRateLimiter(perMinute) {
  const buckets = new Map();
  return function allow(key, now = Date.now()) {
    let b = buckets.get(key);
    if (!b) {
      b = { tokens: perMinute, ts: now };
      buckets.set(key, b);
    }
    b.tokens = Math.min(perMinute, b.tokens + ((now - b.ts) / 60000) * perMinute);
    b.ts = now;
    if (buckets.size > 5000) {
      for (const [k, v] of buckets) if (now - v.ts > 120000) buckets.delete(k);
    }
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  };
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (typeof fwd === 'string' && fwd.split(',')[0].trim()) || req.socket.remoteAddress || 'unknown';
}

function readJson(req, limitBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limitBytes) tooLarge = true;
      if (!tooLarge) chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) return reject(new HttpError(413, 'The photo is too large. Try a smaller photo.', 'too_large'));
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new HttpError(400, 'The request was not valid JSON.', 'bad_json'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': payload.length,
  });
  res.end(payload);
}

function requireText(value, max, what) {
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, `Send the ${what} to read.`, 'missing');
  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length > max) throw new HttpError(400, `The ${what} is too long. Send at most ${max} characters.`, 'too_long');
  return text;
}

function createApp(config = loadConfig(), deps = {}) {
  const gemini = deps.gemini || createGemini(config);
  const ready = Boolean(config.apiKey);
  const allow = createRateLimiter(config.ratePerMinute);
  const simplifyCache = new Lru(500);
  const speechCache = new Lru(200);

  async function handleApi(req, res, pathname) {
    if (pathname === '/api/status') {
      if (req.method !== 'GET') throw new HttpError(405, 'Use GET for this address.', 'method');
      return sendJson(res, 200, { ready, voices: VOICES, languages: LANGUAGES });
    }
    if (req.method !== 'POST') throw new HttpError(405, 'Use POST for this address.', 'method');
    if (!['/api/read', '/api/simplify', '/api/speak'].includes(pathname)) {
      throw new HttpError(404, 'There is no such address.', 'not_found');
    }
    if (!allow(clientIp(req))) {
      throw new HttpError(429, 'Too many requests from this phone. Wait a minute and try again.', 'rate_limited');
    }

    if (pathname === '/api/read') {
      const body = await readJson(req, 8 * 1024 * 1024);
      const mimeType = body.mimeType || 'image/jpeg';
      if (!IMAGE_TYPES.has(mimeType)) throw new HttpError(400, 'Send a JPEG, PNG or WebP photo.', 'bad_type');
      const image = typeof body.image === 'string' ? body.image.replace(/^data:[^,]*,/, '').replace(/\s+/g, '') : '';
      if (image.length < 100 || !/^[A-Za-z0-9+/]+=*$/.test(image)) {
        throw new HttpError(400, 'Send a photo of the page.', 'missing');
      }
      const page = await gemini.readPage(image, mimeType);
      return sendJson(res, 200, page);
    }

    if (pathname === '/api/simplify') {
      const body = await readJson(req, 16 * 1024);
      const line = requireText(body.line, 500, 'sentence');
      const grade = Math.min(5, Math.max(1, Math.round(Number(body.grade)) || 3));
      const pageLang = languageFor(body.language) || OTHER_LANGUAGE;
      const target = body.target === 'en' ? 'en' : 'page';
      const key = `${grade}|${pageLang.code}|${target}|${line}`;
      let text = simplifyCache.get(key);
      if (!text) {
        text = await gemini.simplify(line, grade, pageLang, target);
        simplifyCache.set(key, text);
      }
      return sendJson(res, 200, { text, language: target === 'en' ? 'en' : pageLang.code });
    }

    // /api/speak
    const body = await readJson(req, 16 * 1024);
    const text = requireText(body.text, 800, 'text');
    const voice = VOICES.includes(body.voice) ? body.voice : VOICES[0];
    const lang = languageFor(body.language) || OTHER_LANGUAGE;
    const key = `${voice}|${lang.code}|${text}`;
    let wav = speechCache.get(key);
    if (!wav) {
      wav = await gemini.speak(text, voice, lang);
      speechCache.set(key, wav);
    }
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'content-type': 'audio/wav',
      'content-length': wav.length,
      'cache-control': 'private, max-age=86400',
    });
    res.end(wav);
  }

  async function serveStatic(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Use GET for this address.', 'method');
    let rel;
    try {
      rel = decodeURIComponent(pathname);
    } catch {
      throw new HttpError(400, 'That address is not valid.', 'bad_path');
    }
    if (rel === '/' || rel === '') rel = '/index.html';
    const filePath = path.join(PUBLIC_DIR, rel);
    if (!filePath.startsWith(PUBLIC_DIR + path.sep)) throw new HttpError(404, 'Page not found.', 'not_found');
    let data;
    try {
      data = await fs.readFile(filePath);
    } catch {
      throw new HttpError(404, 'Page not found.', 'not_found');
    }
    const ext = path.extname(filePath);
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'content-type': MIME[ext] || 'application/octet-stream',
      'content-length': data.length,
      'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  }

  function handleError(res, err) {
    const known = err instanceof HttpError || err instanceof GeminiError;
    const status = known ? err.status : 500;
    if (!known || err instanceof GeminiError) {
      // One JSON line per problem, so Cloud Logging can group them.
      console.error(JSON.stringify({
        severity: status >= 500 ? 'ERROR' : 'WARNING',
        message: err.message,
        code: err.code,
        detail: err.detail,
        stack: known ? undefined : err.stack,
      }));
    }
    if (res.headersSent) return res.destroy();
    sendJson(res, status, {
      error: known ? err.message : 'Something went wrong on the server. Try again.',
      code: known ? err.code : 'server_error',
    });
  }

  return http.createServer(async (req, res) => {
    try {
      const { pathname } = new URL(req.url, 'http://localhost');
      if (pathname === '/healthz') {
        res.writeHead(200, { 'content-type': 'text/plain' });
        return res.end('ok');
      }
      if (pathname.startsWith('/api/')) await handleApi(req, res, pathname);
      else await serveStatic(req, res, pathname);
    } catch (err) {
      handleError(res, err);
    }
  });
}

if (require.main === module) {
  const config = loadConfig();
  const server = createApp(config);
  server.listen(config.port, () => {
    console.log(`Tota Reads is running on http://localhost:${config.port}`);
    if (!config.apiKey) console.log('GEMINI_API_KEY is not set: only the sample page will work.');
  });
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
}

module.exports = { createApp, loadConfig, Lru, createRateLimiter };
