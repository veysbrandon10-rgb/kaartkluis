/* Kaartkluis — kern: talen, collectie (met varianten, verlanglijst, ruil), sets, binder, collectie-overzicht, instellingen */
(function () {
  'use strict';

  const KK = (window.KK = window.KK || {});

  // ---------- Talen ----------
  KK.LANGS = [
    ['en', 'Engels'], ['nl', 'Nederlands'], ['fr', 'Frans'], ['de', 'Duits'],
    ['it', 'Italiaans'], ['es', 'Spaans'], ['pt-br', 'Portugees (BR)'],
    ['ja', 'Japans'], ['zh-tw', 'Chinees (traditioneel)'], ['zh-cn', 'Chinees (vereenvoudigd)'],
    ['ko', 'Koreaans'], ['id', 'Indonesisch'], ['th', 'Thais'], ['pl', 'Pools'], ['ru', 'Russisch'],
  ];
  KK.langName = (code) => (KK.LANGS.find((l) => l[0] === code) || [code, code])[1];
  KK.isLatin = (lang) => !/^(ja|zh|ko|th|ru)/.test(lang);

  // ---------- Opslag ----------
  const store = {
    get(key, fallback) { try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; } },
  };
  KK.store = store;
  KK.settings = Object.assign({ lang: 'en', theme: 'system', binderSize: 9, binderRev: false, master: false }, store.get('kk-settings', {}));
  KK.saveSettings = () => store.set('kk-settings', KK.settings);

  // ---------- Collectie ----------
  // Sleutel: "taal|kaart-id" (standaardversie) of "taal|kaart-id#code".
  // Codes: r reverse, h holo, f 1e editie, p promo-stempel; want = verlanglijst, trade = mag weg.
  // Waarde { q, t }: aantal (of 1/0 voor markeringen) en tijdstip; 0 blijft bewaard zodat wissen synchroniseert.
  const VAR_CODES = ['', 'r', 'h', 'f', 'p'];
  KK.VAR_CODES = VAR_CODES;
  const col = store.get('kk-collection', { items: {} });
  if (!col.items) col.items = {};
  KK.collection = col;

  KK.vkey = (lang, id, code) => lang + '|' + id + (code ? '#' + code : '');
  KK.key = (lang, id) => KK.vkey(lang, id, '');
  KK.parseKey = (k) => {
    const i = k.indexOf('|'); const rest = k.slice(i + 1); const h = rest.indexOf('#');
    return { lang: k.slice(0, i), id: h < 0 ? rest : rest.slice(0, h), code: h < 0 ? '' : rest.slice(h + 1) };
  };
  KK.setIdOf = (cardId) => cardId.slice(0, cardId.lastIndexOf('-'));

  KK.qty = (lang, id, code) => { const it = col.items[KK.vkey(lang, id, code || '')]; return it ? it.q : 0; };
  KK.totalQty = (lang, id) => VAR_CODES.reduce((s, c) => s + KK.qty(lang, id, c), 0);
  KK.flag = (lang, id, f) => KK.qty(lang, id, f) > 0;

  let saveTimer = null;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { if (!store.set('kk-collection', col)) KK.toast('Opslaan op dit toestel mislukt. Maak een back-up via Instellingen.'); }, 150);
  }
  KK.persistNow = () => { clearTimeout(saveTimer); store.set('kk-collection', col); };

  let indexCache = null;
  function changed(detail) { indexCache = null; document.dispatchEvent(new CustomEvent('kk-change', { detail })); }

  KK.setQty = (lang, id, q, code) => {
    q = Math.max(0, Math.min(999, q | 0));
    col.items[KK.vkey(lang, id, code || '')] = { q, t: Date.now() };
    persist(); changed({ lang, cardId: id, q, local: true });
  };
  KK.addOne = (lang, id, code) => KK.setQty(lang, id, KK.qty(lang, id, code) + 1, code);
  KK.setFlag = (lang, id, f, on) => KK.setQty(lang, id, on ? 1 : 0, f);

  KK.mergeItems = (incoming) => {
    let n = 0;
    for (const k in incoming) {
      const inc = incoming[k]; if (!inc || typeof inc.q !== 'number') continue;
      const cur = col.items[k];
      if (!cur || (inc.t || 0) > (cur.t || 0)) { col.items[k] = { q: inc.q, t: inc.t || Date.now() }; n++; }
    }
    if (n) { KK.persistNow(); changed({ merged: n }); }
    return n;
  };

  // Index: taal → set → Set(kaart-id's in bezit)
  KK.ownedIndex = () => {
    if (indexCache) return indexCache;
    const idx = {};
    for (const k in col.items) {
      if (!col.items[k].q) continue;
      const p = KK.parseKey(k); if (!VAR_CODES.includes(p.code)) continue;
      const s = KK.setIdOf(p.id);
      ((idx[p.lang] = idx[p.lang] || {})[s] = idx[p.lang][s] || new Set()).add(p.id);
    }
    return (indexCache = idx);
  };
  KK.ownedInSet = (lang, setId) => { const s = (KK.ownedIndex()[lang] || {})[setId]; return s ? s.size : 0; };

  // ---------- Kaartdata (TCGdex) ----------
  const API = 'https://api.tcgdex.net/v2/';
  const memo = new Map();
  KK.api = (lang, path) => {
    const url = API + lang + '/' + path;
    if (memo.has(url)) return memo.get(url);
    const p = fetch(url).then((r) => { if (!r.ok) throw new Error(r.status === 404 ? 'niet gevonden' : 'fout ' + r.status); return r.json(); });
    memo.set(url, p); p.catch(() => memo.delete(url));
    return p;
  };
  KK.getSets = (lang) => KK.api(lang, 'sets');
  KK.getSeries = (lang) => KK.api(lang, 'series');
  KK.getSerie = (lang, id) => KK.api(lang, 'series/' + encodeURIComponent(id));
  KK.getSet = (lang, id) => KK.api(lang, 'sets/' + encodeURIComponent(id));
  KK.getCard = (lang, id) => KK.api(lang, 'cards/' + encodeURIComponent(id));
  KK.searchCards = (lang, q) => KK.api(lang, 'cards?name=' + encodeURIComponent(q));
  KK.cardImg = (card, quality) => { const i = card && (card.image || card.i); return i ? i + '/' + (quality || 'low') + '.webp' : ''; };
  KK.setLogo = (set) => (set && set.logo ? set.logo + '.webp' : set && set.symbol ? set.symbol + '.webp' : '');

  // ---------- Hulpjes ----------
  const esc = (KK.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  let toastTimer;
  KK.toast = (msg) => { const t = document.getElementById('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2600); };
  KK.openSheet = (html, onMount) => { const s = document.getElementById('sheet'); const old = document.getElementById('sheet-body'); const b = old.cloneNode(false); old.replaceWith(b); b.innerHTML = html; s.hidden = false; if (onMount) onMount(b); };
  KK.closeSheet = () => { document.getElementById('sheet').hidden = true; document.getElementById('sheet-body').innerHTML = ''; document.dispatchEvent(new Event('kk-sheet-closed')); };
  document.getElementById('sheet').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) KK.closeSheet(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') KK.closeSheet(); });
  KK.copyText = async (text) => {
    try { await navigator.clipboard.writeText(text); KK.toast('Gekopieerd'); }
    catch (e) { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); KK.toast('Gekopieerd'); } catch (e2) { KK.toast('Kopiëren lukte niet'); } ta.remove(); }
  };
  KK.download = (name, text, type) => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };
  KK.errorBox = (err) => `<div class="empty">${!navigator.onLine
    ? 'Je bent offline en deze gegevens zijn nog niet op je toestel bewaard. Probeer opnieuw met internet.'
    : 'De kaartdatabank gaf geen antwoord (' + esc(err && err.message) + '). Probeer het zo meteen opnieuw.'}
    <div style="margin-top:12px"><button class="btn" onclick="location.reload()">Opnieuw laden</button></div></div>`;
  const progressBar = (KK.progressBar = (owned, total) => {
    const pct = total ? Math.min(100, Math.round((owned / total) * 100)) : 0;
    return `<div class="progress${total && owned >= total ? ' done' : ''}" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>`;
  });
  const HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>';
  const SWAP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h12l-3-3M17 17H5l3 3"/></svg>';
  KK.ICON = { HEART, SWAP };

  // ---------- Thema & taal ----------
  function applyTheme() { const r = document.documentElement; if (KK.settings.theme === 'system') r.removeAttribute('data-theme'); else r.setAttribute('data-theme', KK.settings.theme); }
  applyTheme();
  const langSel = document.getElementById('lang-select');
  langSel.innerHTML = KK.LANGS.map(([c, n]) => `<option value="${c}">${n}</option>`).join('');
  langSel.value = KK.settings.lang;
  langSel.addEventListener('change', () => { KK.settings.lang = langSel.value; KK.saveSettings(); if (location.hash.startsWith('#/set/')) location.hash = '#/sets'; else route(); });
  KK.setLang = (lang) => { KK.settings.lang = lang; KK.saveSettings(); langSel.value = lang; };

  // ---------- Router ----------
  const view = document.getElementById('view');
  let cleanup = null;
  KK.views = KK.views || {};
  function route() {
    if (cleanup) { try { cleanup(); } catch (e) {} cleanup = null; }
    const parts = (location.hash || '#/sets').replace(/^#\/?/, '').split('/');
    const name = parts[0] || 'sets';
    const arg = decodeURIComponent(parts.slice(1).join('/'));
    document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.tab === name || (name === 'set' && a.dataset.tab === 'sets')));
    window.scrollTo(0, 0);
    cleanup = (KK.views[name] || KK.views.sets)(view, arg) || null;
  }
  KK.route = route;
  window.addEventListener('hashchange', route);

  // ---------- Kaarttegel (gedeeld) ----------
  KK.cardTile = (lang, c, opts) => {
    opts = opts || {};
    const code = opts.code;
    const q = code != null ? KK.qty(lang, c.id, code) : KK.totalQty(lang, c.id);
    const d = KK.details && KK.details.get(lang, c.id);
    const img = KK.cardImg(c, 'low');
    const want = KK.flag(lang, c.id, 'want');
    let dots = '';
    if (d && !opts.noDots && code == null) {
      const vs = KK.variantsOf(d);
      if (vs.length > 1) dots = `<div class="vdots">${vs.map((v) => `<span class="${KK.qty(lang, c.id, v) ? 'on' : ''}" title="${esc(KK.variantName(d, v))}">${KK.VARIANT_SHORT[v]}</span>`).join('')}</div>`;
    }
    return `<button class="card${q ? '' : ' missing'}" data-id="${esc(c.id)}"${code != null ? ` data-code="${code}"` : ''} aria-label="${esc(c.name)} ${esc(c.localId)}, ${q ? q + ' in bezit' : 'ontbreekt'}">
      <div class="art">${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : `<div class="noimg">${esc(c.name)}<br>${esc(c.localId)}</div>`}
        ${q ? `<span class="qty">${q}</span>` : ''}${want ? `<span class="want" title="Op verlanglijst">${HEART}</span>` : ''}
        ${opts.label ? `<span class="slot-tag">${esc(opts.label)}</span>` : ''}${dots}</div>
      <div class="cap"><span class="nm">${esc(opts.caption || c.name)}</span><span class="num">${esc(opts.num || c.localId)}</span></div></button>`;
  };

  // ---------- Weergave: sets + zoeken ----------
  const openSeries = new Set(store.get('kk-open-series', []));
  KK.views.sets = (el) => {
    const lang = KK.settings.lang;
    el.innerHTML = `
      <div><div class="eyebrow">Kaarten in het ${esc(KK.langName(lang))}</div><h1>Sets</h1></div>
      <div class="search"><label class="sr-only" for="set-search">Zoek een set of kaart</label>
        <input id="set-search" class="input" type="search" placeholder="Zoek een set of kaartnaam, bv. Pikachu" autocomplete="off"></div>
      <div id="set-area"><div class="spinner"></div></div>`;
    const area = el.querySelector('#set-area'); const search = el.querySelector('#set-search');
    let alive = true, allSets = [], searchTimer = null, searchSeq = 0;

    function setRow(s) {
      const total = (s.cardCount && (s.cardCount.total || s.cardCount.official)) || 0;
      const official = (s.cardCount && s.cardCount.official) || total;
      const owned = KK.ownedInSet(lang, s.id); const logo = KK.setLogo(s);
      return `<a class="set-row" href="#/set/${encodeURIComponent(s.id)}">
        ${logo ? `<img class="logo" src="${esc(logo)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'logo-fallback',textContent:'${esc(s.id)}'}))">` : `<div class="logo-fallback">${esc(s.id)}</div>`}
        <div class="meta"><span class="name">${esc(s.name)}</span>${progressBar(owned, total)}
          <span class="count">${owned} van ${total}${official && official !== total ? ` · ${official} officieel` : ''}</span></div></a>`;
    }

    Promise.all([KK.getSeries(lang), KK.getSets(lang)]).then(([series, sets]) => {
      if (!alive) return;
      allSets = sets || [];
      const list = (series || []).slice().reverse();
      if (!openSeries.size && list[0]) openSeries.add(list[0].id);
      function renderSeries() {
        area.innerHTML = list.length ? list.map((s) => `
          <section class="serie" data-serie="${esc(s.id)}">
            <button class="serie-head" aria-expanded="${openSeries.has(s.id)}"><h2>${esc(s.name)}</h2><span class="chev" aria-hidden="true">›</span></button>
            <div class="set-list" ${openSeries.has(s.id) ? '' : 'hidden'}></div></section>`).join('') : '<div class="empty">Geen sets gevonden in deze taal.</div>';
        area.querySelectorAll('.serie').forEach((sec) => {
          const id = sec.dataset.serie; const btn = sec.querySelector('.serie-head'); const box = sec.querySelector('.set-list');
          const fill = () => {
            if (box.dataset.loaded) return; box.innerHTML = '<div class="spinner"></div>';
            KK.getSerie(lang, id).then((full) => { const ss = (full.sets || []).slice().reverse(); box.innerHTML = ss.length ? ss.map(setRow).join('') : '<div class="muted small">Geen sets.</div>'; box.dataset.loaded = '1'; })
              .catch((e) => { box.innerHTML = KK.errorBox(e); });
          };
          if (openSeries.has(id)) fill();
          btn.addEventListener('click', () => {
            const open = btn.getAttribute('aria-expanded') !== 'true';
            btn.setAttribute('aria-expanded', open); box.hidden = !open;
            if (open) { openSeries.add(id); fill(); } else openSeries.delete(id);
            store.set('kk-open-series', [...openSeries]);
          });
        });
      }
      function renderSearch(q) {
        const ql = q.toLowerCase();
        const hits = allSets.filter((s) => s.name.toLowerCase().includes(ql) || s.id.toLowerCase().includes(ql)).reverse();
        area.innerHTML = `${hits.length ? `<h2>Sets</h2><div class="set-list">${hits.map(setRow).join('')}</div>` : ''}
          <h2 style="margin-top:8px">Kaarten</h2><div id="card-hits">${q.length >= 3 ? '<div class="spinner"></div>' : '<div class="muted small">Typ minstens 3 letters om kaarten te zoeken.</div>'}</div>`;
        if (q.length < 3) return;
        const seq = ++searchSeq;
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
          KK.searchCards(lang, q).then((cards) => {
            if (!alive || seq !== searchSeq) return;
            const box = area.querySelector('#card-hits'); if (!box) return;
            const setName = {}; allSets.forEach((s) => { setName[s.id] = s; });
            const shown = (cards || []).slice().reverse().slice(0, 90);
            box.innerHTML = shown.length ? `<div class="muted small" style="margin-bottom:8px">${cards.length} kaarten gevonden${cards.length > shown.length ? ', de nieuwste ' + shown.length + ' getoond' : ''}.</div>
              <div class="card-grid">${shown.map((c) => { const s = setName[KK.setIdOf(c.id)]; return KK.cardTile(lang, c, { caption: s ? s.name : c.name, num: c.localId }); }).join('')}</div>` : '<div class="empty">Geen kaarten met die naam in deze taal.</div>';
            box.onclick = (e) => { const b = e.target.closest('.card'); if (!b) return; const c = cards.find((x) => x.id === b.dataset.id); KK.showCard(lang, c, setName[KK.setIdOf(c.id)]); };
          }).catch((e) => { const box = area.querySelector('#card-hits'); if (box) box.innerHTML = KK.errorBox(e); });
        }, 350);
      }
      search.addEventListener('input', () => { const q = search.value.trim(); q ? renderSearch(q) : renderSeries(); });
      renderSeries();
    }).catch((e) => { if (alive) area.innerHTML = KK.errorBox(e); });
    return () => { alive = false; clearTimeout(searchTimer); };
  };

  // ---------- Weergave: één set (raster of binder) ----------
  const setUi = { mode: 'all', layout: 'grid', quick: store.get('kk-quick', false) };
  KK.views.set = (el, setId) => {
    const lang = KK.settings.lang;
    el.innerHTML = '<div class="spinner"></div>';
    let alive = true, set = null, detailsDone = false;
    const abort = new AbortController();

    const master = () => KK.settings.master;
    const slotsOf = (c) => (master() ? KK.variantsOf(KK.details.get(lang, c.id)) : ['']);
    const ownedSlot = (c, v) => (master() ? KK.qty(lang, c.id, v) > 0 : KK.totalQty(lang, c.id) > 0);

    function counts() {
      let total = 0, owned = 0, value = 0;
      set.cards.forEach((c) => {
        slotsOf(c).forEach((v) => { total++; if (ownedSlot(c, v)) owned++; });
        const d = KK.details.get(lang, c.id);
        KK.VAR_CODES.forEach((v) => { const q = KK.qty(lang, c.id, v); if (q) { const p = KK.priceOf(d, v); if (p) value += p * q; } });
      });
      return { total, owned, value, official: (set.cardCount && set.cardCount.official) || set.cards.length };
    }

    function renderHead() {
      const { total, owned, value, official } = counts();
      el.querySelector('#set-count').innerHTML = `${owned}<small> / ${total} ${master() ? 'versies (master set)' : 'kaarten'}</small>`;
      el.querySelector('#set-bar').innerHTML = progressBar(owned, total);
      el.querySelector('#set-sub').textContent = (total - owned === 0 ? 'Compleet!' : `Nog ${total - owned} te gaan`) + (official !== set.cards.length ? ` · ${official} officieel genummerd` : '');
      el.querySelector('#set-value').textContent = value ? `Waarde van wat je hebt: ≈ ${KK.euro(value)} (Cardmarket)` : '';
      renderRarity();
    }

    function renderRarity() {
      const box = el.querySelector('#rarity'); if (!box) return;
      if (!detailsDone) return;
      const groups = new Map();
      set.cards.forEach((c) => {
        const d = KK.details.get(lang, c.id); const r = (d && d.r) || 'Onbekend';
        const g = groups.get(r) || { total: 0, owned: 0 }; g.total++; if (KK.totalQty(lang, c.id) > 0) g.owned++; groups.set(r, g);
      });
      box.innerHTML = [...groups].map(([r, g]) => `<div class="rar-row"><span>${esc(r)}</span>${progressBar(g.owned, g.total)}<span class="num">${g.owned}/${g.total}</span></div>`).join('');
    }

    function visible(c) {
      const m = setUi.mode;
      if (m === 'all') return true;
      if (m === 'want') return KK.flag(lang, c.id, 'want');
      if (m === 'dupe') return KK.VAR_CODES.some((v) => KK.qty(lang, c.id, v) > 1) || KK.flag(lang, c.id, 'trade');
      const slots = slotsOf(c); const any = slots.some((v) => ownedSlot(c, v)); const all = slots.every((v) => ownedSlot(c, v));
      return m === 'missing' ? !all : any;
    }

    function renderGrid() {
      const grid = el.querySelector('#grid');
      if (setUi.layout === 'binder') return renderBinder(grid);
      grid.className = 'card-grid';
      const list = set.cards.filter(visible);
      const emptyMsg = { missing: 'Je hebt alles uit deze set!', owned: 'Nog geen kaarten uit deze set.', want: 'Geen kaarten van deze set op je verlanglijst.', dupe: 'Geen dubbels in deze set.' }[setUi.mode] || '';
      grid.innerHTML = list.length ? list.map((c) => KK.cardTile(lang, c)).join('') : `<div class="empty" style="grid-column:1/-1">${emptyMsg}</div>`;
    }

    function renderBinder(grid) {
      const size = KK.settings.binderSize; const cols = { 4: 2, 9: 3, 12: 3, 16: 4 }[size] || 3;
      const slots = [];
      set.cards.forEach((c) => {
        const d = KK.details.get(lang, c.id);
        slots.push({ c, code: KK.settings.binderRev ? '' : undefined });
        if (KK.settings.binderRev && d && d.v && d.v.reverse) slots.push({ c, code: 'r' });
      });
      const pages = [];
      for (let i = 0; i < slots.length; i += size) pages.push(slots.slice(i, i + size));
      grid.className = 'binder';
      grid.innerHTML = pages.map((pg, pi) => `<section class="binder-page" id="page-${pi + 1}">
          <div class="binder-head"><b>Pagina ${pi + 1}</b><span class="muted small">${pi % 2 === 0 ? 'voorkant' : 'achterkant'} van blad ${Math.floor(pi / 2) + 1}</span></div>
          <div class="binder-grid" style="--cols:${cols}">${pg.map((s, si) => KK.cardTile(lang, s.c, { code: s.code, label: s.code === 'r' ? 'Reverse' : '', num: (pi * size + si + 1) + '', caption: s.c.localId + ' ' + s.c.name })).join('')}
            ${Array.from({ length: size - pg.length }, () => '<div class="slot-empty"></div>').join('')}</div></section>`).join('');
      grid.insertAdjacentHTML('afterbegin', `<div class="muted small" style="grid-column:1/-1">${slots.length} vakjes · ${pages.length} pagina's van ${size}${KK.settings.binderRev && !detailsDone ? ' · reverse-vakjes verschijnen zodra de details geladen zijn' : ''}</div>`);
    }

    function refresh() { if (!set) return; renderHead(); renderGrid(); }

    KK.getSet(lang, setId).then((s) => {
      if (!alive) return;
      set = s; set.cards = set.cards || [];
      const logo = KK.setLogo(set);
      el.innerHTML = `
        <a href="#/sets" class="muted small" style="text-decoration:none">‹ Alle sets</a>
        <section class="set-hero">
          <div class="set-hero-top">${logo ? `<img src="${esc(logo)}" alt="" onerror="this.remove()">` : ''}
            <div style="min-width:0"><div class="eyebrow">${esc(set.serie ? set.serie.name : '')}${set.releaseDate ? ' · ' + esc(set.releaseDate.slice(0, 4)) : ''}</div><h1>${esc(set.name)}</h1></div></div>
          <div class="big-count" id="set-count"></div><div id="set-bar"></div>
          <div class="muted small" id="set-sub"></div>
          <div class="small" id="set-value"></div>
          <div class="muted small" id="details-status"></div>
          <details class="rarity-box"><summary>Per zeldzaamheid</summary><div id="rarity"><div class="muted small">Wordt geladen…</div></div></details>
        </section>
        <div class="toolbar">
          <div class="chips" role="group" aria-label="Weergave">
            <button class="chip" data-layout="grid">Raster</button><button class="chip" data-layout="binder">Binder</button>
            <button class="chip" id="master" title="Elke variant (reverse holo, …) telt apart">Master set</button>
          </div>
          <div class="chips" role="group" aria-label="Filter">
            <button class="chip" data-mode="all">Alles</button><button class="chip" data-mode="missing">Ontbrekend</button>
            <button class="chip" data-mode="owned">In bezit</button><button class="chip" data-mode="want">Verlanglijst</button><button class="chip" data-mode="dupe">Dubbel</button>
          </div>
          <div class="binder-opts chips" id="binder-opts">
            <label class="small" for="bsize">Vakjes per pagina</label>
            <select id="bsize" class="input mini"><option>4</option><option>9</option><option>12</option><option>16</option></select>
            <button class="chip" id="brev">Reverse in eigen vakje</button>
          </div>
          <div class="chips">
            <button class="chip" id="quick" title="Tik een kaart om hem meteen af te vinken">Snel afvinken</button>
            <button class="chip" id="copy-missing">Kopieer lijst ontbrekend</button>
          </div>
        </div>
        <div id="grid" class="card-grid"></div>`;

      const sync = () => {
        el.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.mode === setUi.mode));
        el.querySelectorAll('[data-layout]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.layout === setUi.layout));
        el.querySelector('#quick').setAttribute('aria-pressed', setUi.quick);
        el.querySelector('#master').setAttribute('aria-pressed', !!KK.settings.master);
        el.querySelector('#brev').setAttribute('aria-pressed', !!KK.settings.binderRev);
        el.querySelector('#binder-opts').hidden = setUi.layout !== 'binder';
        el.querySelector('#bsize').value = String(KK.settings.binderSize);
      };
      el.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { setUi.mode = b.dataset.mode; sync(); renderGrid(); }));
      el.querySelectorAll('[data-layout]').forEach((b) => b.addEventListener('click', () => { setUi.layout = b.dataset.layout; sync(); renderGrid(); }));
      el.querySelector('#master').addEventListener('click', () => { KK.settings.master = !KK.settings.master; KK.saveSettings(); sync(); refresh(); if (KK.settings.master && !detailsDone) KK.toast('Varianten worden nog geladen…'); });
      el.querySelector('#bsize').addEventListener('change', (e) => { KK.settings.binderSize = +e.target.value; KK.saveSettings(); renderGrid(); });
      el.querySelector('#brev').addEventListener('click', () => { KK.settings.binderRev = !KK.settings.binderRev; KK.saveSettings(); sync(); renderGrid(); });
      el.querySelector('#quick').addEventListener('click', () => { setUi.quick = !setUi.quick; store.set('kk-quick', setUi.quick); sync(); KK.toast(setUi.quick ? 'Snel afvinken aan: tik = in bezit / weg' : 'Snel afvinken uit'); });
      el.querySelector('#copy-missing').addEventListener('click', () => {
        const lines = [];
        set.cards.forEach((c) => slotsOf(c).forEach((v) => { if (!ownedSlot(c, v)) lines.push(`${c.localId}/${set.cardCount.official} ${c.name}${master() ? ' (' + KK.variantName(KK.details.get(lang, c.id), v) + ')' : ''}`); }));
        if (!lines.length) return KK.toast('Je mist niets in deze set');
        KK.copyText(`Ik zoek nog uit ${set.name} (${KK.langName(lang)}):\n` + lines.join('\n'));
      });
      el.querySelector('#grid').addEventListener('click', (e) => {
        const b = e.target.closest('.card'); if (!b) return;
        const id = b.dataset.id; const code = b.dataset.code || '';
        const c = set.cards.find((x) => x.id === id);
        if (setUi.quick) {
          const q = KK.qty(lang, id, code);
          if (q <= 1 && (code || KK.totalQty(lang, id) === q)) { KK.setQty(lang, id, q ? 0 : 1, code); return; }
        }
        KK.showCard(lang, c, set);
      });
      sync(); refresh();

      // details (varianten, zeldzaamheid, prijs) op de achtergrond laden
      const status = el.querySelector('#details-status');
      let lastPaint = 0;
      KK.detailsReady.then(() => KK.details.ensure(lang, set.cards.map((c) => c.id), (done, total) => {
        if (!alive) return;
        status.textContent = done < total ? `Varianten en prijzen laden… ${done}/${total}` : '';
        if (Date.now() - lastPaint > 1500 || done === total) { lastPaint = Date.now(); renderHead(); }
      }, abort.signal)).then(() => { if (!alive) return; detailsDone = true; status.textContent = ''; refresh(); });
    }).catch((e) => { if (alive) el.innerHTML = KK.errorBox(e); });

    const onChange = (e) => {
      if (!set) return; const d = e.detail || {};
      if (d.cardId && d.lang === lang) {
        if (setUi.layout === 'binder') renderGrid();
        else el.querySelectorAll(`.card[data-id="${CSS.escape(d.cardId)}"]`).forEach((b) => {
          const c = set.cards.find((x) => x.id === d.cardId);
          if (!visible(c)) b.remove(); else b.outerHTML = KK.cardTile(lang, c);
        });
        renderHead();
      } else if (d.merged) refresh();
    };
    document.addEventListener('kk-change', onChange);
    return () => { alive = false; abort.abort(); document.removeEventListener('kk-change', onChange); };
  };

  // ---------- Kaartdetail ----------
  KK.showCard = (lang, card, set) => {
    if (!card) return;
    const official = set && set.cardCount ? set.cardCount.official : '';
    const img = KK.cardImg(card, 'high');
    const setName = set ? set.name : KK.setIdOf(card.id);
    KK.openSheet(`
      <div class="detail">
        <div>${img ? `<img src="${esc(img)}" alt="${esc(card.name)}">` : '<div class="card"><div class="art"><div class="noimg">Geen afbeelding</div></div></div>'}</div>
        <div class="info">
          <div class="eyebrow">${esc(setName)} · ${esc(KK.langName(lang))}</div>
          <h2 id="sheet-title" style="font-size:22px">${esc(card.name)}</h2>
          <div class="num muted">Nummer ${esc(card.localId)}${official ? ' / ' + official : ''}</div>
          <div id="card-extra" class="small muted"></div>
          <div class="chips">
            <button class="chip flag" id="f-want">${HEART}<span>Verlanglijst</span></button>
            <button class="chip flag" id="f-trade">${SWAP}<span>Mag weg / ruil</span></button>
          </div>
        </div>
      </div>
      <div class="eyebrow" style="margin-top:16px">In bezit per versie</div>
      <div id="variants" class="variants"><div class="spinner"></div></div>
      <div id="price" class="price-box"></div>
      <a class="btn" style="margin-top:12px" target="_blank" rel="noopener" href="https://www.cardmarket.com/nl/Pokemon/Products/Search?searchString=${encodeURIComponent(card.name)}">Bekijk op Cardmarket ↗</a>`, (body) => {
      const flags = () => {
        body.querySelector('#f-want').setAttribute('aria-pressed', KK.flag(lang, card.id, 'want'));
        body.querySelector('#f-trade').setAttribute('aria-pressed', KK.flag(lang, card.id, 'trade'));
      };
      body.querySelector('#f-want').addEventListener('click', () => { const on = !KK.flag(lang, card.id, 'want'); KK.setFlag(lang, card.id, 'want', on); flags(); KK.toast(on ? 'Op je verlanglijst gezet' : 'Van je verlanglijst gehaald'); });
      body.querySelector('#f-trade').addEventListener('click', () => { const on = !KK.flag(lang, card.id, 'trade'); KK.setFlag(lang, card.id, 'trade', on); flags(); KK.toast(on ? 'Gemarkeerd als "mag weg"' : 'Markering "mag weg" weg'); });
      flags();

      const paint = (d) => {
        const vs = KK.variantsOf(d);
        body.querySelector('#variants').innerHTML = vs.map((v) => {
          const p = KK.priceOf(d, v);
          return `<div class="vrow"><div><b>${esc(KK.variantName(d, v))}</b>${p ? `<span class="muted small"> · ≈ ${KK.euro(p)}</span>` : ''}</div>
            <div class="stepper"><button data-dec="${v}" aria-label="Eén minder ${esc(KK.variantName(d, v))}">−</button><output class="num" data-q="${v}">${KK.qty(lang, card.id, v)}</output><button data-inc="${v}" aria-label="Eén meer ${esc(KK.variantName(d, v))}">+</button></div></div>`;
        }).join('') + (d ? '' : '<div class="muted small">Varianten konden niet geladen worden. Je telt nu de standaardversie.</div>');
        const extra = [];
        if (d && d.r) extra.push('Zeldzaamheid: ' + d.r);
        body.querySelector('#card-extra').innerHTML = extra.map(esc).join('<br>');
        const pb = body.querySelector('#price');
        if (d && d.p) {
          const p = d.p;
          pb.innerHTML = `<div class="eyebrow">Marktprijs Cardmarket</div>
            <div class="price-grid">
              <div><span>Trend</span><b>${KK.euro(p.t)}</b></div><div><span>Gem. 30 dagen</span><b>${KK.euro(p.a)}</b></div><div><span>Laagste</span><b>${KK.euro(p.lo)}</b></div>
              ${p.th || p.ah ? `<div><span>Trend holo/reverse</span><b>${KK.euro(p.th)}</b></div><div><span>Gem. 30 d. holo</span><b>${KK.euro(p.ah)}</b></div><div><span>Laagste holo</span><b>${KK.euro(p.loh)}</b></div>` : ''}
            </div><div class="muted small">Richtprijzen in euro, bijgewerkt ${new Date(d.ts).toLocaleDateString('nl-BE')}. Prijzen kunnen per variant afwijken.</div>`;
        } else pb.innerHTML = d ? '<div class="muted small">Geen prijs bekend voor deze kaart.</div>' : '';
      };
      body.addEventListener('click', (e) => {
        const inc = e.target.closest('[data-inc]'); const dec = e.target.closest('[data-dec]');
        const v = inc ? inc.dataset.inc : dec ? dec.dataset.dec : null; if (v == null) return;
        KK.setQty(lang, card.id, KK.qty(lang, card.id, v) + (inc ? 1 : -1), v);
        body.querySelector(`[data-q="${v}"]`).textContent = KK.qty(lang, card.id, v);
      });
      paint(KK.details.get(lang, card.id));
      KK.details.load(lang, card.id).then((d) => { if (body.isConnected) paint(d); });
    });
  };

  // ---------- Lijstrij (verlanglijst, dubbels, vergelijken) ----------
  KK.listRow = (lang, id, code, right) => {
    const d = KK.details.get(lang, id);
    const name = d ? d.n : id; const img = d && d.i ? d.i + '/low.webp' : '';
    return `<div class="result" data-open="${esc(lang)}|${esc(id)}">
      ${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : '<span class="thumb-ph"></span>'}
      <div class="meta"><b>${esc(name)}</b><span class="small muted">${esc(d ? d.sn : KK.setIdOf(id))} · ${esc(d ? d.l + (d.so ? '/' + d.so : '') : '')}${code != null ? ' · ' + esc(KK.variantName(d, code)) : ''} · ${esc(KK.langName(lang))}</span></div>
      <div class="right small">${right || ''}</div></div>`;
  };
  KK.lineText = (lang, id, code) => { const d = KK.details.get(lang, id); return `${d ? d.n : id} – ${d ? d.sn : KK.setIdOf(id)} ${d ? d.l + (d.so ? '/' + d.so : '') : ''}${code ? ' (' + KK.variantName(d, code) + ')' : ''} [${KK.langName(lang)}]`; };
  KK.openFromRow = (container) => container.addEventListener('click', (e) => {
    const r = e.target.closest('[data-open]'); if (!r || e.target.closest('button')) return;
    const [lang, id] = r.dataset.open.split('|'); const d = KK.details.get(lang, id);
    KK.showCard(lang, { id, name: d ? d.n : id, localId: d ? d.l : '', image: d ? d.i : '' }, d ? { name: d.sn, cardCount: { official: d.so } } : null);
  });

  // ---------- Weergave: collectie ----------
  KK.collectionKeys = (filterFn) => Object.keys(col.items).filter((k) => col.items[k].q > 0 && (!filterFn || filterFn(KK.parseKey(k))));

  KK.dupeList = () => {
    const out = [];
    KK.collectionKeys((p) => KK.VAR_CODES.includes(p.code)).forEach((k) => {
      const p = KK.parseKey(k); const q = col.items[k].q;
      const trade = KK.flag(p.lang, p.id, 'trade');
      if (q > 1 || trade) out.push(Object.assign(p, { spare: trade ? q : q - 1, q, trade }));
    });
    return out;
  };

  let colTab = 'sets';
  KK.views.collectie = (el, arg) => {
    if (arg) colTab = arg;
    const idx = KK.ownedIndex();
    let copies = 0, unique = 0;
    KK.collectionKeys((p) => KK.VAR_CODES.includes(p.code)).forEach((k) => { copies += col.items[k].q; });
    Object.values(idx).forEach((sets) => Object.values(sets).forEach((s) => { unique += s.size; }));
    const langs = Object.keys(idx);
    el.innerHTML = `
      <div><div class="eyebrow">Overzicht</div><h1>Mijn collectie</h1></div>
      <div class="stat-row">
        <div class="stat"><b>${unique}</b><span>verschillende kaarten</span></div>
        <div class="stat"><b>${copies}</b><span>exemplaren</span></div>
        <div class="stat"><b id="col-value">…</b><span id="col-value-sub">waarde (Cardmarket)</span></div>
      </div>
      <div class="chips" role="tablist">
        <button class="chip" data-tab="sets">Per set</button><button class="chip" data-tab="want">Verlanglijst</button>
        <button class="chip" data-tab="dupe">Dubbels &amp; ruil</button><button class="chip" data-tab="compare">Vergelijken</button>
      </div>
      <div id="col-area"></div>`;
    el.querySelectorAll('[data-tab]').forEach((b) => { b.setAttribute('aria-pressed', b.dataset.tab === colTab); b.addEventListener('click', () => { location.hash = '#/collectie/' + b.dataset.tab; }); });
    const area = el.querySelector('#col-area');
    let alive = true; const abort = new AbortController();

    // waarde berekenen (details van alles wat je hebt)
    const ownedKeys = KK.collectionKeys((p) => KK.VAR_CODES.includes(p.code)).map(KK.parseKey);
    const byLang = {}; ownedKeys.forEach((p) => { (byLang[p.lang] = byLang[p.lang] || new Set()).add(p.id); });
    const paintValue = () => {
      let v = 0, known = 0, all = 0;
      ownedKeys.forEach((p) => { all++; const pr = KK.priceOf(KK.details.get(p.lang, p.id), p.code); if (pr) { v += pr * KK.qty(p.lang, p.id, p.code); known++; } });
      const ve = el.querySelector('#col-value'); if (!ve) return;
      ve.textContent = all ? KK.euro(v) : '€ 0';
      el.querySelector('#col-value-sub').textContent = all && known < all ? `waarde · prijs van ${known}/${all} bekend` : 'waarde (Cardmarket)';
    };
    KK.detailsReady.then(async () => {
      paintValue();
      for (const lang of Object.keys(byLang)) { if (!alive) return; await KK.details.ensure(lang, [...byLang[lang]], () => {}, abort.signal); paintValue(); }
      if (alive && colTab !== 'sets') renderTab();
    });

    function renderTab() {
      if (colTab === 'sets') return renderSets();
      if (colTab === 'want') return renderWant();
      if (colTab === 'dupe') return renderDupe();
      if (colTab === 'compare') { if (KK.renderCompare) KK.renderCompare(area); else area.innerHTML = '<div class="empty">Vergelijken vraagt synchronisatie (zie Instellingen).</div>'; }
    }

    function renderSets() {
      if (!langs.length) { area.innerHTML = '<div class="empty">Nog geen kaarten. Scan je eerste kaart of open een set en tik kaarten aan.<div style="margin-top:12px"><a class="btn primary" href="#/scan">Kaart scannen</a></div></div>'; return; }
      area.innerHTML = '';
      langs.forEach((lang) => {
        const sec = document.createElement('section'); sec.className = 'serie';
        sec.innerHTML = `<h2>${esc(KK.langName(lang))}</h2><div class="set-list"><div class="spinner"></div></div>`;
        area.appendChild(sec);
        KK.getSets(lang).then((sets) => {
          if (!alive) return;
          const map = {}; sets.forEach((s, i) => { map[s.id] = Object.assign({ order: i }, s); });
          const ids = Object.keys(idx[lang]).sort((a, b) => ((map[b] || {}).order || 0) - ((map[a] || {}).order || 0));
          sec.querySelector('.set-list').innerHTML = ids.map((id) => {
            const s = map[id] || { id, name: id, cardCount: {} };
            const total = (s.cardCount && (s.cardCount.total || s.cardCount.official)) || 0; const owned = idx[lang][id].size; const logo = KK.setLogo(s);
            return `<a class="set-row" href="#/set/${encodeURIComponent(id)}" data-lang="${esc(lang)}">
              ${logo ? `<img class="logo" src="${esc(logo)}" alt="" loading="lazy">` : `<div class="logo-fallback">${esc(id)}</div>`}
              <div class="meta"><span class="name">${esc(s.name)}</span>${progressBar(owned, total)}<span class="count">${owned} van ${total || '?'} · mist nog ${Math.max(0, total - owned)}</span></div></a>`;
          }).join('');
          sec.querySelectorAll('a[data-lang]').forEach((a) => a.addEventListener('click', () => KK.setLang(a.dataset.lang)));
        }).catch((e) => { sec.querySelector('.set-list').innerHTML = KK.errorBox(e); });
      });
    }

    function renderWant() {
      const keys = KK.collectionKeys((p) => p.code === 'want').map(KK.parseKey);
      if (!keys.length) { area.innerHTML = '<div class="empty">Je verlanglijst is leeg. Open een kaart en tik op het hartje.</div>'; return; }
      const rows = () => keys.map((p) => KK.listRow(p.lang, p.id, null, KK.totalQty(p.lang, p.id) ? '<span style="color:var(--owned)">heb je al</span>' : '')).join('');
      area.innerHTML = `<div class="btn-row"><button class="btn" id="copy">Kopieer verlanglijst</button></div><div class="results" id="rows">${rows()}</div>`;
      area.querySelector('#copy').addEventListener('click', () => KK.copyText('Mijn verlanglijst:\n' + keys.filter((p) => !KK.totalQty(p.lang, p.id)).map((p) => KK.lineText(p.lang, p.id)).join('\n')));
      KK.openFromRow(area.querySelector('#rows'));
      ensureAndRepaint(keys, () => { const r = area.querySelector('#rows'); if (r) r.innerHTML = rows(); });
    }

    function renderDupe() {
      const list = KK.dupeList();
      if (!list.length) { area.innerHTML = '<div class="empty">Geen dubbels. Kaarten waarvan je er 2 of meer hebt, of die je markeert als "mag weg", verschijnen hier.</div>'; return; }
      const total = list.reduce((s, x) => s + x.spare, 0);
      const rows = () => list.map((x) => KK.listRow(x.lang, x.id, x.code, `<b>${x.spare}× over</b>${x.trade ? '<br><span class="muted">mag weg</span>' : ''}`)).join('');
      area.innerHTML = `<div class="muted small">${total} kaarten om te ruilen of te verkopen.</div>
        <div class="btn-row"><button class="btn" id="copy">Kopieer ruillijst</button></div><div class="results" id="rows">${rows()}</div>`;
      area.querySelector('#copy').addEventListener('click', () => KK.copyText('Te ruil:\n' + list.map((x) => `${x.spare}× ${KK.lineText(x.lang, x.id, x.code)}`).join('\n')));
      KK.openFromRow(area.querySelector('#rows'));
      ensureAndRepaint(list, () => { const r = area.querySelector('#rows'); if (r) r.innerHTML = rows(); });
    }

    function ensureAndRepaint(keys, repaint) {
      const byL = {}; keys.forEach((p) => { (byL[p.lang] = byL[p.lang] || new Set()).add(p.id); });
      KK.detailsReady.then(async () => { for (const l of Object.keys(byL)) { if (!alive) return; await KK.details.ensure(l, [...byL[l]], null, abort.signal); } if (alive) repaint(); });
    }

    renderTab();
    const onChange = () => { if (colTab === 'want' || colTab === 'dupe') renderTab(); paintValue(); };
    document.addEventListener('kk-change', onChange);
    return () => { alive = false; abort.abort(); document.removeEventListener('kk-change', onChange); };
  };

  // ---------- CSV-export ----------
  KK.exportCsv = async (onStatus) => {
    const keys = Object.keys(col.items).filter((k) => col.items[k].q > 0).map(KK.parseKey);
    const ids = {}; keys.forEach((p) => { (ids[p.lang] = ids[p.lang] || new Set()).add(p.id); });
    await KK.detailsReady;
    for (const l of Object.keys(ids)) await KK.details.ensure(l, [...ids[l]], (d, t) => onStatus && onStatus(`Gegevens ophalen ${d}/${t}`));
    const cards = {};
    keys.forEach((p) => { const k = p.lang + '|' + p.id; const c = (cards[k] = cards[k] || { lang: p.lang, id: p.id, v: {}, want: false, trade: false }); if (p.code === 'want') c.want = true; else if (p.code === 'trade') c.trade = true; else c.v[p.code] = col.items[KK.vkey(p.lang, p.id, p.code)].q; });
    const num = (x) => (x == null ? '' : x.toFixed(2).replace('.', ','));
    const cell = (x) => { const s = String(x == null ? '' : x); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const rows = [['Taal', 'Set-code', 'Set', 'Nummer', 'Naam', 'Versie', 'Aantal', 'Verlanglijst', 'Mag weg', 'Zeldzaamheid', 'Prijs per stuk (EUR)', 'Waarde (EUR)']];
    Object.values(cards).forEach((c) => {
      const d = KK.details.get(c.lang, c.id);
      const base = [KK.langName(c.lang), KK.setIdOf(c.id), d ? d.sn : '', d ? d.l + (d.so ? '/' + d.so : '') : '', d ? d.n : c.id];
      const codes = Object.keys(c.v);
      if (!codes.length) rows.push(base.concat(['', 0, c.want ? 'ja' : '', c.trade ? 'ja' : '', d ? d.r : '', '', '']));
      codes.forEach((code) => { const pr = KK.priceOf(d, code); rows.push(base.concat([KK.variantName(d, code), c.v[code], c.want ? 'ja' : '', c.trade ? 'ja' : '', d ? d.r : '', num(pr), num(pr ? pr * c.v[code] : null)])); });
    });
    const csv = '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n');
    KK.download('kaartkluis-collectie-' + new Date().toISOString().slice(0, 10) + '.csv', csv, 'text/csv;charset=utf-8');
  };

  // ---------- Weergave: instellingen ----------
  let installEvt = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; const b = document.getElementById('install'); if (b) b.hidden = false; });
  KK.views.instellingen = (el) => {
    el.innerHTML = `
      <div><div class="eyebrow">Instellingen</div><h1>Instellingen</h1></div>
      <section class="panel"><h2>App op je gsm</h2>
        <p class="muted small" style="margin:0">Installeer Kaartkluis op je startscherm. Hij werkt dan als een gewone app, ook offline voor sets die je al eens opende.</p>
        <div class="btn-row"><button class="btn primary" id="install" ${installEvt ? '' : 'hidden'}>Installeren</button></div>
        <p class="muted small" style="margin:0">${installEvt ? '' : 'In Chrome: menu ⋮ → <b>App installeren</b> of <b>Toevoegen aan startscherm</b>.'}</p></section>
      <section class="panel"><h2>Weergave</h2>
        <label class="small" for="theme">Thema</label>
        <select id="theme" class="input"><option value="system">Zoals mijn toestel</option><option value="light">Licht</option><option value="dark">Donker</option></select></section>
      <section class="panel" id="sync-panel"><h2>Synchroniseren</h2><div class="spinner"></div></section>
      <section class="panel" id="family-panel" hidden></section>
      <section class="panel"><h2>Back-up en export</h2>
        <p class="muted small" style="margin:0">Een back-up kun je later terugzetten (wordt samengevoegd met wat je al hebt). De Excel-lijst (CSV) is om te bekijken, te printen of te delen.</p>
        <div class="btn-row"><button class="btn" id="export">Back-up downloaden</button>
          <label class="btn" for="import-file">Back-up terugzetten</label><input id="import-file" type="file" accept="application/json,.json" hidden>
          <button class="btn" id="csv">Excel-lijst (CSV)</button></div>
        <div class="muted small" id="csv-status"></div></section>
      <section class="panel"><h2>Over</h2>
        <p class="muted small" style="margin:0">Kaartgegevens, afbeeldingen en Cardmarket-prijzen komen van TCGdex, Pokédex-gegevens van PokeAPI: twee gratis open databanken. Prijzen zijn richtprijzen. Deze app is niet verbonden aan Nintendo, Creatures, GAME FREAK of The Pokémon Company.</p></section>`;
    const th = el.querySelector('#theme'); th.value = KK.settings.theme;
    th.addEventListener('change', () => { KK.settings.theme = th.value; KK.saveSettings(); applyTheme(); });
    el.querySelector('#install').addEventListener('click', async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice.catch(() => {}); installEvt = null; el.querySelector('#install').hidden = true; });
    el.querySelector('#export').addEventListener('click', () => KK.download('kaartkluis-backup-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify({ app: 'kaartkluis', version: 2, exported: new Date().toISOString(), items: col.items }), 'application/json'));
    el.querySelector('#import-file').addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { const json = JSON.parse(await f.text()); if (!json.items) throw new Error(); const n = KK.mergeItems(json.items); KK.toast(n ? `${n} kaarten bijgewerkt` : 'Niets nieuws in deze back-up'); }
      catch (err) { KK.toast('Dit bestand is geen Kaartkluis-back-up'); }
      e.target.value = '';
    });
    el.querySelector('#csv').addEventListener('click', async (e) => {
      const b = e.currentTarget; const st = el.querySelector('#csv-status'); b.disabled = true;
      try { await KK.exportCsv((t) => { st.textContent = t; }); st.textContent = 'Klaar. Open het bestand met Excel of Google Sheets.'; }
      catch (err) { st.textContent = 'Export mislukt. Controleer je internet en probeer opnieuw.'; }
      b.disabled = false;
    });
    if (KK.renderSyncPanel) KK.renderSyncPanel(el.querySelector('#sync-panel'), el.querySelector('#family-panel'));
  };

  // ---------- Start ----------
  if ('serviceWorker' in navigator && location.protocol === 'https:') window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  window.addEventListener('DOMContentLoaded', route);
})();
