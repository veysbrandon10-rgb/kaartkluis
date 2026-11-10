/* Kaartkluis — synchroniseren via je eigen gratis Firebase-project, plus gezin/vrienden vergelijken */
(function () {
  'use strict';
  const KK = window.KK;
  const esc = KK.esc;
  const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';

  const S = { state: 'off', user: null, lastSync: null, error: '', db: null, auth: null, docRef: null, unsub: null, remote: {} };
  let pushTimer = null, panelEl = null, familyEl = null;

  function parseConfig(text) {
    const cfg = {};
    const re = /["']?(apiKey|authDomain|projectId|storageBucket|messagingSenderId|appId|measurementId)["']?\s*:\s*["']([^"']+)["']/g;
    let m; while ((m = re.exec(text))) cfg[m[1]] = m[2];
    return cfg.apiKey && cfg.projectId && cfg.authDomain && cfg.appId ? cfg : null;
  }
  const getConfig = () => KK.store.get('kk-firebase', null) || (window.KK_FIREBASE_CONFIG && window.KK_FIREBASE_CONFIG.apiKey ? window.KK_FIREBASE_CONFIG : null);

  const enc = (k) => k.replace(/\./g, '~');
  const dec = (k) => k.replace(/~/g, '.');
  function toRemote(items) { const o = {}; for (const k in items) o[enc(k)] = items[k].m ? [items[k].q, items[k].t, items[k].m] : [items[k].q, items[k].t]; return o; }
  function fromRemote(o) { const items = {}; for (const k in (o || {})) { const v = o[k]; if (Array.isArray(v)) items[dec(k)] = v[2] ? { q: v[0], t: v[1], m: v[2] } : { q: v[0], t: v[1] }; } return items; }
  KK.fromRemote = fromRemote;

  function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Firebase kon niet laden')); document.head.appendChild(s); }); }
  function setState(state, extra) { Object.assign(S, { state }, extra || {}); renderPanel(); }

  async function init() {
    const cfg = getConfig();
    if (!cfg) { setState('off'); return; }
    try {
      setState('loading');
      if (!window.firebase) {
        await loadScript(FB + 'firebase-app-compat.js');
        await loadScript(FB + 'firebase-auth-compat.js');
        await loadScript(FB + 'firebase-firestore-compat.js');
      }
      const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(cfg);
      S.auth = app.auth(); S.db = app.firestore();
      try { S.db.enablePersistence({ synchronizeTabs: true }).catch(() => {}); } catch (e) {}
      S.auth.getRedirectResult().catch((e) => setState('error', { error: explain(e) }));
      S.auth.onAuthStateChanged((user) => {
        if (S.unsub) { S.unsub(); S.unsub = null; }
        if (!user) { setState('signedout', { user: null, docRef: null, remote: {} }); return; }
        S.user = user;
        S.docRef = S.db.collection('collections').doc(user.uid);
        setState('syncing');
        S.unsub = S.docRef.onSnapshot((snap) => {
          if (snap.metadata.hasPendingWrites) return;
          const data = snap.exists ? snap.data() : {};
          S.remote = { friends: data.friends || [], following: data.following || [], name: data.name || '' };
          const remote = fromRemote(data.items);
          KK.mergeItems(remote);
          const local = KK.collection.items;
          const needsPush = !snap.exists || !data.name || Object.keys(local).some((k) => !remote[k] || (local[k].t || 0) > (remote[k].t || 0));
          if (needsPush) schedulePush(300); else setState('on', { lastSync: new Date(), error: '' });
        }, (e) => setState('error', { error: explain(e) }));
      });
    } catch (e) { setState('error', { error: explain(e) }); }
  }

  function explain(e) {
    const c = (e && e.code) || '';
    if (c.includes('unauthorized-domain')) return 'Dit webadres staat nog niet bij "Authorized domains" in Firebase (Authentication → Settings).';
    if (c.includes('configuration-not-found')) return 'Google-aanmelden staat nog niet aan in Firebase (Authentication → Sign-in method → Google).';
    if (c.includes('permission-denied')) return 'Firestore weigert toegang. Plak de nieuwste beveiligingsregels (knop hieronder) in Firestore → Regels.';
    if (c.includes('popup-closed')) return 'Aanmelden afgebroken.';
    if (c.includes('operation-not-allowed')) return 'Zet Google aan als aanmeldmethode in Firebase (Authentication → Sign-in method).';
    if (c.includes('api-key')) return 'De Firebase-config klopt niet. Plak hem opnieuw.';
    return (e && e.message) || 'Onbekende fout';
  }

  function schedulePush(ms) { if (!S.docRef) return; clearTimeout(pushTimer); pushTimer = setTimeout(push, ms == null ? 1500 : ms); }
  async function push() {
    if (!S.docRef) return;
    setState('syncing');
    try {
      await S.db.runTransaction(async (tx) => {
        const snap = await tx.get(S.docRef);
        if (snap.exists) KK.mergeItems(fromRemote(snap.data().items));
        tx.set(S.docRef, { items: toRemote(KK.collection.items), name: S.user.displayName || S.user.email || 'Verzamelaar', updated: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
      });
      setState('on', { lastSync: new Date(), error: '' });
    } catch (e) {
      setState(navigator.onLine ? 'error' : 'on', { error: navigator.onLine ? explain(e) : 'Offline — wordt later gesynchroniseerd.' });
      if (!navigator.onLine) window.addEventListener('online', () => schedulePush(500), { once: true });
    }
  }
  document.addEventListener('kk-change', (e) => { if (e.detail && e.detail.local) schedulePush(); });

  async function signIn() {
    const provider = new firebase.auth.GoogleAuthProvider();
    try { await S.auth.signInWithPopup(provider); }
    catch (e) {
      if (/popup-blocked|operation-not-supported|web-storage/.test(e.code || '')) await S.auth.signInWithRedirect(provider);
      else setState('error', { error: explain(e) });
    }
  }

  KK.FIRESTORE_RULES = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /collections/{uid} {
      allow read: if request.auth != null
        && (request.auth.uid == uid || request.auth.uid in resource.data.get('friends', []));
      allow write: if request.auth != null && request.auth.uid == uid;
    }
  }
}`;

  // ---------- Paneel: synchroniseren ----------
  function renderPanel() {
    renderFamily();
    if (!panelEl || !panelEl.isConnected) return;
    const p = panelEl;
    const dot = S.state === 'on' ? 'on' : S.state === 'error' ? 'err' : '';
    const time = S.lastSync ? S.lastSync.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' }) : '';
    if (S.state === 'off') {
      p.innerHTML = `<h2>Synchroniseren</h2>
        <p class="muted small" style="margin:0">Zet je collectie gelijk op gsm, tablet en pc via een gratis Firebase-project (uitleg in LEESMIJ). Zonder dit blijft alles gewoon op dit toestel bewaard.</p>
        <label class="small" for="fb-config">Plak hier je Firebase-config</label>
        <textarea id="fb-config" class="input" placeholder="apiKey: &quot;…&quot;,\nauthDomain: &quot;…&quot;,\nprojectId: &quot;…&quot;,\nappId: &quot;…&quot;"></textarea>
        <div class="btn-row"><button class="btn primary" id="fb-save">Opslaan en verbinden</button><button class="btn" id="fb-rules">Kopieer beveiligingsregels</button></div>`;
      p.querySelector('#fb-save').addEventListener('click', () => {
        const cfg = parseConfig(p.querySelector('#fb-config').value);
        if (!cfg) return KK.toast('Dit lijkt geen volledige Firebase-config (apiKey, authDomain, projectId, appId).');
        KK.store.set('kk-firebase', cfg); init();
      });
      p.querySelector('#fb-rules').addEventListener('click', () => KK.copyText(KK.FIRESTORE_RULES));
      return;
    }
    const labels = { loading: 'Verbinden…', signedout: 'Niet aangemeld', syncing: 'Synchroniseren…', on: 'Gesynchroniseerd' + (time ? ' om ' + time : ''), error: 'Probleem' };
    p.innerHTML = `<h2>Synchroniseren</h2>
      <div><span class="sync-dot ${dot}"></span><b>${esc(labels[S.state] || '')}</b>${S.user ? ` <span class="muted small">· ${esc(S.user.email || '')}</span>` : ''}</div>
      ${S.error ? `<p class="small" style="margin:0;color:var(--warn)">${esc(S.error)}</p>` : ''}
      <div class="btn-row">
        ${!S.user && (S.state === 'signedout' || S.state === 'error') ? '<button class="btn primary" id="fb-in">Aanmelden met Google</button>' : ''}
        ${S.user ? '<button class="btn" id="fb-now">Nu synchroniseren</button><button class="btn" id="fb-out">Afmelden</button>' : ''}
        <button class="btn" id="fb-rules">Kopieer beveiligingsregels</button>
        ${KK.store.get('kk-firebase', null) ? '<button class="btn" id="fb-reset">Firebase loskoppelen</button>' : ''}
      </div>
      <p class="muted small" style="margin:0">Elk gezinslid meldt zich aan met een eigen Google-account en krijgt zo een eigen collectie.</p>`;
    const on = (id, fn) => { const b = p.querySelector(id); if (b) b.addEventListener('click', fn); };
    on('#fb-in', signIn);
    on('#fb-now', () => push());
    on('#fb-out', () => S.auth && S.auth.signOut());
    on('#fb-rules', () => KK.copyText(KK.FIRESTORE_RULES));
    on('#fb-reset', () => {
      if (S.unsub) S.unsub(); if (S.auth) S.auth.signOut().catch(() => {});
      localStorage.removeItem('kk-firebase');
      setState('off', { user: null, docRef: null, error: '' });
      KK.toast('Ontkoppeld. Laad de app opnieuw om Firebase volledig te sluiten.');
    });
  }

  // ---------- Gezin & vrienden ----------
  async function addFriend(code, name) {
    code = code.trim();
    if (!S.docRef) throw new Error('Meld je eerst aan.');
    if (!/^[A-Za-z0-9]{20,40}$/.test(code)) throw new Error('Dat is geen geldige vriendcode.');
    if (code === S.user.uid) throw new Error('Dat is je eigen code.');
    const following = (S.remote.following || []).filter((f) => f.uid !== code).concat([{ uid: code, name: name || 'Vriend' }]);
    await S.docRef.set({ friends: firebase.firestore.FieldValue.arrayUnion(code), following }, { merge: true });
  }
  async function removeFriend(code) {
    const following = (S.remote.following || []).filter((f) => f.uid !== code);
    await S.docRef.set({ friends: firebase.firestore.FieldValue.arrayRemove(code), following }, { merge: true });
  }

  function renderFamily() {
    if (!familyEl || !familyEl.isConnected) return;
    if (!S.user) { familyEl.hidden = true; return; }
    familyEl.hidden = false;
    const fl = S.remote.following || [];
    familyEl.innerHTML = `<h2>Gezin &amp; vrienden</h2>
      <p class="muted small" style="margin:0">Vergelijk collecties: wie heeft een dubbel die een ander zoekt? Geef elkaar je vriendcode en voeg elkaars code toe. Pas als jullie dat <b>allebei</b> gedaan hebben, kunnen jullie elkaars collectie zien. Iedereen moet dezelfde Firebase-config gebruiken.</p>
      <div class="small">Jouw vriendcode</div>
      <div class="manual"><input class="input num" id="my-code" readonly value="${esc(S.user.uid)}" aria-label="Jouw vriendcode"><button class="btn" id="copy-code">Kopieer</button></div>
      <form class="add-friend" id="add-friend">
        <input class="input" id="fr-name" placeholder="Naam (bv. Brandon)" aria-label="Naam van je vriend" autocomplete="off">
        <input class="input" id="fr-code" placeholder="Vriendcode van de ander" aria-label="Vriendcode" autocomplete="off">
        <button class="btn primary" type="submit">Toevoegen</button></form>
      ${fl.length ? `<div class="results">${fl.map((f) => `<div class="result friend"><span class="avatar">${esc((f.name || '?').charAt(0).toUpperCase())}</span><div class="meta"><b>${esc(f.name)}</b><span class="small muted num">${esc(f.uid.slice(0, 8))}…</span></div><button class="btn" data-rm="${esc(f.uid)}">Verwijder</button></div>`).join('')}</div>` : '<div class="muted small">Nog niemand toegevoegd.</div>'}`;
    familyEl.querySelector('#copy-code').addEventListener('click', () => KK.copyText(S.user.uid));
    familyEl.querySelector('#add-friend').addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await addFriend(familyEl.querySelector('#fr-code').value, familyEl.querySelector('#fr-name').value.trim()); KK.toast('Toegevoegd. Vraag de ander om jouw code ook toe te voegen.'); }
      catch (err) { KK.toast(err.message || 'Toevoegen lukte niet'); }
    });
    familyEl.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', async () => {
      if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Zeker?'; return; }
      try { await removeFriend(b.dataset.rm); KK.toast('Verwijderd'); } catch (err) { KK.toast('Verwijderen lukte niet'); }
    }));
  }

  KK.renderSyncPanel = (el, fam) => { panelEl = el; familyEl = fam || null; renderPanel(); };

  // ---------- Vergelijken ----------
  function summarize(items) {
    const m = new Map();
    for (const k in items) {
      const it = items[k]; if (!it.q) continue;
      const p = KK.parseKey(k); const key = p.lang + '|' + p.id;
      const e = m.get(key) || { lang: p.lang, id: p.id, total: 0, spare: 0, want: false, trade: false, byCode: {} };
      if (p.code === 'want') e.want = true;
      else if (p.code === 'trade') e.trade = true;
      else if (KK.isVar(p.code)) { e.total += it.q; e.byCode[p.code] = it.q; }
      m.set(key, e);
    }
    m.forEach((e) => { e.spare = e.trade ? e.total : Object.values(e.byCode).reduce((s, q) => s + Math.max(0, q - 1), 0); });
    return m;
  }

  let compareWith = null;
  KK.renderCompare = (area) => {
    if (!S.user) {
      area.innerHTML = `<div class="empty">Om collecties te vergelijken moet synchroniseren aanstaan en moet je aangemeld zijn.<div style="margin-top:12px"><a class="btn primary" href="#/instellingen">Naar instellingen</a></div></div>`;
      return;
    }
    const fl = S.remote.following || [];
    if (!fl.length) {
      area.innerHTML = `<div class="empty">Voeg eerst een gezinslid of vriend toe via Instellingen → Gezin &amp; vrienden.<div style="margin-top:12px"><a class="btn primary" href="#/instellingen">Vriend toevoegen</a></div></div>`;
      return;
    }
    if (!compareWith || !fl.some((f) => f.uid === compareWith)) compareWith = fl[0].uid;
    area.innerHTML = `<div class="chips">${fl.map((f) => `<button class="chip" data-who="${esc(f.uid)}" aria-pressed="${f.uid === compareWith}">${esc(f.name)}</button>`).join('')}</div>
      <div id="cmp"><div class="spinner"></div></div>`;
    area.querySelectorAll('[data-who]').forEach((b) => b.addEventListener('click', () => { compareWith = b.dataset.who; KK.renderCompare(area); }));
    const friend = fl.find((f) => f.uid === compareWith);
    const box = area.querySelector('#cmp');
    S.db.collection('collections').doc(compareWith).get().then(async (snap) => {
      if (!snap.exists) { box.innerHTML = `<div class="empty">${esc(friend.name)} heeft nog niets gesynchroniseerd.</div>`; return; }
      const theirs = summarize(fromRemote(snap.data().items));
      const mine = summarize(KK.collection.items);
      const get = [], give = [];
      theirs.forEach((t, k) => { const m = mine.get(k); if (t.spare > 0 && (!m || !m.total || m.want)) get.push(t); });
      mine.forEach((m, k) => { const t = theirs.get(k); if (m.spare > 0 && (!t || !t.total || t.want)) give.push(m); });
      let theirTotal = 0; theirs.forEach((t) => { if (t.total) theirTotal++; });
      const all = get.concat(give); const byL = {}; all.forEach((x) => { (byL[x.lang] = byL[x.lang] || new Set()).add(x.id); });
      const paint = () => {
        const fn = esc(friend.name);
        const row = (x, other) => KK.listRow(x.lang, x.id, null, `<b>${x.spare}× over</b>${other && other.want ? `<br><span style="color:var(--accent)">${'op verlanglijst'}</span>` : ''}`);
        box.innerHTML = `<div class="muted small">${fn} heeft ${theirTotal} verschillende kaarten.</div>
          <h2 style="margin-top:12px">${fn} heeft over, en jij mist het</h2>
          <div class="results" id="get">${get.length ? get.map((x) => row(x, mine.get(x.lang + '|' + x.id))).join('') : '<div class="muted small">Niets gevonden.</div>'}</div>
          <h2 style="margin-top:16px">Jij hebt over, en ${fn} mist het</h2>
          <div class="results" id="give">${give.length ? give.map((x) => row(x, theirs.get(x.lang + '|' + x.id))).join('') : '<div class="muted small">Niets gevonden.</div>'}</div>
          ${get.length || give.length ? '<div class="btn-row" style="margin-top:12px"><button class="btn" id="cmp-copy">Kopieer als ruilvoorstel</button></div>' : ''}`;
        KK.openFromRow(box.querySelector('#get')); KK.openFromRow(box.querySelector('#give'));
        const c = box.querySelector('#cmp-copy');
        if (c) c.addEventListener('click', () => KK.copyText(`Ruilvoorstel met ${friend.name}\n\nIk krijg:\n${get.map((x) => KK.lineText(x.lang, x.id)).join('\n') || '-'}\n\nIk geef:\n${give.map((x) => KK.lineText(x.lang, x.id)).join('\n') || '-'}`));
      };
      paint();
      await KK.detailsReady;
      for (const l of Object.keys(byL)) { if (!box.isConnected) return; await KK.details.ensure(l, [...byL[l]]); }
      if (box.isConnected) paint();
    }).catch((e) => {
      box.innerHTML = `<div class="empty">${e && e.code && e.code.includes('permission') ? `Je kunt de collectie van ${esc(friend.name)} nog niet zien. Vraag ${esc(friend.name)} om jouw vriendcode toe te voegen, en controleer of de nieuwste beveiligingsregels in Firebase staan.` : 'Ophalen lukte niet. Controleer je internet.'}</div>`;
    });
  };

  init();
})();
