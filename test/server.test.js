'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApp } = require('../server');

/** A fake Gemini API that answers like the real one. */
function startFakeGemini() {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || '{}');
    const reply = (status, obj) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(obj));
    };

    // Newer TTS models: the Interactions API returns a whole WAV file.
    if (req.url.endsWith('/interactions')) {
      calls.push({ model: body.model, endpoint: 'interactions', key: req.headers['x-goog-api-key'], body });
      const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(40), Buffer.alloc(2400, 2)]);
      return reply(200, { steps: [{ type: 'model_output', content: [{ type: 'audio', mime_type: 'audio/wav', data: wav.toString('base64') }] }] });
    }

    const model = decodeURIComponent(req.url.split('/models/')[1].split(':')[0]);
    calls.push({ model, key: req.headers['x-goog-api-key'], body });

    if (model === 'busy-model') return reply(429, { error: { message: 'Resource has been exhausted' } });
    if (model === 'missing-model') return reply(404, { error: { message: 'models/missing-model is not found' } });
    if (model === 'broke-model') return reply(429, { error: { message: 'Your prepayment credits are depleted. Please go to AI Studio to manage your project and billing.' } });
    if (model === 'fake-tts') {
      const pcm = Buffer.alloc(4800, 1);
      return reply(200, { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: pcm.toString('base64') } }] } }] });
    }
    const parts = body.contents[0].parts;
    const text = parts.some((p) => p.inlineData)
      ? JSON.stringify({ language: 'hi', lines: ['  मैं   स्कूल जाता हूँ। ', '', 'हम खेलते हैं।'] })
      : (/very simple English/.test(parts[0].text) ? 'I go to school.' : 'मैं रोज़ स्कूल जाता हूँ।');
    return reply(200, { candidates: [{ content: { parts: [{ text }] } }] });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, calls, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

function startApp(config) {
  const app = createApp({ apiKey: 'test-key', model: 'fake-model', ttsModel: 'fake-tts', ratePerMinute: 1000, ...config });
  return new Promise((resolve) => {
    app.listen(0, '127.0.0.1', () => resolve({ app, url: `http://127.0.0.1:${app.address().port}` }));
  });
}

const post = (url, body) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

const FAKE_IMAGE = Buffer.alloc(300, 7).toString('base64');

let gemini;
let main;
const others = [];

test.before(async () => {
  gemini = await startFakeGemini();
  main = await startApp({ apiBase: gemini.url });
});

test.after(() => {
  main.app.close();
  others.forEach((o) => o.app.close());
  gemini.server.close();
});

test('serves the phone app', async () => {
  const res = await fetch(`${main.url}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(await res.text(), /Scan a page/);
  assert.ok(res.headers.get('content-security-policy'));
});

test('serves the Android app link file and PNG icons', async () => {
  const links = await fetch(`${main.url}/.well-known/assetlinks.json`);
  assert.equal(links.status, 200);
  assert.equal(links.headers.get('content-type'), 'application/json');
  const [entry] = await links.json();
  assert.equal(entry.target.package_name, 'com.totareads.app');
  assert.match(entry.target.sha256_cert_fingerprints[0], /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);

  const manifest = await (await fetch(`${main.url}/manifest.webmanifest`)).json();
  for (const icon of manifest.icons.filter((i) => i.type === 'image/png')) {
    const res = await fetch(main.url + icon.src);
    assert.equal(res.status, 200, icon.src);
    assert.equal(res.headers.get('content-type'), 'image/png');
  }
});

test('does not serve files outside public/', async () => {
  for (const p of ['/server.js', '/%2e%2e/server.js', '/..%2fserver.js', '/lib/gemini.js']) {
    const res = await fetch(`${main.url}${p}`);
    assert.equal(res.status, 404, p);
  }
});

test('reports status and languages', async () => {
  const data = await (await fetch(`${main.url}/api/status`)).json();
  assert.equal(data.ready, true);
  assert.ok(data.languages.some((l) => l.code === 'te'));
  assert.ok(data.voices.includes('Kore'));
});

test('reads a page: detects language and cleans lines', async () => {
  const res = await post(`${main.url}/api/read`, { image: FAKE_IMAGE, mimeType: 'image/jpeg' });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.language, 'hi');
  assert.deepEqual(data.lines, ['मैं स्कूल जाता हूँ।', 'हम खेलते हैं।']);
  const call = gemini.calls.at(-1);
  assert.equal(call.key, 'test-key');
  assert.equal(call.model, 'fake-model');
});

test('rejects a request with no photo', async () => {
  const res = await post(`${main.url}/api/read`, {});
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, 'missing');
});

test('simplifies in the page language and in English, and caches', async () => {
  const before = gemini.calls.length;
  const page = await (await post(`${main.url}/api/simplify`, { line: 'मैं स्कूल जाता हूँ।', grade: 3, language: 'hi', target: 'page' })).json();
  assert.equal(page.text, 'मैं रोज़ स्कूल जाता हूँ।');
  assert.equal(page.language, 'hi');
  assert.match(gemini.calls.at(-1).body.contents[0].parts[0].text, /spoken Hindi/);

  const en = await (await post(`${main.url}/api/simplify`, { line: 'मैं स्कूल जाता हूँ।', grade: 3, language: 'hi', target: 'en' })).json();
  assert.equal(en.text, 'I go to school.');
  assert.equal(en.language, 'en');

  await post(`${main.url}/api/simplify`, { line: 'मैं स्कूल जाता हूँ।', grade: 3, language: 'hi', target: 'en' });
  assert.equal(gemini.calls.length, before + 2, 'third request should come from the cache');
});

test('speaks text as a playable WAV', async () => {
  const res = await post(`${main.url}/api/speak`, { text: 'అమ్మ అన్నం వండింది.', voice: 'Kore', language: 'te' });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'audio/wav');
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.toString('ascii', 0, 4), 'RIFF');
  assert.equal(buf.toString('ascii', 8, 12), 'WAVE');
  assert.equal(buf.readUInt32LE(24), 24000);
  assert.equal(buf.length, 44 + 4800);
  const call = gemini.calls.at(-1);
  assert.equal(call.model, 'fake-tts');
  assert.match(call.body.contents[0].parts[0].text, /Telugu/);
  assert.equal(call.body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, 'Kore');
});

test('newer voice models get the words only, with the reading style kept separate', async () => {
  const v38 = await startApp({ apiBase: gemini.url, ttsModel: 'gemini-3.8-flash-tts' });
  others.push(v38);
  const res = await post(`${v38.url}/api/speak`, { text: 'అమ్మ అన్నం వండింది.', voice: 'Leda', language: 'te' });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'audio/wav');
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.toString('ascii', 0, 4), 'RIFF');
  assert.equal(buf.length, 44 + 2400, 'a WAV from Gemini is passed on, not wrapped twice');

  const call = gemini.calls.at(-1);
  assert.equal(call.endpoint, 'interactions');
  assert.equal(call.model, 'gemini-3.8-flash-tts');
  const item = call.body.input[0].content[0];
  assert.equal(item.text, 'అమ్మ అన్నం వండింది.', 'only the page words are spoken');
  assert.match(item.annotations[0].style, /slow/i);
  assert.match(item.annotations[0].style, /Telugu/);
  assert.deepEqual(call.body.generation_config.speech_config, [{ voice: 'Leda' }]);
});

test('refuses text that is too long', async () => {
  const res = await post(`${main.url}/api/speak`, { text: 'a'.repeat(900) });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, 'too_long');
});

test('without a key, says Gemini is not set up', async () => {
  const noKey = await startApp({ apiKey: '', apiBase: gemini.url });
  others.push(noKey);
  assert.equal((await (await fetch(`${noKey.url}/api/status`)).json()).ready, false);
  const res = await post(`${noKey.url}/api/read`, { image: FAKE_IMAGE });
  assert.equal(res.status, 503);
  assert.equal((await res.json()).code, 'not_configured');
});

test('passes on Gemini rate limits and wrong model names clearly', async () => {
  const busy = await startApp({ apiBase: gemini.url, model: 'busy-model' });
  const missing = await startApp({ apiBase: gemini.url, model: 'missing-model' });
  others.push(busy, missing);

  const r1 = await post(`${busy.url}/api/simplify`, { line: 'x', language: 'te' });
  assert.equal(r1.status, 429);
  assert.match((await r1.json()).error, /busy/);

  const r2 = await post(`${missing.url}/api/simplify`, { line: 'x', language: 'te' });
  assert.equal(r2.status, 502);
  assert.match((await r2.json()).error, /missing-model/);
});

test('keeps thinking low on Flash models', async () => {
  const v3 = await startApp({ apiBase: gemini.url, model: 'gemini-3.6-flash' });
  const v25 = await startApp({ apiBase: gemini.url, model: 'gemini-2.5-flash' });
  others.push(v3, v25);

  await post(`${v3.url}/api/simplify`, { line: 'thinking check 3', language: 'te' });
  assert.deepEqual(gemini.calls.at(-1).body.generationConfig.thinkingConfig, { thinkingLevel: 'minimal' });

  await post(`${v25.url}/api/simplify`, { line: 'thinking check 25', language: 'te' });
  assert.deepEqual(gemini.calls.at(-1).body.generationConfig.thinkingConfig, { thinkingBudget: 0 });
});

test('says clearly when Gemini credit has run out', async () => {
  const broke = await startApp({ apiBase: gemini.url, model: 'broke-model' });
  others.push(broke);
  const res = await post(`${broke.url}/api/simplify`, { line: 'x', language: 'te' });
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.code, 'billing');
  assert.match(body.error, /add credit/);
});

test('limits requests per phone', async () => {
  const limited = await startApp({ apiBase: gemini.url, ratePerMinute: 2 });
  others.push(limited);
  const codes = [];
  for (let i = 0; i < 3; i++) codes.push((await post(`${limited.url}/api/simplify`, { line: `line ${i}`, language: 'te' })).status);
  assert.deepEqual(codes, [200, 200, 429]);
});
