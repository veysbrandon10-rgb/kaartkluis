/* Kaartkluis — kern: talen, kaartdata (TCGdex), collectie, sets, collectie-overzicht, instellingen */
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

  // ---------- Opslag ----------
  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); }
      catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); return true; }
      catch (e) { return false; }
    },
  };
  KK.store = store;

  KK.settings = Object.assign({ lang: 'en', theme: 'system' }, store.get('kk-settings', {}));
  KK.saveSettings = () => store.set('kk-settings', KK.settings);

  // Collectie: sleutel "taal|kaart-id" → { q: aantal, t: tijdstip laatste wijziging }
  // q = 0 wordt bewaard (met tijdstip) zodat verwijderen ook synchroniseert.
  const col = store.get('kk-collection', { items: {} });
  if (!col.items) col.items = {};
  KK.collection = col;

  KK.key = (lang, cardId) => lang + '|' + cardId;
  KK.qty = (lang, cardId) => { const it = col.items[KK.key(lang, cardId)]; return it ? it.q : 0; };

  let saveTimer = null;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!store.set('kk-collection', col)) KK.toast('Opslaan op dit toestel mislukt. Maak een back-up via Instellingen.');
    }, 150);
  }
  KK.persistNow = () => { clearTimeout(saveTimer); store.set('kk-collection', col); };

  KK.setQty = (lang, cardId, q) => {
    q = Math.max(0, Math.min(999, q | 0));
    col.items[KK.key(lang, cardId)] = { q, t: Date.now() };
    persist();
    document.dispatchEvent(new CustomEvent('kk-change', { detail: { lang, cardId, q, local: true } }));
  };
  KK.addOne = (lang, cardId) => KK.setQty(lang, cardId, KK.qty(lang, cardId) + 1);

  // Samenvoegen (sync of import): per kaart wint de laatste wijziging.
  KK.mergeItems = (incoming) => {
    let changed = 0;
    for (const k in incoming) {
      const inc = incoming[k];
      if (!inc || typeof inc.q !== 'number') continue;
      const cur = col.items[k];
      if (!cur || (inc.t || 0) > (cur.t || 0)) { col.items[k] = { q: inc.q, t: inc.t || Date.now() }; changed++; }
    }
    if (changed) { KK.persistNow(); document.dispatchEvent(new CustomEvent('kk-change', { detail: { merged: changed } })); }
    return changed;
  };

  KK.setIdOf = (cardId) => cardId.slice(0, cardId.lastIndexOf('-'));

  KK.ownedInSet = (lang, setId) => {
    const prefix = lang + '|' + setId + '-';
    let n = 0;
    for (const k in col.items) if (col.items[k].q > 0 && k.startsWith(prefix) && k.indexOf('-', prefix.length) === -1) n++;
    return n;
  };

  // ---------- Kaartdata (TCGdex, gratis en zonder sleutel) ----------
  const API = 'https://api.tcgdex.net/v2/';
  const memo = new Map();
  KK.api = async (lang, path) => {
    const url = API + lang + '/' + path;
    if (memo.has(url)) return memo.get(url);
    const p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(r.status === 404 ? 'niet-gevonden' : 'http-' + r.status);
      return r.json();
    });
    memo.set(url, p);
    p.catch(() => memo.delete(url));
    return p;
  };
  KK.getSets = (lang) => KK.api(lang, 'sets');
  KK.getSeries = (lang) => KK.api(lang, 'series');
  KK.getSerie = (lang, id) => KK.api(lang, 'series/' + encodeURIComponent(id));
  KK.getSet = (lang, id) => KK.api(lang, 'sets/' + encodeURIComponent(id));
  KK.getCard = (lang, id) => KK.api(lang, 'cards/' + encodeURIComponent(id));

  KK.cardImg = (card, quality) => (card && card.image ? card.image + '/' + (quality || 'low') + '.webp' : '');
  KK.setLogo = (set) => (set && set.logo ? set.logo + '.webp' : (set && set.symbol ? set.symbol + '.webp' : ''));

  // ---------- Hulpjes ----------
  KK.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const esc = KK.esc;

  let toastTimer;
  KK.toast = (msg) => {
    const t = document.getElementById('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  };

  KK.openSheet = (html, onMount) => {
    const sheet = document.getElementById('sheet');
    document.getElementById('sheet-body').innerHTML = html;
    sheet.hidden = false;
    if (onMount) onMount(document.getElementById('sheet-body'));
  };
  KK.closeSheet = () => { document.getElementById('sheet').hidden = true; document.getElementById('sheet-body').innerHTML = ''; };
  document.getElementById('sheet').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) KK.closeSheet(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') KK.closeSheet(); });

  KK.copyText = async (text) => {
    try { await navigator.clipboard.writeText(text); KK.toast('Gekopieerd'); }
    catch (e) {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); KK.toast('Gekopieerd'); } catch (e2) { KK.toast('Kopiëren lukte niet'); }
      ta.remove();
    }
  };

  KK.errorBox = (err) => {
    const offline = !navigator.onLine;
    return `<div class="empty">${offline
      ? 'Je bent offline en deze gegevens zijn nog niet op je toestel bewaard. Probeer opnieuw met internet.'
      : 'De kaartdatabank gaf geen antwoord (' + esc(err && err.message) + '). Probeer het zo meteen opnieuw.'}
      <div style="margin-top:12px"><button class="btn" onclick="location.reload()">Opnieuw laden</button></div></div>`;
  };

  function progressBar(owned, total) {
    const pct = total ? Math.min(100, Math.round((owned / total) * 100)) : 0;
    return `<div class="progress${total && owned >= total ? ' done' : ''}" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>`;
  }
  KK.progressBar = progressBar;

  // ---------- Thema ----------
  function applyTheme() {
    const r = document.documentElement;
    if (KK.settings.theme === 'system') r.removeAttribute('data-theme'); else r.setAttribute('data-theme', KK.settings.theme);
  }
  applyTheme();

  // ---------- Taalkeuze bovenaan ----------
  const langSel = document.getElementById('lang-select');
  langSel.innerHTML = KK.LANGS.map(([c, n]) => `<option value="${c}">${n}</option>`).join('');
  langSel.value = KK.settings.lang;
  langSel.addEventListener('change', () => {
    KK.settings.lang = langSel.value; KK.saveSettings();
    if (location.hash.startsWith('#/set/')) location.hash = '#/sets'; else route();
  });
  KK.setLang = (lang) => { KK.settings.lang = lang; KK.saveSettings(); langSel.value = lang; };

  // ---------- Router ----------
  const view = document.getElementById('view');
  let cleanup = null;
  KK.views = KK.views || {};

  function route() {
    if (cleanup) { try { cleanup(); } catch (e) {} cleanup = null; }
    const h = location.hash || '#/sets';
    const parts = h.replace(/^#\/?/, '').split('/');
    const name = parts[0] || 'sets';
    const arg = decodeURIComponent(parts.slice(1).join('/'));
    document.querySelectorAll('.tabbar a').forEach((a) => {
      a.classList.toggle('active', a.dataset.tab === name || (name === 'set' && a.dataset.tab === 'sets'));
    });
    window.scrollTo(0, 0);
    const fn = KK.views[name] || KK.views.sets;
    cleanup = fn(view, arg) || null;
  }
  KK.route = route;
  window.addEventListener('hashchange', route);

  // ---------- Weergave: sets ----------
  const openSeries = new Set(store.get('kk-open-series', []));
  KK.views.sets = (el) => {
    const lang = KK.settings.lang;
    el.innerHTML = `
      <div><div class="eyebrow">Kaarten in het ${esc(KK.langName(lang))}</div><h1>Sets</h1></div>
      <div class="search"><label class="sr-only" for="set-search">Zoek een set</label>
        <input id="set-search" class="input" type="search" placeholder="Zoek een set, bv. Prismatic of promo" autocomplete="off"></div>
      <div id="set-area"><div class="spinner"></div></div>`;
    const area = el.querySelector('#set-area');
    const search = el.querySelector('#set-search');
    let alive = true;

    function setRow(s) {
      const total = (s.cardCount && (s.cardCount.total || s.cardCount.official)) || 0;
      const official = (s.cardCount && s.cardCount.official) || total;
      const owned = KK.ownedInSet(lang, s.id);
      const logo = KK.setLogo(s);
      return `<a class="set-row" href="#/set/${encodeURIComponent(s.id)}">
        ${logo ? `<img class="logo" src="${esc(logo)}" alt="" loading="lazy" onerror="this.outerHTML='<div class=&quot;logo-fallback&quot;>${esc(s.id)}</div>'">` : `<div class="logo-fallback">${esc(s.id)}</div>`}
        <div class="meta"><span class="name">${esc(s.name)}</span>
          ${progressBar(owned, total)}
          <span class="count">${owned} van ${total}${official && official !== total ? ` · ${official} officieel` : ''}</span></div></a>`;
    }

    Promise.all([KK.getSeries(lang), KK.getSets(lang)]).then(([series, sets]) => {
      if (!alive) return;
      const allSets = sets || [];
      const list = (series || []).slice().reverse(); // nieuwste reeks eerst
      if (!openSeries.size && list[0]) openSeries.add(list[0].id);

      function renderSeries() {
        area.innerHTML = list.length ? list.map((s) => `
          <section class="serie" data-serie="${esc(s.id)}">
            <button class="serie-head" aria-expanded="${openSeries.has(s.id)}">
              <h2>${esc(s.name)}</h2><span class="chev" aria-hidden="true">›</span></button>
            <div class="set-list" ${openSeries.has(s.id) ? '' : 'hidden'}></div>
          </section>`).join('') : '<div class="empty">Geen sets gevonden in deze taal.</div>';
        area.querySelectorAll('.serie').forEach((sec) => {
          const id = sec.dataset.serie;
          const btn = sec.querySelector('.serie-head');
          const box = sec.querySelector('.set-list');
          const fill = () => {
            if (box.dataset.loaded) return;
            box.innerHTML = '<div class="spinner"></div>';
            KK.getSerie(lang, id).then((full) => {
              const ss = (full.sets || []).slice().reverse();
              box.innerHTML = ss.length ? ss.map(setRow).join('') : '<div class="muted small">Geen sets.</div>';
              box.dataset.loaded = '1';
            }).catch((e) => { box.innerHTML = KK.errorBox(e); });
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
        area.innerHTML = hits.length ? `<div class="set-list">${hits.map(setRow).join('')}</div>` : '<div class="empty">Geen set met die naam.</div>';
      }

      search.addEventListener('input', () => { const q = search.value.trim(); q ? renderSearch(q) : renderSeries(); });
      renderSeries();
    }).catch((e) => { if (alive) area.innerHTML = KK.errorBox(e); });

    return () => { alive = false; };
  };

  // ---------- Weergave: één set ----------
  const setFilter = { mode: 'all', quick: store.get('kk-quick', false) };
  KK.views.set = (el, setId) => {
    const lang = KK.settings.lang;
    el.innerHTML = '<div class="spinner"></div>';
    let alive = true;
    let set = null;

    function counts() {
      const total = set.cards.length;
      const owned = set.cards.filter((c) => KK.qty(lang, c.id) > 0).length;
      return { total, owned, official: (set.cardCount && set.cardCount.official) || total };
    }

    function cardHtml(c) {
      const q = KK.qty(lang, c.id);
      const img = KK.cardImg(c, 'low');
      return `<button class="card${q ? '' : ' missing'}" data-id="${esc(c.id)}" aria-label="${esc(c.name)} ${esc(c.localId)}, ${q ? q + ' in bezit' : 'ontbreekt'}">
        <div class="art">${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : `<div class="noimg">${esc(c.name)}<br>${esc(c.localId)}</div>`}
          ${q ? `<span class="qty">${q}</span>` : ''}</div>
        <div class="cap"><span class="nm">${esc(c.name)}</span><span class="num">${esc(c.localId)}</span></div></button>`;
    }

    function renderHead() {
      const { total, owned, official } = counts();
      el.querySelector('#set-count').innerHTML = `${owned}<small> / ${total} kaarten</small>`;
      el.querySelector('#set-bar').innerHTML = progressBar(owned, total);
      el.querySelector('#set-sub').textContent = total - owned === 0 ? 'Compleet!' : `Nog ${total - owned} te gaan` + (official !== total ? ` · ${official} officieel genummerd` : '');
    }

    function renderGrid() {
      const grid = el.querySelector('#grid');
      const list = set.cards.filter((c) => {
        const q = KK.qty(lang, c.id);
        return setFilter.mode === 'all' || (setFilter.mode === 'missing' ? q === 0 : q > 0);
      });
      grid.innerHTML = list.length ? list.map(cardHtml).join('')
        : `<div class="empty" style="grid-column:1/-1">${setFilter.mode === 'missing' ? 'Je hebt alles uit deze set!' : 'Nog geen kaarten uit deze set.'}</div>`;
    }

    function refreshCard(id) {
      const b = el.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
      const c = set.cards.find((x) => x.id === id);
      if (b && c) {
        const q = KK.qty(lang, id);
        const hide = (setFilter.mode === 'missing' && q > 0) || (setFilter.mode === 'owned' && q === 0);
        if (hide) b.remove(); else b.outerHTML = cardHtml(c);
      }
      renderHead();
    }

    KK.getSet(lang, setId).then((s) => {
      if (!alive) return;
      set = s; set.cards = set.cards || [];
      const logo = KK.setLogo(set);
      el.innerHTML = `
        <a href="#/sets" class="muted small" style="text-decoration:none">‹ Alle sets</a>
        <section class="set-hero">
          <div class="set-hero-top">
            ${logo ? `<img src="${esc(logo)}" alt="" onerror="this.remove()">` : ''}
            <div style="min-width:0"><div class="eyebrow">${esc(set.serie ? set.serie.name : '')}${set.releaseDate ? ' · ' + esc(set.releaseDate.slice(0, 4)) : ''}</div>
            <h1>${esc(set.name)}</h1></div>
          </div>
          <div class="big-count" id="set-count"></div>
          <div id="set-bar"></div>
          <div class="muted small" id="set-sub"></div>
        </section>
        <div class="toolbar">
          <div class="chips" role="group" aria-label="Filter">
            <button class="chip" data-mode="all">Alles</button>
            <button class="chip" data-mode="missing">Ontbrekend</button>
            <button class="chip" data-mode="owned">In bezit</button>
          </div>
          <div class="chips">
            <button class="chip" id="quick" title="Tik een kaart om hem meteen af te vinken">Snel afvinken</button>
            <button class="chip" id="copy-missing">Kopieer lijst ontbrekend</button>
          </div>
        </div>
        <div class="card-grid" id="grid"></div>`;

      const syncChips = () => {
        el.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.mode === setFilter.mode));
        el.querySelector('#quick').setAttribute('aria-pressed', setFilter.quick);
      };
      el.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { setFilter.mode = b.dataset.mode; syncChips(); renderGrid(); }));
      el.querySelector('#quick').addEventListener('click', () => { setFilter.quick = !setFilter.quick; store.set('kk-quick', setFilter.quick); syncChips(); KK.toast(setFilter.quick ? 'Snel afvinken aan: tik = in bezit / weg' : 'Snel afvinken uit'); });
      el.querySelector('#copy-missing').addEventListener('click', () => {
        const miss = set.cards.filter((c) => KK.qty(lang, c.id) === 0);
        if (!miss.length) return KK.toast('Je mist niets in deze set');
        const { official } = counts();
        KK.copyText(`Ik zoek nog uit ${set.name} (${KK.langName(lang)}):\n` + miss.map((c) => `${c.localId}/${official} ${c.name}`).join('\n'));
      });
      el.querySelector('#grid').addEventListener('click', (e) => {
        const b = e.target.closest('.card'); if (!b) return;
        const id = b.dataset.id;
        const q = KK.qty(lang, id);
        if (setFilter.quick && q <= 1) { KK.setQty(lang, id, q ? 0 : 1); return; }
        KK.showCard(lang, set.cards.find((c) => c.id === id), set);
      });
      syncChips(); renderHead(); renderGrid();
    }).catch((e) => { if (alive) el.innerHTML = KK.errorBox(e); });

    const onChange = (e) => {
      if (!set) return;
      const d = e.detail || {};
      if (d.cardId && d.lang === lang) refreshCard(d.cardId); else if (d.merged) { renderHead(); renderGrid(); }
    };
    document.addEventListener('kk-change', onChange);
    return () => { alive = false; document.removeEventListener('kk-change', onChange); };
  };

  // ---------- Kaartdetail ----------
  KK.showCard = (lang, card, set) => {
    if (!card) return;
    const official = set && set.cardCount ? set.cardCount.official : '';
    const img = KK.cardImg(card, 'high');
    KK.openSheet(`
      <div class="detail">
        <div>${img ? `<img src="${KK.esc(img)}" alt="${KK.esc(card.name)}">` : `<div class="card"><div class="art"><div class="noimg">Geen afbeelding</div></div></div>`}</div>
        <div class="info">
          <div class="eyebrow">${KK.esc(set ? set.name : KK.setIdOf(card.id))} · ${KK.esc(KK.langName(lang))}</div>
          <h2 id="sheet-title" style="font-size:22px">${KK.esc(card.name)}</h2>
          <div class="num muted">Nummer ${KK.esc(card.localId)}${official ? ' / ' + official : ''}</div>
          <div id="card-extra" class="small muted"></div>
          <div class="eyebrow" style="margin-top:6px">Aantal in bezit</div>
          <div class="stepper"><button id="dec" aria-label="Eén minder">−</button><output id="q" class="num">${KK.qty(lang, card.id)}</output><button id="inc" aria-label="Eén meer">+</button></div>
          <a class="btn" target="_blank" rel="noopener" href="https://www.cardmarket.com/nl/Pokemon/Products/Search?searchString=${encodeURIComponent(card.name)}">Prijs op Cardmarket ↗</a>
        </div>
      </div>`, (body) => {
      const out = body.querySelector('#q');
      body.querySelector('#inc').addEventListener('click', () => { KK.setQty(lang, card.id, KK.qty(lang, card.id) + 1); out.textContent = KK.qty(lang, card.id); });
      body.querySelector('#dec').addEventListener('click', () => { KK.setQty(lang, card.id, KK.qty(lang, card.id) - 1); out.textContent = KK.qty(lang, card.id); });
      KK.getCard(lang, card.id).then((full) => {
        const bits = [];
        if (full.rarity) bits.push('Zeldzaamheid: ' + full.rarity);
        if (full.illustrator) bits.push('Illustratie: ' + full.illustrator);
        const v = full.variants;
        if (v) { const names = { normal: 'normaal', reverse: 'reverse holo', holo: 'holo', firstEdition: '1e editie' }; const vs = Object.keys(names).filter((k) => v[k]).map((k) => names[k]); if (vs.length) bits.push('Bestaat als: ' + vs.join(', ')); }
        const x = body.querySelector('#card-extra'); if (x) x.innerHTML = bits.map(KK.esc).join('<br>');
      }).catch(() => {});
    });
  };

  // ---------- Weergave: collectie ----------
  KK.views.collectie = (el) => {
    const byLang = {};
    let copies = 0, unique = 0;
    for (const k in col.items) {
      const it = col.items[k]; if (!it.q) continue;
      const i = k.indexOf('|'); const lang = k.slice(0, i); const cardId = k.slice(i + 1);
      const setId = KK.setIdOf(cardId);
      ((byLang[lang] = byLang[lang] || {})[setId] = (byLang[lang][setId] || 0) + 1);
      copies += it.q; unique++;
    }
    const langs = Object.keys(byLang);
    el.innerHTML = `
      <div><div class="eyebrow">Overzicht</div><h1>Mijn collectie</h1></div>
      <div class="stat-row">
        <div class="stat"><b>${unique}</b><span>verschillende kaarten</span></div>
        <div class="stat"><b>${copies}</b><span>exemplaren</span></div>
        <div class="stat"><b>${langs.length}</b><span>${langs.length === 1 ? 'taal' : 'talen'}</span></div>
      </div>
      <div id="col-area">${langs.length ? '' : `<div class="empty">Nog geen kaarten. Scan je eerste kaart of open een set en tik kaarten aan.<div style="margin-top:12px"><a class="btn primary" href="#/scan">Kaart scannen</a></div></div>`}</div>`;
    const area = el.querySelector('#col-area');
    let alive = true;
    langs.forEach((lang) => {
      const sec = document.createElement('section');
      sec.className = 'serie';
      sec.innerHTML = `<h2>${KK.esc(KK.langName(lang))}</h2><div class="set-list"><div class="spinner"></div></div>`;
      area.appendChild(sec);
      KK.getSets(lang).then((sets) => {
        if (!alive) return;
        const map = {}; sets.forEach((s, i) => { map[s.id] = Object.assign({ order: i }, s); });
        const ids = Object.keys(byLang[lang]).sort((a, b) => ((map[b] || {}).order || 0) - ((map[a] || {}).order || 0));
        sec.querySelector('.set-list').innerHTML = ids.map((id) => {
          const s = map[id] || { id, name: id, cardCount: {} };
          const total = (s.cardCount && (s.cardCount.total || s.cardCount.official)) || 0;
          const owned = byLang[lang][id];
          const logo = KK.setLogo(s);
          return `<a class="set-row" href="#/set/${encodeURIComponent(id)}" data-lang="${KK.esc(lang)}">
            ${logo ? `<img class="logo" src="${KK.esc(logo)}" alt="" loading="lazy">` : `<div class="logo-fallback">${KK.esc(id)}</div>`}
            <div class="meta"><span class="name">${KK.esc(s.name)}</span>${progressBar(owned, total)}
            <span class="count">${owned} van ${total || '?'} · mist nog ${Math.max(0, total - owned)}</span></div></a>`;
        }).join('');
        sec.querySelectorAll('a[data-lang]').forEach((a) => a.addEventListener('click', () => KK.setLang(a.dataset.lang)));
      }).catch((e) => { sec.querySelector('.set-list').innerHTML = KK.errorBox(e); });
    });
    return () => { alive = false; };
  };

  // ---------- Weergave: instellingen ----------
  let installEvt = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; const b = document.getElementById('install'); if (b) b.hidden = false; });

  KK.views.instellingen = (el) => {
    el.innerHTML = `
      <div><div class="eyebrow">Instellingen</div><h1>Instellingen</h1></div>
      <section class="panel">
        <h2>App op je gsm</h2>
        <p class="muted small" style="margin:0">Installeer Kaartkluis op je startscherm. Hij werkt dan als een gewone app, ook offline voor sets die je al eens opende.</p>
        <div class="btn-row"><button class="btn primary" id="install" ${installEvt ? '' : 'hidden'}>Installeren</button></div>
        <p class="muted small" style="margin:0" id="install-hint">${installEvt ? '' : 'In Chrome: menu ⋮ → <b>App installeren</b> of <b>Toevoegen aan startscherm</b>.'}</p>
      </section>
      <section class="panel">
        <h2>Weergave</h2>
        <label class="small" for="theme">Thema</label>
        <select id="theme" class="input"><option value="system">Zoals mijn toestel</option><option value="light">Licht</option><option value="dark">Donker</option></select>
      </section>
      <section class="panel" id="sync-panel"><h2>Synchroniseren</h2><div class="spinner"></div></section>
      <section class="panel">
        <h2>Back-up</h2>
        <p class="muted small" style="margin:0">Bewaar je collectie als bestand, of zet een eerdere back-up terug (wordt samengevoegd met wat je al hebt).</p>
        <div class="btn-row"><button class="btn" id="export">Back-up downloaden</button>
          <label class="btn" for="import-file">Back-up terugzetten</label><input id="import-file" type="file" accept="application/json,.json" hidden></div>
      </section>
      <section class="panel">
        <h2>Over</h2>
        <p class="muted small" style="margin:0">Kaartgegevens en afbeeldingen komen van TCGdex, een gratis open databank. Deze app is niet verbonden aan Nintendo, Creatures, GAME FREAK of The Pokémon Company.</p>
      </section>`;
    const th = el.querySelector('#theme');
    th.value = KK.settings.theme;
    th.addEventListener('change', () => { KK.settings.theme = th.value; KK.saveSettings(); applyTheme(); });
    el.querySelector('#install').addEventListener('click', async () => {
      if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice.catch(() => {}); installEvt = null; el.querySelector('#install').hidden = true;
    });
    el.querySelector('#export').addEventListener('click', () => {
      const data = JSON.stringify({ app: 'kaartkluis', version: 1, exported: new Date().toISOString(), items: col.items });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
      a.download = 'kaartkluis-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    });
    el.querySelector('#import-file').addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const json = JSON.parse(await f.text());
        if (!json.items) throw new Error('geen collectie');
        const n = KK.mergeItems(json.items);
        KK.toast(n ? `${n} kaarten bijgewerkt` : 'Niets nieuws in deze back-up');
      } catch (err) { KK.toast('Dit bestand is geen Kaartkluis-back-up'); }
      e.target.value = '';
    });
    if (KK.renderSyncPanel) KK.renderSyncPanel(el.querySelector('#sync-panel'));
    else el.querySelector('#sync-panel').innerHTML = '<h2>Synchroniseren</h2><p class="muted small">Niet beschikbaar.</p>';
  };

  // ---------- Start ----------
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
  // Wacht tot scanner.js en sync.js geladen zijn (ze staan direct na dit script).
  window.addEventListener('DOMContentLoaded', route);
})();
