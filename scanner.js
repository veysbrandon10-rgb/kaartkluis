/* Kaartkluis — scanner: camera, tekstherkenning (Tesseract.js, draait op je toestel) en kaart opzoeken */
(function () {
  'use strict';
  const KK = window.KK;
  const esc = KK.esc;
  const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

  // ---------- Tekstherkenning laden (één keer) ----------
  let workerPromise = null;
  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('script')); document.head.appendChild(s);
    });
  }
  function getWorker(onStatus) {
    if (!workerPromise) {
      workerPromise = (async () => {
        if (!window.Tesseract) await loadScript(TESSERACT_URL);
        const w = await window.Tesseract.createWorker('eng', 1, {
          logger: (m) => { if (m.status && onStatus && m.status.includes('load')) onStatus('Herkenning laden… ' + Math.round((m.progress || 0) * 100) + '%'); },
        });
        return w;
      })();
      workerPromise.catch(() => { workerPromise = null; });
    }
    return workerPromise;
  }

  async function ocr(canvas, mode) {
    const w = await getWorker();
    if (mode === 'number') {
      await w.setParameters({ tessedit_char_whitelist: '0123456789/ABCDEFGHIJKLMNOPQRSTUVWXYZ-', tessedit_pageseg_mode: '6' });
    } else {
      await w.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: mode === 'name' ? '7' : '11' });
    }
    const { data } = await w.recognize(canvas);
    return data.text || '';
  }

  // ---------- Beeld bijsnijden en verbeteren ----------
  // Snijdt een stuk uit, maakt het grijs en daarna scherp zwart-wit (Otsu-drempel). targetH = hoogte in pixels.
  function cropTo(src, sx, sy, sw, sh, targetH, invert, binarize) {
    const c = document.createElement('canvas');
    const scale = targetH / sh;
    c.width = Math.max(1, Math.round(sw * scale)); c.height = Math.max(1, Math.round(sh * scale));
    const g = c.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
    const img = g.getImageData(0, 0, c.width, c.height); const d = img.data;
    const gray = new Uint8ClampedArray(d.length / 4);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) { gray[j] = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0; }
    // plaatselijke drempel: elk pixel wordt vergeleken met het gemiddelde van zijn omgeving,
    // zodat schaduw, glans of een donkere tafel de tekst niet wegdrukken
    const W = c.width, H = c.height; let integ = null, rad = 0;
    if (binarize !== false) {
      rad = Math.max(8, Math.round(H / 6));
      integ = new Float64Array((W + 1) * (H + 1));
      for (let y = 0; y < H; y++) { let row = 0; for (let x = 0; x < W; x++) { row += gray[y * W + x]; integ[(y + 1) * (W + 1) + x + 1] = integ[y * (W + 1) + x + 1] + row; } }
    }
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      let v;
      if (binarize === false) v = Math.max(0, Math.min(255, (gray[j] - 128) * 1.6 + 128));
      else {
        const x = j % W, y = (j / W) | 0;
        const x0 = Math.max(0, x - rad), x1 = Math.min(W, x + rad + 1), y0 = Math.max(0, y - rad), y1 = Math.min(H, y + rad + 1);
        const sum = integ[y1 * (W + 1) + x1] - integ[y0 * (W + 1) + x1] - integ[y1 * (W + 1) + x0] + integ[y0 * (W + 1) + x0];
        const mean = sum / ((x1 - x0) * (y1 - y0));
        v = gray[j] < mean - 12 ? 0 : 255;
      }
      if (invert) v = 255 - v;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  // ---------- Tekst omzetten naar kaartnummer ----------
  const PROMO_IDS = { SVP: 'svp', MEP: 'mep', SWSH: 'swshp', SWSHP: 'swshp', SMP: 'smp', SM: 'smp', XYP: 'xyp', XY: 'xyp', BWP: 'bwp', BW: 'bwp' };
  const fixDigits = (s) => s.replace(/[OoQD]/g, '0').replace(/[ILl|]/g, '1').replace(/S/g, '5').replace(/B/g, '8');

  KK.parseScan = function (raw) {
    const text = String(raw || '').toUpperCase().replace(/[‐–—]/g, '-');
    const out = { num: null, denom: null, promo: null };
    // Japanse promo: 025/SV-P
    let m = text.match(/([0-9OIL]{1,3})\s*\/\s*(SV|S|SM|M)-?P\b/);
    if (m) { out.promo = { id: m[2] === 'SV' ? 'svp' : m[2] === 'M' ? 'mep' : m[2] === 'S' ? 'swshp' : 'smp', num: parseInt(fixDigits(m[1]), 10) }; return out; }
    // Internationale promo: SVP EN 085, SWSH123, MEP 012
    m = text.match(/\b(SVP|MEP|SWSHP?|SMP?|XYP?|BWP?)\s*(?:EN|NL|FR|DE|IT|ES|PT|JP)?\s*[-:]?\s*([0-9OIL]{1,3})\b/);
    if (m) { out.promo = { id: PROMO_IDS[m[1]], num: parseInt(fixDigits(m[2]), 10) }; }
    // Gewoon nummer: 045/198 (OCR leest / soms als | of \)
    m = text.match(/([0-9OIL]{1,3})\s*[\/\\|]\s*([0-9OIL]{2,3})(?![0-9])/);
    if (m) { out.num = parseInt(fixDigits(m[1]), 10); out.denom = parseInt(fixDigits(m[2]), 10); }
    // Alleen een nummer getypt (bv. "85" met promo-keuze) laten we aan de handmatige invoer over.
    return out;
  };

  const localNum = (localId) => { const n = parseInt(String(localId).replace(/\D/g, ''), 10); return isNaN(n) ? -1 : n; };
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

  function lev(a, b) {
    if (!a.length) return b.length; if (!b.length) return a.length;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[b.length];
  }
  function nameScore(cardName, ocrText) {
    const n = norm(cardName); const t = norm(ocrText);
    if (!n || !t) return 0;
    if (t.includes(n)) return 1;
    // vergelijk met elk stuk tekst van dezelfde lengte
    let best = 0;
    for (let i = 0; i <= Math.max(0, t.length - n.length); i++) {
      const piece = t.substr(i, n.length);
      best = Math.max(best, 1 - lev(n, piece) / n.length);
    }
    return Math.max(0, best);
  }

  // ---------- Kandidaten zoeken in de kaartdatabank ----------
  // Zoekt kaarten met dit nummer. Geeft { cands, info } terug; info beschrijft waar gezocht is (voor de melding).
  KK.findCandidates = async function (lang, parsed, nameText) {
    const sets = await KK.getSets(lang);
    const order = {}; const byId = {}; sets.forEach((s, i) => { order[s.id] = i; byId[s.id] = s; });
    const official = (s) => (s.cardCount && (s.cardCount.official || s.cardCount.total)) || 0;
    const num = parsed.promo ? parsed.promo.num : parsed.num;
    const info = { lang, searched: [], how: '' };
    if (num == null) return Object.assign([], { info });
    let targets = [];
    if (parsed.promo) {
      const wanted = parsed.promo.id;
      targets = sets.filter((s) => s.id.toLowerCase() === wanted);
      if (!targets.length) targets = sets.filter((s) => /promo/i.test(s.name) && s.id.toLowerCase().startsWith(wanted.replace(/p$/, '')));
      info.how = 'promo';
    }
    if (!targets.length && parsed.denom) {
      targets = sets.filter((s) => official(s) === parsed.denom);
      if (!targets.length) targets = sets.filter((s) => s.cardCount && s.cardCount.total === parsed.denom);
      info.how = 'aantal';
    }
    const score = (c, set) => { const ns = nameText ? nameScore(c.name, nameText) : 0; return { card: c, set, score: ns * 10 + (order[set.id] || 0) / sets.length, nameMatch: ns }; };
    let cands = [];
    if (targets.length) {
      targets = targets.slice(-8);
      info.searched = targets.map((t) => t.name);
      const full = await Promise.all(targets.map((t) => KK.getSet(lang, t.id).catch(() => null)));
      full.forEach((set) => { if (set && set.cards) set.cards.forEach((c) => { if (localNum(c.localId) === num) cands.push(score(c, set)); }); });
    }
    // Reserve: zoek alle kaarten met dit nummer en kies sets waarvan het aantal (bijna) klopt
    if (!cands.length) {
      info.how = 'nummer';
      const tries = [String(num).padStart(3, '0'), String(num)];
      let list = [];
      for (const t of tries) {
        try { const r = await KK.api(lang, 'cards?localId=eq:' + encodeURIComponent(t)); if (Array.isArray(r) && r.length) { list = r; break; } } catch (e) {}
      }
      list = list.filter((c) => localNum(c.localId) === num && byId[KK.setIdOf(c.id)]);
      let pick = list;
      if (parsed.denom) {
        const close = list.filter((c) => Math.abs(official(byId[KK.setIdOf(c.id)]) - parsed.denom) <= 3);
        if (close.length) pick = close;
      }
      if (parsed.promo) { const pr = list.filter((c) => /promo/i.test(byId[KK.setIdOf(c.id)].name)); if (pr.length) pick = pr; }
      pick.sort((a, b) => (order[KK.setIdOf(b.id)] || 0) - (order[KK.setIdOf(a.id)] || 0));
      pick = pick.slice(0, 6);
      info.searched = [...new Set(pick.map((c) => byId[KK.setIdOf(c.id)].name))];
      cands = pick.map((c) => score(c, byId[KK.setIdOf(c.id)]));
    }
    cands.sort((a, b) => b.score - a.score);
    return Object.assign(cands.slice(0, 6), { info });
  };

  // ---------- Weergave ----------
  KK.views.scan = (el) => {
    const s = KK.settings;
    if (!s.favLangs) s.favLangs = ['en', 'nl', 'ja', 'zh-tw'];
    el.innerHTML = `
      <div><div class="eyebrow">Kaart herkennen</div><h1>Scannen</h1></div>
      <div class="chips" id="lang-chips" role="group" aria-label="Taal van de kaart"></div>
      <div class="scanner">
        <div class="cam" id="cam">
          <video id="video" playsinline muted></video>
          <div class="frame" aria-hidden="true"><span class="zone zone-l"></span><span class="zone zone-r"></span></div>
          <div class="cam-msg" id="cam-msg">Camera starten…</div>
        </div>
        <div class="scan-actions">
          <button class="btn primary big" id="shoot">Scan kaart</button>
          <button class="btn" id="torch" hidden>Lamp</button>
        </div>
        <div class="chips" style="justify-content:center">
          <button class="chip" id="auto" aria-pressed="true">Doorlopend scannen</button>
          <button class="chip" id="autoadd" aria-pressed="false">Meteen toevoegen</button>
        </div>
        <div class="vpick"><label class="small muted" for="vsel">Versie bij toevoegen</label>
          <select id="vsel" class="input mini"><option value="">Standaard</option><option value="r">Reverse holo</option><option value="h">Holo</option>
            <optgroup label="Gestempeld">${KK.STAMPS.map((x) => `<option value="${x[0]}">${esc(x[1])}</option>`).join('')}</optgroup></select></div>
        <div class="scan-status" id="status">Leg de kaart plat op tafel en houd je gsm er recht boven, zodat de kaart het kader vult. Het nummer moet in een van de twee vakjes onderaan staan.</div>
        <div class="results" id="results"></div>
        <section class="panel">
          <h2>Typ het nummer</h2>
          <p class="muted small" style="margin:0">Lukt scannen niet? Typ wat onderaan de kaart staat, bv. <b>045/198</b>, <b>SVP 085</b> of <b>025/SV-P</b>.</p>
          <form class="manual" id="manual"><label class="sr-only" for="manual-in">Kaartnummer</label>
            <input id="manual-in" class="input" placeholder="045/198" autocomplete="off" inputmode="text">
            <button class="btn" type="submit">Zoek</button></form>
          <label class="btn" for="photo">Of kies een foto</label><input id="photo" type="file" accept="image/*" hidden>
        </section>
      </div>`;

    const video = el.querySelector('#video');
    const cam = el.querySelector('#cam');
    const msg = el.querySelector('#cam-msg');
    const status = el.querySelector('#status');
    const results = el.querySelector('#results');
    const shootBtn = el.querySelector('#shoot');
    let stream = null, track = null, alive = true, busy = false, torchOn = false;
    let lastAdded = { id: null, at: 0 };
    const opts = { auto: true, autoAdd: false, v: '' };
    let lastSeen = { key: '', at: 0 };
    el.querySelector('#vsel').addEventListener('change', (e) => { opts.v = e.target.value; });
    async function addCard(lang, id, name) {
      let code = opts.v;
      if (code === 'r' || code === 'h') { const d = await KK.details.load(lang, id); if (d && !KK.variantsOf(d).includes(code)) { KK.toast(`${name} bestaat niet als ${KK.VARIANT_NAMES[code].toLowerCase()}; standaard toegevoegd`); code = ''; } }
      KK.addOne(lang, id, code); lastAdded = { id, at: Date.now() };
      KK.toast(`Toegevoegd: ${name}${code ? ' (' + KK.VARIANT_NAMES[code].toLowerCase() + ')' : ''} · ${KK.totalQty(lang, id)} in bezit`);
      if (results._cands) renderResults(results._cands, results._sure);
    }

    // taal-chips
    const chips = el.querySelector('#lang-chips');
    function renderChips() {
      const langs = [...new Set([KK.settings.lang, ...s.favLangs])].slice(0, 5);
      chips.innerHTML = langs.map((l) => `<button class="chip" data-l="${l}" aria-pressed="${l === KK.settings.lang}">${esc(KK.langName(l))}</button>`).join('');
    }
    chips.addEventListener('click', (e) => { const b = e.target.closest('[data-l]'); if (!b) return; KK.setLang(b.dataset.l); renderChips(); results.innerHTML = ''; });
    renderChips();

    // camera
    async function startCam() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { msg.textContent = 'Deze browser geeft geen toegang tot de camera. Gebruik "Typ het nummer" of kies een foto.'; shootBtn.disabled = true; return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } } });
        if (!alive) { stream.getTracks().forEach((t) => t.stop()); return; }
        video.srcObject = stream; await video.play();
        msg.hidden = true;
        track = stream.getVideoTracks()[0];
        const caps = track.getCapabilities ? track.getCapabilities() : {};
        if (caps.torch) el.querySelector('#torch').hidden = false;
        if (caps.focusMode && caps.focusMode.includes('continuous')) track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
        getWorker((t) => { if (!busy) status.textContent = t; }).then(() => { if (!busy && alive) status.textContent = 'Klaar. Leg een kaart in het kader.'; if (opts.auto) loop(); }).catch(() => {});
      } catch (e) {
        msg.textContent = e && e.name === 'NotAllowedError'
          ? 'Geen toestemming voor de camera. Sta de camera toe via het slotje naast het adres, of typ het nummer hieronder.'
          : 'De camera kon niet starten. Typ het nummer hieronder of kies een foto.';
        shootBtn.disabled = true;
      }
    }
    startCam();

    el.querySelector('#torch').addEventListener('click', () => {
      torchOn = !torchOn; track && track.applyConstraints({ advanced: [{ torch: torchOn }] }).catch(() => {});
      el.querySelector('#torch').setAttribute('aria-pressed', torchOn);
    });

    // positie van het kader omrekenen naar camerapixels
    function frameRect() {
      const vw = video.videoWidth, vh = video.videoHeight;
      const cw = cam.clientWidth, ch = cam.clientHeight;
      const scale = Math.max(cw / vw, ch / vh);
      const offX = (vw * scale - cw) / 2, offY = (vh * scale - ch) / 2;
      const fw = cw * 0.72, fh = fw * 88 / 63;
      const fx = (cw - fw) / 2, fy = (ch - fh) / 2;
      return { x: (fx + offX) / scale, y: (fy + offY) / scale, w: fw / scale, h: fh / scale, vw, vh };
    }

    // Leest het kaartnummer. Nieuwe kaarten hebben het linksonder, oudere rechtsonder.
    // We lezen dus twee kleine stukjes in plaats van de hele onderrand: dat is veel sneller.
    async function recognizeFromSource(src, r) {
      const clampX = (x) => Math.max(0, Math.min(r.vw - 1, x)); const clampY = (y) => Math.max(0, Math.min(r.vh - 1, y));
      const zone = (x0, x1) => { const sx = clampX(r.x + r.w * x0), sy = clampY(r.y + r.h * 0.8); return [sx, sy, clampX(r.x + r.w * x1) - sx, clampY(r.y + r.h * 1.05) - sy]; };
      const zones = [zone(-0.03, 0.55), zone(0.45, 1.03)];
      const order = lastZone === 1 ? [1, 0] : [0, 1];
      const tries = order.map((i) => ({ i, bin: true, h: 230 })).concat(order.map((i) => ({ i, bin: false, h: 320 })));
      let parsed = { num: null, denom: null, promo: null }, raw = '';
      for (const t of tries) {
        const [sx, sy, sw, sh] = zones[t.i]; if (sw < 10 || sh < 10) continue;
        const crop = cropTo(src, sx, sy, sw, sh, Math.min(t.h, sh * 2.5), false, t.bin);
        raw = await ocr(crop, 'number');
        if (window.KK_DEBUG) window.KK_DEBUG.push({ zone: t.i, bin: t.bin, raw, img: crop.toDataURL() });
        parsed = KK.parseScan(raw);
        if (parsed.denom || parsed.promo) { lastZone = t.i; break; }
        if (!alive) break;
      }
      const getName = async () => {
        if (!KK.isLatin(KK.settings.lang)) return '';
        const ny = clampY(r.y + r.h * 0.015), nh = r.h * 0.11;
        return ocr(cropTo(src, clampX(r.x + r.w * 0.04), ny, r.w * 0.78, nh, 70, false, false), 'name');
      };
      return { parsed, getName, raw };
    }
    let lastZone = 0;

    async function scanOnce(fromAuto) {
      if (busy || !video.videoWidth) return;
      busy = true; shootBtn.disabled = true;
      if (!fromAuto) status.textContent = 'Bezig met lezen…';
      try {
        const snap = document.createElement('canvas');
        snap.width = video.videoWidth; snap.height = video.videoHeight;
        snap.getContext('2d').drawImage(video, 0, 0);
        const r = frameRect();
        const { parsed, getName } = await recognizeFromSource(snap, r);
        await handleParsed(parsed, getName, fromAuto);
      } catch (e) {
        status.textContent = navigator.onLine ? 'Er ging iets mis: ' + (e && e.message ? e.message : 'onbekend') + '. Probeer opnieuw.' : 'Offline: de herkenning en kaartdata hebben de eerste keer internet nodig.';
      } finally { busy = false; shootBtn.disabled = false; }
    }

    async function handleParsed(parsed, nameArg, fromAuto) {
      const lang = KK.settings.lang;
      if (!parsed.denom && !parsed.promo) {
        status.textContent = fromAuto ? 'Zoeken naar het nummer… houd de kaart stil in het kader.' : 'Geen kaartnummer gevonden. Kom iets dichterbij, vermijd schittering, of typ het nummer.';
        return;
      }
      const label = parsed.promo ? `promo ${parsed.promo.num}` : `${parsed.num}/${parsed.denom}`;
      const seenKey = lang + label;
      if (fromAuto && lastSeen.key === seenKey && Date.now() - lastSeen.at < 8000) { lastSeen.at = Date.now(); return; } // dezelfde kaart ligt er nog
      lastSeen = { key: seenKey, at: Date.now() };
      let nameText = typeof nameArg === 'string' ? nameArg : '';
      status.textContent = `Gelezen: ${label} — zoeken…`;
      let cands = await KK.findCandidates(lang, parsed, nameText);
      if (cands.length > 1 && typeof nameArg === 'function') {
        status.textContent = `Gelezen: ${label} — naam controleren…`;
        nameText = await nameArg().catch(() => '');
        if (nameText) cands = await KK.findCandidates(lang, parsed, nameText);
      }
      let usedLang = lang;
      if (!cands.length && lang !== 'en') {
        const en = await KK.findCandidates('en', parsed, nameText).catch(() => []);
        if (en.length) { cands = en; usedLang = 'en'; }
      }
      if (!alive) return;
      if (fromAuto && (!cands.length || (cands.info && cands.info.how === 'nummer'))) {
        lastSeen = { key: '', at: 0 }; // waarschijnlijk verkeerd gelezen: gewoon opnieuw proberen
        status.textContent = `Gelezen: ${label}… nog eens kijken. Houd de kaart stil.`;
        return;
      }
      if (usedLang !== lang) { KK.setLang('en'); renderChips(); KK.toast(`Niet gevonden in het ${KK.langName(lang)}; ik toon de Engelse kaart`); }
      if (!cands.length) {
        const nSets = (await KK.getSets(lang).catch(() => [])).length;
        status.textContent = `Gelezen: ${label}, maar geen kaart gevonden in het ${KK.langName(lang)} (${nSets} sets in de databank). Klopt de taal en het nummer?`;
        el.querySelector('#manual-in').value = parsed.promo ? `SVP ${parsed.promo.num}` : `${parsed.num}/${parsed.denom}`;
        return;
      }
      const sure = (cands.info && cands.info.how === 'nummer') ? false : cands.length === 1 || cands[0].nameMatch >= 0.75 && (cands.length < 2 || cands[1].nameMatch < 0.6);
      status.textContent = sure ? `Gevonden: ${cands[0].card.name}` : `Gelezen: ${label}. Kies de juiste kaart:`;
      if (navigator.vibrate) navigator.vibrate(40);
      renderResults(cands, sure);
      if (sure && opts.autoAdd) {
        const id = cands[0].card.id;
        if (lastAdded.id !== id || Date.now() - lastAdded.at > 6000) {
          await addCard(lang, id, cands[0].card.name);
        } else lastAdded.at = Date.now();
      }
    }

    function renderResults(cands, sure) {
      const lang = KK.settings.lang;
      results.innerHTML = cands.map((c, i) => {
        const q = KK.totalQty(lang, c.card.id);
        const official = c.set.cardCount ? c.set.cardCount.official : '';
        return `<div class="result${i === 0 && sure ? ' best' : ''}">
          ${c.card.image ? `<img src="${esc(KK.cardImg(c.card, 'low'))}" alt="" loading="lazy">` : '<span></span>'}
          <div class="meta"><b>${esc(c.card.name)}</b><span class="small muted">${esc(c.set.name)} · ${esc(c.card.localId)}${official ? '/' + official : ''}</span>
            <div class="small" style="color:${q ? 'var(--owned)' : 'var(--muted)'}">${q ? q + ' in bezit' : 'Nog niet in je collectie'}</div></div>
          <button class="btn primary" data-add="${esc(c.card.id)}" aria-label="Voeg ${esc(c.card.name)} toe">+1</button></div>`;
      }).join('');
      results._cands = cands; results._sure = sure;
    }
    results.addEventListener('click', (e) => {
      const b = e.target.closest('[data-add]');
      if (!b) { const r = e.target.closest('.result'); const i = r ? [...results.children].indexOf(r) : -1; const c = (results._cands || [])[i]; if (c) KK.showCard(KK.settings.lang, c.card, c.set); return; }
      const lang = KK.settings.lang; const id = b.dataset.add;
      const c = (results._cands || []).find((x) => x.card.id === id);
      addCard(lang, id, c ? c.card.name : id);
    });

    shootBtn.addEventListener('click', () => scanOnce(false));
    el.querySelector('#auto').addEventListener('click', (e) => {
      opts.auto = !opts.auto; e.currentTarget.setAttribute('aria-pressed', opts.auto);
      if (opts.auto) { status.textContent = 'Doorlopend scannen staat aan. Leg kaart na kaart in het kader.'; loop(); }
    });
    async function loop() {
      if (looping) return; looping = true;
      while (alive && opts.auto) {
        if (video.videoWidth && !document.hidden && document.getElementById('sheet').hidden) await scanOnce(true);
        await new Promise((r) => setTimeout(r, 200));
      }
      looping = false;
    }
    let looping = false;
    el.querySelector('#autoadd').addEventListener('click', (e) => {
      opts.autoAdd = !opts.autoAdd; e.currentTarget.setAttribute('aria-pressed', opts.autoAdd);
      KK.toast(opts.autoAdd ? 'Zekere matches worden meteen toegevoegd' : 'Je bevestigt zelf met +1');
    });

    el.querySelector('#manual').addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = el.querySelector('#manual-in').value.trim(); if (!v) return;
      let parsed = KK.parseScan(v);
      if (!parsed.denom && !parsed.promo) parsed = KK.parseScan(v.replace(/(\d)\s*[-\s.,]\s*(\d)/, '$1/$2'));
      if (!parsed.denom && !parsed.promo) { status.textContent = 'Typ het nummer zoals op de kaart, bv. 045/198 of SVP 085.'; return; }
      busy = true;
      try { await handleParsed(parsed, '', false); }
      catch (err) { status.textContent = (navigator.onLine ? 'Opzoeken lukte niet: ' + (err && err.message ? err.message : 'onbekende fout') : 'Je bent offline.') + ' Probeer opnieuw.'; }
      busy = false;
    });

    el.querySelector('#photo').addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      status.textContent = 'Foto lezen…';
      try {
        const bmp = await createImageBitmap(f);
        // aanname: de kaart vult de foto grotendeels
        const r = { x: 0, y: 0, w: bmp.width, h: bmp.height, vw: bmp.width, vh: bmp.height };
        let { parsed, getName } = await recognizeFromSource(bmp, r);
        if (!parsed.denom && !parsed.promo) {
          const whole = cropTo(bmp, 0, 0, bmp.width, bmp.height, Math.min(2000, bmp.height), false, false);
          parsed = KK.parseScan(await ocr(whole, 'free'));
        }
        await handleParsed(parsed, getName, false);
      } catch (err) { status.textContent = 'Deze foto kon niet gelezen worden.'; }
      e.target.value = '';
    });

    return () => {
      alive = false; opts.auto = false;
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  };
})();
