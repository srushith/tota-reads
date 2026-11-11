'use strict';

/**
 * Thin client for the Gemini API (Google AI Studio key).
 * Three jobs: read a textbook photo, simplify a sentence, read text aloud.
 */

const { LANGUAGES, languageFor } = require('./languages');

class GeminiError extends Error {
  constructor(message, { status = 502, code = 'upstream', detail } = {}) {
    super(message);
    this.name = 'GeminiError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

const READ_PROMPT = [
  'This is a photo of a printed page from an Indian school textbook, usually in Telugu or another Indian language.',
  'Work out which language the main text is in, then read the main text in reading order and return it as a list of sentences, one sentence per item.',
  'Rules:',
  '- Copy the text exactly as printed, in its own script. Do not translate, correct or summarise.',
  '- Keep numbers and punctuation as printed.',
  '- If a sentence continues onto the next printed line, join it into one item.',
  '- Keep a heading or a question as its own item.',
  '- Leave out page numbers, running headers and footers.',
  '- If there is no readable text, return an empty list.',
].join('\n');

const SAME_LANGUAGE = 'the same language as the sentence';

function simplifyPrompt(line, grade, pageLang, target) {
  const known = pageLang && pageLang.code !== 'other';
  const page = known ? pageLang.name : SAME_LANGUAGE;
  const intro =
    `You are a kind teacher in an Indian school. A Class ${grade} child is stuck on this sentence ` +
    `from their ${known ? page + ' ' : ''}textbook:\n\n${line}\n\n`;
  if (target === 'en') {
    return (
      intro +
      `Explain what it means in very simple English that a Class ${grade} child in India understands, ` +
      'in two or three short sentences, the way you would say it to the child. ' +
      "If a word is hard, give its meaning with an everyday example from a child's life. " +
      (pageLang && pageLang.code === 'en' ? '' : 'You may keep one or two key words from the sentence, in their own script, so the child connects them. ') +
      'No lists, no headings.'
    );
  }
  return (
    intro +
    `Explain what it means in very simple, spoken ${page}, in two or three short sentences, ` +
    "the way you would say it to the child. If a word is hard, say what it means with an everyday example from a child's life. " +
    `Write only in ${page}, in its own script. No lists, no headings.`
  );
}

/** Older TTS models (2.5, 3.1 previews) take the reading direction inside the text itself. */
function speakPrompt(text, lang) {
  const name = lang && lang.code !== 'other' ? `this ${lang.name} text` : 'this text';
  return `Read ${name} aloud slowly and clearly, like a kind teacher reading to a young child: ${text}`;
}

/**
 * Newer TTS models (3.8+) speak the text word for word, so the reading direction goes in a
 * separate style hint. Keep it about delivery only; it is never read aloud.
 */
function speakStyle(lang) {
  const inLang = lang && lang.code !== 'other' ? ` in ${lang.name}` : '';
  return `Slow, clear and warm${inLang}, like a kind teacher reading aloud to a young child.`;
}

/** TTS models from 3.8 on use the Interactions API; older ones use generateContent. */
function usesInteractions(modelName) {
  const m = /^gemini-(\d+)\.(\d+)-.*tts/.exec(modelName || '');
  if (!m || /preview/.test(modelName)) return false;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  return major > 3 || (major === 3 && minor >= 8);
}

const MAX_LINES = 60;
const MAX_LINE_CHARS = 400;

function createGemini({ apiKey, apiBase, model, ttsModel, timeoutMs = 45000, fetchImpl = fetch }) {
  function generate(modelName, body) {
    return callGemini(`${apiBase}/models/${encodeURIComponent(modelName)}:generateContent`, modelName, body);
  }

  /** One HTTP call to Gemini, with the same friendly errors for every endpoint. */
  async function callGemini(url, modelName, body) {
    if (!apiKey) {
      throw new GeminiError('Gemini is not set up on the server yet.', { status: 503, code: 'not_configured' });
    }
    let res;
    try {
      res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const timedOut = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
      throw new GeminiError(
        timedOut ? 'Gemini took too long to answer. Try again.' : 'The server could not reach Gemini. Try again in a moment.',
        { status: 504, code: 'unreachable', detail: String(err && err.message) }
      );
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (data && data.error && data.error.message) || `Gemini returned ${res.status}`;
      // Checked first: an out-of-credit project can come back as 429, 400 or 403.
      if (/prepay|credits? (are |is )?(depleted|exhausted)|billing/i.test(msg)) {
        throw new GeminiError('Gemini is not paid for right now. The app owner needs to add credit in AI Studio.', {
          status: 503, code: 'billing', detail: msg,
        });
      }
      if (res.status === 429) {
        throw new GeminiError('Gemini is busy or the free limit is used up. Wait a minute and try again.', {
          status: 429, code: 'rate_limited', detail: msg,
        });
      }
      if (res.status === 401 || res.status === 403 || /API key/i.test(msg)) {
        throw new GeminiError('Gemini did not accept the server key. The app owner needs to check it.', {
          status: 502, code: 'bad_key', detail: msg,
        });
      }
      if (res.status === 404) {
        throw new GeminiError(`Gemini has no model called "${modelName}". The app owner needs to change it.`, {
          status: 502, code: 'bad_model', detail: msg,
        });
      }
      throw new GeminiError('Gemini could not finish this request. Try again.', { status: 502, code: 'upstream', detail: msg });
    }
    if (data && data.promptFeedback && data.promptFeedback.blockReason) {
      throw new GeminiError('Gemini could not read this. Try a different photo.', {
        status: 422, code: 'blocked', detail: data.promptFeedback.blockReason,
      });
    }
    return data;
  }

  function partsOf(data) {
    return (data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
  }

  function textOf(data) {
    return partsOf(data)
      .filter((p) => typeof p.text === 'string' && !p.thought)
      .map((p) => p.text)
      .join('')
      .trim();
  }

  // Flash models think by default; reading and short explanations don't need it.
  // 2.5 Flash can switch thinking off; 3.x Flash only goes down to "minimal".
  function fastConfig(modelName) {
    if (/^gemini-2\.5-flash/.test(modelName)) return { thinkingConfig: { thinkingBudget: 0 } };
    if (/^gemini-3(\.\d+)?-flash/.test(modelName) && !/-tts/.test(modelName)) {
      return { thinkingConfig: { thinkingLevel: 'minimal' } };
    }
    return {};
  }

  /** Returns { language: 'te', lines: [...] }. */
  async function readPage(base64, mimeType) {
    const data = await generate(model, {
      contents: [{ role: 'user', parts: [{ inlineData: { mimeType, data: base64 } }, { text: READ_PROMPT }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            language: {
              type: 'STRING',
              enum: LANGUAGES.map((l) => l.code).concat('other'),
              description: 'ISO 639-1 code of the main language on the page',
            },
            lines: { type: 'ARRAY', items: { type: 'STRING' } },
          },
          required: ['language', 'lines'],
        },
        ...fastConfig(model),
      },
    });
    const raw = textOf(data);
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { lines: raw.split(/\n+/) };
    }
    const language = languageFor(parsed.language) ? parsed.language : 'other';
    return { language, lines: cleanLines(parsed.lines) };
  }

  /** target: 'page' to explain in the page's language, 'en' for English. */
  async function simplify(line, grade, pageLang, target) {
    const data = await generate(model, {
      contents: [{ role: 'user', parts: [{ text: simplifyPrompt(line, grade, pageLang, target) }] }],
      generationConfig: { temperature: 0.4, ...fastConfig(model) },
    });
    const text = textOf(data);
    if (!text) throw new GeminiError('Gemini sent an empty answer. Tap Simplify again.', { status: 502, code: 'empty' });
    return text;
  }

  async function speak(text, voice, lang) {
    if (usesInteractions(ttsModel)) return speakInteractions(text, voice, lang);
    const data = await generate(ttsModel, {
      contents: [{ parts: [{ text: speakPrompt(text, lang) }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
      },
    });
    const part = partsOf(data).find((p) => p.inlineData && p.inlineData.data);
    if (!part) throw new GeminiError('Gemini sent no audio. Tap Listen again.', { status: 502, code: 'no_audio' });
    const rate = /rate=(\d+)/.exec(part.inlineData.mimeType || '');
    return pcmToWav(Buffer.from(part.inlineData.data, 'base64'), rate ? Number(rate[1]) : 24000);
  }

  async function speakInteractions(text, voice, lang) {
    const data = await callGemini(`${apiBase}/interactions`, ttsModel, {
      model: ttsModel,
      input: [{
        type: 'user_input',
        content: [{ type: 'text', text, annotations: [{ type: 'speech_metadata', style: speakStyle(lang) }] }],
      }],
      response_format: { type: 'audio' },
      generation_config: { speech_config: [{ voice }] },
    });
    const clip = lastAudio(data);
    if (!clip) throw new GeminiError('Gemini sent no audio. Tap Listen again.', { status: 502, code: 'no_audio' });
    const bytes = Buffer.from(clip.data, 'base64');
    // These models send a whole WAV file by default; wrap it only if raw PCM comes back.
    if (bytes.toString('ascii', 0, 4) === 'RIFF') return bytes;
    const rate = /rate=(\d+)/.exec(clip.mime_type || clip.mimeType || '');
    return pcmToWav(bytes, rate ? Number(rate[1]) : 24000);
  }

  return { readPage, simplify, speak };
}

/** Finds the last audio item in an Interactions reply (steps[].content[] with base64 data). */
function lastAudio(data) {
  let found = null;
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    const mime = String(node.mime_type || node.mimeType || '');
    if (typeof node.data === 'string' && node.data && (node.type === 'audio' || mime.startsWith('audio/'))) found = node;
    Object.values(node).forEach(walk);
  };
  walk(data);
  return found;
}

function cleanLines(lines) {
  return (Array.isArray(lines) ? lines : [])
    .map((s) => String(s).replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, MAX_LINES)
    .map((s) => s.slice(0, MAX_LINE_CHARS));
}

/** Gemini TTS returns raw 16-bit mono PCM; browsers need a WAV header to play it. */
function pcmToWav(pcm, sampleRate) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

module.exports = { createGemini, GeminiError, cleanLines, pcmToWav, usesInteractions };
