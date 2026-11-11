(() => {
  'use strict';

  /* ---------- Sample page, shown before the first scan ---------- */
  const SAMPLE = {
    language: 'te',
    lines: [
      { text: 'ఒక ఊరిలో రవి అనే బాలుడు ఉండేవాడు.',
        page: 'ఒక గ్రామంలో రవి అనే ఒక చిన్న అబ్బాయి ఉండేవాడు. "బాలుడు" అంటే చిన్న అబ్బాయి.',
        en: 'There was a boy named Ravi who lived in a village. "బాలుడు" means a young boy.' },
      { text: 'అతనికి పుస్తకాలు చదవడం అంటే చాలా ఇష్టం.',
        page: 'రవికి పుస్తకాలు చదవడం చాలా నచ్చుతుంది. ఖాళీ దొరికితే చాలు, పుస్తకం పట్టుకుంటాడు.',
        en: 'Ravi loved reading books very much. Whenever he had free time, he picked up a book.' },
      { text: 'ప్రతిరోజూ సాయంత్రం గ్రంథాలయానికి వెళ్ళి కొత్త కథలు చదివేవాడు.',
        page: 'రోజూ సాయంత్రం రవి గ్రంథాలయానికి వెళ్ళేవాడు. "గ్రంథాలయం" అంటే చాలా పుస్తకాలు ఉండే చోటు. అక్కడ కొత్త కథలు చదివేవాడు.',
        en: 'Every evening Ravi went to the library and read new stories. A library (గ్రంథాలయం) is a place with lots of books.' },
      { text: 'ఒక రోజు అతనికి ఒక పాత పుస్తకం దొరికింది.',
        page: 'ఒక రోజు రవికి ఒక పాత పుస్తకం దొరికింది. "దొరికింది" అంటే అనుకోకుండా చేతికి వచ్చింది.',
        en: 'One day Ravi found an old book. "దొరికింది" means he came across it without looking for it.' },
      { text: 'అందులో అడవి జంతువుల గురించి ఆసక్తికరమైన విషయాలు ఉన్నాయి.',
        page: 'ఆ పుస్తకంలో అడవిలో ఉండే జంతువుల గురించి సరదా విషయాలు ఉన్నాయి. "ఆసక్తికరమైన" అంటే ఇంకా తెలుసుకోవాలనిపించేలా ఉండేవి.',
        en: 'That book had interesting facts about animals that live in the forest. "Interesting" means it makes you want to know more.' },
      { text: 'రవి ఆ విషయాలను తన స్నేహితులకు చెప్పాడు.',
        page: 'రవి తను చదివిన విషయాలను తన స్నేహితులకు చెప్పాడు. "స్నేహితులు" అంటే మనతో కలిసి ఆడుకునే మిత్రులు.',
        en: 'Ravi told his friends what he had read. "స్నేహితులు" means friends.' },
      { text: 'అందరూ సంతోషంగా విన్నారు.',
        page: 'రవి స్నేహితులు అందరూ ఆనందంగా విన్నారు. "సంతోషంగా" అంటే నవ్వుతూ, ఆనందంగా.',
        en: 'All his friends listened happily. "సంతోషంగా" means happily.' },
    ],
  };

  const LANGUAGES_FALLBACK = [
    { code: 'te', name: 'Telugu', tag: 'te-IN' }, { code: 'hi', name: 'Hindi', tag: 'hi-IN' },
    { code: 'ta', name: 'Tamil', tag: 'ta-IN' }, { code: 'kn', name: 'Kannada', tag: 'kn-IN' },
    { code: 'ml', name: 'Malayalam', tag: 'ml-IN' }, { code: 'mr', name: 'Marathi', tag: 'mr-IN' },
    { code: 'bn', name: 'Bengali', tag: 'bn-IN' }, { code: 'gu', name: 'Gujarati', tag: 'gu-IN' },
    { code: 'pa', name: 'Punjabi', tag: 'pa-IN' }, { code: 'or', name: 'Odia', tag: 'or-IN' },
    { code: 'ur', name: 'Urdu', tag: 'ur-IN' }, { code: 'en', name: 'English', tag: 'en-IN' },
  ];
  const OTHER = { code: 'other', name: 'Page language', tag: '' };

  /* ---------- Per-device preferences ---------- */
  const store = {
    // Falls back to the old 'chaduvu.' keys so settings saved before the rename carry over.
    get(k) {
      try { return localStorage.getItem('totareads.' + k) ?? localStorage.getItem('chaduvu.' + k); } catch { return null; }
    },
    set(k, v) { try { localStorage.setItem('totareads.' + k, v); } catch { /* private mode */ } },
  };
  const prefs = () => ({
    grade: store.get('grade') || '3',
    voice: store.get('voice') || 'Kore',
    simplifyIn: store.get('simplifyIn') === 'en' ? 'en' : 'page',
  });

  const state = {
    ready: false,
    languages: LANGUAGES_FALLBACK,
    page: { source: 'sample', language: SAMPLE.language, lines: SAMPLE.lines.map((l) => l.text) },
    open: -1,
    slow: store.get('slow') !== '0',
    simple: {}, // line index -> { show: 'page'|'en', page: {status,text}, en: {status,text} }
  };

  const lang = (code) => state.languages.find((l) => l.code === code) || OTHER;

  /* ---------- Elements ---------- */
  const $ = (s) => document.querySelector(s);
  const el = {
    list: $('#lines'), status: $('#status'), camera: $('#camera'), gallery: $('#gallery'),
    scanGroup: $('.scan-group'), thumb: $('#thumb'), title: $('#source-title'), meta: $('#source-meta'),
    slow: $('#slow'), gear: $('#gear'), settings: $('#settings'), grade: $('#set-grade'),
    simplifyIn: $('#set-simplify'), voice: $('#set-voice'), save: $('#save'), serverState: $('#server-state'),
  };

  const ICON = {
    speaker: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10v4h4l5 4V6L8 10H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19 6a8.5 8.5 0 0 1 0 12"/></svg>',
    bulb: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1.2"/><rect x="14" y="5" width="4" height="14" rx="1.2"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
    wait: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9"/></svg>',
  };

  // What each play button shows, by playback state.
  const PLAY_LOOK = {
    idle: ['speaker', 'Listen'],
    loading: ['wait', 'Wait…'],
    playing: ['pause', 'Pause'],
    paused: ['play', 'Play'],
  };

  function say(msg, isError) {
    el.status.textContent = msg || '';
    el.status.classList.toggle('is-error', Boolean(isError));
  }

  function wordsInto(node, text) {
    node.textContent = '';
    String(text).split(/(\s+)/).forEach((part) => {
      if (!part) return;
      if (/^\s+$/.test(part)) { node.appendChild(document.createTextNode(part)); return; }
      const w = document.createElement('span');
      w.className = 'w';
      w.textContent = part;
      node.appendChild(w);
    });
  }

  function setLang(node, code) {
    const l = lang(code);
    if (l.tag) node.lang = l.tag;
    node.dir = 'auto';
  }

  /* ---------- Server calls ---------- */
  async function api(path, body, { signal, as = 'json' } = {}) {
    let res;
    try {
      res = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      throw new Error('Could not reach the server. Check the internet connection and try again.');
    }
    if (!res.ok) {
      let data = {};
      try { data = await res.json(); } catch { /* not JSON */ }
      const err = new Error(data.error || `The server answered with error ${res.status}.`);
      err.code = data.code;
      throw err;
    }
    return as === 'blob' ? res.blob() : res.json();
  }

  async function checkServer() {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      state.ready = Boolean(data.ready);
      if (Array.isArray(data.languages) && data.languages.length) state.languages = data.languages;
    } catch {
      state.ready = false;
    }
    el.serverState.textContent = state.ready
      ? 'Connected to Gemini. Scanning, simplifying and the Gemini voice are on.'
      : 'Gemini is not set up on the server, so only the sample page works and the phone\'s own voice reads aloud.';
    el.serverState.classList.toggle('ok', state.ready);
    if (state.page.source === 'sample') {
      say(state.ready
        ? 'This is a sample page. Tap a line to hear it, or scan your own page.'
        : 'This is a sample page. Tap a line to hear it. Scanning needs the server to be connected to Gemini.');
    }
  }

  /* ---------- Rendering ---------- */
  function updateSource() {
    const n = state.page.lines.length;
    el.title.textContent = state.page.source === 'sample' ? 'Sample page' : 'Your page';
    el.meta.textContent = `${lang(state.page.language).name} · ${n} line${n === 1 ? '' : 's'}`;
  }

  function actButton(kind, label, icon, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'act ' + kind;
    b.innerHTML = icon;
    b.append(label);
    b.addEventListener('click', onClick);
    return b;
  }

  function render() {
    el.list.textContent = '';
    state.page.lines.forEach((text, i) => {
      const open = i === state.open;
      const li = document.createElement('li');
      li.className = 'line' + (open ? ' is-open' : '');
      li.id = 'line-' + i;

      const main = document.createElement('button');
      main.type = 'button';
      main.className = 'line-main';
      main.id = 'main-' + i;
      main.setAttribute('aria-expanded', open ? 'true' : 'false');
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = 'Line ' + (i + 1);
      const txt = document.createElement('span');
      txt.className = 'text';
      setLang(txt, state.page.language);
      wordsInto(txt, text);
      main.append(tag, txt);
      main.addEventListener('click', () => selectLine(i));
      li.appendChild(main);

      if (open) {
        const acts = document.createElement('div');
        acts.className = 'actions';
        const listen = actButton('listen', 'Listen', ICON.speaker, () => playOrPause('line-' + i, () => readLine(i)));
        listen.dataset.src = 'line-' + i;
        acts.append(
          listen,
          actButton('simplify', 'Simplify', ICON.bulb, () => simplify(i, defaultTarget())),
        );
        const next = actButton('next', 'Next line', ICON.next, () => selectLine(i + 1));
        next.disabled = i >= state.page.lines.length - 1;
        acts.appendChild(next);
        li.appendChild(acts);

        const box = document.createElement('div');
        box.className = 'simple';
        box.id = 'simple-' + i;
        box.setAttribute('aria-live', 'polite');
        li.appendChild(box);
        fillSimple(i);
      }
      el.list.appendChild(li);
    });
    syncPlayButtons();
  }

  function defaultTarget() {
    return state.page.language === 'en' ? 'page' : prefs().simplifyIn;
  }

  function fillSimple(i) {
    const box = document.getElementById('simple-' + i);
    if (!box) return;
    const s = state.simple[i];
    box.textContent = '';
    box.hidden = !s;
    if (!s) return;
    const entry = s[s.show] || {};

    const head = document.createElement('div');
    head.className = 'simple-head';
    const title = document.createElement('span');
    title.className = 'simple-title';
    title.textContent = 'In simple words';
    head.appendChild(title);
    if (state.page.language !== 'en') {
      const seg = document.createElement('div');
      seg.className = 'seg';
      seg.setAttribute('role', 'group');
      seg.setAttribute('aria-label', 'Simplify in');
      [['page', lang(state.page.language).name], ['en', 'English']].forEach(([target, label]) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.setAttribute('aria-pressed', s.show === target ? 'true' : 'false');
        b.addEventListener('click', () => simplify(i, target));
        seg.appendChild(b);
      });
      head.appendChild(seg);
    }
    box.appendChild(head);

    if (entry.status === 'loading') {
      const t = document.createElement('div');
      t.className = 'thinking';
      t.innerHTML = '<span class="dot"></span>';
      t.append('Making it simpler…');
      box.appendChild(t);
      return;
    }
    if (entry.status === 'error') {
      const p = document.createElement('p');
      p.className = 'err';
      p.textContent = entry.text;
      box.appendChild(p);
      return;
    }
    const p = document.createElement('p');
    p.className = 'simple-text';
    setLang(p, simpleLang(s.show));
    wordsInto(p, entry.text);
    const listen = document.createElement('button');
    listen.type = 'button';
    listen.className = 'mini';
    listen.innerHTML = ICON.speaker;
    listen.append('Listen');
    listen.dataset.src = 'simple-' + i;
    listen.addEventListener('click', () => playOrPause('simple-' + i, () => speakSimple(i)));
    box.append(p, listen);
    syncPlayButtons();
  }

  const simpleLang = (target) => (target === 'en' ? 'en' : state.page.language);

  function showLoading(on) {
    el.scanGroup.setAttribute('aria-busy', on ? 'true' : 'false');
    if (on) el.list.innerHTML = '<li class="skel"></li><li class="skel"></li><li class="skel"></li><li class="skel"></li>';
  }

  /* ---------- Line actions ---------- */
  function selectLine(i) {
    if (i < 0 || i >= state.page.lines.length) return;
    stopAudio();
    state.open = i;
    render();
    const main = document.getElementById('main-' + i);
    if (main) {
      main.focus({ preventScroll: true });
      const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
      document.getElementById('line-' + i).scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
    }
    readLine(i);
  }

  function readLine(i) {
    const spans = [...document.querySelectorAll(`#main-${i} .w`)];
    speak(state.page.lines[i], state.page.language, spans, document.getElementById('line-' + i), 'line-' + i);
  }

  function speakSimple(i) {
    const s = state.simple[i];
    const entry = s && s[s.show];
    if (!entry || entry.status !== 'done') return;
    const spans = [...document.querySelectorAll(`#simple-${i} .w`)];
    speak(entry.text, simpleLang(s.show), spans, null, 'simple-' + i);
  }

  async function simplify(i, target) {
    const s = (state.simple[i] = state.simple[i] || {});
    s.show = target;
    const done = s[target] && s[target].status === 'done';
    if (done) { fillSimple(i); speakSimple(i); return; }

    if (state.page.source === 'sample' && SAMPLE.lines[i]) {
      s[target] = { status: 'done', text: SAMPLE.lines[i][target] };
      fillSimple(i); speakSimple(i);
      return;
    }
    if (!state.ready) {
      s[target] = { status: 'error', text: 'Simplifying needs the server to be connected to Gemini.' };
      fillSimple(i);
      return;
    }

    const line = state.page.lines[i];
    s[target] = { status: 'loading' };
    fillSimple(i);
    try {
      const data = await api('/api/simplify', {
        line, grade: Number(prefs().grade), language: state.page.language, target,
      });
      if (state.page.lines[i] !== line) return; // a new page was scanned meanwhile
      s[target] = { status: 'done', text: data.text };
      fillSimple(i);
      if (state.open === i && s.show === target) speakSimple(i);
    } catch (err) {
      if (state.page.lines[i] !== line) return;
      s[target] = { status: 'error', text: err.message };
      fillSimple(i);
    }
  }

  /* ---------- Scanning ---------- */
  function shrink(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const max = 1600;
        const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * scale);
        c.height = Math.round(img.naturalHeight * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve({ base64: c.toDataURL('image/jpeg', 0.85).split(',')[1], preview: url });
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not open that photo. Try taking it again.')); };
      img.src = url;
    });
  }

  async function onPhoto(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    stopAudio();
    let img;
    try {
      img = await shrink(file);
    } catch (err) {
      say(err.message, true);
      return;
    }
    if (el.thumb.src.startsWith('blob:')) URL.revokeObjectURL(el.thumb.src);
    el.thumb.src = img.preview;
    el.thumb.hidden = false;
    if (!state.ready) {
      say('Scanning needs the server to be connected to Gemini. The sample page still works.', true);
      return;
    }
    showLoading(true);
    say('Reading the page…');
    try {
      const data = await api('/api/read', { image: img.base64, mimeType: 'image/jpeg' });
      if (!data.lines || !data.lines.length) {
        throw new Error('No text found in this photo. Hold the phone straight over the page, in good light, and try again.');
      }
      state.page = { source: 'scan', language: data.language || 'other', lines: data.lines };
      state.open = -1;
      state.simple = {};
      updateSource();
      render();
      const n = data.lines.length;
      say(`Found ${n} line${n === 1 ? '' : 's'} in ${lang(state.page.language).name}. Tap a line to hear it.`);
    } catch (err) {
      render();
      say(err.message, true);
    } finally {
      showLoading(false);
      if (!el.list.children.length || el.list.querySelector('.skel')) render();
    }
  }
  el.camera.addEventListener('change', onPhoto);
  el.gallery.addEventListener('change', onPhoto);

  /* ---------- Speech ---------- */
  const audio = new Audio();
  audio.preload = 'auto';
  let raf = 0;
  let token = 0;
  let current = null;
  let pending = null;
  const audioCache = new Map();

  function stopAudio() {
    token++;
    if (pending) { pending.abort(); pending = null; }
    try { audio.pause(); } catch { /* nothing playing */ }
    cancelAnimationFrame(raf);
    if ('speechSynthesis' in window) { try { speechSynthesis.cancel(); } catch { /* ignore */ } }
    if (current) {
      clearMarks(current.spans);
      if (current.row) current.row.classList.remove('is-loading');
    }
    current = null;
    syncPlayButtons();
  }

  /* current.status: 'loading' | 'playing' | 'paused'. No current means nothing is playing. */
  function setPlayState(status) {
    if (!current) return;
    current.status = status;
    syncPlayButtons();
  }

  function syncPlayButtons() {
    document.querySelectorAll('[data-src]').forEach((b) => {
      const status = current && current.key === b.dataset.src ? current.status : 'idle';
      if (b.dataset.look === status) return;
      const [icon, label] = PLAY_LOOK[status] || PLAY_LOOK.idle;
      b.dataset.look = status;
      b.innerHTML = ICON[icon];
      b.append(label);
      b.setAttribute('aria-busy', status === 'loading' ? 'true' : 'false');
    });
  }

  /** The Listen button: start reading, or pause / carry on if this text is already reading. */
  function playOrPause(key, start) {
    if (!current || current.key !== key) { start(); return; }
    if (current.status === 'loading') return; // voice is on its way; a second tap does nothing
    if (current.status === 'playing') {
      if (current.browser) { try { speechSynthesis.pause(); } catch { /* ignore */ } } else audio.pause();
      setPlayState('paused');
      return;
    }
    if (current.browser) {
      try { speechSynthesis.resume(); } catch { /* ignore */ }
      setPlayState('playing');
    } else {
      audio.play().catch(() => say('Tap Play again to carry on.'));
    }
  }

  function finished(spans) {
    clearMarks(spans);
    current = null;
    syncPlayButtons();
  }

  async function speak(text, code, spans, row, key) {
    stopAudio();
    const mine = token;
    current = { spans, row, key, status: 'loading' };
    syncPlayButtons();
    // Unlock audio playback on phones while we are still inside the tap.
    try { audio.muted = true; audio.play().catch(() => {}); audio.pause(); audio.muted = false; } catch { /* ignore */ }

    if (!state.ready) { browserSpeak(text, code, spans); return; }

    const cacheKey = `${prefs().voice}|${code}|${text}`;
    let blob = audioCache.get(cacheKey);
    if (!blob) {
      if (row) row.classList.add('is-loading');
      pending = new AbortController();
      try {
        blob = await api('/api/speak', { text, voice: prefs().voice, language: code }, { signal: pending.signal, as: 'blob' });
        audioCache.set(cacheKey, blob);
        if (audioCache.size > 40) audioCache.delete(audioCache.keys().next().value);
      } catch (err) {
        if (err.name === 'AbortError' || mine !== token) return;
        if (row) row.classList.remove('is-loading');
        say(`The Gemini voice did not work (${err.message}) Using the phone's voice instead.`, true);
        browserSpeak(text, code, spans);
        return;
      } finally {
        pending = null;
      }
    }
    if (mine !== token) return;
    if (row) row.classList.remove('is-loading');
    playBlob(blob, spans, mine);
  }

  function playBlob(blob, spans, mine) {
    const url = URL.createObjectURL(blob);
    const weights = weightsOf(spans);
    const rate = state.slow ? 0.85 : 1;
    audio.src = url;
    audio.defaultPlaybackRate = rate;
    audio.playbackRate = rate;
    audio.preservesPitch = true;
    const tick = () => {
      if (mine !== token || audio.paused || audio.ended) return;
      if (audio.duration && isFinite(audio.duration)) mark(spans, wordAt(weights, audio.currentTime / audio.duration));
      raf = requestAnimationFrame(tick);
    };
    audio.onplaying = () => {
      if (mine !== token) return;
      setPlayState('playing');
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    };
    // Paused by the button, or by the phone (a call, another app). Keep the word highlighted.
    audio.onpause = () => {
      if (mine !== token || audio.ended) return;
      setPlayState('paused');
    };
    audio.onended = () => {
      URL.revokeObjectURL(url);
      if (mine === token) finished(spans);
    };
    audio.play().catch(() => {
      if (mine !== token) return;
      setPlayState('paused');
      say('Tap Play to hear this line.');
    });
  }

  function voiceFor(tag) {
    if (!('speechSynthesis' in window) || !tag) return null;
    const prefix = tag.slice(0, 2).toLowerCase();
    return speechSynthesis.getVoices().find((v) => v.lang && v.lang.toLowerCase().startsWith(prefix)) || null;
  }
  if ('speechSynthesis' in window) speechSynthesis.getVoices();

  function browserSpeak(text, code, spans) {
    if (!('speechSynthesis' in window)) {
      say('This phone cannot read aloud on its own. Connect the server to Gemini to hear the Gemini voice.', true);
      finished(spans);
      return;
    }
    const mine = token;
    if (current) current.browser = true;
    const l = lang(code);
    const voice = voiceFor(l.tag);
    if (!voice) say(`This phone has no ${l.name} voice. Connect the server to Gemini to hear the Gemini voice.`, true);
    const u = new SpeechSynthesisUtterance(text);
    if (l.tag) u.lang = l.tag;
    if (voice) u.voice = voice;
    u.rate = state.slow ? 0.75 : 1;
    const starts = [];
    let pos = 0;
    spans.forEach((s) => {
      const idx = text.indexOf(s.textContent, pos);
      const at = idx < 0 ? pos : idx;
      starts.push(at);
      pos = at + s.textContent.length;
    });
    u.onboundary = (e) => {
      if (typeof e.charIndex !== 'number') return;
      let k = 0;
      starts.forEach((st, j) => { if (st <= e.charIndex) k = j; });
      mark(spans, k);
    };
    u.onstart = () => { if (mine === token) setPlayState('playing'); };
    u.onend = () => { if (mine === token) finished(spans); else clearMarks(spans); };
    u.onerror = u.onend;
    speechSynthesis.speak(u);
  }

  function weightsOf(spans) {
    let total = 0;
    const cum = spans.map((s) => (total += s.textContent.length + 1));
    return cum.map((v) => v / (total || 1));
  }
  function wordAt(cum, f) {
    const i = cum.findIndex((c) => f <= c);
    return i < 0 ? cum.length - 1 : i;
  }
  function mark(spans, k) { spans.forEach((s, j) => s.classList.toggle('on', j === k)); }
  function clearMarks(spans) { (spans || []).forEach((s) => s.classList.remove('on')); }

  /* ---------- Slow toggle ---------- */
  function syncSlow() { el.slow.setAttribute('aria-pressed', state.slow ? 'true' : 'false'); }
  el.slow.addEventListener('click', () => {
    state.slow = !state.slow;
    store.set('slow', state.slow ? '1' : '0');
    syncSlow();
    if (!audio.paused) audio.playbackRate = state.slow ? 0.85 : 1;
  });

  /* ---------- Settings ---------- */
  function loadSettings() {
    const p = prefs();
    el.grade.value = p.grade;
    el.simplifyIn.value = p.simplifyIn;
    el.voice.value = p.voice;
  }
  function openSettings(on) {
    el.settings.hidden = !on;
    el.gear.setAttribute('aria-expanded', on ? 'true' : 'false');
    if (on) { loadSettings(); el.grade.focus(); }
  }
  el.gear.addEventListener('click', () => openSettings(el.settings.hidden));
  el.save.addEventListener('click', () => {
    store.set('grade', el.grade.value);
    store.set('simplifyIn', el.simplifyIn.value);
    store.set('voice', el.voice.value);
    audioCache.clear();
    openSettings(false);
    say('Settings saved.');
  });

  /* ---------- Start ---------- */
  syncSlow();
  updateSource();
  render();
  checkServer();
})();
