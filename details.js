/* Kaartkluis — kaartdetails (varianten, zeldzaamheid, Pokédex-nummer, Cardmarket-prijs) bewaard op het toestel */
(function () {
  'use strict';
  const KK = window.KK;
  const MAX_AGE = 5 * 24 * 3600 * 1000; // prijzen hooguit 5 dagen oud
  const mem = new Map();
  let dbp = null;

  function idb() {
    if (dbp) return dbp;
    dbp = new Promise((res) => {
      try {
        const r = indexedDB.open('kaartkluis', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('cards');
        r.onsuccess = () => res(r.result);
        r.onerror = () => res(null);
      } catch (e) { res(null); }
    });
    return dbp;
  }
  async function idbAll() {
    const db = await idb(); if (!db) return;
    await new Promise((res) => {
      const tx = db.transaction('cards', 'readonly'); const st = tx.objectStore('cards');
      const req = st.openCursor();
      req.onsuccess = () => { const c = req.result; if (c) { mem.set(c.key, c.value); c.continue(); } else res(); };
      req.onerror = () => res();
    });
  }
  async function idbPut(key, val) {
    const db = await idb(); if (!db) return;
    try { db.transaction('cards', 'readwrite').objectStore('cards').put(val, key); } catch (e) {}
  }

  KK.detailsReady = idbAll();

  function compact(card, enPricing) {
    const cm = (card.pricing && card.pricing.cardmarket) || (enPricing && enPricing.cardmarket) || null;
    const num = (x) => (typeof x === 'number' && x > 0 ? x : null);
    return {
      n: card.name, l: card.localId, i: card.image || '',
      s: card.set ? card.set.id : KK.setIdOf(card.id), sn: card.set ? card.set.name : '',
      so: card.set && card.set.cardCount ? card.set.cardCount.official : null,
      r: card.rarity || '', c: card.category || '', d: card.dexId || [],
      v: card.variants || {},
      p: cm ? { t: num(cm.trend), th: num(cm['trend-holo']), a: num(cm.avg30), ah: num(cm['avg30-holo']), lo: num(cm.low), loh: num(cm['low-holo']) } : null,
      ts: Date.now(),
    };
  }

  KK.details = {
    get: (lang, id) => mem.get(lang + '|' + id) || null,
    all: () => mem,
    async load(lang, id, force) {
      const key = lang + '|' + id;
      const have = mem.get(key);
      if (have && !force && Date.now() - have.ts < MAX_AGE) return have;
      try {
        const card = await KK.getCard(lang, id);
        let enPricing = null;
        if (!card.pricing && lang !== 'en') { try { enPricing = (await KK.getCard('en', id)).pricing; } catch (e) {} }
        const d = compact(card, enPricing);
        mem.set(key, d); idbPut(key, d);
        return d;
      } catch (e) { return have || null; }
    },
    // laadt een lijst kaarten met maximaal 6 tegelijk; onProgress(klaar, totaal)
    async ensure(lang, ids, onProgress, signal) {
      const todo = ids.filter((id) => { const d = mem.get(lang + '|' + id); return !d || Date.now() - d.ts > MAX_AGE; });
      let done = ids.length - todo.length; const total = ids.length;
      if (onProgress) onProgress(done, total);
      let i = 0;
      const worker = async () => {
        while (i < todo.length) {
          if (signal && signal.aborted) return;
          const id = todo[i++];
          await KK.details.load(lang, id);
          done++; if (onProgress) onProgress(done, total);
        }
      };
      await Promise.all(Array.from({ length: Math.min(6, todo.length) }, worker));
    },
  };

  // ---------- Varianten ----------
  // '' = de standaardversie (normaal, of holo als de kaart alleen als holo bestaat)
  KK.VARIANT_NAMES = { '': 'Normaal', r: 'Reverse holo', h: 'Holo', f: '1e editie', p: 'Promo-stempel' };
  KK.VARIANT_SHORT = { '': 'N', r: 'R', h: 'H', f: '1e', p: 'P' };
  (KK.STAMPS || []).forEach(([code, name]) => { KK.VARIANT_NAMES[code] = name; KK.VARIANT_SHORT[code] = 'S'; });
  KK.variantsOf = (d) => {
    if (!d || !d.v) return [''];
    const v = d.v; const out = [''];
    if (v.reverse) out.push('r');
    if (v.normal && v.holo) out.push('h');
    if (v.firstEdition) out.push('f');
    if (v.wPromo) out.push('p');
    return out;
  };
  KK.baseName = (d) => (!d || !d.v ? 'Standaard' : d.v.normal ? 'Normaal' : d.v.holo ? 'Holo' : 'Standaard');
  KK.variantName = (d, code) => (code === '' ? KK.baseName(d) : KK.VARIANT_NAMES[code]);

  // ---------- Prijzen (Cardmarket, euro) ----------
  KK.priceOf = (d, code) => {
    if (!d || !d.p || String(code).startsWith('s-')) return null; // gestempeld: geen betrouwbare prijs
    const p = d.p;
    const holoish = code === 'r' || code === 'h' || (code === '' && d.v && !d.v.normal && d.v.holo);
    return holoish ? (p.th || p.ah || p.t || p.a) : (p.t || p.a || p.th);
  };
  KK.euro = (x) => (x == null ? '–' : '€ ' + x.toLocaleString('nl-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
})();
