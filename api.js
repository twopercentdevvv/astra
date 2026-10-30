(function (g) {
  'use strict';

  const A = (g.Astra = g.Astra || {});
  const cfg = (A.cfg = {
    oauthBase: 'https://oauth.reddit.com',
    arctic: 'https://arctic-shift.photon-reddit.com',
    pullpush: 'https://api.pullpush.io',
    token: null, user: false, exp: 0, ppGap: 3500, ttl: 60000
  });
  const health = (A.health = { reddit: {}, arctic: {}, pullpush: {} });
  const reqLog = (A.log = []);
  const stats = (A.stats = { hit: 0, miss: 0 });
  const note = (e) => { reqLog.unshift(e); if (reqLog.length > 40) reqLog.pop(); };
  const pathOf = (u) => String(u).replace(/^https?:\/\/[^/]+/, '').split('?')[0];
  const fire = (name, detail) => { try { g.dispatchEvent(new CustomEvent(name, { detail })); } catch (e) {  } };
  const setHealth = (src, patch) => { Object.assign(health[src], patch); fire('astra:health', src); };

  class ApiError extends Error {
    constructor(msg, info) { super(msg); this.name = 'ApiError'; Object.assign(this, info || {}); }
  }
  A.ApiError = ApiError;

  const qs = (o) => {
    const p = Object.keys(o || {}).filter((k) => o[k] !== undefined && o[k] !== null && o[k] !== '')
      .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(o[k]).replace(/%2C/g, ','));
    return p.length ? '?' + p.join('&') : '';
  };
  A.qs = qs;

  const cache = new Map();
  const inflight = new Map();
  const queue = [];
  let active = 0;
  const MAX_ACTIVE = 4;
  function pump() {
    while (active < MAX_ACTIVE && queue.length) {
      const t = queue.shift();
      active++;
      t.fn().then(t.res, t.rej).then(() => { active--; pump(); });
    }
  }
  let ppNext = 0, ppChain = Promise.resolve(), ppBlockedUntil = 0;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function ppSlot() {
    const p = ppChain.then(async () => { const w = ppNext - Date.now(); if (w > 0) await sleep(w); ppNext = Date.now() + cfg.ppGap; });
    ppChain = p.catch(() => {});
    return p;
  }
  const limit = (fn) => new Promise((res, rej) => { queue.push({ fn, res, rej }); pump(); });
  const NAMES = { reddit: 'Reddit', arctic: 'Arctic Shift', pullpush: 'PullPush' };

  function getJSON(url, o) {
    o = o || {};
    const source = o.source;
    const ttl = o.ttl === undefined ? cfg.ttl : o.ttl;
    const key = url + (o.headers && o.headers.Authorization ? '#auth' : '');
    const hit = cache.get(key);
    if (hit && Date.now() - hit.t < ttl) { stats.hit++; return Promise.resolve(hit.v); }
    stats.miss++;
    if (inflight.has(key)) return inflight.get(key);
    const run = source === 'pullpush' ? (fn) => fn() : limit;
    const p = run(async () => {
      const t0 = Date.now();
      let r;
      const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const to = ctl ? setTimeout(() => ctl.abort(), 20000) : 0;
      try {
        r = await fetch(url, { headers: o.headers, credentials: 'omit', signal: ctl ? ctl.signal : undefined });
        clearTimeout(to);
      } catch (e) {
        clearTimeout(to);
        const timedOut = ctl && ctl.signal.aborted;
        const detail = timedOut ? 'timed out after 20s' : (e && (e.name + ': ' + e.message));
        setHealth(source, { ok: false, err: timedOut ? 'timed out' : 'unreachable', detail, status: null });
        note({ t: Date.now(), src: source, path: pathOf(url), status: 0, ms: Date.now() - t0, err: timedOut ? 'timeout' : 'network' });
        throw new ApiError(NAMES[source] + ' could not be reached (' + detail + ').', { source, network: true, detail });
      }
      const ms = Date.now() - t0;
      if (r.status === 429) {
        const wait = +(r.headers.get('X-RateLimit-Reset') || r.headers.get('Retry-After') || (source === 'pullpush' ? 60 : 30));
        if (source === 'pullpush') ppBlockedUntil = Date.now() + Math.max(wait, 20) * 1000;
        setHealth(source, { ok: false, ms, err: 'rate limited', status: 429 });
        note({ t: Date.now(), src: source, path: pathOf(url), status: 429, ms, err: 'rate limited' });
        throw new ApiError(NAMES[source] + ' is limiting requests. Try again in ' + wait + ' seconds.', { status: 429, source, retryAfter: wait, silent: true });
      }
      if (!r.ok) {
        let body = '';
        try { body = (await r.text()).slice(0, 160); } catch (e) {  }
        setHealth(source, { ok: false, ms, err: String(r.status), status: r.status });
        note({ t: Date.now(), src: source, path: pathOf(url), status: r.status, ms, err: String(r.status) });
        throw new ApiError(NAMES[source] + ' returned ' + r.status + (body && r.status !== 404 ? ': ' + body : ''), { status: r.status, source });
      }
      let j;
      try { j = await r.json(); } catch (e) { throw new ApiError(NAMES[source] + ' returned an unreadable response.', { source, unexpected: true }); }
      setHealth(source, { ok: true, ms, err: null, status: r.status });
      note({ t: Date.now(), src: source, path: pathOf(url), status: r.status, ms });
      return j;
    }).then((v) => { cache.set(key, { t: Date.now(), v }); return v; }).finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  }
  A.clearCache = () => cache.clear();

  const IMG_RE = /\.(jpe?g|png|gif|webp|avif)(\?.*)?$/i;
  const isImageUrl = (u) => !!u && (IMG_RE.test(u) || /^https?:\/\/(i\.redd\.it|i\.imgur\.com)\//i.test(u));
  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };
  const unamp = (s) => (s ? String(s).replace(/&amp;/g, '&') : s);
  function removedKind(selftext, author, cat) {
    if (selftext === '[removed]' || (cat && cat !== 'deleted')) return 'mod';
    if (selftext === '[deleted]' || author === '[deleted]' || cat === 'deleted') return 'user';
    return null;
  }
  const isGone = (c) => !c || c.body === '[deleted]' || c.body === '[removed]' || (c.author === '[deleted]' && !c.body);
  A.isGone = isGone;

  function galleryOf(d) {
    if (!(d.is_gallery && d.gallery_data && d.media_metadata)) return null;
    const out = d.gallery_data.items.map((it) => {
      const m = d.media_metadata[it.media_id];
      return m && m.s ? unamp(m.s.u || m.s.gif) : null;
    }).filter(Boolean);
    return out.length ? out : null;
  }

  function gifVideo(p, prev) {
    if (p.video) return;
    const mp4 = prev && prev.variants && prev.variants.mp4 && prev.variants.mp4.source && unamp(prev.variants.mp4.source.url);
    if (mp4) p.video = { url: mp4, gif: true };
    else if (/^https?:\/\/i\.imgur\.com\/\w+\.gif(\?.*)?$/i.test(p.url || '')) p.video = { url: p.url.replace(/\.gif.*$/i, '.mp4'), gif: true };
  }

  function normRedditPost(d) {
    const p = {
      id: d.id, name: 't3_' + d.id, title: d.title || '', author: d.author || '[deleted]', subreddit: d.subreddit || '',
      score: d.score === undefined ? 0 : d.score, numComments: d.num_comments || 0, created: d.created_utc,
      selftext: d.selftext || '', url: d.url || '', domain: d.domain || hostOf(d.url),
      permalink: d.permalink || '/r/' + d.subreddit + '/comments/' + d.id + '/',
      over18: !!d.over_18, spoiler: !!d.spoiler, stickied: !!(d.stickied || d.pinned), locked: !!d.locked,
      flair: d.link_flair_text || '', isSelf: !!d.is_self, saved: !!d.saved, likes: d.likes, src: 'R'
    };
    p.removed = removedKind(p.selftext, p.author, d.removed_by_category);
    p.images = galleryOf(d);
    const rv = (d.secure_media && d.secure_media.reddit_video) || (d.media && d.media.reddit_video);
    if (rv) p.video = { url: rv.fallback_url, hls: rv.hls_url };
    else if (/\.gifv$/i.test(p.url)) p.video = { url: p.url.replace(/\.gifv$/i, '.mp4'), gif: true };
    else if (isImageUrl(p.url)) p.image = p.url;
    const prev = d.preview && d.preview.images && d.preview.images[0];
    gifVideo(p, prev);
    p.preview = p.image || (p.images && p.images[0]) || (prev && prev.source && unamp(prev.source.url)) || '';
    p.thumb = /^https?:/.test(d.thumbnail || '') ? d.thumbnail : '';
    if (d.crosspost_parent_list && d.crosspost_parent_list[0]) p.crosspost = d.crosspost_parent_list[0].subreddit_name_prefixed;
    return p;
  }

  function normArchivePost(d, code) {
    const url = d.url || d.url_overridden_by_dest || '';
    const p = {
      id: d.id, name: 't3_' + d.id, title: d.title || '', author: d.author || '[deleted]', subreddit: d.subreddit || '',
      score: d.score === undefined ? 0 : d.score, numComments: d.num_comments || 0, created: +d.created_utc,
      selftext: d.selftext || '', url, domain: d.domain || hostOf(url),
      permalink: d.permalink || '/r/' + d.subreddit + '/comments/' + d.id + '/',
      over18: !!d.over_18, spoiler: !!d.spoiler, stickied: !!d.stickied, locked: !!d.locked,
      flair: d.link_flair_text || '', isSelf: !!d.is_self || /reddit\.com\/r\/[^/]+\/comments\//.test(url), saved: false, src: code
    };
    const ret = d.retrieved_on !== undefined ? d.retrieved_on : d.retrieved_utc;
    p.retrieved = ret ? +ret : 0;
    p.captureSec = p.retrieved && p.created ? p.retrieved - p.created : null;
    p.removed = removedKind(p.selftext, p.author, d.removed_by_category);
    p.images = galleryOf(d);
    if (/\.gifv$/i.test(url)) p.video = { url: url.replace(/\.gifv$/i, '.mp4'), gif: true };
    else if (isImageUrl(url)) p.image = url;
    const prev = d.preview && d.preview.images && d.preview.images[0];
    gifVideo(p, prev);
    p.preview = p.image || (p.images && p.images[0]) || (prev && prev.source && unamp(prev.source.url)) || '';
    p.thumb = /^https?:/.test(d.thumbnail || '') ? d.thumbnail : '';
    return p;
  }

  function normComment(d, code) {
    const ret = d.retrieved_on !== undefined ? d.retrieved_on : d.retrieved_utc;
    const c = {
      id: d.id, name: 't1_' + d.id, author: d.author || '[deleted]', body: d.body || '',
      score: d.score === undefined ? 0 : d.score, created: +d.created_utc, parent: d.parent_id || '', link: d.link_id || '',
      distinguished: d.distinguished || null, stickied: !!d.stickied, op: !!d.is_submitter, flair: d.author_flair_text || '',
      subreddit: d.subreddit || '', permalink: d.permalink || '', src: code, scoreHidden: !!d.score_hidden,
      linkTitle: d.link_title || '', retrieved: ret ? +ret : 0, saved: !!d.saved, likes: d.likes
    };
    c.captureSec = c.retrieved && c.created ? c.retrieved - c.created : null;
    return c;
  }

  const R = (A.reddit = {});
  R.url = (path, params) => cfg.oauthBase + path + qs(Object.assign({ raw_json: 1 }, params));
  R.hdr = () => (cfg.token ? { Authorization: 'Bearer ' + cfg.token } : undefined);
  R.get = async (path, params, opts) => {
    if (A.ensureToken) { try { await A.ensureToken(); } catch (e) {  } }
    if (!cfg.token) throw new ApiError('Unable to obtain an access token.', { source: 'reddit', status: 401, auth: true });
    const url = R.url(path, params);
    const run = (tok) => getJSON(url, Object.assign({ source: 'reddit', headers: { Authorization: 'Bearer ' + tok } }, opts));
    try { return await run(cfg.token); }
    catch (e) {
      if ((e.status === 401 || e.status === 403) && A.defaultToken) {
        let t = null;
        try { t = await A.defaultToken(); } catch (x) { t = null; }
        if (t && t !== cfg.token) return run(t);
      }
      throw e;
    }
  };

  R.listing = async (o) => {
    const params = { limit: 25, after: o.after };
    let path;
    const sort = o.sort || 'hot';
    if (o.kind === 'home' && cfg.user) path = '/' + sort;
    else if (o.kind === 'sub' || o.kind === 'home') path = '/r/' + (o.name || 'popular') + (sort === 'hot' ? '' : '/' + sort);
    else if (o.kind === 'user') { path = '/user/' + o.name + '/' + (o.tab || 'overview'); params.sort = sort === 'hot' ? 'new' : sort; }
    else if (o.kind === 'search') {
      path = o.sub ? '/r/' + o.sub + '/search' : '/search';
      Object.assign(params, { q: o.q, sort: sort === 'hot' ? 'relevance' : sort, restrict_sr: o.sub ? 1 : undefined, type: 'link' });
    } else if (o.kind === 'saved') path = '/user/' + o.name + '/saved';
    else throw new Error('Unknown listing kind ' + o.kind);
    if (['top', 'controversial'].includes(sort) || o.kind === 'search' || o.kind === 'user') params.t = o.t || (o.kind === 'search' ? 'all' : 'day');
    if (!['top', 'controversial'].includes(sort) && o.kind !== 'search' && o.kind !== 'user') delete params.t;
    const j = await R.get(path, params);
    const items = ((j.data && j.data.children) || []).map((c) => (c.kind === 't3' ? normRedditPost(c.data) : c.kind === 't1' ? normComment(c.data, 'R') : null)).filter(Boolean);
    return { items, after: (j.data && j.data.after) || null };
  };

  R.about = async (name) => {
    const j = await R.get('/r/' + name + '/about', {}, { ttl: 600000 });
    const d = j.data || {};
    return {
      name: d.display_name, subscribers: d.subscribers, title: d.title, description: d.public_description || '', sidebar: d.description || '',
      over18: !!d.over18, icon: unamp(d.community_icon || d.icon_img || ''), banner: unamp(d.banner_background_image || d.banner_img || ''), created: d.created_utc, subscribed: !!d.user_is_subscriber
    };
  };

  R.info = async (names) => {
    const out = [];
    for (let i = 0; i < names.length; i += 100) {
      const j = await R.get('/api/info', { id: names.slice(i, i + 100).join(',') });
      ((j.data && j.data.children) || []).forEach((c) => { if (c.kind === 't3') out.push(normRedditPost(c.data)); });
    }
    return out;
  };

  function walkLive(children, flat, stubs) {
    (children || []).forEach((ch) => {
      if (ch.kind === 't1') {
        const c = normComment(ch.data, 'R');
        flat.set(c.id, c);
        const rep = ch.data.replies;
        if (rep && rep.data) walkLive(rep.data.children, flat, stubs);
      } else if (ch.kind === 'more') {
        stubs.push({ ids: ch.data.children || [], parent: ch.data.parent_id || '', count: ch.data.count || 0 });
      }
    });
  }
  R.thread = async (id, o) => {
    o = o || {};
    const j = await R.get('/comments/' + id, { sort: o.sort || 'confidence', limit: 500, depth: 10 });
    const first = j[0] && j[0].data && j[0].data.children && j[0].data.children[0];
    if (!first) throw new ApiError('The post could not be retrieved.', { source: 'reddit' });
    const post = normRedditPost(first.data);
    const flat = new Map();
    const stubs = [];
    walkLive((j[1] && j[1].data && j[1].data.children) || [], flat, stubs);
    return { post, flat, stubs };
  };
  R.moreChildren = async (linkId, ids, sort) => {
    const flat = new Map();
    const stubs = [];
    if (!ids.length) return { flat, stubs };
    const j = await R.get('/api/morechildren', { api_type: 'json', link_id: 't3_' + linkId, children: ids.slice(0, 100).join(','), sort: sort || 'confidence' }, { ttl: 0 });
    const things = (j.json && j.json.data && j.json.data.things) || [];
    things.forEach((t) => {
      if (t.kind === 't1') { const c = normComment(t.data, 'R'); flat.set(c.id, c); }
      else if (t.kind === 'more') stubs.push({ ids: t.data.children || [], parent: t.data.parent_id || '', count: t.data.count || 0 });
    });
    return { flat, stubs, rest: ids.slice(100) };
  };
  R.subthread = async (linkId, parentName) => {
    const j = await R.get('/comments/' + linkId + '/_/' + parentName.replace(/^t1_/, ''), { limit: 500, depth: 10 }, { ttl: 0 });
    const flat = new Map();
    const stubs = [];
    walkLive((j[1] && j[1].data && j[1].data.children) || [], flat, stubs);
    return { flat, stubs };
  };

  async function oauthPost(path, form) {
    if (!cfg.user) throw new ApiError('Sign in from Settings to continue.', { source: 'reddit', auth: true });
    const body = new URLSearchParams(Object.assign({ api_type: 'json', raw_json: '1' }, form));
    let r;
    try {
      r = await fetch(cfg.oauthBase + path, { method: 'POST', headers: { Authorization: 'Bearer ' + cfg.token, 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    } catch (e) { throw new ApiError('Reddit could not be reached.', { source: 'reddit', network: true }); }
    if (r.status === 401) { A.clearToken && A.clearToken(); throw new ApiError('Your session has expired. Sign in again from Settings.', { source: 'reddit', auth: true }); }
    if (!r.ok) throw new ApiError('Reddit returned ' + r.status + '.', { source: 'reddit', status: r.status });
    let j = {};
    try { j = await r.json(); } catch (e) {  }
    if (j.json && j.json.errors && j.json.errors.length) throw new ApiError(j.json.errors.map((e) => e[1] || e[0]).join('; '), { source: 'reddit' });
    return j;
  }
  R.userAbout = async (name) => {
    const j = await R.get('/user/' + name + '/about', {}, { ttl: 600000 });
    const d = j.data || {}, sr = d.subreddit || {};
    return { name: d.name, link: d.link_karma || 0, comment: d.comment_karma || 0, created: d.created_utc, icon: unamp(d.snoovatar_img || d.icon_img || sr.icon_img || ''), banner: unamp(sr.banner_img || ''), bio: sr.public_description || '' };
  };
  R.hide = (name, on) => oauthPost(on ? '/api/hide' : '/api/unhide', { id: name });
  R.blockUser = (name) => oauthPost('/api/block_user', { name });
  R.vote = (name, dir) => oauthPost('/api/vote', { id: name, dir: String(dir) });
  R.save = (name, on) => oauthPost(on ? '/api/save' : '/api/unsave', { id: name });
  R.comment = async (parent, text) => {
    const j = await oauthPost('/api/comment', { thing_id: parent, text });
    const t = j.json && j.json.data && j.json.data.things && j.json.data.things[0];
    return t ? normComment(t.data, 'R') : null;
  };
  R.subscribe = (sub, on) => oauthPost('/api/subscribe', { sr_name: sub, action: on ? 'sub' : 'unsub' });
  R.submit = (o) => oauthPost('/api/submit', { sr: o.sr, title: o.title, kind: o.kind, text: o.text || '', url: o.url || '', resubmit: 'true' });
  R.me = () => R.get('/api/v1/me', {}, { ttl: 0 });
  R.subscriptions = async () => {
    const names = [];
    let after = null;
    for (let i = 0; i < 5; i++) {
      const j = await R.get('/subreddits/mine/subscriber', { limit: 100, after }, { ttl: 0 });
      ((j.data && j.data.children) || []).forEach((c) => names.push(c.data.display_name));
      after = j.data && j.data.after;
      if (!after) break;
    }
    return names;
  };
  R.inbox = async (where) => {
    const j = await R.get('/message/' + (where || 'inbox'), { limit: 50 }, { ttl: 0 });
    return ((j.data && j.data.children) || []).map((c) => ({
      id: c.data.id, name: c.data.name, kind: c.kind, author: c.data.author || 'Reddit', subject: c.data.subject || c.data.link_title || '',
      body: c.data.body || '', created: c.data.created_utc, isNew: !!c.data.new, context: c.data.context || '', subreddit: c.data.subreddit || ''
    }));
  };

  const mapMsg = (c) => {
    const d = c.data || {};
    return { id: d.id, name: d.name, author: d.author || 'Reddit', dest: d.dest || '', subject: d.subject || '', body: d.body || '', created: d.created_utc, isNew: !!d.new,
      replies: d.replies && d.replies.data ? (d.replies.data.children || []).map(mapMsg) : [] };
  };
  R.messages = async (box) => {
    const j = await R.get('/message/' + (box === 'sent' ? 'sent' : 'messages'), { limit: 50 }, { ttl: 0 });
    return ((j.data && j.data.children) || []).filter((c) => c.kind === 't4').map(mapMsg);
  };
  R.compose = (to, subject, text) => oauthPost('/api/compose', { to, subject, text });
  R.replyMessage = (parent, text) => oauthPost('/api/comment', { thing_id: parent, text });
  R.readMessages = (names) => oauthPost('/api/read_message', { id: names.join(',') });

  const AS = (A.arctic = {});
  AS.get = async (path, params, opts) => {
    const j = await getJSON(cfg.arctic + path + qs(params), Object.assign({ source: 'arctic', ttl: 120000 }, opts));
    if (j && j.error) throw new ApiError('Arctic Shift: ' + j.error, { source: 'arctic' });
    return j;
  };
  const dataOf = (j) => (j && Array.isArray(j.data) ? j.data : Array.isArray(j) ? j : []);
  AS.posts = async (p) => dataOf(await AS.get('/api/posts/search', p)).map((d) => normArchivePost(d, 'A'));
  AS.comments = async (p) => dataOf(await AS.get('/api/comments/search', p)).map((d) => normComment(d, 'A'));
  AS.postsByIds = async (ids) => {
    const out = [];
    for (let i = 0; i < ids.length; i += 100) {
      const j = await AS.get('/api/posts/ids', { ids: ids.slice(i, i + 100).join(',') });
      dataOf(j).forEach((d) => out.push(normArchivePost(d, 'A')));
    }
    return out;
  };
  AS.commentsAll = async (linkId, o) => {
    const maxPages = (o && o.maxPages) || 8;
    const out = new Map();
    let after = null;
    for (let i = 0; i < maxPages; i++) {
      const page = await AS.comments({ link_id: linkId, sort: 'asc', limit: 'auto', after: after ? after - 1 : undefined });
      let added = 0;
      page.forEach((c) => { if (!out.has(c.id)) { out.set(c.id, c); added++; } });
      if (!added || page.length < 100) break;
      after = Math.max.apply(null, page.map((c) => c.created));
    }
    return out;
  };

  function toEpoch(t) {
    if (typeof t === 'number') return t > 1e11 ? t / 1000 : t;
    const n = Date.parse(t);
    return isNaN(n) ? NaN : n / 1000;
  }
  AS.timeSeries = async (sub, precision) => {
    const j = await AS.get('/api/time_series', { key: 'r/' + sub + '/posts/count', precision: precision || 'month' }, { ttl: 3600000 });
    let arr = j && j.data !== undefined ? j.data : j;
    if (arr && !Array.isArray(arr) && typeof arr === 'object') arr = Object.keys(arr).map((k) => ({ t: k, v: arr[k] }));
    if (!Array.isArray(arr)) return [];
    return arr.map((it) => {
      if (Array.isArray(it)) return { t: toEpoch(it[0]), v: +it[1] };
      if (it && typeof it === 'object') {
        const tk = ['date', 'time', 'timestamp', 't', 'x', 'created_utc', 'period'].find((k) => k in it);
        const vk = ['value', 'count', 'v', 'y', 'posts', 'n'].find((k) => k in it);
        if (tk && vk) return { t: toEpoch(it[tk]), v: +it[vk] };
      }
      return null;
    }).filter((x) => x && isFinite(x.t) && isFinite(x.v)).sort((a, b) => a.t - b.t);
  };
  AS.userSubreddits = async (author) => {
    const j = await AS.get('/api/users/interactions/subreddits', { author, limit: 30 }, { ttl: 600000 });
    return dataOf(j).map((it) => {
      if (Array.isArray(it)) return { sub: String(it[0]), n: +it[1] };
      const sk = ['subreddit', 'name', 'key'].find((k) => k in it);
      const nk = ['count', 'n', 'value', 'weight', 'score'].find((k) => k in it);
      return sk && nk ? { sub: String(it[sk]), n: +it[nk] } : null;
    }).filter(Boolean);
  };
  AS.subreddits = async (prefix) => dataOf(await AS.get('/api/subreddits/search', { subreddit_prefix: prefix, limit: 12 }, { ttl: 600000 }))
    .map((d) => ({ name: d.display_name || d.subreddit, subscribers: d.subscribers, title: d.title || '' })).filter((d) => d.name);
  AS.subreddit = async (name) => (await AS.subreddits(name)).find((d) => d.name.toLowerCase() === name.toLowerCase()) || null;
  AS.shortLink = async (path) => {
    const j = await AS.get('/api/short_links', { paths: path }, { ttl: 3600000 });
    const m = JSON.stringify(j).match(/\/r\/[^"\\]+\/comments\/[^"\\]+/);
    return m ? m[0] : null;
  };

  const PP = (A.pullpush = { mode: null });
  const PP_PATHS = { topic: '/reddit/search/submission/', comment: '/reddit/search/comment/' };
  PP.get = async (kind, params) => {
    const j = await getJSON(cfg.pullpush + PP_PATHS[kind] + qs(params), { source: 'pullpush', ttl: 120000 });
    if (j && Array.isArray(j.data)) return j.data;
    throw new ApiError('PullPush returned an unexpected response.', { source: 'pullpush', unexpected: true, silent: true });
  };
  PP.posts = async (p) => (await PP.get('topic', p)).map((d) => normArchivePost(d, 'P'));
  PP.comments = async (p) => (await PP.get('comment', p)).map((d) => normComment(d, 'P'));

  PP.page = async (kind, base, cursor) => {
    const p = Object.assign({ size: 50 }, base);
    const st = p.sort_type || 'created_utc';
    const asc = p.sort === 'asc';
    if (cursor) {
      if (st === 'score') p.score = (asc ? '>' : '<') + cursor.value;
      else if (asc) p.after = cursor.value;
      else p.before = cursor.value;
    }
    const raw = kind === 'topic' ? await PP.posts(p) : await PP.comments(p);
    const items = cursor && cursor.exclude.length ? raw.filter((x) => cursor.exclude.indexOf(x.id) < 0) : raw;
    const key = st === 'score' ? 'score' : 'created';
    let next = null;
    if (raw.length) {
      const lastVal = raw[raw.length - 1][key];
      const same = raw.filter((x) => x[key] === lastVal).map((x) => x.id);
      const carried = cursor && cursor.value === lastVal ? cursor.exclude : [];
      next = { value: lastVal, exclude: Array.from(new Set(carried.concat(same))) };
    }
    return { items, cursor: next, done: raw.length < p.size || (cursor && !items.length) };
  };

  A.addVersion = (map, post) => {
    let m = map.get(post.id);
    if (!m) { m = { id: post.id, v: { R: null, A: null, P: null }, has: {} }; map.set(post.id, m); }
    m.v[post.src] = post;
    m.has[post.src] = true;
    refreshPost(m);
    return m;
  };
  function refreshPost(m) {
    const r = m.v.R;
    const arch = [m.v.A, m.v.P].filter(Boolean);
    let show = null;
    m.recovered = null;
    m.removedOnReddit = r && r.removed ? r.removed : null;
    if (r && !r.removed) show = r;
    else if (r && r.removed) {
      const good = arch.filter((x) => !x.removed && (x.selftext || (x.author && x.author !== '[deleted]'))).sort((x, y) => (x.retrieved || 1e12) - (y.retrieved || 1e12));
      if (good.length) { show = good[0]; m.recovered = show.src; } else show = r;
    } else {
      show = arch.slice().sort((x, y) => (+!!x.removed - +!!y.removed) || ((x.retrieved || 1e12) - (y.retrieved || 1e12)))[0] || null;
    }
    if (!show) return;
    const live = r || null;
    const out = Object.assign({}, show);
    if (live) { out.score = live.score; out.numComments = live.numComments; out.title = live.title || show.title; out.locked = live.locked; out.flair = live.flair || show.flair; if (!out.preview) out.preview = live.preview; out.saved = live.saved; out.likes = live.likes; }
    else if (arch.length > 1) { const best = arch.slice().sort((x, y) => y.score - x.score)[0]; out.score = Math.max(out.score, best.score); out.numComments = Math.max(out.numComments, best.numComments); }
    out.showSrc = show.src;
    delete out.src;
    Object.assign(m, out, { v: m.v, has: m.has });
    if (!m.preview) m.preview = '';
  }

  A.checkArchives = async (map, ids, which) => {
    which = which || { A: true, P: true };
    const wantA = which.A ? ids.filter((id) => map.get(id) && map.get(id).has.A === undefined) : [];
    const wantP = which.P ? ids.filter((id) => map.get(id) && map.get(id).has.P === undefined) : [];
    const jobs = [];
    const run = async (want, key, fetchIds) => {
      if (!want.length) return;
      try {
        const found = await fetchIds(want);
        const got = new Set();
        found.forEach((p) => { if (map.has(p.id)) { got.add(p.id); A.addVersion(map, p); } });
        want.forEach((id) => { if (!got.has(id)) map.get(id).has[key] = false; });
      } catch (e) {  }
    };
    jobs.push(run(wantA, 'A', (w) => AS.postsByIds(w)));
    jobs.push(run(wantP, 'P', async (w) => {
      const out = [];
      for (let i = 0; i < w.length; i += 50) out.push.apply(out, await PP.posts({ ids: w.slice(i, i + 50).join(','), size: 100 }));
      return out;
    }));
    await Promise.all(jobs);
  };

  A.checkRemovedLive = async (map, ids) => {
    const live = await R.info(ids.map((id) => 't3_' + id));
    const seen = new Set();
    live.forEach((p) => { seen.add(p.id); A.addVersion(map, p); });
    ids.forEach((id) => { if (!seen.has(id)) map.get(id).has.R = false; });
  };

  function pickArchive(a, p) {
    const list = [a, p].filter(Boolean);
    if (!list.length) return null;
    return list.sort((x, y) => (+isGone(x) - +isGone(y)) || ((x.retrieved || 1e12) - (y.retrieved || 1e12)))[0];
  }
  A.mergeComments = (live, aMap, pMap) => {
    const out = new Map();
    const ids = new Set();
    [live, aMap, pMap].forEach((m) => m && m.forEach((v, k) => ids.add(k)));
    ids.forEach((id) => {
      const l = live && live.get(id), a = aMap && aMap.get(id), p = pMap && pMap.get(id);
      const arch = pickArchive(a, p);
      let c;
      if (l) {
        c = Object.assign({}, l);
        c.reddit = l.reddit || { body: l.body, author: l.author };
        if (isGone(l) && arch && !isGone(arch)) { c.body = arch.body; c.author = arch.author; c.recovered = arch.src; c.captureSec = arch.captureSec; c.goneOnReddit = true; }
      } else {
        c = Object.assign({}, arch);
        c.archiveOnly = true;
        c.recovered = null;
      }
      c.has = { R: !!l, A: !!a, P: !!p };
      out.set(id, c);
    });
    return out;
  };

  const SORTS = {
    best: (x, y) => (+!!y.c.stickied - +!!x.c.stickied) || (y.c.score - x.c.score) || (x.c.created - y.c.created),
    top: (x, y) => (y.c.score - x.c.score) || (x.c.created - y.c.created),
    new: (x, y) => y.c.created - x.c.created,
    old: (x, y) => x.c.created - y.c.created,
    controversial: (x, y) => (y.kids.length - x.kids.length) || (x.c.score - y.c.score)
  };
  A.buildTree = (flat, stubs, sort) => {
    const nodes = new Map();
    flat.forEach((c) => nodes.set(c.id, { c, kids: [] }));
    const roots = [];
    nodes.forEach((n) => {
      const par = n.c.parent || '';
      if (par.indexOf('t1_') === 0) {
        const pn = nodes.get(par.slice(3));
        if (pn) { pn.kids.push(n); return; }
        n.orphan = true;
      }
      roots.push(n);
    });
    (stubs || []).forEach((s) => {
      const ids = s.ids.filter((id) => !nodes.has(id));
      if (s.ids.length && !ids.length) return;
      const node = { stub: Object.assign({}, s, { ids }), kids: [] };
      const pn = s.parent && s.parent.indexOf('t1_') === 0 ? nodes.get(s.parent.slice(3)) : null;
      (pn ? pn.kids : roots).push(node);
    });
    const cmp = SORTS[sort] || SORTS.best;
    const stats = { total: 0, recovered: 0, archiveOnly: 0, depth: 0 };
    (function walk(list, depth) {
      list.sort((x, y) => (+!!x.stub - +!!y.stub) || (x.stub ? 0 : cmp(x, y)));
      list.forEach((n) => {
        n.depth = depth;
        if (n.c) {
          stats.total++;
          if (n.c.recovered) stats.recovered++;
          if (n.c.archiveOnly) stats.archiveOnly++;
          stats.depth = Math.max(stats.depth, depth);
        }
        walk(n.kids, depth + 1);
      });
    })(roots, 0);
    return { roots, stats };
  };

  A.loadThread = (id, o) => {
    o = o || {};
    id = String(id).replace(/^t3_/, '');
    const src = o.src || 'reddit';
    const want = (n) => src === 'all' || src === n || (Array.isArray(src) && src.indexOf(n) >= 0);
    const T = {
      id, posts: new Map(), live: new Map(), aC: new Map(), pC: new Map(), stubs: [], errors: [],
      loading: { R: false, A: false, P: false }, sort: o.sort || 'best',
      get post() { return T.posts.get(id) || null; }
    };
    T.rebuild = (sort) => {
      if (sort) T.sort = sort;
      const flat = A.mergeComments(T.live, T.aC, T.pC);
      const t = A.buildTree(flat, T.stubs, T.sort);
      T.flat = flat; T.tree = t.roots; T.stats = t.stats;
      return T;
    };
    let pending = false;
    const update = () => { if (pending) return; pending = true; Promise.resolve().then(() => { pending = false; T.rebuild(); o.onUpdate && o.onUpdate(T); }); };
    const fail = (key, e) => { T.errors.push({ src: key, message: e && e.message ? e.message : String(e) }); };
    const redditSort = { best: 'confidence', top: 'top', new: 'new', old: 'old', controversial: 'controversial' }[T.sort] || 'confidence';
    const jobs = [];

    if (want('reddit')) {
      T.loading.R = true;
      jobs.push(R.thread(id, { sort: redditSort }).then((r) => {
        A.addVersion(T.posts, r.post);
        T.live = r.flat; T.stubs = r.stubs; T.redditSort = redditSort;
      }).catch((e) => fail('R', e)).then(() => { T.loading.R = false; update(); }));
    }
    if (want('arctic')) {
      T.loading.A = true;
      jobs.push(Promise.all([
        AS.postsByIds([id]).then((ps) => ps.forEach((p) => A.addVersion(T.posts, p))),
        AS.commentsAll(id).then((m) => { T.aC = m; })
      ]).catch((e) => fail('A', e)).then(() => { T.loading.A = false; update(); }));
    }
    if (want('pullpush')) {
      T.loading.P = true;
      jobs.push((async () => {
        const ps = await PP.posts({ ids: id, size: 10 });
        ps.forEach((p) => A.addVersion(T.posts, p));
        update();
        let cursor = null;
        const m = new Map();
        for (let i = 0; i < 3; i++) {
          const pg = await PP.page('comment', { link_id: id, size: 100, sort: 'asc' }, cursor);
          pg.items.forEach((c) => m.set(c.id, c));
          T.pC = new Map(m);
          cursor = pg.cursor;
          if (pg.done || !cursor) break;
        }
      })().catch((e) => fail('P', e)).then(() => { T.loading.P = false; update(); }));
    }
    T.done = Promise.all(jobs).then(() => { T.rebuild(); return T; });
    T.rebuild();
    return T;
  };

  A.loadMore = async (T, stub) => {
    let res;
    if (stub.ids.length) res = await R.moreChildren(T.id, stub.ids, T.redditSort);
    else res = await R.subthread(T.id, stub.parent);
    res.flat.forEach((c, id) => T.live.set(id, c));
    T.stubs = T.stubs.filter((s) => !(s.parent === stub.parent && s.ids.join() === stub.ids.join()));
    res.stubs.forEach((s) => T.stubs.push(s));
    if (res.rest && res.rest.length) T.stubs.push({ ids: res.rest, parent: stub.parent, count: res.rest.length });
    T.rebuild();
    return res.flat.size > 0;
  };

  A.parseLink = (input) => {
    let s = String(input || '').trim();
    if (!s) return null;
    let m;
    if ((m = /^\/?r\/([A-Za-z0-9_+]+)\/?$/i.exec(s))) return { hash: '#/r/' + m[1] };
    if ((m = /^\/?u(?:ser)?\/([A-Za-z0-9_-]+)\/?$/i.exec(s))) return { hash: '#/u/' + m[1] };
    let u;
    try { u = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s.replace(/^\/+/, '')); } catch (e) { return null; }
    const host = u.hostname.replace(/^(www|old|new|np|m|i|sh)\./, '');
    if (host === 'redd.it') { m = /^\/([a-z0-9]+)/i.exec(u.pathname); return m ? { hash: '#/comments/' + m[1] } : null; }
    if (host !== 'reddit.com') return null;
    const path = u.pathname;
    if ((m = /^\/(?:r|u|user)\/[^/]+\/s\/[A-Za-z0-9]+/i.exec(path))) return { short: m[0] };
    if ((m = /^\/r\/[^/]+\/comments\/([a-z0-9]+)(?:\/[^/]*(?:\/([a-z0-9]+))?)?/i.exec(path))) return { hash: '#/comments/' + m[1] + (m[2] ? '?c=' + m[2] : '') };
    if ((m = /^\/comments\/([a-z0-9]+)/i.exec(path))) return { hash: '#/comments/' + m[1] };
    if ((m = /^\/r\/([^/]+)\/(hot|new|top|rising|controversial)\/?$/i.exec(path))) return { hash: '#/r/' + m[1] + '/' + m[2].toLowerCase() };
    if ((m = /^\/r\/([^/]+)/i.exec(path))) return { hash: '#/r/' + m[1] };
    if ((m = /^\/(?:u|user)\/([^/]+)/i.exec(path))) return { hash: '#/u/' + m[1] };
    return null;
  };

  A._internal = { normRedditPost, normArchivePost, normComment, removedKind, refreshPost, walkLive };
})(typeof window !== 'undefined' ? window : globalThis);
