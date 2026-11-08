/* Kaartkluis — synchroniseren via je eigen gratis Firebase-project (Google-login + Firestore) */
(function () {
  'use strict';
  const KK = window.KK;
  const esc = KK.esc;
  const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';

  const S = { state: 'off', user: null, lastSync: null, error: '', db: null, auth: null, docRef: null, unsub: null };
  let pushTimer = null;
  let panelEl = null;

  // Firebase-config plakken zoals de console hem toont (JavaScript-object) of als JSON
  function parseConfig(text) {
    const cfg = {};
    const re = /["']?(apiKey|authDomain|projectId|storageBucket|messagingSenderId|appId|measurementId)["']?\s*:\s*["']([^"']+)["']/g;
    let m; while ((m = re.exec(text))) cfg[m[1]] = m[2];
    return cfg.apiKey && cfg.projectId && cfg.authDomain && cfg.appId ? cfg : null;
  }

  const enc = (k) => k.replace(/\./g, '~');
  const dec = (k) => k.replace(/~/g, '.');
  function toRemote(items) { const o = {}; for (const k in items) o[enc(k)] = [items[k].q, items[k].t]; return o; }
  function fromRemote(o) { const items = {}; for (const k in (o || {})) { const v = o[k]; if (Array.isArray(v)) items[dec(k)] = { q: v[0], t: v[1] }; } return items; }

  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Firebase kon niet laden')); document.head.appendChild(s); });
  }

  function setState(state, extra) { Object.assign(S, { state }, extra || {}); renderPanel(); }

  async function init() {
    const cfg = KK.store.get('kk-firebase', null);
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
        if (!user) { setState('signedout', { user: null }); return; }
        S.user = user;
        S.docRef = S.db.collection('collections').doc(user.uid);
        setState('syncing');
        S.unsub = S.docRef.onSnapshot((snap) => {
          if (snap.metadata.hasPendingWrites) return;
          const remote = snap.exists ? fromRemote(snap.data().items) : {};
          KK.mergeItems(remote);
          // heeft dit toestel iets nieuwers dan de wolk? dan meteen terugsturen
          const local = KK.collection.items;
          const needsPush = Object.keys(local).some((k) => !remote[k] || (local[k].t || 0) > (remote[k].t || 0));
          if (needsPush) schedulePush(300); else setState('on', { lastSync: new Date(), error: '' });
        }, (e) => setState('error', { error: explain(e) }));
      });
    } catch (e) { setState('error', { error: explain(e) }); }
  }

  function explain(e) {
    const c = (e && e.code) || '';
    if (c.includes('unauthorized-domain')) return 'Dit webadres staat nog niet bij "Authorized domains" in Firebase (Authentication → Settings).';
    if (c.includes('permission-denied')) return 'Firestore weigert toegang. Controleer de beveiligingsregels (zie uitleg).';
    if (c.includes('popup-closed')) return 'Aanmelden afgebroken.';
    if (c.includes('operation-not-allowed')) return 'Zet Google aan als aanmeldmethode in Firebase (Authentication → Sign-in method).';
    if (c.includes('api-key')) return 'De Firebase-config klopt niet. Plak hem opnieuw.';
    return (e && e.message) || 'Onbekende fout';
  }

  function schedulePush(ms) {
    if (!S.docRef) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(push, ms == null ? 1500 : ms);
  }

  async function push() {
    if (!S.docRef) return;
    setState('syncing');
    try {
      await S.db.runTransaction(async (tx) => {
        const snap = await tx.get(S.docRef);
        if (snap.exists) KK.mergeItems(fromRemote(snap.data().items));
        tx.set(S.docRef, { items: toRemote(KK.collection.items), updated: firebase.firestore.FieldValue.serverTimestamp() });
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

  const RULES = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /collections/{uid} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}`;

  function renderPanel() {
    if (!panelEl || !panelEl.isConnected) return;
    const p = panelEl;
    const dot = S.state === 'on' ? 'on' : S.state === 'error' ? 'err' : '';
    const time = S.lastSync ? S.lastSync.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' }) : '';
    if (S.state === 'off') {
      p.innerHTML = `<h2>Synchroniseren</h2>
        <p class="muted small" style="margin:0">Zet je collectie gelijk op gsm, tablet en pc. Dat gebeurt via een gratis Firebase-project van jezelf (eenmalig ±10 minuten instellen, uitleg staat in LEESMIJ). Zonder dit blijft alles gewoon op dit toestel bewaard.</p>
        <label class="small" for="fb-config">Plak hier je Firebase-config</label>
        <textarea id="fb-config" class="input" placeholder="apiKey: &quot;…&quot;,\nauthDomain: &quot;…&quot;,\nprojectId: &quot;…&quot;,\nappId: &quot;…&quot;"></textarea>
        <div class="btn-row"><button class="btn primary" id="fb-save">Opslaan en verbinden</button><button class="btn" id="fb-rules">Kopieer beveiligingsregels</button></div>`;
      p.querySelector('#fb-save').addEventListener('click', () => {
        const cfg = parseConfig(p.querySelector('#fb-config').value);
        if (!cfg) return KK.toast('Dit lijkt geen volledige Firebase-config (apiKey, authDomain, projectId, appId).');
        KK.store.set('kk-firebase', cfg); init();
      });
      p.querySelector('#fb-rules').addEventListener('click', () => KK.copyText(RULES));
      return;
    }
    const labels = { loading: 'Verbinden…', signedout: 'Niet aangemeld', syncing: 'Synchroniseren…', on: 'Gesynchroniseerd' + (time ? ' om ' + time : ''), error: 'Probleem' };
    p.innerHTML = `<h2>Synchroniseren</h2>
      <div><span class="sync-dot ${dot}"></span><b>${esc(labels[S.state] || '')}</b>${S.user ? ` <span class="muted small">· ${esc(S.user.email || '')}</span>` : ''}</div>
      ${S.error ? `<p class="small" style="margin:0;color:var(--warn)">${esc(S.error)}</p>` : ''}
      <div class="btn-row">
        ${S.state === 'signedout' || (S.state === 'error' && !S.user) ? '<button class="btn primary" id="fb-in">Aanmelden met Google</button>' : ''}
        ${S.user ? '<button class="btn" id="fb-now">Nu synchroniseren</button><button class="btn" id="fb-out">Afmelden</button>' : ''}
        <button class="btn" id="fb-reset">Firebase loskoppelen</button>
      </div>
      <p class="muted small" style="margin:0">Elk gezinslid meldt zich aan met een eigen Google-account en krijgt zo een eigen collectie.</p>`;
    const on = (id, fn) => { const b = p.querySelector(id); if (b) b.addEventListener('click', fn); };
    on('#fb-in', signIn);
    on('#fb-now', () => push());
    on('#fb-out', () => S.auth && S.auth.signOut());
    on('#fb-reset', () => {
      // collectie blijft op dit toestel; alleen de koppeling verdwijnt
      if (S.unsub) S.unsub(); if (S.auth) S.auth.signOut().catch(() => {});
      KK.store.set('kk-firebase', null); localStorage.removeItem('kk-firebase');
      setState('off', { user: null, docRef: null, error: '' });
      KK.toast('Ontkoppeld. Laad de app opnieuw om Firebase volledig te sluiten.');
    });
  }

  KK.renderSyncPanel = (el) => { panelEl = el; renderPanel(); };
  init();
})();
