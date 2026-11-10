/* Kaartkluis — Pokédex: elke Pokémon als silhouet, ingekleurd zodra je er een kaart van hebt */
(function () {
  'use strict';
  const KK = window.KK;
  const esc = KK.esc;
  const TOTAL = 1025;
  const GENS = [[1, 151], [152, 251], [252, 386], [387, 493], [494, 649], [650, 721], [722, 809], [810, 905], [906, 1025]];
  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'];
  const SPECIAL = { 'mr-mime': 'Mr. Mime', 'mime-jr': 'Mime Jr.', 'mr-rime': 'Mr. Rime', farfetchd: "Farfetch'd", sirfetchd: "Sirfetch'd", 'nidoran-f': 'Nidoran♀', 'nidoran-m': 'Nidoran♂', 'ho-oh': 'Ho-Oh', 'porygon-z': 'Porygon-Z', 'type-null': 'Type: Null', 'jangmo-o': 'Jangmo-o', 'hakamo-o': 'Hakamo-o', 'kommo-o': 'Kommo-o', flabebe: 'Flabébé', 'wo-chien': 'Wo-Chien', 'chien-pao': 'Chien-Pao', 'ting-lu': 'Ting-Lu', 'chi-yu': 'Chi-Yu' };
  const pretty = (slug) => SPECIAL[slug] || slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  const sprite = (n) => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${n}.png`;

  let speciesP = null;
  function species() {
    if (speciesP) return speciesP;
    const cached = KK.store.get('kk-species', null);
    if (cached && cached.length >= 1000) return (speciesP = Promise.resolve(cached));
    speciesP = fetch('https://pokeapi.co/api/v2/pokemon-species?limit=' + TOTAL).then((r) => { if (!r.ok) throw new Error('fout ' + r.status); return r.json(); })
      .then((j) => { const list = j.results.map((x) => { const id = +x.url.split('/').filter(Boolean).pop(); return [id, pretty(x.name)]; }).sort((a, b) => a[0] - b[0]); KK.store.set('kk-species', list); return list; });
    speciesP.catch(() => { speciesP = null; });
    return speciesP;
  }

  // welke Pokédex-nummers heb je (alle talen samen) → nummer → lijst {lang,id}
  function ownedDex() {
    const map = new Map(); const seen = new Set();
    KK.collectionKeys((p) => KK.isVar(p.code)).forEach((k) => {
      const p = KK.parseKey(k); const key = p.lang + '|' + p.id; if (seen.has(key)) return; seen.add(key);
      const d = KK.details.get(p.lang, p.id); if (!d || !d.d) return;
      d.d.forEach((n) => { if (!map.has(n)) map.set(n, []); map.get(n).push(p); });
    });
    return map;
  }

  const ui = { gen: 0, filter: 'all', q: '' };

  KK.views.pokedex = (el) => {
    el.innerHTML = `
      <div><div class="eyebrow">Alle Pokémon</div><h1>Pokédex</h1></div>
      <section class="set-hero"><div class="big-count" id="dex-count">…</div><div id="dex-bar"></div><div class="muted small" id="dex-status"></div></section>
      <input id="dex-search" class="input" type="search" placeholder="Zoek een Pokémon of nummer" autocomplete="off" aria-label="Zoek een Pokémon">
      <div class="chips" id="gen-chips" role="group" aria-label="Generatie"></div>
      <div class="chips" role="group" aria-label="Filter">
        <button class="chip" data-f="all">Alles</button><button class="chip" data-f="have">Heb ik</button><button class="chip" data-f="miss">Mis ik</button></div>
      <div class="dex-grid" id="dex-grid"><div class="spinner" style="grid-column:1/-1"></div></div>`;
    let alive = true, list = [], owned = new Map();
    const abort = new AbortController();
    const grid = el.querySelector('#dex-grid');
    const genChips = el.querySelector('#gen-chips');
    genChips.innerHTML = `<button class="chip" data-g="0">Alle</button>` + ROMAN.map((r, i) => `<button class="chip" data-g="${i + 1}">Gen ${r}</button>`).join('');

    const syncChips = () => {
      genChips.querySelectorAll('[data-g]').forEach((b) => b.setAttribute('aria-pressed', +b.dataset.g === ui.gen));
      el.querySelectorAll('[data-f]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.f === ui.filter));
    };
    genChips.addEventListener('click', (e) => { const b = e.target.closest('[data-g]'); if (!b) return; ui.gen = +b.dataset.g; syncChips(); render(); });
    el.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => { ui.filter = b.dataset.f; syncChips(); render(); }));
    const search = el.querySelector('#dex-search'); search.value = ui.q;
    search.addEventListener('input', () => { ui.q = search.value.trim().toLowerCase(); render(); });
    syncChips();

    function paintCount() {
      const n = owned.size;
      el.querySelector('#dex-count').innerHTML = `${n}<small> / ${list.length || TOTAL} Pokémon</small>`;
      el.querySelector('#dex-bar').innerHTML = KK.progressBar(n, list.length || TOTAL);
    }

    function render() {
      if (!list.length) return;
      const [lo, hi] = ui.gen ? GENS[ui.gen - 1] : [1, TOTAL];
      const rows = list.filter(([id, name]) => id >= lo && id <= hi
        && (ui.filter === 'all' || (ui.filter === 'have') === owned.has(id))
        && (!ui.q || name.toLowerCase().includes(ui.q) || String(id) === ui.q.replace(/^#?0*/, '')));
      grid.innerHTML = rows.length ? rows.map(([id, name]) => {
        const has = owned.get(id);
        return `<button class="dex${has ? ' have' : ''}" data-dex="${id}" aria-label="${esc(name)}${has ? ', ' + has.length + ' kaarten' : ', nog geen kaart'}">
          <img src="${sprite(id)}" alt="" loading="lazy" width="96" height="96">
          <span class="dex-no num">#${String(id).padStart(4, '0')}</span><span class="dex-name">${esc(name)}</span>
          ${has ? `<span class="qty">${has.length}</span>` : ''}</button>`;
      }).join('') : '<div class="empty" style="grid-column:1/-1">Geen Pokémon gevonden.</div>';
    }

    grid.addEventListener('click', (e) => {
      const b = e.target.closest('[data-dex]'); if (!b) return;
      const id = +b.dataset.dex; const name = (list.find((x) => x[0] === id) || [id, '#' + id])[1];
      openSpecies(id, name, owned.get(id) || []);
    });

    species().then((l) => {
      if (!alive) return; list = l; owned = ownedDex(); paintCount(); render();
      // details van je kaarten laden om ze aan Pokémon te koppelen
      const keys = KK.collectionKeys((p) => KK.isVar(p.code)).map(KK.parseKey);
      const byL = {}; keys.forEach((p) => { (byL[p.lang] = byL[p.lang] || new Set()).add(p.id); });
      const status = el.querySelector('#dex-status');
      KK.detailsReady.then(async () => {
        for (const l of Object.keys(byL)) {
          if (!alive) return;
          await KK.details.ensure(l, [...byL[l]], (d, t) => { if (alive && d < t) status.textContent = `Je kaarten koppelen aan Pokémon… ${d}/${t}`; }, abort.signal);
        }
        if (!alive) return; status.textContent = ''; owned = ownedDex(); paintCount(); render();
      });
    }).catch((e) => { if (alive) grid.innerHTML = '<div style="grid-column:1/-1">' + KK.errorBox(e) + '</div>'; });

    const onChange = () => { owned = ownedDex(); paintCount(); render(); };
    document.addEventListener('kk-change', onChange);
    return () => { alive = false; abort.abort(); document.removeEventListener('kk-change', onChange); };
  };

  function openSpecies(dex, name, have) {
    const lang = KK.settings.lang;
    const searchLang = KK.isLatin(lang) ? lang : 'en';
    KK.openSheet(`
      <div style="display:flex;gap:12px;align-items:center"><img src="${sprite(dex)}" alt="" width="72" height="72">
        <div><div class="eyebrow num">#${String(dex).padStart(4, '0')}</div><h2 id="sheet-title" style="font-size:22px">${esc(name)}</h2>
        <div class="muted small">${have.length ? have.length + (have.length === 1 ? ' kaart' : ' kaarten') + ' in je collectie' : 'Nog geen kaart van deze Pokémon'}</div></div></div>
      ${have.length ? `<div class="eyebrow" style="margin-top:14px">Jouw kaarten</div><div class="card-grid" id="sp-have" style="margin-top:8px">${have.map((p) => { const d = KK.details.get(p.lang, p.id); return KK.cardTile(p.lang, { id: p.id, name: d.n, localId: d.l, image: d.i }, { caption: d.sn + ' · ' + KK.langName(p.lang), noDots: true }); }).join('')}</div>` : ''}
      <div class="eyebrow" style="margin-top:14px">Alle kaarten in het ${esc(KK.langName(searchLang))}</div>
      ${searchLang !== lang ? `<div class="muted small">Zoeken op naam kan niet in het ${esc(KK.langName(lang))}; dit zijn de Engelse kaarten.</div>` : ''}
      <div id="sp-all" style="margin-top:8px"><div class="spinner"></div></div>`, (body) => {
      const haveBox = body.querySelector('#sp-have');
      if (haveBox) haveBox.addEventListener('click', (e) => {
        const b = e.target.closest('.card'); if (!b) return;
        const p = have.find((x) => x.id === b.dataset.id); const d = KK.details.get(p.lang, p.id);
        KK.showCard(p.lang, { id: p.id, name: d.n, localId: d.l, image: d.i }, { name: d.sn, cardCount: { official: d.so } });
      });
      const base = name.replace(/[♀♂]/g, '');
      const re = new RegExp('(^|[\\s\'’.])' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[\\s♀♂-])', 'i');
      Promise.all([KK.searchCards(searchLang, base), KK.getSets(searchLang)]).then(([cards, sets]) => {
        const box = body.querySelector('#sp-all'); if (!box) return;
        const setMap = {}; sets.forEach((s) => { setMap[s.id] = s; });
        const hits = (cards || []).filter((c) => re.test(c.name)).reverse();
        box.innerHTML = hits.length ? `<div class="muted small" style="margin-bottom:8px">${hits.length} kaarten</div><div class="card-grid">${hits.map((c) => { const s = setMap[KK.setIdOf(c.id)]; return KK.cardTile(searchLang, c, { caption: s ? s.name : c.name }); }).join('')}</div>` : '<div class="muted small">Geen kaarten gevonden.</div>';
        box.addEventListener('click', (e) => { const b = e.target.closest('.card'); if (!b) return; const c = hits.find((x) => x.id === b.dataset.id); KK.showCard(searchLang, c, setMap[KK.setIdOf(c.id)]); });
      }).catch((e) => { const box = body.querySelector('#sp-all'); if (box) box.innerHTML = KK.errorBox(e); });
    });
  }
})();
