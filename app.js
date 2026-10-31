(function () {
  'use strict';
  const VERSION = '1.0.0';
  const DEFAULT_CID = 'XCCJPTbxgTaaQA';
  const A = window.Astra, MD = window.AstraMD, esc = MD.esc;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  const store = {
    get(k, d) { try { const v = localStorage.getItem('astra.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('astra.' + k, JSON.stringify(v)); } catch (e) {  } },
    del(k) { try { localStorage.removeItem('astra.' + k); } catch (e) {  } }
  };
  function clearAll() {
    try { Object.keys(localStorage).filter((k) => k.indexOf('astra.') === 0).forEach((k) => localStorage.removeItem(k)); } catch (e) {  }
  }
  const phone = () => window.matchMedia('(max-width: 860px)').matches;
  const reduced = () => set.motion === 'reduce' || (set.motion !== 'full' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const SRC = { reddit: 'R', arctic: 'A', pullpush: 'P' };
  const SRCNAME = { R: 'Reddit', A: 'Arctic Shift', P: 'PullPush' };

  const DEF = { accent: '#1BA1E2', theme: 'dark', compact: false, blur: true, clientId: '', sources: null, hideNsfw: false, hideRead: false, hideDeleted: 'off', hideDelPages: { feed: true, sub: true, user: true, search: true, thread: true }, ts: 100, cacheMin: 5, gestures: true, imgFeed: true, imgPost: true, imgProfile: true, imgComments: false, notify: false, toolbar: ['back', 'forward', 'previous', 'next', 'compose'], topTabs: ['subs', 'feed', 'thread', 'search'], topItems: ['me'], barLabels: true, font: 'default', lh: 'normal', motion: 'system', contrast: false, focus: false, targets: false, links: false, autoplay: true, toastSec: 4, speechRate: 1, speechComments: false };
  const set = Object.assign({}, DEF, store.get('settings', {}));
  const DEFAULT_SUBS = ['popular', 'all', 'pics', 'AskReddit', 'worldnews', 'technology', 'selfhosted', 'DataHoarder'];
  const S = {
    subs: store.get('subs', DEFAULT_SUBS), hub: 'feed', feedRoute: null, feed: null, T: null, ver: 'best', csort: 'best',
    sel: -1, folded: new Set(), votes: {}, saved: store.get('saved', {}), read: new Set(store.get('read', [])), edit: false, tt: false,
    cfind: '', blocks: null, hidden: new Set(store.get('hidden', [])), orig: new Set(), stubs: [], me: store.get('me', null), reply: null, ttCache: {}, stack: ['feed'], hist: { feed: [], thread: [] }, fwd: { feed: [], thread: [] }, errors: [], navFwd: false, curFeed: null, curThread: null, navBack: false, unread: 0
  };
  if (!set.sources || set.sourcesV !== 2) { set.sources = { R: true, A: false, P: false }; set.sourcesV = 2; store.set('settings', set); }
  const srcOn = (c) => !!set.sources[c] || (!set.sources.R && !set.sources.A && !set.sources.P && c === 'R');
  const srcKey = () => ['R', 'A', 'P'].filter(srcOn).join('');
  S.blocks = store.get('blocks', null) || {
    words: String(set.keywords || '').split(',').map((x) => x.trim()).filter(Boolean),
    users: Array.isArray(set.blockedUsers) ? set.blockedUsers.slice() : [], subs: Array.isArray(set.blockedSubs) ? set.blockedSubs.slice() : []
  };
  const applyCache = () => { A.cfg.ttl = Math.max(15000, (set.cacheMin || 0) * 60000); };
  applyCache();
  delete set.routes; delete set.proxy; delete set.proxies;
  if (!Array.isArray(set.toolbar)) set.toolbar = DEF.toolbar.slice();
  if (!Array.isArray(set.topTabs)) set.topTabs = DEF.topTabs.slice();
  if (!Array.isArray(set.topItems)) set.topItems = DEF.topItems.slice();
  const logErr = (where, e) => { S.errors.unshift({ t: Date.now(), where, msg: String((e && e.message) || e || 'Unknown error').slice(0, 200) }); if (S.errors.length > 10) S.errors.pop(); };
  window.addEventListener('error', (e) => logErr('script', e.error || e.message));
  window.addEventListener('unhandledrejection', (e) => logErr('promise', e.reason));
  const cid = () => String(set.clientId || '').trim() || DEFAULT_CID;
  A.clearToken = () => { A.cfg.token = null; A.cfg.user = false; A.cfg.exp = 0; store.del('token'); store.del('me'); S.me = null; if (S.ready) renderBar(); };
  (function bootToken() {
    if (/^#access_token=/.test(location.hash)) {
      const p = new URLSearchParams(location.hash.slice(1));
      if (p.get('state') && p.get('state') === store.get('oauthstate')) {
        store.set('token', { t: p.get('access_token'), exp: Date.now() + (+p.get('expires_in') || 3600) * 1000 - 60000 });
        S.justConnected = true;
      } else S.authError = true;
      history.replaceState(null, '', location.pathname + location.search + '#/');
    }
    const t = store.get('token', null);
    if (t && t.exp > Date.now()) { A.cfg.token = t.t; A.cfg.user = true; A.cfg.exp = t.exp; } else if (t) store.del('token');
  })();

  let appTok = store.get('apptoken', null), tokJob = null, tokFail = 0;
  const devId = store.get('dev', null) || (() => { const d = Array.from(crypto.getRandomValues(new Uint8Array(12))).map((b) => b.toString(16).padStart(2, '0')).join(''); store.set('dev', d); return d; })();
  async function requestToken(id) {
    const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 8000);
    try {
      const r = await fetch('https://www.reddit.com/api/v1/access_token', { method: 'POST', credentials: 'omit', signal: ctl.signal, headers: { Authorization: 'Basic ' + btoa(id + ':'), 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=' + encodeURIComponent('https://oauth.reddit.com/grants/installed_client') + '&device_id=' + devId });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (!j.access_token) throw new Error('No token returned');
      return { t: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 - 120000, id };
    } finally { clearTimeout(to); }
  }
  async function fetchAppToken() {
    const ids = [cid()]; if (ids[0] !== DEFAULT_CID) ids.push(DEFAULT_CID);
    let last = null;
    for (const id of ids) {
      try { appTok = await requestToken(id); store.set('apptoken', appTok); return; }
      catch (e) { last = e; logErr('token', (id === DEFAULT_CID ? 'default' : 'custom') + ' client: ' + (e && e.message)); }
    }
    tokFail = Date.now() + 5 * 60000; appTok = null; toast('Unable to obtain an access token.');
  }
  let defTok = null;
  A.defaultToken = async () => {
    if (defTok && defTok.exp > Date.now()) return defTok.t;
    defTok = await requestToken(DEFAULT_CID);
    return defTok.t;
  };
  A.ensureToken = async () => {
    const now = Date.now();
    if (A.cfg.token && A.cfg.exp > now) return;
    if (A.cfg.user) { A.clearToken(); toast('Your session has ended.'); }
    A.cfg.token = null; A.cfg.exp = 0;
    if (tokFail > now) return;
    if (!(appTok && appTok.exp > now)) { if (!tokJob) tokJob = fetchAppToken().then(() => { tokJob = null; }); await tokJob; }
    if (appTok && appTok.exp > now) { A.cfg.token = appTok.t; A.cfg.exp = appTok.exp; }
  };

  function applyTheme() {
    const root = document.documentElement;
    root.dataset.theme = set.theme;
    const TV = ['--bg', '--panel', '--raise', '--line', '--tile', '--dim', '--faint', '--rec-bg', '--rec-a-bg'];
    if (set.theme === 'accent') {
      const m = /^#([0-9a-f]{6})$/i.exec(set.accent) || [0, '2A8BFF'];
      const v = parseInt(m[1], 16), rr = (v >> 16) / 255, gg = ((v >> 8) & 255) / 255, bb = (v & 255) / 255;
      const mx = Math.max(rr, gg, bb), mn = Math.min(rr, gg, bb), d = mx - mn;
      let h = 0;
      if (d) h = mx === rr ? ((gg - bb) / d) % 6 : mx === gg ? (bb - rr) / d + 2 : (rr - gg) / d + 4;
      h = Math.round(((h * 60) + 360) % 360);
      const hs = (s, l) => 'hsl(' + h + ',' + s + '%,' + l + '%)';
      const cols = [hs(45, 13), hs(40, 18), hs(36, 24), hs(34, 27), hs(30, 32), hs(18, 78), hs(14, 60), hs(45, 16), hs(45, 16)];
      TV.forEach((k, i) => root.style.setProperty(k, cols[i]));
    } else TV.forEach((k) => root.style.removeProperty(k));
    root.style.setProperty('--accent', set.accent);
    root.style.setProperty('--r', set.accent);
    const n = parseInt(set.accent.slice(1), 16);
    const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    root.style.setProperty('--on-accent', lum > 0.62 ? '#101014' : '#FFFFFF');
    root.style.setProperty('--ts', String((set.ts || 100) / 100));
    document.body.classList.toggle('compact', !!set.compact);
    const ds = root.dataset;
    ds.font = set.font; ds.lh = set.lh; ds.motion = set.motion; ds.contrast = set.contrast ? 'high' : 'normal';
    ds.focus = set.focus ? 'enhanced' : 'normal'; ds.targets = set.targets ? 'large' : 'normal'; ds.links = set.links ? 'underline' : 'normal';
  }
  const saveSet = () => store.set('settings', set);

  const fmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'm' : n >= 1e4 ? Math.round(n / 1e3) + 'k' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n));
  const ago = (t) => {
    const d = Date.now() / 1000 - t;
    if (!(d >= 0)) return 'now';
    if (d < 60) return 'now';
    if (d < 3600) return Math.floor(d / 60) + 'm';
    if (d < 86400) return Math.floor(d / 3600) + 'h';
    if (d < 86400 * 30) return Math.floor(d / 86400) + 'd';
    if (d < 86400 * 365) return Math.floor(d / 86400 / 30) + 'mo';
    return Math.floor(d / 86400 / 365) + 'y';
  };
  const dur = (s) => (s < 60 ? s + 's' : s < 3600 ? Math.round(s / 60) + 'm' : s < 86400 ? Math.round(s / 3600) + 'h' : Math.round(s / 86400) + 'd');
  const ymd = (t) => new Date(t * 1000).toISOString().slice(0, 10);
  const WIN = { hour: 3600, day: 86400, week: 604800, month: 2592000, year: 31536000 };
  const hubEl = (n) => $('#hub-' + n);

  let toastTimer;
  function toast(msg, label, fn) {
    const box = $('#toasts');
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = '<span>' + esc(msg) + '</span>' + (label ? '<button>' + esc(label) + '</button>' : '');
    if (label) el.querySelector('button').onclick = () => { fn(); el.remove(); };
    box.appendChild(el);
    setTimeout(() => el.remove(), label ? Math.max(7, set.toastSec) * 1000 : set.toastSec * 1000);
    clearTimeout(toastTimer);
  }
  const errToast = (e) => { if (e && e.status) toast('Request failed (' + e.status + ').'); };
  const needAuth = () => {
    if (A.cfg.user) return false;
    toast('Sign in to continue.', 'Settings', openSettings);
    return true;
  };

  const IC = {
    reply: 'M9 14L4 9l5-5M4 9h10a6 6 0 016 6v3',
    save: 'M6 3h12v18l-6-4-6 4z',
    share: 'M12 3v12M7 8l5-5 5 5M5 14v6h14v-6',
    compare: 'M3 5h8v14H3zM13 5h8v14h-8z',
    refresh: 'M20 12a8 8 0 11-2.3-5.7M20 4v5h-5',
    more: 'M5 12h.01M12 12h.01M19 12h.01',
    plus: 'M12 5v14M5 12h14',
    pin: 'M12 17v5M8 3h8l-1 7 3 3H6l3-3z',
    clock: 'M12 7v5l3 2M12 21a9 9 0 100-18 9 9 0 000 18z',
    search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4',
    down: 'M12 5v14M6 13l6 6 6-6',
    info: 'M12 11v6M12 7.5v.01M12 21a9 9 0 100-18 9 9 0 000 18z',
    back: 'M19 12H5M11 6l-6 6 6 6',
    forward: 'M5 12h14M13 6l6 6-6 6',
    up: 'M12 19V5M6 11l6-6 6 6',
    home: 'M4 11l8-7 8 7v9h-5v-6H9v6H4z',
    mail: 'M4 6h16v12H4zM4 7l8 6 8-6',
    trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
    restore: 'M4 12a8 8 0 102.3-5.7M4 4v5h5M12 8v4l3 2',
    sliders: 'M4 7h10M18 7h2M4 17h2M10 17h10M14 5v4M6 15v4',
    person: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0',
    link: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1'
  };
  const icon = (n) => '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + IC[n] + '"/></svg>';

  function parseHash() {
    const h = location.hash.replace(/^#/, '') || '/';
    const i = h.indexOf('?');
    const path = i < 0 ? h : h.slice(0, i);
    const q = {};
    new URLSearchParams(i < 0 ? '' : h.slice(i + 1)).forEach((v, k) => { q[k] = v; });
    const p = path.split('/').filter(Boolean).map((x) => { try { return decodeURIComponent(x); } catch (e) { return x; } });
    let r;
    if (p[0] === 'r' && p[1]) r = { kind: 'sub', name: p[1], sort: p[2] || 'hot' };
    else if (p[0] === 'comments' && p[1]) r = { kind: 'thread', id: p[1] };
    else if (p[0] === 'u' && p[1]) r = { kind: 'user', name: p[1], tab: p[2] || 'overview', sort: 'new' };
    else if (p[0] === 'search') r = { kind: 'search', sort: q.sort || 'relevance' };
    else if (p[0] === 'removed' && p[1]) r = { kind: 'removed', name: p[1], sort: 'new' };
    else if (['inbox', 'saved', 'messages'].includes(p[0])) r = { kind: p[0], sort: 'hot' };
    else r = { kind: 'home', sort: ['hot', 'new', 'top', 'rising'].includes(p[0]) ? p[0] : 'hot' };
    r.q = q;
    return r;
  }
  function hashOf(r, patch) {
    patch = patch || {};
    const x = Object.assign({}, r, patch);
    const q = Object.assign({}, r.q, patch.q);
    Object.keys(q).forEach((k) => { if (q[k] === '' || q[k] == null || q[k] === false) delete q[k]; });
    let path;
    switch (x.kind) {
      case 'sub': path = '/r/' + encodeURIComponent(x.name) + '/' + x.sort; break;
      case 'user': path = '/u/' + encodeURIComponent(x.name) + '/' + x.tab; break;
      case 'search': path = '/search'; if (x.sort !== 'relevance') q.sort = x.sort; break;
      case 'removed': path = '/removed/' + encodeURIComponent(x.name); break;
      case 'thread': path = '/comments/' + x.id; break;
      case 'home': path = x.sort === 'hot' ? '/' : '/' + x.sort; break;
      default: path = '/' + x.kind;
    }
    const qs = new URLSearchParams(q).toString();
    return '#' + path + (qs ? '?' + qs : '');
  }
  const go = (h) => { if (location.hash === h) onRoute(); else location.hash = h; };

  function showHub(name, smooth, fast) {
    const el = hubEl(name), pan = $('#panorama');
    if (!el) return;
    const pad = phone() ? 0 : parseInt(getComputedStyle(pan).paddingLeft, 10) || 0;
    const left = el.getBoundingClientRect().left - pan.getBoundingClientRect().left + pan.scrollLeft - pad;
    const was = S.hub;
    progNav = Math.abs(left - pan.scrollLeft) > 1;
    if (smooth === false || reduced() || !S.ready) pan.scrollTo({ left, behavior: 'auto' });
    else if (phone()) slideTo(pan, left, fast ? 200 : 380);
    else pan.scrollTo({ left, behavior: 'smooth' });
    if (S.ready && !reduced() && was !== name) replay(el, fast);
    S.hub = name;
    navPush(name);
    updateTitle();
    markPivot();
    renderBar();
  }
  let slideRaf = 0, progNav = false;
  function slideTo(pan, left, ms) {
    cancelAnimationFrame(slideRaf);
    const from = pan.scrollLeft, dist = left - from;
    if (!dist) return;
    pan.style.scrollSnapType = 'none';
    const t0 = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - t0) / ms);
      pan.scrollLeft = from + dist * (1 - Math.pow(1 - t, 4));
      if (t < 1) slideRaf = requestAnimationFrame(step);
      else { pan.scrollLeft = left; pan.style.scrollSnapType = ''; }
    };
    slideRaf = requestAnimationFrame(step);
  }
  function replay(el, fast) {
    const on = el.classList.contains('ea');
    el.classList.remove('ea', 'eb', 'pa', 'pb', 'fx');
    el.classList.add(on ? 'eb' : 'ea', on ? 'pb' : 'pa');
    if (fast) el.classList.add('fx');
    clearTimeout(el._pt);
    el._pt = setTimeout(() => el.classList.remove('pa', 'pb', 'fx'), fast ? 600 : 1100);
  }
  function updateTitle() {
    const d = $('#dlg'), r = S.feedRoute;
    let t = '';
    if (d && d.open && d.dataset.t) t = d.dataset.t;
    else if (S.hub === 'thread') t = S.T && S.T.post ? MD.unent(S.T.post.title) : '';
    else if (S.hub === 'feed' && r) {
      if (r.kind === 'sub' && !isGlobal(r)) t = 'r/' + r.name;
      else if (r.kind === 'user') t = 'u/' + r.name;
      else if (r.kind === 'search') t = 'search' + (r.q.q ? ': ' + r.q.q : '') + (r.q.sub ? ' in r/' + r.q.sub : '') + (r.q.user ? ' by u/' + r.q.user : '');
      else if (r.kind === 'removed') t = 'removed in r/' + r.name;
      else if (r.kind === 'inbox') t = 'inbox';
      else if (r.kind === 'messages') t = 'messages';
      else if (r.kind === 'saved') t = 'saved';
    }
    document.title = t ? t + ' | astra' : 'astra';
  }
  function navPush(h) { if (S.stack[S.stack.length - 1] !== h) { S.stack.push(h); if (S.stack.length > 30) S.stack.shift(); } }
  const canBack = () => !!((S.hist[S.hub] || []).length || S.hub === 'thread');
  const canFwd = () => !!(S.fwd[S.hub] || []).length;
  function goBack() {
    const L = S.hist[S.hub];
    if (L && L.length) { const cur = S.hub === 'thread' ? S.curThread : S.curFeed; if (cur) S.fwd[S.hub].push(cur); S.navBack = true; go(L.pop()); return; }
    if (S.hub === 'thread') showHub('feed');
  }
  function goForward() {
    const F = S.fwd[S.hub];
    if (F && F.length) { S.navFwd = true; go(F.pop()); }
  }

  function onRoute() {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    const r = parseHash();
    const hh = location.hash || '#/';
    const tab = r.kind === 'thread' ? 'thread' : 'feed';
    if (tab) {
      const cur = tab === 'thread' ? 'curThread' : 'curFeed';
      if (S[cur] && S[cur] !== hh && !S.navBack) { S.hist[tab].push(S[cur]); if (S.hist[tab].length > 30) S.hist[tab].shift(); }
      S[cur] = hh;
    }
    if (tab && !S.navBack && !S.navFwd) S.fwd[tab] = [];
    S.navBack = false; S.navFwd = false;
    if (r.kind === 'thread') {
      if (!S.feedRoute) { S.feedRoute = parseRouteHome(); setFeed(S.feedRoute, true); }
      openThread(r.id, r.q.c);
      showHub('thread');
      return;
    }
    S.feedRoute = r;
    setFeed(r);
    showHub('feed');
  }
  const parseRouteHome = () => ({ kind: 'home', sort: 'hot', q: {} });

  function markSrc() {  }
  function applySrc() {
    if (S.feedRoute) setFeed(S.feedRoute, true);
    if (S.T && parseHash().kind === 'thread') openThread(S.T.id, null, true);
  }
  const HUBS = [['subs', 'subscriptions'], ['feed', 'posts'], ['thread', 'thread'], ['search', 'search']];
  const TOP_TABS = { subs: 'Subscriptions', feed: 'Posts', thread: 'Thread', search: 'Search' };
  const TOP_ITEMS = { me: 'Profile or sign in', saved: 'Saved', inbox: 'Inbox', messages: 'Messages', settings: 'Settings' };
  let topSig = '';
  function topItem(id) {
    switch (id) {
      case 'me': return ['person', A.cfg.user ? (S.me ? 'u/' + S.me : 'profile') : 'sign in', A.cfg.user ? 'Open your profile' : 'Sign in'];
      case 'saved': return ['save', 'saved', 'Saved'];
      case 'inbox': return A.cfg.user ? ['mail', 'inbox' + (S.unread ? ' (' + S.unread + ')' : ''), 'Inbox'] : null;
      case 'messages': return A.cfg.user ? ['mail', 'messages', 'Messages'] : null;
      case 'settings': return ['sliders', 'settings', 'Settings'];
      default: return null;
    }
  }
  function buildPivot() {
    const lab = {}; HUBS.forEach((h) => { lab[h[0]] = h[1]; });
    const tabs = set.topTabs.filter((id) => lab[id]).map((id) => '<button role="tab" data-hub="' + id + '" aria-selected="false">' + lab[id] + '</button>').join('');
    const pills = set.topItems.map((id, k) => { const x = topItem(id); return x ? '<button type="button" class="topme' + (k === 0 ? ' first' : '') + '" data-top="' + id + '" aria-label="' + esc(x[2]) + '">' + icon(x[0]) + '<span>' + esc(x[1]) + '</span></button>' : ''; }).join('');
    $('#pivotstrip').innerHTML = tabs + pills;
    topSig = [A.cfg.user ? 1 : 0, S.me || '', S.unread, set.topTabs.join(), set.topItems.join()].join('|');
  }
  function drawMe() {
    const sig = [A.cfg.user ? 1 : 0, S.me || '', S.unread, set.topTabs.join(), set.topItems.join()].join('|');
    if (sig !== topSig) { buildPivot(); markPivot(); }
  }
  function markPivot() {
    $$('#pivotstrip button[data-hub]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.hub === S.hub)));
    const strip = $('#pivotstrip'), on = $('#pivotstrip button[aria-selected="true"]');
    if (phone()) syncPivot(true);
    else if (on) strip.scrollLeft = on.offsetLeft - (strip.clientWidth - on.offsetWidth) / 2;
    const pan = $('#panorama');
    if (pan) pan.scrollTop = 0;
  }
  $('#pivotstrip').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.top) {
      const t = b.dataset.top;
      if (t === 'me') { if (A.cfg.user) doAct('profile'); else openSettings('account'); }
      else if (t === 'saved') go('#/saved'); else if (t === 'inbox') go('#/inbox'); else if (t === 'messages') go('#/messages'); else if (t === 'settings') openSettings();
      return;
    } showHub(b.dataset.hub, undefined, true); });
  let pivRaf = 0;
  function syncPivot(settle, quiet) {
    const pan = $('#panorama'), strip = $('#pivotstrip');
    if (!pan || !strip || !phone()) return;
    const tabs = $$('#pivotstrip button[data-hub]');
    const pts = HUBS.map((h, i) => ({ i, b: tabs.find((t) => t.dataset.hub === h[0]) })).filter((x) => x.b);
    if (!pts.length) return;
    const pos = Math.max(0, Math.min(HUBS.length - 1, pan.scrollLeft / Math.max(1, pan.clientWidth)));
    const cx = (b) => b.offsetLeft + b.offsetWidth / 2;
    let lo = pts[0], hi = pts[pts.length - 1];
    pts.forEach((x) => { if (x.i <= pos) lo = x; });
    for (let k = pts.length - 1; k >= 0; k--) if (pts[k].i >= pos) hi = pts[k];
    const f = hi.i === lo.i ? 0 : Math.max(0, Math.min(1, (pos - lo.i) / (hi.i - lo.i)));
    strip.scrollLeft = cx(lo.b) + (cx(hi.b) - cx(lo.b)) * f - strip.clientWidth / 2;
    if (settle) { strip.classList.remove('dragging'); tabs.forEach((b) => { b.style.opacity = ''; }); return; }
    if (quiet) return;
    strip.classList.add('dragging');
    pts.forEach((x) => { x.b.style.opacity = String(0.4 + 0.6 * Math.max(0, 1 - Math.abs(pos - x.i))); });
  }
  $('#panorama').addEventListener('scroll', () => {
    if (!phone()) return;
    if (!pivRaf) pivRaf = requestAnimationFrame(() => { pivRaf = 0; syncPivot(false, progNav); });
    clearTimeout(onScrollEnd.t);
    onScrollEnd.t = setTimeout(onScrollEnd, 90);
  });
  function onScrollEnd() {
    progNav = false;
    const pan = $('#panorama');
    const idx = Math.round(pan.scrollLeft / Math.max(1, pan.clientWidth));
    const h = HUBS[Math.min(HUBS.length - 1, Math.max(0, idx))][0];
    if (h !== S.hub) { S.hub = h; navPush(h); updateTitle(); markPivot(); renderBar(); } else syncPivot(true);
  }
  $('#panorama').addEventListener('touchstart', () => { progNav = false; }, { passive: true });
  $('#panorama').addEventListener('pointerdown', (e) => {
    if (phone()) return;
    const h = e.target.closest('.hub');
    if (h && h.dataset.hub !== S.hub) { S.hub = h.dataset.hub; renderBar(); }
  });

  async function doSearch(v, o) {
    v = String(v || '').trim();
    if (!v && !(o && (o.sub || o.user))) return;
    const L = v ? A.parseLink(v) : null;
    if (L && L.hash) { go(L.hash); return; }
    if (L && L.short) {
      try {
        const p = await A.arctic.shortLink(L.short);
        const L2 = p && A.parseLink('https://www.reddit.com' + p);
        if (L2 && L2.hash) { go(L2.hash); return; }
      } catch (err) {  }
      return;
    }
    const fr = S.feedRoute;
    let sub = '', user = '', type = '';
    if (o) { sub = o.sub || ''; user = o.user || ''; type = o.type || ''; }
    else sub = fr && fr.kind === 'sub' && !['popular', 'all'].includes(fr.name) ? fr.name : (fr && fr.kind === 'search' ? fr.q.sub || '' : '');
    if (!v && !type) {
      if (user && !sub) { go('#/u/' + encodeURIComponent(user) + '/posts'); return; }
      if (sub && !user) { go('#/r/' + encodeURIComponent(sub)); return; }
    }
    go('#/search?' + [['q', v], ['sub', sub], ['user', user], ['type', type]].filter((x) => x[1]).map((x) => x[0] + '=' + encodeURIComponent(x[1])).join('&'));
  }
  function renderSearch() {
    const L = store.get('searches', []).filter((x) => x && x.label), f = S.sf || {};
    const inp = (id, label, ph, v) => '<label for="' + id + '">' + label + '</label><input type="text" id="' + id + '" placeholder="' + ph + '" value="' + esc(v || '') + '" autocomplete="off" autocapitalize="off" spellcheck="false">';
    $('#search-body').innerHTML = '<form class="sform2" id="sform" autocomplete="off">' +
      inp('sq', 'Search for', 'Keywords or a Reddit link', f.q) + inp('ssub', 'Subreddit', 'Optional, such as pics', f.sub) + inp('suser', 'User', 'Optional, such as spez', f.user) +
      '<label for="stype">Search in</label><select id="stype"><option value="">Posts</option><option value="comments"' + (f.type === 'comments' ? ' selected' : '') + '>Comments</option></select>' +
      '<div class="row"><button class="btn primary">Search</button></div></form>' +
      (L.length ? '<div class="recent"><h3>Recent</h3><ul class="suggest">' + L.map((x, k) => '<li><button type="button" data-q="' + k + '">' + esc(x.label) + '</button></li>').join('') + '</ul><div class="row"><button class="btn small" type="button" id="sclear">Clear recent</button></div></div>' : '');
  }
  function runSearch(o) {
    const clean = (x, p) => String(x || '').trim().replace(new RegExp('^/?' + p + '/', 'i'), '');
    o = { q: String(o.q || '').trim(), sub: clean(o.sub, 'r'), user: clean(o.user, 'u'), type: o.type || '' };
    if (!o.q && !o.sub && !o.user) { toast('Enter a search term, subreddit or user.'); return; }
    S.sf = o;
    const label = [o.q, o.sub ? 'in r/' + o.sub : '', o.user ? 'by u/' + o.user : '', o.type === 'comments' ? '(comments)' : ''].filter(Boolean).join(' ');
    const L = store.get('searches', []).filter((x) => x && x.label).filter((x) => x.label !== label); L.unshift({ label, o }); store.set('searches', L.slice(0, 8));
    doSearch(o.q, o); renderSearch();
  }
  $('#search-body').addEventListener('submit', (e) => { e.preventDefault(); runSearch({ q: $('#sq').value, sub: $('#ssub').value, user: $('#suser').value, type: $('#stype').value }); });
  $('#search-body').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.q !== undefined) { const x = store.get('searches', []).filter((x) => x && x.label)[+b.dataset.q]; if (x) runSearch(x.o); }
    else if (b.id === 'sclear') { store.del('searches'); renderSearch(); }
  });
  function openSearch() { showHub('search'); setTimeout(() => { const q = $('#sq'); if (q) q.focus(); }, 60); }

  const WIN8 = ['#A4C400', '#60A917', '#008A00', '#00ABA9', '#1BA1E2', '#0050EF', '#6A00FF', '#AA00FF', '#F472D0', '#D80073', '#A20025', '#E51400', '#FA6800', '#F0A30A', '#E3C800', '#825A2C', '#6D8764', '#647687', '#76608A', '#87794E'];
  const TILE8 = ['#2D89EF', '#2B5797', '#00A300', '#1E7145', '#99B433', '#00ABA9', '#DA532C', '#B91D47', '#EE1111', '#FF0097', '#9F00A7', '#7E3878', '#603CBA', '#FFC40D', '#E3A21A'];
  const colorOf = (n) => { let h = 0; for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0; return WIN8[h % WIN8.length]; };
  const tileColorOf = (n) => { let h = 0; for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0; return TILE8[h % TILE8.length]; };
  const onColor = (hex) => { const n = parseInt(hex.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 > 0.62 ? '#101014' : '#FFFFFF'; };
  const tileData = {};
  const isEntry = (n) => /^(u\/|~)/.test(n);
  function tileOf(n) {
    if (n.indexOf('u/') === 0) return { k: 'u', name: n.slice(2), label: n.slice(2), small: 'u/', href: '#/u/' + encodeURIComponent(n.slice(2)) };
    if (n.charAt(0) === '~') return { k: 't', name: n.slice(1), label: n.slice(1), small: 'topic', href: '#/search?q=' + encodeURIComponent(n.slice(1)) };
    return { k: 'r', name: n, label: n, small: 'r/', href: '#/r/' + encodeURIComponent(n) };
  }
  function renderSubs() {
    const tiles = [{ name: '__home', label: 'home', small: '', href: '#/', color: set.accent, w2: true }]
      .concat(S.subs.map((n, i) => Object.assign(tileOf(n), { id: n, color: tileColorOf(n), w2: i === 0 })));
    const t = tiles.map((x, i) => {
      const id = x.id || x.name;
      const back = tileData[id];
      const fg = onColor(x.color);
      const has = back && back.t;
      return '<a class="tile press' + (x.w2 ? ' w2' : '') + (has ? ' has' : '') + '" href="' + esc(x.href) + '" style="background:' + x.color + ';color:' + fg + ';--ti:' + i + '" data-name="' + esc(id) + '">' +
        '<div class="flipper"><div class="face front"><small>' + esc(x.small) + '</small><b>' + esc(x.label) + '</b></div>' +
        '<div class="face back" style="background:' + x.color + '"><small>' + (has ? esc(back.k === 'r' ? 'top now' : 'r/' + back.sub) : '') + '</small><span>' + (has ? esc(back.t) : '') + '</span></div></div>' +
        (S.edit && id !== '__home' ? '<button class="x" data-rm="' + esc(id) + '" aria-label="Remove">&times;</button>' : '') + '</a>';
    }).join('');
    $('#subs-body').innerHTML = '<div class="tiles">' + t + '</div>' +
      '<form class="subform" id="subadd" autocomplete="off"><input id="subq" placeholder="Subreddit, u/user or topic" aria-label="Add"><button class="btn small">Add</button><button class="btn small" type="button" data-act="edit">' + (S.edit ? 'Done' : 'Edit') + '</button></form>' +
      '<ul class="suggest" id="suggest"></ul>';
    loadTileBacks();
  }
  let tileJob = 0;
  async function loadTileBacks() {
    const job = ++tileJob;
    if (!srcOn('R')) return;
    const ttl = Math.max(60000, (set.cacheMin || 5) * 60000);
    const names = S.subs.filter((n) => !tileData[n] || Date.now() - tileData[n].at > ttl).slice(0, 8);
    for (const n of names) {
      if (job !== tileJob) return;
      const x = tileOf(n);
      try {
        const o = x.k === 'r' ? { kind: 'sub', name: n, sort: 'hot' } : x.k === 'u' ? { kind: 'user', name: x.name, sort: 'new', tab: 'submitted' } : { kind: 'search', q: x.name, sort: 'new' };
        const r = await A.reddit.listing(o);
        const p = r.items.find((y) => y.title && !y.stickied && !blockedUser(y.author) && !blockedSub(y.subreddit) && !blockedText(y.title));
        tileData[n] = p ? { t: MD.unent(p.title), id: p.id, sub: p.subreddit, k: x.k, at: Date.now() } : { at: Date.now() };
        const el = $('.tile[data-name="' + CSS.escape(n) + '"]');
        if (el && p) {
          el.classList.add('has');
          el.querySelector('.back small').textContent = x.k === 'r' ? 'top now' : 'r/' + p.subreddit;
          el.querySelector('.back span').textContent = tileData[n].t;
        }
      } catch (e) { tileData[n] = { at: Date.now() }; }
    }
  }
  let flipI = 0;
  setInterval(() => {
    if (document.hidden || (phone() && S.hub !== 'subs')) return;
    const els = $$('#subs-body .tile.has');
    if (!els.length) return;
    const el = els[flipI++ % els.length];
    el.classList.add('flipped');
    setTimeout(() => el.classList.remove('flipped'), 9000);
  }, 6000);
  setInterval(() => { if (!document.hidden && S.ready) loadTileBacks(); }, 60000);
  const tileGo = (el) => { const x = el.dataset.name === '__home' ? { href: '#/' } : tileOf(el.dataset.name); go(x.href); };
  $('#subs-body').addEventListener('click', (e) => {
    const rm = e.target.closest('[data-rm]');
    if (rm) { e.preventDefault(); S.subs = S.subs.filter((n) => n !== rm.dataset.rm); store.set('subs', S.subs); renderSubs(); return; }
    if (e.target.closest('[data-act="edit"]')) { S.edit = !S.edit; renderSubs(); return; }
    const sg = e.target.closest('[data-add]');
    if (sg) { addEntry(sg.dataset.add, sg.dataset.k); return; }
    const tile = e.target.closest('.tile');
    if (tile && !S.edit && tile.classList.contains('flipped') && tileData[tile.dataset.name] && tileData[tile.dataset.name].id) {
      e.preventDefault();
      go('#/comments/' + tileData[tile.dataset.name].id);
    }
  });
  $('#subs-body').addEventListener('contextmenu', (e) => { const tile = e.target.closest('.tile'); if (tile) { e.preventDefault(); tileGo(tile); } });
  (function tileHold() {
    let timer;
    const body = $('#subs-body');
    body.addEventListener('touchstart', (e) => {
      const tile = e.target.closest('.tile');
      if (!tile) return;
      timer = setTimeout(() => { S.noClick = Date.now(); tileGo(tile); }, 500);
    }, { passive: true });
    const stop = () => clearTimeout(timer);
    body.addEventListener('touchmove', stop, { passive: true });
    body.addEventListener('touchend', stop);
    body.addEventListener('touchcancel', stop);
  })();
  function addEntry(raw, kind) {
    raw = String(raw || '').trim();
    let e;
    if (kind === 'u' || (!kind && /^(\/?u\/|@)/i.test(raw))) { const u = raw.replace(/^\/?u\/|^@/i, ''); if (!/^[\w-]{3,20}$/.test(u)) return; e = 'u/' + u; }
    else if (kind === 't' || (!kind && (/^[~#]/.test(raw) || /\s/.test(raw)))) { const q = raw.replace(/^[~#]/, '').trim(); if (q.length < 2) return; e = '~' + q; }
    else { const n = raw.replace(/^\/?r\//i, ''); if (!/^[A-Za-z0-9_+]{2,}$/.test(n)) return; e = n; }
    if (!S.subs.some((x) => x.toLowerCase() === e.toLowerCase())) {
      S.subs.push(e); store.set('subs', S.subs);
      if (A.cfg.user && !isEntry(e) && e.indexOf('+') < 0) A.reddit.subscribe(e, true).catch(() => {});
    }
    renderSubs();
    go(tileOf(e).href);
  }
  $('#subs-body').addEventListener('submit', (e) => { e.preventDefault(); const v = $('#subq').value; if (v.trim()) addEntry(v); });
  let sgT;
  $('#subs-body').addEventListener('input', (e) => {
    if (e.target.id !== 'subq') return;
    clearTimeout(sgT);
    const raw = e.target.value.trim();
    const v = raw.replace(/^(\/?[ru]\/|@|[~#])/i, '');
    sgT = setTimeout(async () => {
      const ul = $('#suggest');
      if (!ul) return;
      if (v.length < 2) { ul.innerHTML = ''; return; }
      const fixed = [['r', 'r/' + v], ['u', 'u/' + v], ['t', 'topic: ' + v]].map((x) => '<li><button type="button" data-add="' + esc(v) + '" data-k="' + x[0] + '"><span>' + esc(x[1]) + '</span></button></li>').join('');
      ul.innerHTML = fixed;
      if (!srcOn('A')) return;
      try {
        const list = await A.arctic.subreddits(v);
        if (!$('#suggest')) return;
        ul.innerHTML = fixed + list.slice(0, 6).map((s) => '<li><button type="button" data-add="' + esc(s.name) + '" data-k="r"><span>r/' + esc(s.name) + '</span><span class="n">' + (s.subscribers ? fmt(s.subscribers) : '') + '</span></button></li>').join('');
      } catch (err) {  }
    }, 250);
  });

  let feedSeq = 0;
  const feedKey = (r) => JSON.stringify([r.kind, r.name, r.sort, r.tab, r.q]);
  function activeSources(r) {
    let list = ['R', 'A', 'P'].filter(srcOn);
    if (r.q.src && SRC[r.q.src]) list = [SRC[r.q.src]];
    if (r.q.asof) list = list.filter((x) => x !== 'R');
    if (!list.length) list = ['A'];
    return list;
  }
  const isGlobal = (r) => r.kind === 'home' || (r.kind === 'sub' && ['popular', 'all'].includes(r.name.toLowerCase()));
  function homeName() {
    const l = S.subs.filter((n) => !isEntry(n) && !['popular', 'all'].includes(n.toLowerCase()));
    return A.cfg.user && l.length ? l.slice(0, 40).join('+') : 'all';
  }
  function feedTitle(r) {
    switch (r.kind) {
      case 'home': return 'home';
      case 'sub': return r.name.toLowerCase();
      case 'user': return 'u/' + r.name.toLowerCase();
      case 'search': return 'search';
      case 'removed': return 'removed';
      case 'inbox': return 'inbox';
      case 'messages': return 'messages';
      case 'saved': return 'saved';
      default: return 'posts';
    }
  }
  function setFeed(r, force) {
    const key = feedKey(r) + srcKey();
    if (!force && S.feed && S.feed.key === key) { renderFeedShell(); renderList(0); return; }
    const F = (S.feed = { id: ++feedSeq, key, r, map: new Map(), cmap: new Map(), items: [], cur: {}, done: {}, errors: {}, busy: false, loaded: false, srcs: [] });
    S.sel = -1;
    renderFeedShell();
    if (r.kind === 'saved') { loadSaved(F); return; }
    if (r.kind === 'inbox') { loadInbox(F); return; }
    if (r.kind === 'messages') { loadMessages(F); return; }
    if (!force) {
      const c = cacheGet('f' + hk(key));
      if (c && c.items && c.items.length) {
        F.items = c.items; F.cur = c.cur || {}; F.done = c.done || {}; F.srcs = c.srcs || [];
        F.items.forEach((m) => { if (m.c) F.cmap.set(m.c.id, m.c); else F.map.set(m.id, m); });
        F.loaded = true;
        renderList(0);
        return;
      }
    }
    loadFeed(F);
  }
  function pinTop(F) {
    const k = F.r.kind;
    if (k !== 'sub' && k !== 'user') return;
    const idx = new Map(F.items.map((x, i) => [x, i]));
    F.items.sort((a, b) => (+!!b.stickied - +!!a.stickied) || (idx.get(a) - idx.get(b)));
  }

  function renderFeedShell() {
    const F = S.feed, r = F.r;
    $('#feed-title').textContent = feedTitle(r);
    updateTitle();
    let opts = [];
    if (['home', 'sub'].includes(r.kind)) opts = ['hot', 'new', 'top', 'rising'].map((s) => [s, s, hashOf(r, { sort: s })]);
    else if (r.kind === 'user') opts = [['overview', 'overview'], ['posts', 'posts'], ['comments', 'comments']].map((o) => [o[0], o[1], hashOf(r, { tab: o[0] })]);
    else if (r.kind === 'messages') opts = [['inbox', 'inbox', '#/messages'], ['sent', 'sent', '#/messages?box=sent']];
    else if (r.kind === 'search') opts = ['relevance', 'new', 'top'].map((s) => [s, s, hashOf(r, { sort: s })]);
    const cur = r.kind === 'user' ? r.tab : r.kind === 'messages' ? (r.q.box === 'sent' ? 'sent' : 'inbox') : r.sort;
    $('#feed-sorts').innerHTML = opts.map((o) => '<button role="tab" aria-selected="' + (o[0] === cur) + '" data-go="' + esc(o[2]) + '" class="press">' + o[1] + '</button>').join('');
    $('#feed-sorts').style.display = opts.length ? '' : 'none';
    $('#feed-body').innerHTML = '<div id="feed-top"></div><div id="feed-list"></div><div id="feed-more"></div>';
    renderFeedTop();
  }

  function renderFeedTop() {
    const F = S.feed, r = F.r;
    let h = '';
    if (r.kind === 'user' || (r.kind === 'sub' && !isGlobal(r) && r.name.indexOf('+') < 0 && set.imgFeed)) h += '<div class="phead" id="phead"></div>';
    if (r.kind === 'user' && S.me && lc(S.me) === lc(r.name)) h += '<div class="chips"><button data-go="#/messages">messages</button><button data-go="#/saved">saved</button><button data-go="#/inbox">inbox' + (S.unread ? ' (' + S.unread + ')' : '') + '</button></div>';
    if (r.kind === 'user' && A.cfg.user && !(S.me && lc(S.me) === lc(r.name))) h += '<div class="chips"><button data-act="msguser" data-u="' + esc(r.name) + '">message</button></div>';
    if (r.kind === 'search') {
      const comments = r.q.type === 'comments';
      h += '<div class="chips"><button data-go="' + esc(hashOf(r, { q: { type: '' } })) + '" aria-pressed="' + !comments + '">posts</button><button data-go="' + esc(hashOf(r, { q: { type: 'comments' } })) + '" aria-pressed="' + comments + '">comments</button>' +
        (r.q.sub ? '<button data-go="' + esc(hashOf(r, { q: { sub: '' } })) + '">r/' + esc(r.q.sub) + ' &times;</button>' : '') + (r.q.user ? '<button data-go="' + esc(hashOf(r, { q: { user: '' } })) + '">u/' + esc(r.q.user) + ' &times;</button>' : '') + '</div>';
    }
    if (['top', 'controversial'].includes(r.sort) && ['home', 'sub', 'search'].includes(r.kind) && !r.q.asof) {
      const t = r.q.t || (r.kind === 'search' ? 'all' : 'day');
      h += '<div class="chips">' + ['hour', 'day', 'week', 'month', 'year', 'all'].map((x) => '<button data-go="' + esc(hashOf(r, { q: { t: x } })) + '" aria-pressed="' + (x === t) + '">' + x + '</button>').join('') + '</div>';
    }
    if (r.kind === 'sub' && !isGlobal(r) && (S.tt || r.q.asof)) h += '<div class="tt" id="tt"></div>';
    h += '<div id="feed-notes"></div>';
    $('#feed-top').innerHTML = h;
    if ($('#tt')) renderTT();
    renderNotes();
    if ($('#phead')) fillHead(r);
  }

  function renderNotes() {
    const F = S.feed;
    const box = $('#feed-notes');
    if (!box) return;
    let h = '';
    const errs = Object.keys(F.errors).map((k) => F.errors[k]);
    if (errs.length && !F.items.length && F.loaded) {
      const codes = Array.from(new Set(errs.filter((e) => e.status).map((e) => 'HTTP ' + e.status)));
      const why = codes.length ? codes.join(' · ') : 'An error has occurred.';
      h += '<div class="note err"><span>' + esc(why) + '</span><button data-act="retry">Retry</button></div>';
    }
    box.innerHTML = h;
  }

  const sortKey = (r) => (['top', 'controversial'].includes(r.sort) ? 'score' : 'created');

  async function loadFeed(F) {
    if (F.busy) return;
    const r = F.r;
    let srcs = activeSources(r);
    if ((isGlobal(r) && !r.q.asof) || (r.kind === 'sub' && r.name.includes('+'))) {
      const ar = srcs.filter((x) => x !== 'R');
      srcs = (srcOn('R') || !isGlobal(r) || !ar.length) ? ['R'] : ar.slice(0, 1);
    }
    if (r.kind === 'removed') { const ar = srcs.filter((x) => x !== 'R'); srcs = ar.length ? ar.slice(0, 1) : ['A']; }
    if (r.kind === 'user' || r.kind === 'search') {  }
    if (r.kind === 'search' && r.q.type === 'comments') srcs = srcs.filter((x) => x !== 'R');
    if (r.kind === 'search' && r.q.type === 'comments' && !srcs.length) srcs = ['P'];
    srcs = srcs.filter((x) => !F.done[x]);
    if (!srcs.length) { renderMore(); return; }
    F.busy = true;
    F.srcs = srcs;
    renderMore();
    const before = F.items.length;
    await Promise.all(srcs.map((s) => fetchPage(F, s)));
    if (F !== S.feed) return;
    F.busy = false;
    F.loaded = true;
    rebuildItems(F);
    pinTop(F);
    renderNotes();
    renderList(before);
    cacheFeed(F);
    postCheck(F);
  }

  function asofEnd(r) { return r.q.asof ? Date.parse(r.q.asof + 'T23:59:59Z') / 1000 : null; }

  async function fetchPage(F, s) {
    const r = F.r, sort = r.sort, top = sortKey(r) === 'score';
    const isCm = (r.kind === 'user' && r.tab === 'comments') || (r.kind === 'search' && r.q.type === 'comments');
    const wantBoth = r.kind === 'user' && r.tab === 'overview';
    try {
      if (s === 'R') {
        const kind = r.kind === 'home' ? 'home' : r.kind;
        const o = { kind: kind === 'removed' ? 'sub' : kind, name: r.kind === 'home' ? homeName() : r.name, sort, t: r.q.t, after: F.cur.R, tab: r.tab === 'posts' ? 'submitted' : r.tab, q: r.kind === 'search' ? [r.q.q, r.q.user ? 'author:' + r.q.user : ''].filter(Boolean).join(' ') : r.q.q, sub: r.q.sub };
        const res = await A.reddit.listing(o);
        res.items.forEach((x) => addItem(F, x));
        F.cur.R = res.after;
        if (!res.after) F.done.R = true;
        return;
      }
      const win = r.q.asof ? { after: asofEnd(r) - 7 * 86400, before: asofEnd(r) } : (top && WIN[r.q.t || 'day'] ? { after: Math.floor(Date.now() / 1000) - WIN[r.q.t || 'day'] } : {});
      if (s === 'A') {
        const base = { limit: 100, sort: 'desc' };
        if ((r.kind === 'sub' && !isGlobal(r)) || r.kind === 'removed') base.subreddit = r.name;
        if (r.kind === 'user') base.author = r.name;
        if (r.kind === 'search') { if (r.q.sub) base.subreddit = r.q.sub; if (r.q.user) base.author = r.q.user; if (isCm) base.body = r.q.q; else base.query = r.q.q; }
        if (win.after) base.after = win.after;
        const before = F.cur.A != null ? F.cur.A : win.before;
        if (before) base.before = before;
        const jobs = [];
        if (!isCm || wantBoth) jobs.push(A.arctic.posts(base).then((l) => l.map((x) => ({ x, kind: 'p' }))));
        if (isCm || wantBoth) { const cb = Object.assign({}, base); delete cb.query; jobs.push(A.arctic.comments(cb).then((l) => l.map((x) => ({ x, kind: 'c' })))); }
        const all = [].concat.apply([], await Promise.all(jobs));
        all.forEach((it) => addItem(F, it.x));
        const last = all.length ? Math.min.apply(null, all.map((it) => it.x.created)) : null;
        F.cur.A = last;
        if (!all.length || (top && !r.q.asof) || (top && r.q.asof) || all.length < 20) F.done.A = true;
        return;
      }
      if (s === 'P') {
        const base = { sort: 'desc', sort_type: top ? 'score' : 'created_utc' };
        if ((r.kind === 'sub' && !isGlobal(r)) || r.kind === 'removed') base.subreddit = r.name;
        if (r.kind === 'user') base.author = r.name;
        if (r.kind === 'search') { base.q = r.q.q; if (r.q.sub) base.subreddit = r.q.sub; if (r.q.user) base.author = r.q.user; }
        if (win.after) base.after = win.after;
        if (win.before && !F.cur.P) base.before = win.before;
        let doneAll = true;
        const kinds = (!isCm || wantBoth ? ['topic'] : []).concat(isCm || wantBoth ? ['comment'] : []);
        F.cur.Pm = F.cur.Pm || {};
        for (const k of kinds) {
          if (F.cur.Pm[k] === 'done') continue;
          const b2 = Object.assign({}, base);
          if (k === 'comment') delete b2.sort_type;
          const pg = await A.pullpush.page(k, b2, F.cur.Pm[k] || null);
          pg.items.forEach((x) => addItem(F, x));
          if (pg.done || !pg.cursor) F.cur.Pm[k] = 'done'; else { F.cur.Pm[k] = pg.cursor; doneAll = false; }
        }
        if (doneAll) F.done.P = true;
      }
    } catch (e) {
      F.errors[s] = { status: e.status, message: e && e.message ? e.message : String(e), network: !!(e && e.network), src: s };
      try { console.warn('[astra] ' + s + ' failed:', e); } catch (x) {  }
      F.done[s] = true;
    }
  }

  function addItem(F, x) {
    if (x.title === undefined && x.body !== undefined) { if (!F.cmap.has(x.id)) { F.cmap.set(x.id, x); F.items.push({ c: x }); } return; }
    const m = A.addVersion(F.map, x);
    if (!F.items.some((it) => it.id === m.id)) F.items.push(m);
  }
  function rebuildItems(F) {
    const r = F.r;
    const multi = F.srcs.length > 1 || Object.keys(F.done).length > 1 || F.items.some((x) => x.c);
    if (r.kind === 'removed') return;
    const key = sortKey(r);
    if (r.kind === 'sub' && !multi && F.srcs[0] === 'R') return;
    if (F.srcs.length === 1 && F.srcs[0] === 'R' && !r.q.asof) return;
    F.items.sort((a, b) => {
      const A1 = a.c || a, B1 = b.c || b;
      return key === 'score' ? B1.score - A1.score : (B1.created || 0) - (A1.created || 0);
    });
  }

  async function postCheck(F) {
    const posts = F.items.filter((x) => !x.c);
    if (!posts.length) return;
    try {
      if (F.r.kind === 'removed') {
        const ids = posts.map((m) => m.id);
        await A.checkRemovedLive(F.map, ids);
        if (F !== S.feed) return;
        F.checked = (F.checked || 0) + ids.length;
        F.items = F.items.filter((m) => m.c || m.has.R === false || m.removedOnReddit);
        F.items.sort((a, b) => b.created - a.created);
        renderList(0);
        return;
      }
      const wantA = srcOn('A'), wantP = srcOn('P'), wantR = srcOn('R');
      const ids = posts.map((m) => m.id);
      const needArch = ids.filter((id) => (wantA && F.map.get(id).has.A === undefined) || (wantP && F.map.get(id).has.P === undefined));
      const needLive = wantR ? ids.filter((id) => F.map.get(id).has.R === undefined) : [];
      const jobs = [];
      if (needArch.length) jobs.push(A.checkArchives(F.map, needArch, { A: wantA, P: wantP }));
      if (needLive.length) jobs.push(A.checkRemovedLive(F.map, needLive).catch(() => {}));
      await Promise.all(jobs);
      if (F !== S.feed) return;
      renderList(F.items.length);
    } catch (e) {  }
  }

  function bannerHTML(m) {
    if (m.recovered) {
  return '<div class="banner" role="img" aria-label="Recovered" title="Recovered">' + icon('restore') + '</div>';
}
if (m.removedOnReddit) return '<div class="banner" role="img" aria-label="Deleted" title="Deleted">' + icon('trash') + '</div>';
return '';
  }
  function mediaThumb(m, big) {
    const src = m.preview || m.thumb;
    if (!src) return '';
    const blur = set.blur && (m.over18 || m.spoiler);
    return '<img src="' + esc(src) + '" alt="" loading="lazy" referrerpolicy="no-referrer"' + (blur ? ' class="blur"' : '') + '>';
  }
  function postRow(m, i, from) {
    const cls = ['post', 'press'];
    if (i >= from) cls.push('new');
    if (i === S.sel) cls.push('sel');
    if (S.read.has(m.id)) cls.push('read');
    if (m.recovered) cls.push('rec');
    const compact = set.compact;
    const showBig = !compact && (m.image || m.images || m.video || (m.preview && !m.isSelf));
    const badges = (m.over18 ? '<span class="badge nsfw">nsfw</span>' : '') + (m.spoiler ? '<span class="badge spoiler">spoiler</span>' : '') + (m.stickied ? '<span class="badge">pinned</span>' : '') + (m.flair ? '<span class="badge">' + esc(m.flair) + '</span>' : '') + (m.locked ? '<span class="badge">locked</span>' : '');
    const blur = set.blur && (m.over18 || m.spoiler);
    const big = showBig && (m.preview || m.thumb)
      ? '<div class="thumbbig' + (blur ? ' blur' : '') + '">' + mediaThumb(m) + (m.images ? '<span class="tag">' + m.images.length + ' images</span>' : m.video ? '<span class="tag">video</span>' : '') + '</div>' : '';
    const small = compact && (m.preview || m.thumb) ? '<div class="pthumb' + (blur ? ' blur' : '') + '">' + mediaThumb(m) + '</div>' : '';
    const ex = !showBig && m.selftext && !m.removedOnReddit ? '<p class="excerpt">' + esc(MD.unent(m.selftext).replace(/[#>*_`~]/g, '').slice(0, 280)) + '</p>' : (m.recovered && m.selftext ? '<p class="excerpt">' + esc(m.selftext.slice(0, 240)) + '</p>' : '');
    return '<article class="' + cls.join(' ') + '" style="--i:' + (i - from) + '" data-id="' + esc(m.id) + '" data-i="' + i + '" tabindex="0">' +
      '<div class="pmain">' + bannerHTML(m) + '<h3 class="ptitle"><a href="#/comments/' + esc(m.id) + '">' + esc(MD.unent(m.title)) + '</a></h3>' + (badges ? '<div class="badges">' + badges + '</div>' : '') + ex + big +
      '<div class="meta"><span><b>' + fmt(m.score) + '</b> pts</span><span>' + fmt(m.numComments) + ' comments</span><span>' + esc(m.domain && !m.isSelf ? m.domain : 'r/' + m.subreddit) + '</span><span>' + ago(m.created) + '</span>' + (S.feed && S.feed.r.kind === 'sub' ? '' : '<span>r/' + esc(m.subreddit) + '</span>') + '<span>u/' + esc(m.author) + '</span>' + '</div></div>' + small + '</article>';
  }
  function commentRow(c, i, from) {
    const link = c.link ? c.link.replace(/^t3_/, '') : '';
    return '<article class="post cmpost press' + (i >= from ? ' new' : '') + (i === S.sel ? ' sel' : '') + '" style="--i:' + (i - from) + '" data-cid="' + esc(c.id) + '" data-link="' + esc(link) + '" tabindex="0"><div class="ctx">' + (c.linkTitle ? esc(c.linkTitle) + ' · ' : '') + 'r/' + esc(c.subreddit) + ' · u/' + esc(c.author) + ' · ' + ago(c.created) + ' · ' + fmt(c.score) + ' pts' + (c.src !== 'R' ? ' · ' + SRCNAME[c.src] : '') + '</div><div class="cbody md">' + MD.render(c.body.slice(0, 600)) + '</div></article>';
  }
  const lc = (x) => String(x || '').toLowerCase();
  const blockedUser = (u) => !!u && S.blocks.users.some((x) => lc(x) === lc(u));
  const blockedSub = (u) => !!u && S.blocks.subs.some((x) => lc(x) === lc(u));
  const blockedText = (t) => { if (!S.blocks.words.length) return false; const l = lc(t); return S.blocks.words.some((w) => w && l.includes(lc(w))); };
  const hideDelPosts = () => set.hideDeleted === 'posts' || set.hideDeleted === 'both';
  const hideDelComments = () => set.hideDeleted === 'comments' || set.hideDeleted === 'both';
  const DEL_PAGES = [['feed', 'Home, popular and all'], ['sub', 'Subreddits'], ['user', 'Users'], ['search', 'Search'], ['thread', 'Threads']];
  const delPageOn = (k) => !set.hideDelPages || set.hideDelPages[k] !== false;
  const delScope = (r) => (r.kind === 'home' || (r.kind === 'sub' && isGlobal(r)) ? 'feed' : r.kind);
  const hideDelThread = () => hideDelComments() && delPageOn('thread');
  const deletedPost = (m) => !!(m.recovered || m.removedOnReddit || m.selftext === '[removed]' || m.selftext === '[deleted]');
  const deletedComment = (c) => A.isGone(c) || !!c.recovered || !!c.archiveOnly;
  function visibleItem(m) {
    const r = S.feed.r;
    const c = m.c || m;
    if (['saved', 'removed', 'inbox', 'messages'].includes(r.kind)) return true;
    if (delPageOn(delScope(r)) && (m.c ? (hideDelComments() && deletedComment(c)) : (hideDelPosts() && deletedPost(m)))) return false;
    if (!m.c && S.hidden.has(m.id)) return false;
    if (r.kind === 'user') return true;
    if (blockedUser(c.author) || (blockedSub(c.subreddit) && !(r.kind === 'sub' && lc(r.name) === lc(c.subreddit)))) return false;
    if (m.c) return !blockedText(c.body);
    if (set.hideNsfw && m.over18) return false;
    if (set.hideRead && S.read.has(m.id) && r.kind !== 'search') return false;
    return !blockedText(m.title + ' ' + (m.selftext || '').slice(0, 600));
  }
  function renderList(from) {
    const F = S.feed, list = $('#feed-list');
    if (!list) return;
    if (!F.loaded && !F.items.length) { list.innerHTML = '<div class="skel"></div><div class="skel"></div><div class="skel"></div><div class="skel"></div>'; renderMore(); return; }
    if (!F.items.length) {
      const hasErr = Object.keys(F.errors).length;
      list.innerHTML = '';
      renderMore();
      return;
    }
    const V = (F.view = F.items.filter(visibleItem));
    if (!V.length) { list.innerHTML = ''; renderMore(); return; }
    list.innerHTML = V.map((m, i) => (m.c ? commentRow(m.c, i, from) : postRow(m, i, from))).join('');
    renderMore();
  }
  let moreObs;
  function renderMore() {
    const F = S.feed, box = $('#feed-more');
    if (!box) return;
    const canMore = F.loaded && Object.keys(F.done).length < Math.max(1, activeCount(F)) || (F.loaded && F.srcs.some((s) => !F.done[s]));
    if (F.busy && F.loaded) box.innerHTML = '<div class="loadingbar"></div>';
    else if (F.busy) box.innerHTML = '';
    else if (F.loaded && F.items.length && F.srcs.some((s) => !F.done[s])) box.innerHTML = '<button class="more-tile press" data-act="more">more</button>';
    else box.innerHTML = '';
    void canMore;
    if (moreObs) moreObs.disconnect();
    const b = $('#feed-more .more-tile');
    if (b && 'IntersectionObserver' in window) {
      moreObs = new IntersectionObserver((en) => { if (en[0].isIntersecting && !S.feed.busy) loadFeed(S.feed); }, { root: $('#feed-body'), rootMargin: '200px' });
      moreObs.observe(b);
    }
  }
  const activeCount = (F) => F.srcs.length;

  async function loadSaved(F) {
    F.loaded = true;
    const l = Object.values(S.saved).sort((a, b) => b.savedAt - a.savedAt);
    l.forEach((p) => { const m = Object.assign({ v: {}, has: {} }, p); F.items.push(m); });
    F.srcs = [];
    $('#feed-title').textContent = 'saved';
    renderList(0);
    if (A.cfg.user) {
      try {
        if (!S.me) { const me = await A.reddit.me(); S.me = me.name; store.set('me', me.name); }
        const res = await A.reddit.listing({ kind: 'saved', name: S.me });
        res.items.forEach((x) => { if (x.title !== undefined) addItem(F, x); });
        F.view = null;
        renderList(F.items.length);
      } catch (e) { errToast(e); }
    }

  }
  async function loadInbox(F) {
    F.loaded = true; F.srcs = [];
    if (!A.cfg.user) { $('#feed-list').innerHTML = '<div class="empty"><div class="acts"><button class="btn primary" data-act="settings">Sign in</button></div></div>'; return; }
    try {
      const l = await A.reddit.inbox('inbox');
      $('#feed-list').innerHTML = l.length ? l.map((m, i) => '<article class="post press new" style="--i:' + i + '" data-ctx="' + esc(m.context) + '" tabindex="0"><div class="ptitle" style="font-size:17px">' + esc(m.subject) + '</div><div class="cbody md">' + MD.render(m.body.slice(0, 400)) + '</div><div class="meta"><span>u/' + esc(m.author) + '</span><span>' + ago(m.created) + '</span>' + (m.isNew ? '<span style="color:var(--accent)">new</span>' : '') + '</div></article>').join('') : '';
    } catch (e) { $('#feed-list').innerHTML = '<div class="note err">' + (e.status ? '<span>HTTP ' + e.status + '</span>' : '') + '</div>'; }
  }

  async function loadMessages(F) {
    F.loaded = true; F.srcs = [];
    const box = F.r.q.box === 'sent' ? 'sent' : 'inbox';
    if (!A.cfg.user) { $('#feed-list').innerHTML = '<div class="empty"><div class="acts"><button class="btn primary" data-act="settings">Sign in</button></div></div>'; return; }
    try {
      const l = await A.reddit.messages(box);
      S.msgs = l; S.msgBox = box;
      const top = '<div class="chips"><button data-act="newmsg">new message</button></div>';
      $('#feed-list').innerHTML = top + (l.length ? l.map((m, i) => {
        const who = box === 'sent' ? 'to u/' + m.dest : 'u/' + m.author;
        return '<article class="post press new" style="--i:' + i + '" data-pm="' + i + '" tabindex="0" role="button"><div class="ptitle" style="font-size:17px">' + (m.isNew && box === 'inbox' ? '&#9679; ' : '') + esc(MD.unent(m.subject)) + '</div>' +
          '<div class="cbody md">' + MD.render(m.body.slice(0, 300)) + '</div><div class="meta"><span>' + esc(who) + '</span><span>' + ago(m.created) + ' ago</span>' + (m.replies.length ? '<span>' + m.replies.length + ' repl' + (m.replies.length === 1 ? 'y' : 'ies') + '</span>' : '') + '</div></article>';
      }).join('') : '<div class="empty">No messages.</div>');
    } catch (e) { $('#feed-list').innerHTML = '<div class="note err"><span>' + esc(e.message || 'Messages could not be loaded.') + '</span></div>'; }
  }
  function openMessage(k) {
    const m = S.msgs && S.msgs[k];
    if (!m) return;
    const conv = [m].concat(m.replies).sort((a, b) => a.created - b.created), last = conv[conv.length - 1];
    const d = openDlg('<h2>' + esc(MD.unent(m.subject) || 'message') + '</h2>' + conv.map((x) => '<div class="msg"><p class="help"><b>u/' + esc(x.author) + '</b> &middot; ' + ago(x.created) + ' ago</p><div class="md">' + MD.render(x.body) + '</div></div>').join('') +
      '<form id="mreply"><label for="mtext">Reply</label><textarea id="mtext" rows="4"></textarea><div class="row"><button class="btn primary">Send</button><button class="btn" type="button" data-close>Close</button></div></form>');
    d.querySelector('.dlg').classList.add('lc');
    const unread = conv.filter((x) => x.isNew).map((x) => x.name);
    if (unread.length && S.msgBox === 'inbox') A.reddit.readMessages(unread).then(() => { unread.forEach((n) => { const x = conv.find((y) => y.name === n); if (x) x.isNew = false; }); S.unread = Math.max(0, S.unread - 1); renderBar(); }).catch(() => {});
    d.querySelector('#mreply').onsubmit = async (e) => {
      e.preventDefault();
      const t = d.querySelector('#mtext').value.trim();
      if (!t) return;
      try { await A.reddit.replyMessage(last.name, t); d.close(); toast('Message sent'); A.clearCache(); if (S.feed) loadMessages(S.feed); }
      catch (err) { toast(err.message || 'The message could not be sent.'); }
    };
  }
  function openCompose(to) {
    if (needAuth()) return;
    const d = openDlg('<h2>new message</h2><form id="mnew"><label for="mto">To</label><input type="text" id="mto" value="' + esc(to || '') + '" placeholder="Username" autocomplete="off" autocapitalize="off" spellcheck="false">' +
      '<label for="msub">Subject</label><input type="text" id="msub" maxlength="100" autocomplete="off"><label for="mbody">Message</label><textarea id="mbody" rows="6"></textarea>' +
      '<div class="row"><button class="btn primary">Send</button><button class="btn" type="button" data-close>Cancel</button></div></form>');
    d.querySelector('.dlg').classList.add('lc');
    d.querySelector('#mnew').onsubmit = async (e) => {
      e.preventDefault();
      const u = d.querySelector('#mto').value.trim().replace(/^\/?u\//i, ''), sj = d.querySelector('#msub').value.trim(), tx = d.querySelector('#mbody').value.trim();
      if (!u || !sj || !tx) { toast('Enter a recipient, subject and message.'); return; }
      try { await A.reddit.compose(u, sj, tx); d.close(); toast('Message sent'); A.clearCache(); if (S.feed && S.feed.r.kind === 'messages') loadMessages(S.feed); }
      catch (err) { toast(err.message || 'The message could not be sent.'); }
    };
  }

  async function renderTT() {
    const box = $('#tt'), r = S.feedRoute;
    if (!box || !r || r.kind !== 'sub') return;
    const asof = r.q.asof || '';
    box.innerHTML = '<div class="tt-head"><span>' + (asof ? 'as of <b>' + esc(asof) + '</b>' : 'Pick a moment in <b>r/' + esc(r.name) + '</b>') + '</span><span><input type="date" id="ttdate" value="' + esc(asof) + '" max="' + ymd(Date.now() / 1000) + '" aria-label="As of date"> ' + (asof ? '<button class="btn small" data-act="ttnow">Now</button>' : '') + '</span></div><div class="tt-axis"><span>loading activity…</span></div>';
    try {
      let ts = S.ttCache[r.name];
      if (!ts) ts = S.ttCache[r.name] = await A.arctic.timeSeries(r.name, 'month');
      if (!$('#tt') || S.feedRoute !== r) return;
      if (!ts.length) { $('.tt-axis', box).innerHTML = '<span>No activity data for this subreddit.</span>'; return; }
      const max = Math.max.apply(null, ts.map((x) => x.v)) || 1;
      const t0 = ts[0].t, t1 = ts[ts.length - 1].t + 2592000;
      const w = 100 / ts.length;
      const sel = asof ? Date.parse(asof + 'T00:00:00Z') / 1000 : null;
      const bars = ts.map((x, i) => '<rect class="bar' + (sel && sel >= x.t && sel < x.t + 2678400 ? '' : ' dim') + '" x="' + (i * w).toFixed(3) + '" width="' + Math.max(0.4, w - 0.3).toFixed(3) + '" y="' + (56 - (x.v / max) * 52 - 2).toFixed(1) + '" height="' + ((x.v / max) * 52 + 2).toFixed(1) + '"><title>' + ymd(x.t).slice(0, 7) + ': ' + fmt(x.v) + ' posts</title></rect>').join('');
      box.querySelector('.tt-axis').insertAdjacentHTML('beforebegin', '<svg viewBox="0 0 100 56" preserveAspectRatio="none" data-t0="' + t0 + '" data-t1="' + t1 + '">' + bars.replace(/class="bar dim"/g, 'class="bar dim" style="fill:var(--tile)"') + '</svg>');
      $('.tt-axis', box).innerHTML = '<span>' + ymd(t0).slice(0, 4) + '</span><span>' + ymd(t1).slice(0, 4) + '</span>';
    } catch (e) { $('.tt-axis', box).innerHTML = '<span>Activity chart unavailable: ' + esc(e.message) + '</span>'; }
  }
  document.addEventListener('click', (e) => {
    const svg = e.target.closest('.tt svg');
    if (!svg) return;
    const rc = svg.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - rc.left) / rc.width));
    const t = +svg.dataset.t0 + f * (+svg.dataset.t1 - +svg.dataset.t0 - 2592000);
    go(hashOf(S.feedRoute, { sort: 'top', q: { asof: ymd(t) } }));
  });
  document.addEventListener('change', (e) => {
    if (e.target.id === 'ttdate' && e.target.value) go(hashOf(S.feedRoute, { sort: 'top', q: { asof: e.target.value } }));
  });

  $('#hub-feed').addEventListener('click', (e) => {
    const g = e.target.closest('[data-go]');
    if (g) { e.preventDefault(); go(g.dataset.go); return; }
    const act = e.target.closest('[data-act]');
    if (act) {
      if (act.dataset.act === 'more') loadFeed(S.feed);
      else if (act.dataset.act === 'retry') { S.feed.errors = {}; S.feed.done = {}; loadFeed(S.feed); }
      else if (act.dataset.act === 'settings') openSettings();
      else if (act.dataset.act === 'newmsg') openCompose('');
      else if (act.dataset.act === 'msguser') openCompose(act.dataset.u);
      else if (act.dataset.act === 'ttnow') go(hashOf(S.feedRoute, { q: { asof: '' } }));
      return;
    }
    const row = e.target.closest('.post');
    if (!row) return;
    if (row.dataset.pm !== undefined) { openMessage(+row.dataset.pm); return; }
    if (row.dataset.ctx) { const L = A.parseLink('https://www.reddit.com' + row.dataset.ctx); if (L && L.hash) go(L.hash); return; }
    if (row.dataset.cid) { go('#/comments/' + row.dataset.link + '?c=' + row.dataset.cid); return; }
    S.sel = +row.dataset.i;
    $$('.post.sel', $('#feed-list')).forEach((x) => x.classList.remove('sel'));
    row.classList.add('sel');
    if (e.target.closest('a')) e.preventDefault();
    go('#/comments/' + row.dataset.id);
  });
  $('#feed-body').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.classList.contains('post')) e.target.click(); });

  const rowPost = (id) => (S.feed && (S.feed.map.get(id) || S.feed.items.find((x) => x.id === id))) || null;
  function hidePost(m) {
    S.hidden.add(m.id); store.set('hidden', Array.from(S.hidden).slice(-3000));
    if (A.cfg.user && m.name) A.reddit.hide(m.name, true).catch(() => {});
    renderList(S.feed.items.length);
    toast('Post hidden', 'Undo', () => { S.hidden.delete(m.id); store.set('hidden', Array.from(S.hidden)); renderList(S.feed.items.length); });
  }
  function feedVote(m, dir) {
    if (needAuth()) return;
    A.reddit.vote(m.name, dir).catch(errToast);
  }
  function rowMenu(id) {
    const m = rowPost(id);
    if (!m) return;
    const saved = !!S.saved[m.id];
    const d = openDlg('<h2 style="font-size:24px;line-height:1.2">' + esc(MD.unent(m.title).slice(0, 70)) + '</h2><ul class="menu">' + [
      ['up', 'upvote'], ['save', saved ? 'unsave' : 'save'], ['hide', 'hide post'], ['bu', 'block u/' + m.author], ['bs', 'block r/' + m.subreddit],
      ['copy', 'copy link'], ['open', 'open on Reddit'], ['sub', 'go to r/' + m.subreddit]
    ].map((x) => '<li><button data-m="' + x[0] + '">' + esc(x[1]) + '</button></li>').join('') + '</ul>');
    d.querySelector('.dlg').style.padding = '18px 0 8px';
    d.querySelector('h2').style.padding = '0 24px';
    d.querySelector('.menu').onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      d.close();
      switch (b.dataset.m) {
        case 'up': feedVote(m, 1); break;
        case 'save': toggleSavePost(m); break;
        case 'hide': hidePost(m); break;
        case 'bu': addBlock('users', m.author); break;
        case 'bs': addBlock('subs', m.subreddit); break;
        case 'copy': copy(location.origin + location.pathname + '#/comments/' + m.id, 'Copied'); break;
        case 'open': window.open('https://www.reddit.com' + (m.permalink || '/comments/' + m.id), '_blank', 'noopener'); break;
        case 'sub': go('#/r/' + encodeURIComponent(m.subreddit)); break;
        default: break;
      }
    };
  }
  $('#feed-body').addEventListener('contextmenu', (e) => { const row = e.target.closest('.post[data-id]'); if (row) { e.preventDefault(); rowMenu(row.dataset.id); } });

  function lightbox(urls, i) {
    const o = document.createElement('div');
    o.className = 'lightbox';
    const draw = () => { o.innerHTML = '<img src="' + esc(urls[i]) + '" alt="" referrerpolicy="no-referrer"><button class="lb-x" aria-label="Close">&times;</button>' + (urls.length > 1 ? '<button class="lb-p" aria-label="Previous">&lsaquo;</button><button class="lb-n" aria-label="Next">&rsaquo;</button><div class="lb-c">' + (i + 1) + ' / ' + urls.length + '</div>' : ''); };
    const close = () => { o.remove(); document.removeEventListener('keydown', key, true); };
    const key = (e) => { if (e.key === 'Escape') close(); else if (e.key === 'ArrowRight' && urls.length > 1) { i = (i + 1) % urls.length; draw(); } else if (e.key === 'ArrowLeft' && urls.length > 1) { i = (i - 1 + urls.length) % urls.length; draw(); } else return; e.stopPropagation(); };
    o.onclick = (e) => {
      if (e.target.closest('.lb-n')) { i = (i + 1) % urls.length; draw(); } else if (e.target.closest('.lb-p')) { i = (i - 1 + urls.length) % urls.length; draw(); } else close();
    };
    document.addEventListener('keydown', key, true);
    draw();
    document.body.appendChild(o);
  }
  function inlineMedia(root) {
    $$('.md a[href]', root).forEach((a) => {
      if (a.dataset.done) return;
      const h = a.getAttribute('href') || '';
      if (/\.(jpe?g|png|gif|webp)(\?|$)/i.test(h) || /^https?:\/\/(i\.redd\.it|preview\.redd\.it|i\.imgur\.com)\//i.test(h)) {
        a.dataset.done = '1';
        const img = document.createElement('img');
        img.className = 'cimg'; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer'; img.alt = ''; img.src = h;
        img.onerror = () => img.remove();
        a.after(img);
      }
    });
  }

  let threadRaf = 0;
  function openThread(id, hl, force) {
    id = String(id).replace(/^t3_/, '');
    if (!force && S.T && S.T.id === id) { if (hl) S.hl = hl; renderThread(true); return; }
    S.ver = 'best'; S.folded = new Set(); S.orig = new Set(); S.hl = hl || null; S.reply = null; S.cfind = ''; S.unblur = false;
    const NM = { R: 'reddit', A: 'arctic', P: 'pullpush' };
    const src = ['R', 'A', 'P'].filter(srcOn).map((c) => NM[c]);
    S.read.add(id); store.set('read', Array.from(S.read).slice(-2000));
    const T = (S.T = A.loadThread(id, { src, sort: S.csort, onUpdate: () => scheduleThread() }));
    T.src = src;
    renderThread(true);
    const row = $('.post[data-id="' + CSS.escape(id) + '"]');
    if (row) row.classList.add('read');
  }
  function scheduleThread() { if (threadRaf) return; threadRaf = requestAnimationFrame(() => { threadRaf = 0; renderThread(false); }); }

  function mediaHTML(p) {
    const blur = set.blur && (p.over18 || p.spoiler) && !S.unblur;
    let h = '';
    const wrap = (inner) => '<div class="media' + (blur ? ' blur' : '') + '"' + (blur ? ' data-act="unblur" title="Click to reveal"' : '') + '>' + inner + '</div>';
    if (p.video) {
      const hls = p.video.hls && document.createElement('video').canPlayType('application/vnd.apple.mpegurl');
      const poster = p.preview ? ' poster="' + esc(p.preview) + '"' : '';
      if (hls) h += wrap('<video controls playsinline preload="metadata" src="' + esc(p.video.hls) + '"' + poster + '></video>');
      else h += wrap('<div class="vwrap"><video playsinline ' + (p.video.gif && set.autoplay ? 'autoplay muted loop ' : p.video.gif ? 'muted loop controls ' : '') + 'preload="metadata" src="' + esc(p.video.url) + '"' + poster + '></video><div class="vctl"><button type="button" class="vp" aria-label="Play">&#9654;</button><input type="range" class="vs" min="0" max="1000" value="0" aria-label="Position"><span class="vt">0:00</span>' + (p.video.gif ? '' : '<button type="button" class="vm" aria-label="Sound">&#9835;</button>') + '</div></div>');
    } else if (p.images && p.images.length > 1) h += wrap('<div class="gallery">' + p.images.map((u) => '<img src="' + esc(u) + '" alt="" loading="lazy" referrerpolicy="no-referrer">').join('') + '</div>' + (blur ? '' : '<button type="button" class="gnav gp" data-gal="-1" aria-label="Previous image">&lsaquo;</button><button type="button" class="gnav gn" data-gal="1" aria-label="Next image">&rsaquo;</button>'));
    else if (p.image || (p.images && p.images[0])) h += wrap('<img src="' + esc(p.image || p.images[0]) + '" alt="" referrerpolicy="no-referrer">');
    else if (p.preview && !p.isSelf) h += wrap('<img src="' + esc(p.preview) + '" alt="" referrerpolicy="no-referrer">');
    if (p.url && !p.isSelf && !p.image && !p.images && !p.video) h += '<a class="linkcard press" href="' + esc(/^https?:/.test(p.url) ? p.url : '#') + '" target="_blank" rel="noopener noreferrer"><small>' + esc(p.domain || 'link') + '</small><span>' + esc(p.url.slice(0, 120)) + '</span></a>';
    return h;
  }
  function bodyOf(p, tint) {
    const txt = p.selftext && !['[removed]', '[deleted]'].includes(p.selftext) ? '<div class="md">' + MD.render(p.selftext) + '</div>' : (p.selftext ? '<p class="empty" style="padding:6px 0">' + esc(p.selftext) + '</p>' : '');
    return mediaHTML(p) + (txt ? '<div class="tbody' + (tint ? ' rec' : '') + '">' + txt + '</div>' : '');
  }
  function archiveVersion(m) {
    const l = [m.v.A, m.v.P].filter(Boolean).sort((a, b) => (+!!a.removed - +!!b.removed) || ((a.retrieved || 1e12) - (b.retrieved || 1e12)));
    return l[0] || null;
  }
  function scoreOf(name, base, likes) {
    const d = S.votes[name] !== undefined ? S.votes[name] : (likes === true ? 1 : likes === false ? -1 : 0);
    const orig = likes === true ? 1 : likes === false ? -1 : 0;
    return { n: base + (d - orig), d };
  }

  function headHTML(T) {
    const m = T.post;
    if (!m) {
      if (T.loading.R || T.loading.A || T.loading.P) return '<div class="skel" style="height:120px"></div><div class="skel"></div>';
      return '<div class="empty"><div class="acts"><button class="btn primary" data-act="refresh">Retry</button></div></div>';
    }
    const pick = S.ver !== 'best' && m.v[S.ver] ? S.ver : null;
    let shown = m, note = '', tint = !!m.recovered;
    if (pick) {
      shown = m.v[pick]; tint = pick !== 'R';
      note = '<p class="srcnote ' + pick.toLowerCase() + '">' + SRCNAME[pick] + (pick === 'R' ? ' · live' : ' · ' + (shown.retrieved ? fdt(shown.retrieved) : 'archived') + (shown.captureSec != null ? ' · +' + dur(Math.max(0, shown.captureSec)) + ' after posting' : '')) + '</p>';
    } else if (m.recovered) { const v = m.v[m.recovered]; note = '<p class="srcnote ' + (m.recovered === 'A' ? 'a' : 'p') + '">Recovered from ' + SRCNAME[m.recovered] + (v && v.captureSec != null ? ' · captured +' + dur(Math.max(0, v.captureSec)) + ' after posting' : '') + '</p>'; }
    else if (m.removedOnReddit) note = '<p class="srcnote amber">Removed on Reddit' + (T.loading.A || T.loading.P ? ' · looking in the archives…' : '') + '</p>';
    const sc = scoreOf(m.name, m.score, m.v.R && m.v.R.likes);
    const body = bodyOf(shown, tint);
    return '<div class="tmeta">' + (set.imgPost ? avTag('r', shown.subreddit) : '') + '<a href="#/r/' + encodeURIComponent(shown.subreddit) + '">r/' + esc(shown.subreddit) + '</a><a href="#/u/' + encodeURIComponent(shown.author) + '">u/' + esc(shown.author) + '</a><span>' + ago(shown.created) + ' ago</span>' + (shown.flair ? '<span>' + esc(shown.flair) + '</span>' : '') + (shown.over18 ? '<span style="color:#FF6B6B">nsfw</span>' : '') + '<a href="https://www.reddit.com' + esc(m.permalink) + '" target="_blank" rel="noopener noreferrer">open on Reddit</a></div>' +
      note + body +
      '<div class="tstats"><span><button class="cact-btn" data-vote="up" data-n="' + m.name + '" style="border:0;background:none;padding:0 4px;color:' + (sc.d === 1 ? 'var(--accent)' : 'var(--dim)') + '" aria-label="Upvote">&#9650;</button><b>' + fmt(sc.n) + '</b><button data-vote="down" data-n="' + m.name + '" style="border:0;background:none;padding:0 4px;color:' + (sc.d === -1 ? 'var(--amber)' : 'var(--dim)') + '" aria-label="Downvote">&#9660;</button></span><span><b>' + fmt(m.numComments) + '</b> comments</span></div>';
  }

  function keepIds(T, pred) {
    const keep = new Set();
    (function walk(list, trail) {
      list.forEach((n) => {
        if (!n.c) return;
        const hit = pred(n.c);
        const t2 = trail.concat(n.c.id);
        if (hit) t2.forEach((id) => keep.add(id));
        walk(n.kids, t2);
      });
    })(T.tree, []);
    return keep;
  }
  function cNode(n, keep) {
    if (n.stub) {
      const cnt = n.stub.count || n.stub.ids.length;
      S.stubs.push(n.stub);
      return '<button class="stubbtn" data-act="more" data-k="' + (S.stubs.length - 1) + '">load ' + (cnt || 'more') + ' more ' + (cnt === 1 ? 'reply' : 'replies') + '</button>';
    }
    const c = n.c;
    if ((keep && !keep.has(c.id)) || blockedUser(c.author) || blockedText(c.body)) return '';
    if (hideDelThread() && deletedComment(c)) return n.kids.map((k) => cNode(k, keep)).join('');
    const gone = A.isGone(c) && !c.recovered;
    const rec = c.recovered;
    const showOrig = S.orig.has(c.id) && rec;
    const body = showOrig ? c.reddit.body : c.body;
    const folded = S.folded.has(c.id);
    const sc = scoreOf(c.name, c.score, c.likes);
    let tag = '';
    if (rec) {
      const rl = 'Recovered · ' + (rec === 'A' ? 'Arctic Shift' : 'PullPush') + (c.captureSec != null ? ' · +' + dur(Math.max(0, c.captureSec)) : '');
      tag = '<span class="tag ' + (rec === 'A' ? 'a' : 'p') + '" role="img" aria-label="' + rl + '" title="' + rl + '">' + icon('restore') + '</span>';
    }
    else if (c.archiveOnly) tag = '<span class="tag ' + (c.src === 'A' ? 'a' : 'p') + '" role="img" aria-label="Deleted" title="Deleted">' + icon('trash') + '</span>';
    else if (gone) tag = '<span class="tag mute" role="img" aria-label="' + (c.body === '[removed]' ? 'Removed' : 'Deleted') + '" title="' + (c.body === '[removed]' ? 'Removed' : 'Deleted') + '">' + icon('trash') + '</span>';
    const au = showOrig ? c.reddit.author : c.author;
    const kids = n.kids.map((k) => cNode(k, keep)).join('');
    const hl = S.hl && S.hl === c.id;
    return '<div class="c' + (rec ? ' rec' + (rec === 'A' ? ' ra' : '') : '') + (folded ? ' folded' : '') + (hl ? ' hl' : '') + '" data-id="' + esc(c.id) + '"><div class="cwrap"><div class="chead">' + (set.imgComments && au !== '[deleted]' ? avTag('u', au) : '') +
      (au === '[deleted]' ? '<span>[deleted]</span>' : '<a class="au' + (c.op ? ' op' : '') + (c.distinguished === 'moderator' ? ' mod' : '') + '" href="#/u/' + encodeURIComponent(au) + '">' + esc(au) + (c.op ? ' · op' : '') + '</a>') +
      '<span>' + (c.scoreHidden ? '•' : fmt(sc.n)) + ' pts</span><span>' + ago(c.created) + '</span>' + (c.stickied ? '<span class="tag mute">pinned</span>' : '') + tag + '<button class="fold" data-act="fold" aria-label="Collapse">' + (folded ? '+' : '&minus;') + '</button></div>' +
      '<div class="cbody md">' + (gone ? '<p style="color:var(--faint)">' + esc(c.body || '[deleted]') + '</p>' : MD.render(body)) + '</div>' +
      '<div class="cact"><button data-vote="up" data-n="' + c.name + '" class="' + (sc.d === 1 ? 'on' : '') + '">up</button><button data-vote="down" data-n="' + c.name + '" class="dn ' + (sc.d === -1 ? 'on' : '') + '">down</button><button data-act="reply">reply</button>' + (rec ? '<button data-act="orig">' + (showOrig ? 'show recovered' : 'show Reddit version') + '</button>' : '') + '<button data-act="csave" class="' + (S.saved['c_' + c.id] || c.saved ? 'on' : '') + '">save</button><button data-act="ccopy">copy</button><button data-act="clink">link</button></div></div>' +
      (kids ? '<div class="kids' + (n.depth > 7 ? ' flat' : '') + '">' + kids + '</div>' : '') + '</div>';
  }
  function commentsHTML(T) {
    S.stubs = [];
    if (!T.tree) return '';
    const pred = (c) => !S.cfind || (c.body + ' ' + c.author).toLowerCase().includes(S.cfind);
    const keep = S.cfind ? keepIds(T, pred) : null;
    const st = T.stats || { total: 0, recovered: 0, archiveOnly: 0 };
    const busy = T.loading.R || T.loading.A || T.loading.P;
    const srcs = ['R', 'A', 'P'].map((k) => (T.loading[k] ? SRCNAME[k] + '…' : '')).filter(Boolean).join(' · ');
    let hiddenCount = 0;
    if (hideDelThread()) (function count(list) { list.forEach((n) => { if (n.c && deletedComment(n.c)) hiddenCount++; count(n.kids); }); })(T.tree);
    let h = '<div class="cbar"><div class="pivot small" role="tablist" aria-label="Comment sort">' + ['best', 'top', 'new', 'old', 'controversial'].map((s) => '<button role="tab" data-csort="' + s + '" aria-selected="' + (T.sort === s) + '">' + s + '</button>').join('') + '</div><span class="ct">' + (st.total - hiddenCount) + ' comments' + '</span></div>';
    h += '<input class="find" id="cfind" type="search" placeholder="Find in comments" value="' + esc(S.cfind) + '" aria-label="Find in comments">';
    if (busy) h += '<div class="loadingbar" title="' + esc(srcs) + '"></div>';
    if (S.reply === 'top') h += replyForm('top');
    h += T.tree.map((n) => cNode(n, keep)).join('');
    return h;
  }
  function replyForm(id) {
    return '<form class="reply" data-reply="' + esc(id) + '">' + mdEditor() + '<div class="row"><button class="btn primary small">Reply</button><button class="btn small" type="button" data-act="cancelreply">Cancel</button></div></form>';
  }
  function openReply(cEl) {
    if (needAuth() || !cEl) return;
    $$('.reply', $('#t-comments')).forEach((f) => f.remove());
    cEl.querySelector('.cwrap').insertAdjacentHTML('beforeend', replyForm(cEl.dataset.id));
    cEl.querySelector('textarea').focus();
  }
  function renderThread(first) {
    const T = S.T, body = $('#thread-body');
    if (!T) return;
    if (first || !$('#t-head')) {
      body.innerHTML = '<div class="thread"><div id="t-head"></div><div id="t-comments"></div></div>';
    }
    const keepDraft = !!$('#t-comments .reply');
    $('#t-head').innerHTML = headHTML(T);
    if (!keepDraft) $('#t-comments').innerHTML = commentsHTML(T);
    if (S.hl && T.flat && T.flat.has(S.hl)) {
      const el = $('.c[data-id="' + CSS.escape(S.hl) + '"]');
      if (el) { el.classList.add('hl'); el.scrollIntoView({ block: 'center' }); S.hl = null; }
    }
    const tt = $('#thread-title'), real = T.post ? MD.unent(T.post.title) : '';
    if (tt) { tt.textContent = real || 'thread'; tt.classList.toggle('real', !!real); }
    renderBar();
    updateTitle();
  }
  const findC = (id) => (S.T && S.T.flat ? S.T.flat.get(id) : null);

  $('#hub-thread').addEventListener('click', async (e) => {
    const T = S.T;
    const vt = e.target.closest('[data-vote]');
    if (vt) { vote(vt.dataset.n, vt.dataset.vote === 'up' ? 1 : -1); return; }
    const ver = e.target.closest('[data-ver]');
    if (ver) { S.ver = ver.dataset.ver; renderThread(false); return; }
    const cs = e.target.closest('[data-csort]');
    if (cs) { T.rebuild(cs.dataset.csort); S.csort = cs.dataset.csort; $('#t-comments').innerHTML = commentsHTML(T); return; }
    const gb = e.target.closest('[data-gal]');
    if (gb) {
      const g = gb.parentElement.querySelector('.gallery'), imgs = g ? Array.from(g.children) : [];
      if (imgs.length) {
        const gl = g.getBoundingClientRect().left;
        const posOf = (el) => el.getBoundingClientRect().left - gl + g.scrollLeft;
        let cur = 0;
        imgs.forEach((el, k) => { if (Math.abs(posOf(el) - g.scrollLeft) < Math.abs(posOf(imgs[cur]) - g.scrollLeft)) cur = k; });
        const to = Math.max(0, Math.min(imgs.length - 1, cur + (+gb.dataset.gal)));
        g.scrollTo({ left: posOf(imgs[to]), behavior: reduced() ? 'auto' : 'smooth' });
      }
      return;
    }
    if (e.target.closest('[data-act="unblur"]')) { S.unblur = true; renderThread(false); return; }
    const im = e.target.closest('.media img, .cimg');
    if (im) {
      const grp = im.closest('.gallery') ? $$('img', im.closest('.gallery')).map((x) => x.src) : [im.src];
      lightbox(grp, Math.max(0, grp.indexOf(im.src)));
      return;
    }
    const a = e.target.closest('[data-act]');
    if (!a) {
      const tap = e.target.closest('.chead, .cbody');
      if (tap && !e.target.closest('a, button, .spoiler, video, input')) {
        const cEl = tap.closest('.c');
        if (cEl) { const id = cEl.dataset.id; if (S.folded.has(id)) S.folded.delete(id); else S.folded.add(id); cEl.classList.toggle('folded'); const fb = cEl.querySelector('.fold'); if (fb) fb.innerHTML = S.folded.has(id) ? '+' : '&minus;'; }
      }
      return;
    }
    const cEl = a.closest('.c');
    const id = cEl && cEl.dataset.id;
    switch (a.dataset.act) {
      case 'fold': if (S.folded.has(id)) S.folded.delete(id); else S.folded.add(id); cEl.classList.toggle('folded'); a.innerHTML = S.folded.has(id) ? '+' : '&minus;'; break;
      case 'orig': if (S.orig.has(id)) S.orig.delete(id); else S.orig.add(id); $('#t-comments').innerHTML = commentsHTML(T); break;
      case 'more': {
        const stub = S.stubs[+a.dataset.k];
        a.textContent = 'loading…';
        try { await A.loadMore(T, stub); } catch (err) { errToast(err); }
        $('#t-comments').innerHTML = commentsHTML(T);
        break;
      }
      case 'reply': {
        openReply(cEl);
        break;
      }
      case 'ccopy': { const c = findC(id); if (c) copy(c.body, 'Copied'); break; }
      case 'cancelreply': { const f = a.closest('.reply'); f.remove(); S.reply = null; break; }
      case 'csave': { const c = findC(id); if (!c) break; toggleSaveComment(c); a.classList.toggle('on'); break; }
      case 'clink': {
        const u = location.origin + location.pathname + '#/comments/' + T.id + '?c=' + id;
        copy(u, 'Copied');
        break;
      }
      case 'refresh': openThread(T.id, null, true); break;
      default: break;
    }
  });
  $('#hub-thread').addEventListener('input', (e) => {
    if (e.target.id !== 'cfind') return;
    S.cfind = e.target.value.trim().toLowerCase();
    const pos = e.target.selectionStart;
    $('#t-comments').innerHTML = commentsHTML(S.T);
    const fi = $('#cfind');
    if (fi) { fi.focus(); fi.setSelectionRange(pos, pos); }
  });
  $('#hub-thread').addEventListener('submit', async (e) => {
    const f = e.target.closest('.reply');
    if (!f) return;
    e.preventDefault();
    const text = f.querySelector('textarea').value.trim();
    if (!text) return;
    const T = S.T;
    const cEl = f.closest('.c');
    const parent = cEl ? 't1_' + cEl.dataset.id : 't3_' + T.id;
    const btn = f.querySelector('.btn.primary');
    btn.disabled = true;
    try {
      const c = await A.reddit.comment(parent, text);
      if (c) { c.link = 't3_' + T.id; T.live.set(c.id, c); T.rebuild(); }
      S.reply = null;
      $('#t-comments').innerHTML = commentsHTML(T);
    } catch (err) { btn.disabled = false; errToast(err); }
  });

  async function vote(name, dir) {
    if (needAuth()) return;
    const T = S.T;
    const isPost = name.startsWith('t3_');
    const likes = isPost ? (T.post && T.post.v.R && T.post.v.R.likes) : (findC(name.slice(3)) || {}).likes;
    const cur = S.votes[name] !== undefined ? S.votes[name] : (likes === true ? 1 : likes === false ? -1 : 0);
    const next = cur === dir ? 0 : dir;
    S.votes[name] = next;
    renderThread(false);
    try { await A.reddit.vote(name, next); } catch (err) { S.votes[name] = cur; renderThread(false); errToast(err); }
  }
  function toggleSaveComment(c) {
    const k = 'c_' + c.id;
    const on = !S.saved[k];
    if (on) S.saved[k] = { id: c.id, comment: true, title: c.body.slice(0, 80), savedAt: Date.now() }; else delete S.saved[k];
    store.set('saved', S.saved);
    if (A.cfg.user) A.reddit.save(c.name, on).catch(() => {});
    toast(on ? 'Saved' : 'Removed');
  }
  function toggleSavePost(m) {
    m = m || (S.T && S.T.post);
    if (!m) return;
    const on = !S.saved[m.id];
    if (on) {
      S.saved[m.id] = { id: m.id, name: m.name, title: m.title, author: m.author, subreddit: m.subreddit, score: m.score, numComments: m.numComments, created: m.created, over18: m.over18, spoiler: m.spoiler, preview: m.preview, thumb: m.thumb, flair: m.flair, domain: m.domain, selftext: (m.selftext || '').slice(0, 300), isSelf: m.isSelf, recovered: m.recovered, removedOnReddit: m.removedOnReddit, permalink: m.permalink, savedAt: Date.now() };
    } else delete S.saved[m.id];
    store.set('saved', S.saved);
    if (A.cfg.user) A.reddit.save(m.name, on).catch(() => {});
    toast(on ? 'Saved' : 'Removed');
    renderBar();
  }
  function copy(text, msg) {
    const done = () => toast(msg || 'Copied');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => toast(text));
    else { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); done(); } catch (e) { toast(text); } t.remove(); }
  }

  const CIDX = 'astra.cidx';
  const hk = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); };
  function cacheGet(k) {
    if (!set.cacheMin) return null;
    try {
      const raw = localStorage.getItem('astra.c.' + k);
      if (!raw) return null;
      const o = JSON.parse(raw);
      return Date.now() - o.t > set.cacheMin * 60000 ? null : o.v;
    } catch (e) { return null; }
  }
  function clearCacheAll() {
    try { JSON.parse(localStorage.getItem(CIDX) || '[]').forEach((k) => localStorage.removeItem('astra.c.' + k)); localStorage.removeItem(CIDX); } catch (e) {  }
  }
  function cachePut(k, v, max) {
    if (!set.cacheMin) return;
    try {
      const s = JSON.stringify({ t: Date.now(), v });
      if (s.length > (max || 700000)) return;
      localStorage.setItem('astra.c.' + k, s);
      const idx = JSON.parse(localStorage.getItem(CIDX) || '[]').filter((x) => x !== k);
      idx.push(k);
      while (idx.length > 24) localStorage.removeItem('astra.c.' + idx.shift());
      localStorage.setItem(CIDX, JSON.stringify(idx));
    } catch (e) { clearCacheAll(); }
  }
  function cacheFeed(F) {
    if (!F.loaded || F.items.length > 150 || F.r.kind === 'saved' || F.r.kind === 'inbox' || F.r.kind === 'messages') return;
    cachePut('f' + hk(F.key), { items: F.items, cur: F.cur, done: F.done, srcs: F.srcs });
  }

  function refilter() { if (S.feed) renderList(S.feed.items.length); if (S.T) renderThread(false); }
  function addBlock(kind, val) {
    val = String(val || '').trim();
    if (kind === 'users') val = val.replace(/^\/?u(ser)?\//i, '');
    if (kind === 'subs') val = val.replace(/^\/?r\//i, '');
    if (!val || S.blocks[kind].some((x) => lc(x) === lc(val))) return;
    S.blocks[kind].push(val);
    store.set('blocks', S.blocks);
    if (kind === 'users' && A.cfg.user) A.reddit.blockUser(val).catch(() => {});
    refilter();
  }
  function openBlocks(tab) {
    tab = tab || 'words';
    const NAMES = { words: 'words', users: 'users', subs: 'subreddits' };
    const pre = tab === 'users' ? 'u/' : tab === 'subs' ? 'r/' : '';
    const d = openDlg('<h2>blocking</h2><div class="pivot small" role="tablist">' + ['words', 'users', 'subs'].map((k) => '<button role="tab" data-bt="' + k + '" aria-selected="' + (k === tab) + '">' + NAMES[k] + '</button>').join('') + '</div>' +
      '<form id="bform" class="subform"><input type="text" id="bin" autocomplete="off" autocapitalize="off" placeholder="' + (tab === 'words' ? 'Word or phrase' : tab === 'users' ? 'Username' : 'Subreddit') + '" aria-label="Add"><button class="btn small primary">Add</button></form>' +
      '<ul class="blist">' + S.blocks[tab].map((x, i) => '<li><span>' + pre + esc(x) + '</span><button data-bx="' + i + '" aria-label="Remove">&times;</button></li>').join('') + '</ul>' +
      '<div class="row"><button class="btn primary" data-close>Done</button></div>');
    $$('[data-bt]', d).forEach((b) => { b.onclick = () => openBlocks(b.dataset.bt); });
    d.querySelector('#bform').onsubmit = (e) => { e.preventDefault(); addBlock(tab, d.querySelector('#bin').value); openBlocks(tab); const i = $('#bin'); if (i) i.focus(); };
    d.querySelector('.blist').onclick = (e) => {
      const b = e.target.closest('[data-bx]');
      if (!b) return;
      S.blocks[tab].splice(+b.dataset.bx, 1);
      store.set('blocks', S.blocks);
      refilter();
      openBlocks(tab);
    };
  }

  const MDBTN = [['b', 'B', 'Bold'], ['i', 'I', 'Italic'], ['s', 'S', 'Strikethrough'], ['h', 'H', 'Heading'], ['link', 'Link', 'Link'], ['q', '“', 'Quote'], ['code', '</>', 'Code'], ['cb', '{ }', 'Code block'],
    ['ul', '•', 'Bulleted list'], ['ol', '1.', 'Numbered list'], ['sp', '!', 'Spoiler'], ['sup', '^', 'Superscript'], ['hr', '—', 'Divider'], ['tbl', 'Table', 'Table'], ['pv', 'Preview', 'Preview']];
  function mdEditor(name) {
    return '<div class="mded"><div class="mdtop"><button type="button" class="mdmore" data-mdmore aria-label="Formatting">&middot;&middot;&middot;</button></div>' +
      '<div class="mdbar" hidden>' + MDBTN.map((b) => '<button type="button" data-md="' + b[0] + '" aria-label="' + b[2] + '">' + esc(b[1]) + '</button>').join('') + '</div>' +
      '<div class="mdlink" hidden><input type="text" placeholder="Text" data-ltext><input type="url" placeholder="https://" data-lurl><button type="button" class="btn small primary" data-mdins>Insert</button></div>' +
      '<textarea' + (name ? ' name="' + name + '"' : '') + ' rows="4" aria-label="Text"></textarea><div class="mdprev md" hidden></div></div>';
  }
  function mdApply(act, w) {
    const ta = w.querySelector('textarea');
    const s = ta.selectionStart, e = ta.selectionEnd, v = ta.value, sel = v.slice(s, e);
    const put = (text, a, b) => { ta.value = v.slice(0, s) + text + v.slice(e); ta.selectionStart = s + a; ta.selectionEnd = s + b; };
    const wrap = (a, b, ph) => { const t = sel || ph; put(a + t + b, a.length, a.length + t.length); };
    const lines = (fn) => {
      const ls = v.lastIndexOf('\n', s - 1) + 1; let le = v.indexOf('\n', e); if (le < 0) le = v.length;
      const blk = v.slice(ls, le).split('\n').map(fn).join('\n');
      ta.value = v.slice(0, ls) + blk + v.slice(le); ta.selectionStart = ls; ta.selectionEnd = ls + blk.length;
    };
    let n = 0;
    switch (act) {
      case 'b': wrap('**', '**', 'bold'); break;
      case 'i': wrap('*', '*', 'italic'); break;
      case 's': wrap('~~', '~~', 'text'); break;
      case 'h': lines((l) => '# ' + l); break;
      case 'q': lines((l) => '> ' + l); break;
      case 'ul': lines((l) => '* ' + l); break;
      case 'ol': lines((l) => (++n) + '. ' + l); break;
      case 'code': wrap('`', '`', 'code'); break;
      case 'cb': wrap('\n```\n', '\n```\n', 'code'); break;
      case 'sp': wrap('>!', '!<', 'spoiler'); break;
      case 'sup': wrap('^(', ')', 'text'); break;
      case 'hr': put('\n\n---\n\n', 7, 7); break;
      case 'tbl': put('\n\n| Header | Header |\n|---|---|\n| Cell | Cell |\n\n', 2, 2); break;
      case 'link': {
        const l = w.querySelector('.mdlink');
        l.hidden = !l.hidden;
        w.dataset.s = s; w.dataset.e = e;
        l.querySelector('[data-ltext]').value = sel;
        l.querySelector(sel ? '[data-lurl]' : '[data-ltext]').focus();
        return;
      }
      case 'pv': { const p = w.querySelector('.mdprev'); p.hidden = !p.hidden; p.innerHTML = MD.render(ta.value); return; }
      default: return;
    }
    ta.focus();
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
  document.addEventListener('click', (e) => {
    const more = e.target.closest('[data-mdmore]');
    if (more) { const w = more.closest('.mded'); const bar = w.querySelector('.mdbar'); bar.hidden = !bar.hidden; if (bar.hidden) w.querySelector('.mdlink').hidden = true; return; }
    const b = e.target.closest('[data-md]');
    if (b) { mdApply(b.dataset.md, b.closest('.mded')); return; }
    const ins = e.target.closest('[data-mdins]');
    if (ins) {
      const w = ins.closest('.mded'), ta = w.querySelector('textarea');
      const s = +w.dataset.s || 0, en = +w.dataset.e || 0;
      const text = w.querySelector('[data-ltext]').value || 'link', url = w.querySelector('[data-lurl]').value.trim();
      if (!url) return;
      const md = '[' + text + '](' + url + ')';
      ta.value = ta.value.slice(0, s) + md + ta.value.slice(en);
      ta.selectionStart = ta.selectionEnd = s + md.length;
      w.querySelector('.mdlink').hidden = true;
      ta.focus();
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  document.addEventListener('input', (e) => {
    const ta = e.target.closest && e.target.closest('.mded textarea');
    if (!ta) return;
    const p = ta.closest('.mded').querySelector('.mdprev');
    if (p && !p.hidden) p.innerHTML = MD.render(ta.value);
  });

  document.addEventListener('click', (e) => { if (Date.now() - (S.noClick || 0) < 400) { e.stopPropagation(); e.preventDefault(); } }, true);
  function attachSwipe(root, rowSel, moverSel, actions) {
    let st = null;
    const begin = (s) => {
      s.A = actions(s.row) || {};
      s.mv.classList.add('swiping');
      const bg = document.createElement('div');
      bg.className = 'swbg';
      bg.style.top = s.mv.offsetTop + 'px';
      bg.style.height = s.mv.offsetHeight + 'px';
      s.mv.parentElement.insertBefore(bg, s.mv);
      s.bg = bg;
    };
    const paint = (s, hit, dx) => {
      s.bg.style.background = hit ? hit.color : 'var(--raise)';
      s.bg.style.justifyContent = dx > 0 ? 'flex-start' : 'flex-end';
      s.bg.textContent = hit ? hit.label : '';
    };
    const reset = (s) => {
      s.mv.style.transition = 'transform .22s cubic-bezier(.1, .9, .2, 1)';
      s.mv.style.transform = '';
      setTimeout(() => { s.mv.style.transition = ''; s.mv.classList.remove('swiping'); if (s.bg) s.bg.remove(); }, 240);
    };
    root.addEventListener('touchstart', (e) => {
      st = null;
      if (!set.gestures || e.touches.length !== 1) return;
      const row = e.target.closest(rowSel);
      if (!row || e.target.closest('input, textarea, video, .gallery, .vctl, .mded, a[href^="http"]')) return;
      const t = e.touches[0];
      if (t.clientX < 32 || t.clientX > window.innerWidth - 32) return;
      const mv = moverSel ? row.querySelector(moverSel) : row;
      if (mv) st = { row, mv, x: t.clientX, y: t.clientY, lock: null, act: null, bg: null };
    }, { passive: true });
    root.addEventListener('touchmove', (e) => {
      if (!st) return;
      const t = e.touches[0], dx = t.clientX - st.x, dy = t.clientY - st.y;
      if (!st.lock) {
        if (Math.abs(dx) < 14 && Math.abs(dy) < 14) return;
        if (Math.abs(dx) > Math.abs(dy) * 2) { st.lock = 'x'; begin(st); } else { st = null; return; }
      }
      e.preventDefault();
      st.mv.style.transform = 'translateX(' + dx + 'px)';
      const acts = (dx > 0 ? st.A.right : st.A.left) || [];
      let hit = null;
      acts.forEach((a) => { if (Math.abs(dx) >= a.at) hit = a; });
      if (hit !== st.act || !st.painted) { st.act = hit; st.painted = true; paint(st, hit, dx); }
    }, { passive: false });
    const end = (cancel) => {
      if (!st) return;
      const s = st; st = null;
      if (s.lock !== 'x') return;
      S.noClick = Date.now();
      if (!cancel && s.act) { try { s.act.fn(); } catch (err) {  } }
      reset(s);
    };
    root.addEventListener('touchend', () => end(false));
    root.addEventListener('touchcancel', () => end(true));
  }
  attachSwipe($('#feed-body'), '.post[data-id]', null, (row) => {
    const m = rowPost(row.dataset.id);
    if (!m) return {};
    const signed = A.cfg.user;
    return {
      right: [{ at: 120, label: signed ? 'upvote' : 'save', color: '#1BA1E2', fn: () => (signed ? feedVote(m, 1) : toggleSavePost(m)) }, { at: 240, label: 'save', color: '#60A917', fn: () => toggleSavePost(m) }],
      left: [{ at: 120, label: 'hide', color: '#E51400', fn: () => hidePost(m) }, { at: 240, label: 'more', color: '#647687', fn: () => rowMenu(m.id) }]
    };
  });
  attachSwipe($('#hub-thread'), '#t-comments .c', ':scope > .cwrap', (row) => {
    const id = row.dataset.id;
    return {
      right: [{ at: 120, label: 'upvote', color: '#1BA1E2', fn: () => vote('t1_' + id, 1) }, { at: 240, label: 'downvote', color: '#FA6800', fn: () => vote('t1_' + id, -1) }],
      left: [{ at: 120, label: 'reply', color: '#AA00FF', fn: () => openReply(row) }, { at: 240, label: 'save', color: '#60A917', fn: () => { const c = findC(id); if (c) toggleSaveComment(c); } }]
    };
  });
  (function pullToRefresh() {
    const body = $('#feed-body');
    let x0 = null, y0 = null, dy = 0;
    body.addEventListener('touchstart', (e) => {
      x0 = null;
      if (!set.gestures || body.scrollTop > 0 || e.touches.length !== 1) return;
      x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dy = 0;
    }, { passive: true });
    body.addEventListener('touchmove', (e) => {
      if (x0 == null) return;
      const t = e.touches[0];
      dy = t.clientY - y0;
      if (Math.abs(t.clientX - x0) > Math.abs(dy) || dy < 0 || body.scrollTop > 0) { if (dy < 0) x0 = null; return; }
      if (dy > 8) { e.preventDefault(); const l = $('#feed-list'); if (l) { l.style.transition = 'none'; l.style.transform = 'translateY(' + Math.min(dy / 2, 90) + 'px)'; } }
    }, { passive: false });
    const done = () => {
      if (x0 == null) return;
      x0 = null;
      const l = $('#feed-list');
      if (l) { l.style.transition = 'transform .25s cubic-bezier(.1, .9, .2, 1)'; l.style.transform = ''; }
      if (dy > 150 && S.feedRoute) { A.clearCache(); setFeed(S.feedRoute, true, true); }
    };
    body.addEventListener('touchend', done);
    body.addEventListener('touchcancel', done);
  })();

  (function longPress() {
    let timer, sx, sy;
    const body = $('#feed-body');
    body.addEventListener('touchstart', (e) => {
      const row = e.target.closest('.post[data-id]');
      if (!row || e.touches.length !== 1) return;
      sx = e.touches[0].clientX; sy = e.touches[0].clientY;
      timer = setTimeout(() => { S.noClick = Date.now() + 600; rowMenu(row.dataset.id); }, 550);
    }, { passive: true });
    const stop = () => clearTimeout(timer);
    body.addEventListener('touchmove', (e) => { if (Math.abs(e.touches[0].clientX - sx) > 8 || Math.abs(e.touches[0].clientY - sy) > 8) stop(); }, { passive: true });
    body.addEventListener('touchend', stop);
    body.addEventListener('touchcancel', stop);
  })();

  const fdate = (s) => new Date(s * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const fdt = (s) => new Date(s * 1000).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const AV = {};
  let avBusy = 0;
  const avQ = [];
  const avTag = (kind, name) => '<img class="av" data-av="' + kind + ':' + esc(name) + '" alt="" referrerpolicy="no-referrer" hidden>';
  function avApply(key) { $$('img[data-av="' + key.replace(/"/g, '') + '"]').forEach((i) => { if (AV[key]) { i.src = AV[key]; i.hidden = false; } }); }
  function avPump() {
    while (avBusy < 3 && avQ.length) {
      const key = avQ.shift();
      avBusy++;
      const i = key.indexOf(':'), kind = key.slice(0, i), name = key.slice(i + 1);
      (kind === 'u' ? A.reddit.userAbout(name) : A.reddit.about(name)).then((a) => { AV[key] = /^https?:/.test(a.icon || '') ? a.icon : ''; }, () => { AV[key] = ''; }).then(() => { avBusy--; avApply(key); avPump(); });
    }
  }
  function fillAvatars(root) {
    if (!srcOn('R')) return;
    $$('img[data-av]', root).forEach((img) => {
      const key = img.dataset.av;
      if (key in AV) { avApply(key); return; }
      if (avQ.indexOf(key) < 0 && avQ.length < 80) { avQ.push(key); }
    });
    avPump();
  }
  async function fillHead(r) {
    const box = $('#phead');
    if (!box) return;
    const isU = r.kind === 'user';
    const showImg = isU ? set.imgProfile : set.imgFeed;
    const label = (isU ? 'u/' : 'r/') + esc(r.name);
    const paint = (a) => {
      box.innerHTML = '<div class="pbanner"></div><div class="pid">' + (showImg && a && /^https?:/.test(a.icon || '') ? '<img class="av big" alt="" referrerpolicy="no-referrer">' : '') + '<div><b>' + label + '</b>' + (a ? '<small>' + (isU ? 'karma ' + fmt((a.link || 0) + (a.comment || 0)) + (a.created ? ' · joined ' + fdate(a.created) : '') : fmt(a.subscribers || 0) + ' members') + '</small>' : '') + '</div></div>';
      const ban = box.querySelector('.pbanner');
      ban.style.backgroundColor = colorOf(r.name);
      if (showImg && a && /^https?:/.test(a.banner || '')) ban.style.backgroundImage = 'url("' + a.banner.replace(/"/g, '%22') + '")';
      const im = box.querySelector('img.av'); if (im) im.src = a.icon;
    };
    paint(null);
    if (!srcOn('R')) return;
    try {
      const a = isU ? await A.reddit.userAbout(r.name) : await A.reddit.about(r.name);
      if ($('#phead') === box && S.feedRoute === r) paint(a);
    } catch (e) {  }
  }
  function histList(m) {
    const l = [];
    if (m.v.R) l.push({ k: 'R', at: Math.floor(Date.now() / 1000), now: true });
    ['A', 'P'].forEach((k) => { const x = m.v[k]; if (x && x.retrieved) l.push({ k, at: x.retrieved, cap: x.captureSec }); });
    return l.length > 1 ? l.sort((a, b) => b.at - a.at) : [];
  }
  function openBefore(kind) {
    const m = S.T && S.T.post, fr = S.feedRoute;
    if (kind === 'post' && !m) return;
    const max = ymd(Date.now() / 1000);
    const cur = kind === 'feed' && fr && fr.q.asof ? fr.q.asof : '';
    const title = kind === 'post' ? 'post before date' : kind === 'feed' ? 'feed before date' : 'history';
    const l = kind === 'post' ? histList(m) : [];
    const pick = S.ver === 'best' ? '' : S.ver;
    const list = l.length ? '<h3>versions</h3><ul class="menu hist">' + l.map((x) => '<li><button type="button" data-v="' + x.k + '"' + (x.k === pick ? ' class="on"' : '') + '>' + (x.now ? 'Reddit, live' : esc(fdt(x.at))) + '<span class="sub">' + SRCNAME[x.k] + (x.cap != null ? ' · +' + dur(Math.max(0, x.cap)) + ' after posting' : '') + '</span></button></li>').join('') + '<li><button type="button" data-v="best">Best available</button></li></ul>' : '';
    const d = openDlg('<h2>' + title + '</h2><form id="bform"><label for="bdate">Date</label><input type="date" id="bdate" name="d" max="' + max + '" value="' + esc(cur) + '" required><div class="row"><button class="btn primary">Go</button>' + (cur ? '<button class="btn" type="button" id="bnow">Now</button>' : '') + '<button class="btn" type="button" data-close>Cancel</button></div></form>' + list);
    d.querySelector('#bform').onsubmit = (e) => {
      e.preventDefault();
      const v = d.querySelector('#bdate').value;
      if (!v) return;
      if (kind === 'post') {
        const end = Date.parse(v + 'T23:59:59Z') / 1000;
        const c = ['A', 'P'].filter((k) => m.v[k] && m.v[k].retrieved && m.v[k].retrieved <= end).sort((a, b) => m.v[b].retrieved - m.v[a].retrieved)[0];
        if (!c) { toast(srcOn('A') || srcOn('P') ? 'No archived copy before that date' : 'Turn on an archive source in settings'); return; }
        S.ver = c; d.close(); renderThread(false);
      } else if (kind === 'feed') {
        d.close();
        go(hashOf(fr, { sort: ['home', 'sub'].includes(fr.kind) ? 'top' : fr.sort, q: { asof: v } }));
      } else { d.close(); go('#/r/all/top?asof=' + v); }
    };
    const now = d.querySelector('#bnow');
    if (now) now.onclick = () => { d.close(); go(hashOf(fr, { q: { asof: '' } })); };
    const lm = d.querySelector('.menu');
    if (lm) lm.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; S.ver = b.dataset.v; d.close(); renderThread(false); };
  }
  const tfmt = (s) => { s = Math.max(0, s | 0); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); };
  function bindVideos(root) {
    $$('.vwrap', root).forEach((w) => {
      if (w.dataset.b) return;
      w.dataset.b = '1';
      const v = w.querySelector('video'), sl = w.querySelector('.vs'), pb = w.querySelector('.vp'), tt = w.querySelector('.vt'), mb = w.querySelector('.vm');
      let drag = false, was = false;
      const sync = () => { pb.innerHTML = v.paused ? '&#9654;' : '&#10073;&#10073;'; };
      const tick = () => { if (!drag && v.duration) sl.value = String(Math.round(v.currentTime / v.duration * 1000)); tt.textContent = tfmt(v.currentTime) + (v.duration && isFinite(v.duration) ? ' / ' + tfmt(v.duration) : ''); };
      v.addEventListener('play', sync); v.addEventListener('pause', sync); v.addEventListener('timeupdate', tick); v.addEventListener('loadedmetadata', tick);
      pb.onclick = () => { if (v.paused) { const p = v.play(); if (p && p.catch) p.catch(() => {}); } else v.pause(); };
      v.addEventListener('click', () => pb.onclick());
      const start = () => { drag = true; was = !v.paused; v.pause(); };
      const stop = () => { drag = false; if (was) { const p = v.play(); if (p && p.catch) p.catch(() => {}); } };
      ['touchstart', 'mousedown'].forEach((n) => sl.addEventListener(n, start, { passive: true }));
      ['touchend', 'mouseup', 'change'].forEach((n) => sl.addEventListener(n, stop));
      sl.addEventListener('input', () => { if (v.duration) { v.currentTime = sl.value / 1000 * v.duration; tick(); } });
      if (mb) { v.muted = false; mb.onclick = () => { v.muted = !v.muted; mb.classList.toggle('off', v.muted); }; }
      sync();
    });
  }

  const SITE = 'https://faggot.eu.cc';
  const REPO = 'https://github.com/twopercentdevvv/astra';
  function bytesOf(s) { return new Blob([s]).size; }
  function storageStats() {
    let ls = 0, cache = 0, cacheN = 0;
    try { Object.keys(localStorage).forEach((k) => { if (k.indexOf('astra.') === 0) { const n = bytesOf(localStorage.getItem(k) || ''); ls += n; if (k.indexOf('astra.c.') === 0) { cache += n; cacheN++; } } }); } catch (e) { }
    return { ls, cache, cacheN };
  }
  const kb = (n) => (n < 1024 ? n + ' B' : (n / 1024).toFixed(1) + ' KB');
  function aboutRows() {
    const st = storageStats(), now = Date.now(), c = A.cfg, left = (t) => Math.max(0, Math.round((t - now) / 60000)) + ' min';
    const tok = c.user ? 'User, expires in ' + left(c.exp)
      : appTok && appTok.exp > now ? 'Application (' + (appTok.id === DEFAULT_CID ? 'default' : 'custom') + ' client), expires in ' + left(appTok.exp)
      : 'None' + (tokFail > now ? ', retry in ' + left(tokFail) : '');
    const fr = S.feedRoute, mq = (q) => window.matchMedia(q).matches;
    const net = navigator.connection ? [navigator.connection.effectiveType, navigator.connection.saveData ? 'data saver' : ''].filter(Boolean).join(', ') : '';
    const fails = A.log.filter((x) => x.err).length;
    return {
      stats: [
        ['Saved posts', Object.keys(S.saved).length], ['Posts read', S.read.size], ['Hidden posts', S.hidden.size],
        ['Local storage', kb(st.ls)], ['Page cache', st.cacheN + ' entries, ' + kb(st.cache)]
      ],
      debug: [
        ['Version', VERSION], ['Access token', tok], ['Client ID', set.clientId ? 'Custom' : 'Default'],
        ['Requests', A.stats.miss + ' sent, ' + A.stats.hit + ' from cache, ' + fails + ' failed of last ' + A.log.length],
        ['Route', location.hash || '#/'], ['View', S.hub + (fr ? ' (' + fr.kind + (fr.name ? ' ' + fr.name : '') + ', ' + (S.feed && S.feed.items ? S.feed.items.length : 0) + ' items)' : '')],
        ['Thread', S.T && S.T.id ? S.T.id : 'None'],
        ['Display', window.innerWidth + 'x' + window.innerHeight + ' @' + (window.devicePixelRatio || 1) + 'x, ' + (mq('(display-mode: standalone)') ? 'installed' : 'browser') + ', ' + (mq('(prefers-color-scheme: dark)') ? 'dark' : 'light') + ' system theme'],
        ['System preferences', [mq('(prefers-reduced-motion: reduce)') ? 'reduced motion' : '', mq('(prefers-contrast: more)') ? 'high contrast' : ''].filter(Boolean).join(', ') || 'Default'],
        ['Input', 'ontouchstart' in window ? 'Touch' : 'Pointer'], ['Network', (navigator.onLine ? 'Online' : 'Offline') + (net ? ', ' + net : '')],
        ['Language', navigator.language || ''], ['Time zone', (window.Intl && Intl.DateTimeFormat().resolvedOptions().timeZone) || ''], ['Agent', navigator.userAgent]
      ],
      requests: A.log.slice(0, 8).map((x) => [ago(x.t / 1000) + ' ' + (SRCNAME[SRC[x.src]] || x.src) + ' ' + x.path, (x.err ? x.err : x.status) + ', ' + x.ms + ' ms']),
      errors: S.errors.slice(0, 5).map((x) => [new Date(x.t).toLocaleTimeString() + ' ' + x.where, x.msg])
    };
  }
  function openAboutApp() {
    const r = aboutRows();
    const tbl = (rows) => '<table class="kv">' + rows.map((x) => '<tr><td>' + esc(x[0]) + '</td><td>' + esc(String(x[1])) + '</td></tr>').join('') + '</table>';
    const d = openDlg('<h2>about</h2><p class="who"><b>Astra</b> by twopercentdev<br>Version ' + esc(VERSION) + '</p>' +
      '<div class="row links"><a class="btn small" href="' + SITE + '" target="_blank" rel="noopener noreferrer">website</a><a class="btn small" href="' + REPO + '" target="_blank" rel="noopener noreferrer">github</a></div>' +
      '<h3>usage</h3>' + tbl(r.stats) + '<h3>diagnostics</h3>' + tbl(r.debug) +
      (r.requests.length ? '<h3>recent requests</h3>' + tbl(r.requests) : '') + (r.errors.length ? '<h3>recent errors</h3>' + tbl(r.errors) : '') +
      '<div class="row"><button class="btn" id="a-copy">copy diagnostics</button><button class="btn primary" data-close>done</button></div>');
    d.querySelector('.dlg').classList.add('lc');
    d.querySelector('#a-copy').onclick = () => {
      const f = (t, rows) => rows.length ? '\n\n' + t + '\n' + rows.map((x) => x[0] + ': ' + x[1]).join('\n') : '';
      copy('Astra ' + VERSION + f('Usage', r.stats) + f('Diagnostics', r.debug) + f('Recent requests', r.requests) + f('Recent errors', r.errors), 'Copied');
    };
  }

  const BAR_IDS = ['back', 'forward', 'previous', 'next', 'search', 'find', 'compose', 'refresh', 'home', 'saved', 'profile', 'settings'];
  const BAR_NAMES = { back: 'Back', forward: 'Forward', previous: 'Previous', next: 'Next', search: 'Search', find: 'Find in thread', compose: 'Add, new post or reply', refresh: 'Refresh', home: 'Home', saved: 'Saved', profile: 'Profile', settings: 'Settings' };
  function barItem(id) {
    const m = S.T && S.T.post, th = S.hub === 'thread';
    switch (id) {
      case 'back': return ['back', 'back', 'back', false, !canBack()];
      case 'forward': return ['forward', 'forward', 'forward', false, !canFwd()];
      case 'previous': return S.hub === 'subs' || S.hub === 'search' ? null : ['up', 'previous', 'previous'];
      case 'next': return S.hub === 'subs' || S.hub === 'search' ? null : ['down', 'next', 'next'];
      case 'search': return ['search', 'search', 'search'];
      case 'find': return th ? ['search', 'find', 'find', false, !m] : null;
      case 'compose':
        if (th) return ['reply', 'reply', 'reply', false, !m];
        if (S.hub === 'subs') return ['plus', 'add', 'addtile'];
        return A.cfg.user && S.hub === 'feed' ? ['plus', 'new post', 'newpost'] : null;
      case 'refresh': return ['refresh', 'refresh', 'refresh'];
      case 'home': return ['home', 'home', '#/'];
      case 'saved': return ['save', 'saved', '#/saved'];
      case 'profile': return A.cfg.user ? ['person', 'profile', 'profile'] : null;
      case 'settings': return ['sliders', 'settings', 'settings'];
      default: return null;
    }
  }
  function renderBar() {
    const bar = $('#appbar');
    if (!bar) return;
    const it = set.toolbar.filter((id) => BAR_IDS.indexOf(id) >= 0).map(barItem).filter(Boolean);
    it.push(['more', 'more', 'more']);
    bar.classList.toggle('nolabels', !set.barLabels);
    bar.innerHTML = it.map((x) => '<button class="ab press" data-ab="' + esc(x[2]) + '"' + (x[4] ? ' disabled' : '') + ' aria-label="' + esc(x[1]) + '"><span class="ic">' + icon(x[0]) + (x[2] === 'more' && S.unread ? '<i class="dot"></i>' : '') + '</span><span>' + esc(x[1]) + '</span></button>').join('');
    drawMe();
  }
  $('#appbar').addEventListener('click', (e) => {
    const b = e.target.closest('.ab');
    if (b && !b.disabled) doAct(b.dataset.ab);
  });
  async function doAct(code) {
    const m = S.T && S.T.post;
    switch (code) {
      case 'back': goBack(); break;
      case 'forward': goForward(); break;
      case 'previous': stepItem(-1); break;
      case 'search': openSearch(); break;
      case 'find': { showHub('thread'); const f = $('#cfind'); if (f) { f.scrollIntoView({ block: 'center' }); f.focus(); } break; }
      case 'refresh':
        A.clearCache(); clearCacheAll();
        if (S.hub === 'thread' && S.T) openThread(S.T.id, null, true);
        else if (S.hub === 'subs') { Object.keys(tileData).forEach((k) => delete tileData[k]); renderSubs(); }
        else setFeed(S.feedRoute, true);
        break;
      case 'reply':
        if (needAuth()) break;
        S.reply = 'top';
        $('#t-comments').innerHTML = commentsHTML(S.T);
        { const ta = $('#t-comments textarea'); if (ta) { ta.focus(); ta.scrollIntoView({ block: 'center' }); } }
        break;
      case 'save': toggleSavePost(); break;
      case 'share': {
        const u = location.origin + location.pathname + '#/comments/' + S.T.id;
        if (navigator.share) navigator.share({ title: m ? m.title : 'Astra', url: u }).catch(() => {}); else copy(u, 'Copied');
        break;
      }
      case 'copytext': if (m) copy(MD.unent(m.title) + (m.selftext ? '\n\n' + m.selftext : ''), 'Copied'); break;
      case 'postbefore': openBefore('post'); break;
      case 'feedbefore': openBefore('feed'); break;
      case 'redditbefore': openBefore('reddit'); break;
      case 'addtile': showHub('subs'); $('#subq') && $('#subq').focus(); break;
      case 'pin': {
        const n = S.feedRoute.name;
        const has = S.subs.some((x) => x.toLowerCase() === n.toLowerCase());
        S.subs = has ? S.subs.filter((x) => x.toLowerCase() !== n.toLowerCase()) : S.subs.concat(n);
        store.set('subs', S.subs);
        if (A.cfg.user) A.reddit.subscribe(n, !has).catch(() => {});
        renderSubs(); toast(has ? 'Unpinned' : 'Pinned');
        break;
      }
      case 'next': stepItem(1); break;
      case 'read': readAloud(); break;
      case 'about': openAbout(S.feedRoute.name); break;
      case 'newpost': openSubmit(); break;
      case 'blocks': openBlocks(); break;
      case 'profile': {
        try { if (!S.me) { const me = await A.reddit.me(); S.me = me.name; store.set('me', me.name); } } catch (err) { errToast(err); break; }
        if (S.me) go('#/u/' + encodeURIComponent(S.me));
        break;
      }
      case 'settings': openSettings(); break;
      case 'aboutapp': openAboutApp(); break;
      case 'more': openMenu(); break;
      default: if (code && code.charAt(0) === '#') go(code); break;
    }
  }

  function readAloud() {
    const ss = window.speechSynthesis;
    if (!ss || !window.SpeechSynthesisUtterance) { toast('Speech is not supported on this device.'); return; }
    if (ss.speaking || ss.pending) { ss.cancel(); return; }
    const m = S.T && S.T.post;
    if (!m) return;
    const clean = (t) => MD.unent(String(t || '')).replace(/```[\s\S]*?```/g, ' code block ').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/https?:\/\/\S+/g, ' link ').replace(/[*_~>#`^]/g, '').replace(/\s+/g, ' ').trim();
    const parts = [clean(m.title), clean(m.selftext)];
    if (set.speechComments && S.T.flat) {
      Array.from(S.T.flat.values()).filter((c) => c && c.body && !A.isGone(c)).slice(0, 25).forEach((c) => parts.push('u/' + c.author + ' says: ' + clean(c.body)));
    }
    const chunks = [];
    parts.filter(Boolean).join('. ').replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/).forEach((x) => {
      const last = chunks.length - 1;
      if (last >= 0 && chunks[last].length + x.length < 220) chunks[last] += ' ' + x; else chunks.push(x);
    });
    chunks.forEach((x, k) => {
      const u = new SpeechSynthesisUtterance(x);
      u.rate = set.speechRate || 1; u.lang = navigator.language || 'en-US';
      if (k === chunks.length - 1) u.onend = () => { if (S.ready) renderBar(); };
      ss.speak(u);
    });
    toast('Reading aloud');
  }
  function stepItem(dir) {
    const hub = hubEl(S.hub), sc = hub && $('.hubbody', hub);
    if (!sc) return;
    const sel = S.hub === 'thread' ? '#t-comments > .c' : S.hub === 'feed' ? '#feed-list .post' : '';
    const top = sc.getBoundingClientRect().top, els = sel ? $$(sel, hub) : [];
    const tgt = dir > 0 ? els.find((el) => el.getBoundingClientRect().top > top + 40) : els.filter((el) => el.getBoundingClientRect().top < top - 8).pop();
    const dy = tgt ? tgt.getBoundingClientRect().top - top : dir * sc.clientHeight * 0.8;
    sc.scrollTo({ top: sc.scrollTop + dy, behavior: reduced() ? 'auto' : 'smooth' });
  }
  function openDlg(html) {
    const d = $('#dlg');
    d.innerHTML = '<div class="dlg">' + html + '</div>';
    if (!d.open) d.showModal();
    const h = d.querySelector('h2');
    if (h) d.dataset.t = h.textContent; else delete d.dataset.t;
    updateTitle();
    return d;
  }
  $('#dlg').addEventListener('close', updateTitle);
  $('#dlg').addEventListener('click', (e) => { if (e.target === $('#dlg') || e.target.closest('[data-close]')) $('#dlg').close(); });
  function openMenu() {
    const m = S.T && S.T.post, fr = S.feedRoute, L = [];
    if (S.hub === 'thread' && m) {
      L.push(['save', S.saved[m.id] ? 'remove from saved' : 'save'], ['share', 'share'], ['read', window.speechSynthesis && (speechSynthesis.speaking || speechSynthesis.pending) ? 'stop reading' : 'read aloud'], ['copytext', 'copy text'], ['refresh', 'refresh'], ['postbefore', 'post before date']);
    } else {
      if (S.hub === 'feed' && fr && fr.kind === 'sub' && !isGlobal(fr)) {
        const has = S.subs.some((x) => x.toLowerCase() === fr.name.toLowerCase());
        L.push(['pin', has ? 'unpin tile' : 'pin tile'], ['about', 'about this community'], ['#/removed/' + encodeURIComponent(fr.name), 'removed posts']);
      }
      if (S.hub === 'feed' && fr && !isGlobal(fr) && ['sub', 'user', 'search'].includes(fr.kind)) L.push(['feedbefore', 'feed before date']);
      else L.push(['redditbefore', 'history']);
      L.push(['refresh', 'refresh']);
      if (A.cfg.user) L.push(['profile', 'profile']);
      L.push(['#/inbox', 'inbox' + (S.unread ? ' (' + S.unread + ')' : '')]);
      if (A.cfg.user) L.push(['#/messages', 'messages']);
      L.push(['#/saved', 'saved']);
    }
    L.push(['settings', 'settings']);
    const d = openDlg('<ul class="menu">' + L.map((x) => '<li><button data-m="' + esc(x[0]) + '">' + esc(x[1]) + '</button></li>').join('') + '<li class="ver"><button type="button" data-m="aboutapp">about</button></li></ul>');
    d.querySelector('.dlg').style.padding = '8px 0';
    d.querySelector('.menu').onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      d.close();
      doAct(b.dataset.m);
    };
  }

  async function openAbout(name) {
    const d = openDlg('<h2>r/' + esc(name) + '</h2>');
    try {
      const a = await A.reddit.about(name);
      const has = S.subs.some((x) => x.toLowerCase() === name.toLowerCase());
      d.querySelector('.dlg').innerHTML = '<h2>r/' + esc(a.name || name) + '</h2><p class="help">' + fmt(a.subscribers || 0) + ' members</p>' + (a.title ? '<p><b>' + esc(a.title) + '</b></p>' : '') + '<div class="md" style="max-height:46vh;overflow:auto">' + MD.render(a.sidebar || a.description) + '</div><div class="row"><button class="btn primary" data-pin>' + (has ? 'Unpin tile' : 'Pin tile') + '</button><button class="btn" data-close>Close</button></div>';
      d.querySelector('[data-pin]').onclick = () => { d.close(); const b = $('#appbar [data-ab="pin"]'); if (b) b.click(); };
    } catch (e) { d.querySelector('.dlg').innerHTML = '<h2>r/' + esc(name) + '</h2><div class="row"><button class="btn" data-close>Close</button></div>'; }
  }
  function openSubmit() {
    if (needAuth()) return;
    const fr = S.feedRoute;
    const d = openDlg('<h2>new post</h2><form id="subform"><label>Subreddit</label><input type="text" name="sr" value="' + esc(fr && fr.kind === 'sub' && !isGlobal(fr) ? fr.name : '') + '" required><label>Title</label><input type="text" name="title" required><label>Type</label><select name="kind"><option value="self">Text</option><option value="link">Link</option></select><label id="bodylbl">Text</label><div id="bodybox">' + mdEditor('body') + '</div><div class="row"><button class="btn primary">Post</button><button class="btn" type="button" data-close>Cancel</button></div></form>');
    const sync = () => {
      const link = d.querySelector('[name="kind"]').value === 'link';
      d.querySelector('#bodylbl').textContent = link ? 'Link' : 'Text';
      d.querySelector('.mdtop').style.display = link ? 'none' : '';
      d.querySelector('.mdbar').hidden = true;
      d.querySelector('textarea').rows = link ? 1 : 6;
    };
    d.querySelector('[name="kind"]').onchange = sync;
    d.querySelector('#subform').onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.target), kind = f.get('kind');
      try {
        await A.reddit.submit({ sr: f.get('sr'), title: f.get('title'), kind, text: kind === 'self' ? f.get('body') : '', url: kind === 'link' ? String(f.get('body')).trim() : '' });
        d.close(); toast('Post submitted');
      } catch (err) { errToast(err); }
    };
  }

  function openHow() {
    const ru = location.protocol === 'file:' ? '' : location.origin + location.pathname;
    const d = openDlg('<h2>client id</h2><ol class="steps">' +
      '<li>Sign in to Reddit and open <a href="https://www.reddit.com/prefs/apps" target="_blank" rel="noopener noreferrer">reddit.com/prefs/apps</a>.</li>' +
      '<li>Select <b>Create another app</b>.</li>' +
      '<li>Enter any name, such as Astra.</li>' +
      '<li>Set the type to <b>installed app</b>.</li>' +
      '<li>Set <b>redirect uri</b> to the value below. It must match exactly.</li>' +
      '<li>Select <b>Create app</b>.</li>' +
      '<li>Copy the ID shown under the app name. It is the short text below the words &ldquo;installed app&rdquo;.</li>' +
      '<li>Paste it into Client ID in Settings, then select Sign in.</li></ol>' +
      '<div class="vars"><label>Redirect URI</label>' + (ru ? '<code>' + esc(ru) + '</code>' : '<p class="help">Open Astra from a web address (http or https) to get a redirect URI. Local files are not supported.</p>') + '</div>' +
      '<div class="row">' + (ru ? '<button class="btn" id="h-copy">Copy redirect URI</button>' : '') + '<button class="btn primary" id="h-back">Back to settings</button></div>');
    d.querySelector('#h-back').onclick = () => openSettings('account');
    const cp = d.querySelector('#h-copy'); if (cp) cp.onclick = () => copy(ru, 'Copied');
  }
  function openSettings(open) {
    const SW = ['#A4C400', '#60A917', '#008A00', '#00ABA9', '#1BA1E2', '#0050EF', '#6A00FF', '#AA00FF', '#F472D0', '#D80073', '#A20025', '#E51400', '#FA6800', '#F0A30A', '#E3C800', '#825A2C', '#6D8764', '#647687', '#76608A', '#87794E'];
    const isPreset = SW.some((c) => c.toLowerCase() === String(set.accent).toLowerCase());
    const chk = (id, label) => '<label class="chk"><input type="checkbox" id="' + id + '"> ' + label + '</label>';
    const sel = (id, label, opts) => '<label for="' + id + '">' + label + '</label><select id="' + id + '">' + opts.map((o) => '<option value="' + o[0] + '">' + o[1] + '</option>').join('') + '</select>';
    const cat = (title, body) => '<details class="cat"><summary>' + title + '</summary><div class="catbody">' + body + '</div></details>';
    const d = openDlg('<h2>settings</h2>' +
      cat('appearance',
        '<div class="swatches" id="sw">' + SW.map((c) => '<button class="swatch" data-c="' + c + '" style="background:' + c + '" aria-pressed="' + (set.accent.toLowerCase() === c.toLowerCase()) + '" aria-label="Accent ' + c + '"></button>').join('') +
        '<label class="swatch rainbow" id="swc" aria-pressed="' + (!isPreset) + '" aria-label="Custom colour"><input type="color" id="s-color" value="' + esc(/^#[0-9a-f]{6}$/i.test(set.accent) ? set.accent : '#1BA1E2') + '"></label></div>' +
        sel('s-theme', 'Theme', [['dark', 'Dark'], ['black', 'Black'], ['gray', 'Gray'], ['accent', 'Accent'], ['light', 'Light'], ['system', 'System']]) +
        '<label for="s-ts">Text size</label><input type="range" id="s-ts" min="60" max="160" step="5" value="' + set.ts + '" style="width:100%">' +
        chk('s-compact', 'Compact layout') + chk('s-blur', 'Blur sensitive and spoiler content')) +
      cat('accessibility',
        sel('s-font', 'Typeface', [['default', 'Open Sans'], ['atkinson', 'Atkinson Hyperlegible'], ['system', 'System default']]) +
        sel('s-lh', 'Line spacing', [['normal', 'Standard'], ['relaxed', 'Relaxed'], ['loose', 'Loose']]) +
        sel('s-motion', 'Animation', [['system', 'Follow system setting'], ['reduce', 'Reduce'], ['full', 'Full']]) +
        sel('s-toast', 'Notification duration', [['4', '4 seconds'], ['8', '8 seconds'], ['15', '15 seconds']]) +
        sel('s-rate', 'Read aloud speed', [['0.8', 'Slow'], ['1', 'Normal'], ['1.25', 'Fast'], ['1.5', 'Faster']]) + chk('s-speechc', 'Include comments when reading aloud') +
        chk('s-contrast', 'High contrast') + chk('s-focus', 'Enhanced focus indicators') + chk('s-targets', 'Larger touch targets') + chk('s-links', 'Underline links') + chk('s-autoplay', 'Play animated media automatically')) +
      cat('toolbar', '<div id="barbox"></div>' + chk('s-barlabels', 'Show labels')) +
      cat('top bar', '<h3>tabs</h3><div id="tabbox"></div><h3>shortcuts</h3><div id="itembox"></div>') +
      cat('content',
        chk('s-hnsfw', 'Hide sensitive content') + chk('s-hread', 'Hide posts already read') + chk('s-gest', 'Swipe gestures') +
        '<h3 role="img" aria-label="Deleted content" title="Deleted content">' + icon('trash') + '</h3>' + sel('s-hdel', 'Hide', [['off', 'Off'], ['posts', 'Posts'], ['comments', 'Comments'], ['both', 'Posts and comments']]) + DEL_PAGES.map((x) => chk('s-hd-' + x[0], x[1])).join('') +
        '<h3>images</h3>' + chk('s-iProfile', 'Profile') + chk('s-iFeed', 'Community') + chk('s-iPost', 'Post') + chk('s-iComments', 'Comments') +
        '<div class="row"><button class="btn" id="s-blocks">Manage blocked content</button></div>') +
      cat('sources',
        chk('s-sR', 'Reddit') + chk('s-sA', 'Arctic Shift') + chk('s-sP', 'PullPush') +
        sel('s-cache', 'Cache duration', [[0, 'Off'], [1, '1 minute'], [5, '5 minutes'], [15, '15 minutes'], [60, '1 hour'], [360, '6 hours'], [1440, '1 day']])) +
      cat('account',
        '<label for="s-cid">Client ID</label><input type="text" id="s-cid" value="' + esc(set.clientId || '') + '" placeholder="Optional" autocomplete="off" autocapitalize="off" spellcheck="false">' +
        '<p class="help">A client ID is required to sign in.</p>' + '<div class="row"><button class="btn small" type="button" id="s-how">How?</button></div>' +
        (A.cfg.user ? chk('s-notify', 'Notifications') : '') +
        '<div class="row">' + (A.cfg.user ? '<button class="btn" id="s-out">Sign out' + (S.me ? ' u/' + esc(S.me) : '') + '</button>' : '<button class="btn primary" id="s-conn"' + (String(set.clientId || '').trim() ? '' : ' disabled') + '>Sign in</button>') + '</div>') +
      cat('data', '<div class="row"><button class="btn" id="s-clear">Clear all data</button></div>') +
      '<div class="row" style="margin-top:20px"><button class="btn primary" data-close>Close</button></div>');
    if (open) $$('details.cat', d).forEach((x) => { x.open = x.querySelector('summary').textContent === open; });
    function drawBar() {
      const on = set.toolbar.filter((id) => BAR_IDS.indexOf(id) >= 0), off = BAR_IDS.filter((id) => on.indexOf(id) < 0);
      const mv = (id, dir, dis) => '<button class="btn small" type="button" data-mv="' + dir + '" data-id="' + id + '"' + (dis ? ' disabled' : '') + ' aria-label="Move ' + esc(BAR_NAMES[id]) + (dir === 'up' ? ' up' : ' down') + '">' + (dir === 'up' ? '&#9650;' : '&#9660;') + '</button>';
      $('#barbox', d).innerHTML = '<ol class="routes">' +
        on.map((id, k) => '<li><label class="rname"><input type="checkbox" data-bar="' + id + '" checked> ' + esc(BAR_NAMES[id]) + '</label>' + mv(id, 'up', !k) + mv(id, 'down', k === on.length - 1) + '</li>').join('') +
        off.map((id) => '<li><label class="rname"><input type="checkbox" data-bar="' + id + '"> ' + esc(BAR_NAMES[id]) + '</label></li>').join('') + '</ol>' +
        '<p class="help">Selected items appear in the order shown. The More menu is always available.</p>';
    }
    drawBar();
    function drawTop() {
      const one = (key, all, names, box) => {
        const on = set[key].filter((id) => names[id]), off = all.filter((id) => on.indexOf(id) < 0);
        const mv = (id, dir, dis) => '<button class="btn small" type="button" data-tmv="' + dir + '" data-tk="' + key + '" data-id="' + id + '"' + (dis ? ' disabled' : '') + ' aria-label="Move ' + esc(names[id]) + (dir === 'up' ? ' up' : ' down') + '">' + (dir === 'up' ? '&#9650;' : '&#9660;') + '</button>';
        $(box, d).innerHTML = '<ol class="routes">' +
          on.map((id, k) => '<li><label class="rname"><input type="checkbox" data-tchk="' + key + '" data-id="' + id + '" checked> ' + esc(names[id]) + '</label>' + mv(id, 'up', !k) + mv(id, 'down', k === on.length - 1) + '</li>').join('') +
          off.map((id) => '<li><label class="rname"><input type="checkbox" data-tchk="' + key + '" data-id="' + id + '"> ' + esc(names[id]) + '</label></li>').join('') + '</ol>';
      };
      one('topTabs', Object.keys(TOP_TABS), TOP_TABS, '#tabbox');
      one('topItems', Object.keys(TOP_ITEMS), TOP_ITEMS, '#itembox');
    }
    drawTop();
    d.addEventListener('click', (e) => {
      const t = e.target.closest('button');
      if (!t || !t.dataset.tmv) return;
      const L = set[t.dataset.tk], k = L.indexOf(t.dataset.id), n = t.dataset.tmv === 'up' ? k - 1 : k + 1;
      if (k < 0 || n < 0 || n >= L.length) return;
      L.splice(n, 0, L.splice(k, 1)[0]);
      saveSet(); drawTop(); drawMe();
    });
    d.addEventListener('click', (e) => {
      const t = e.target.closest('button');
      if (!t || !t.dataset.mv) return;
      const L = set.toolbar, k = L.indexOf(t.dataset.id), n = t.dataset.mv === 'up' ? k - 1 : k + 1;
      if (k < 0 || n < 0 || n >= L.length) return;
      L.splice(n, 0, L.splice(k, 1)[0]);
      saveSet(); drawBar(); renderBar();
    });
    $('#s-theme', d).value = set.theme;
    $('#s-hdel', d).value = ['posts', 'comments', 'both'].indexOf(set.hideDeleted) >= 0 ? set.hideDeleted : 'off';
    DEL_PAGES.forEach((x) => { $('#s-hd-' + x[0], d).checked = delPageOn(x[0]); });
    $('#s-cache', d).value = String(set.cacheMin);
    $('#s-font', d).value = set.font; $('#s-lh', d).value = set.lh; $('#s-motion', d).value = set.motion; $('#s-toast', d).value = String(set.toastSec); $('#s-rate', d).value = String(set.speechRate);
    ['R', 'A', 'P'].forEach((c) => { $('#s-s' + c, d).checked = !!set.sources[c]; });
    const flags = { 's-compact': 'compact', 's-blur': 'blur', 's-hnsfw': 'hideNsfw', 's-hread': 'hideRead', 's-gest': 'gestures', 's-iProfile': 'imgProfile', 's-iFeed': 'imgFeed', 's-iPost': 'imgPost', 's-iComments': 'imgComments', 's-notify': 'notify', 's-contrast': 'contrast', 's-focus': 'focus', 's-targets': 'targets', 's-links': 'links', 's-autoplay': 'autoplay', 's-barlabels': 'barLabels', 's-speechc': 'speechComments' };
    Object.keys(flags).forEach((id) => { const el = $('#' + id, d); if (el) el.checked = !!set[flags[id]]; });
    d.querySelector('#sw').onclick = (e) => { const b = e.target.closest('button.swatch'); if (!b) return; set.accent = b.dataset.c; saveSet(); applyTheme(); $$('.swatch', d).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); renderSubs(); };
    const col = d.querySelector('#s-color');
    col.oninput = (e) => { set.accent = e.target.value; saveSet(); applyTheme(); $$('.swatch', d).forEach((x) => x.setAttribute('aria-pressed', String(x.id === 'swc'))); };
    col.onchange = () => renderSubs();
    d.querySelector('#s-ts').oninput = (e) => { set.ts = +e.target.value; applyTheme(); };
    d.onchange = (e) => {
      const t = e.target;
      let srcChanged = false, relist = false;
      if (t.dataset.tchk) {
        const L = set[t.dataset.tchk], k = L.indexOf(t.dataset.id);
        if (t.checked && k < 0) L.push(t.dataset.id); else if (!t.checked && k >= 0) L.splice(k, 1);
        saveSet(); drawTop(); drawMe(); markPivot(); return;
      }
      if (t.dataset.bar) {
        const k = set.toolbar.indexOf(t.dataset.bar);
        if (t.checked && k < 0) set.toolbar.push(t.dataset.bar); else if (!t.checked && k >= 0) set.toolbar.splice(k, 1);
        saveSet(); drawBar(); renderBar(); return;
      }
      if (t.id === 's-theme') set.theme = t.value;
      else if (t.id === 's-font') set.font = t.value;
      else if (t.id === 's-lh') set.lh = t.value;
      else if (t.id === 's-motion') set.motion = t.value;
      else if (t.id === 's-toast') set.toastSec = +t.value;
      else if (t.id === 's-rate') set.speechRate = +t.value;
      else if (t.id === 's-hdel') { set.hideDeleted = t.value; relist = true; }
      else if (/^s-hd-/.test(t.id)) { set.hideDelPages = Object.assign({}, DEF.hideDelPages, set.hideDelPages); set.hideDelPages[t.id.slice(5)] = t.checked; relist = true; }
      else if (t.id === 's-cache') { set.cacheMin = +t.value; applyCache(); if (!set.cacheMin) clearCacheAll(); }
      else if (t.id === 's-cid') { set.clientId = t.value.trim(); store.del('apptoken'); appTok = null; tokFail = 0; if (!A.cfg.user) { A.cfg.token = null; A.cfg.exp = 0; } A.clearCache(); srcChanged = true; }
      else if (/^s-s[RAP]$/.test(t.id)) {
        set.sources[t.id.slice(3)] = t.checked;
        if (!set.sources.R && !set.sources.A && !set.sources.P) { set.sources.R = true; $('#s-sR', d).checked = true; }
        srcChanged = true;
      } else if (flags[t.id]) {
        set[flags[t.id]] = t.checked;
        if (t.id === 's-notify' && t.checked && window.Notification && Notification.permission === 'default') Notification.requestPermission();
        relist = true;
      }
      saveSet(); applyTheme(); renderBar();
      if (srcChanged) { clearCacheAll(); applySrc(); renderSubs(); } else if (relist) { if (S.feed) renderList(S.feed.items.length); if (S.T) renderThread(false); if (S.feedRoute && S.feedRoute.kind) renderFeedTop(); }
    };
    d.querySelector('#s-blocks').onclick = () => openBlocks();
    const conn = d.querySelector('#s-conn');
    if (conn) d.addEventListener('input', (e) => { if (e.target.id === 's-cid') conn.disabled = !e.target.value.trim(); });
    if (conn) conn.onclick = () => {
      const typed = $('#s-cid', d).value.trim();
      if (!typed) { conn.disabled = true; return; }
      set.clientId = typed; saveSet();
      if (location.protocol === 'file:') return;
      const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
      store.set('oauthstate', state);
      location.href = 'https://www.reddit.com/api/v1/authorize' + A.qs({ client_id: typed, response_type: 'token', state, redirect_uri: location.origin + location.pathname, scope: 'identity read vote submit save subscribe mysubreddits privatemessages history edit account' });
    };
    d.querySelector('#s-how').onclick = () => openHow();
    const out = d.querySelector('#s-out');
    if (out) out.onclick = () => { A.clearToken(); d.close(); renderSubs(); };
    d.querySelector('#s-clear').onclick = () => { if (confirm('Clear all data stored by Astra? This cannot be undone.')) { clearAll(); location.hash = '#/'; location.reload(); } };
  }

  async function pollInbox() {
    if (!A.cfg.user || document.hidden) return;
    try {
      const l = await A.reddit.inbox('unread');
      const n = l.length;
      if (S.unreadInit && n > S.unread) {
        toast(n + ' unread', 'Open', () => go('#/inbox'));
        if (set.notify && window.Notification && Notification.permission === 'granted') { try { new Notification('Astra', { body: n + ' unread' }); } catch (e) {  } }
      }
      S.unread = n; S.unreadInit = true;
      renderBar();
    } catch (e) {  }
  }
  setInterval(pollInbox, 120000);

  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t.closest && (t.closest('input, textarea, select') || $('#dlg').open)) { if (e.key === 'Escape' && t.blur) t.blur(); return; }
    const F = S.feed;
    const move = (d) => {
      if (!F || !(F.view || F.items).length) return;
      S.sel = Math.max(0, Math.min((F.view || F.items).length - 1, (S.sel < 0 ? (d > 0 ? -1 : 1) : S.sel) + d));
      $$('.post', $('#feed-list')).forEach((x) => x.classList.toggle('sel', +x.dataset.i === S.sel));
      const el = $('.post[data-i="' + S.sel + '"]');
      if (el) el.scrollIntoView({ block: 'nearest' });
    };
    const order = HUBS.map((x) => x[0]);
    switch (e.key) {
      case 'j': move(1); break;
      case 'k': move(-1); break;
      case 'Enter': { const el = $('.post.sel'); if (el && S.hub === 'feed') el.click(); break; }
      case 'h': showHub(order[Math.max(0, order.indexOf(S.hub) - 1)]); break;
      case 'l': showHub(order[Math.min(order.length - 1, order.indexOf(S.hub) + 1)]); break;
      case 'u': { const m = F && F.view && F.view[S.sel]; if (m && !m.c && S.hub === 'feed') feedVote(m, 1); break; }
      case 's': { const m = F && F.view && F.view[S.sel]; if (m && !m.c && S.hub === 'feed') toggleSavePost(m); break; }
      case 'x': { const m = F && F.view && F.view[S.sel]; if (m && !m.c && S.hub === 'feed') hidePost(m); break; }
      case 'r': $('#appbar [data-ab="refresh"]') && $('#appbar [data-ab="refresh"]').click(); break;
      case '/': e.preventDefault(); openSearch(); break;
      default: return;
    }
  });

  function boot() {
    applyTheme();
    S.ready = true;
    buildPivot(); renderSubs(); renderSearch(); renderBar();
    new MutationObserver(() => { const root = $('#thread-body'); inlineMedia(root); bindVideos(root); fillAvatars(root); }).observe($('#thread-body'), { childList: true, subtree: true });
    window.addEventListener('hashchange', onRoute);
    window.addEventListener('resize', () => { renderBar(); });
    if (S.authError) toast('Sign-in was not completed.');
    if (S.justConnected) {
      A.reddit.me().then((j) => { S.me = j.name; store.set('me', j.name); drawMe(); return A.reddit.subscriptions(); }).then((names) => {
        const have = new Set(S.subs.map((x) => x.toLowerCase()));
        names.forEach((n) => { if (!have.has(n.toLowerCase())) S.subs.push(n); });
        store.set('subs', S.subs); renderSubs();
      }).catch(() => {});
    }
    onRoute();
    setTimeout(pollInbox, 2500);
  }
  boot();
})();
