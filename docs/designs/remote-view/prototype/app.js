/* Remote View PROTOTYPE — throwaway. One file, hash router, no framework.
   Round 2 (owner feedback): Project = four tabs mirroring the desktop steps
   Footage (Import) · Clips (Review) · Edit (Timeline) · Export. */
(function () {
  'use strict';
  var app = document.getElementById('app');
  var qs = new URLSearchParams(location.search);
  var DEV_STATE = qs.get('state');   // reconnecting | unreachable | appclosed | off
  var MAC = 'macbook-pro';
  var HOST = location.host;

  var me = null, project = null, exportsList = [], tab = localStorage.rvTab || 'cand';
  var ptab = localStorage.rvPTab || 'clips';
  var selecting = false, selection = {};
  var conn = 'connected', failCount = 0, lastOk = Date.now();
  var sheet = null, toast = null, toastTimer = null;
  var pairStage = 'idle';
  var pollTimer = null, player = null;
  var got = {};        // export id -> {file, url, progress, state}
  var items = [];      // upload items on this phone (in-flight)

  var TABS = [
    ['footage', 'Footage', 'Add your footage'],
    ['clips', 'Clips', 'Pick the best clips'],
    ['edit', 'Edit', 'Accepted clips, in order'],
    ['export', 'Export', 'Save your video to this phone']
  ];

  // ------------------------------------------------------------ helpers --
  function h(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmtSize(b) { var u = ['B', 'KB', 'MB', 'GB'], i = 0; while (b >= 1024 && i < 3) { b /= 1024; i++; } return (i === 0 ? b : b.toFixed(i === 3 ? 2 : 1)) + ' ' + u[i]; }
  function tc(s) { var m = Math.floor(s / 60), r = s - m * 60; return (m < 10 ? '0' : '') + m + ':' + (r < 10 ? '0' : '') + r.toFixed(1); }
  function secs(s) { return (+s).toFixed(1) + ' s'; }
  function clock(t) { var d = new Date(t * 1000); return d.toTimeString().slice(0, 5); }
  function ago(t) { var s = Math.max(0, (Date.now() / 1000) - t); if (s < 60) return 'just now'; if (s < 3600) return Math.round(s / 60) + ' min ago'; if (s < 86400) return Math.round(s / 3600) + ' h ago'; return Math.round(s / 86400) + ' d ago'; }
  function scoreCls(v) { return v >= 8 ? 'hi' : v >= 6 ? 'mid' : 'lo'; }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
  function clipById(id) { return project ? project.clips.filter(function (x) { return x.clip_id === id; })[0] : null; }
  function deviceLabel() {
    var ua = navigator.userAgent, dev = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Macintosh/.test(ua) ? 'Mac' : 'Phone';
    var standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
    var br = standalone ? 'Home Screen app' : /CriOS|Chrome/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : 'browser';
    return dev + ' · ' + br;
  }
  var ICON = {
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
    chev: '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
    mark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="3" width="10" height="18" rx="2.5"/><path d="M11 9.5l4 2.5-4 2.5z" fill="currentColor"/></svg>',
    prev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
    film: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="13" height="12" rx="2.5"/><path d="M16 10.5l5-2.5v8l-5-2.5"/></svg>',
    // tab bar
    tFootage: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3 9h18M3 15h18M8 5v14M16 5v14"/></svg>',
    tClips: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="7" height="7" rx="1.8"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.8"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.8"/><path d="M15 17h5M17.5 14.5v5"/></svg>',
    tEdit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="6" height="8" rx="1.5"/><rect x="10.5" y="8" width="4" height="8" rx="1.5"/><rect x="16" y="8" width="5" height="8" rx="1.5"/><path d="M3 4.5h18M3 19.5h18"/></svg>',
    tExport: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="3" width="12" height="18" rx="2.5"/><path d="M12 8v7M9 12l3 3 3-3"/></svg>'
  };

  // ---------------------------------------------------------------- api --
  function api(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || 'GET', cache: 'no-store', headers: {} };
    if (opts.body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
    return fetch(path, init).then(function (r) {
      if (r.status === 401) { onUnpaired(); throw new Error('unpaired'); }
      if (r.status === 502) { setConn('appclosed'); throw new Error('502'); }
      if (r.status === 503) { setConn('off'); throw new Error('503'); }
      if (!r.ok) return r.json().catch(function () { return {}; }).then(function (j) { throw new Error(j.error || ('server ' + r.status)); });
      failCount = 0; lastOk = Date.now(); setConn('connected');
      return r.json();
    }, function (e) {
      failCount++; setConn(failCount >= 3 ? 'unreachable' : 'reconnecting'); throw e;
    });
  }
  function setConn(c) { if (DEV_STATE) c = DEV_STATE; if (c !== conn) { conn = c; paintPill(); if (route().name !== 'clip') render(); } }
  function onUnpaired() {
    var was = me && me.paired;
    me = { paired: false }; stopPolling();
    sessionStorage.rvReason = was ? 'removed' : (sessionStorage.rvReason || '');
    location.hash = '#/pair';
  }

  // ------------------------------------------------------------- router --
  function route() {
    var parts = location.hash.replace(/^#\/?/, '').split('/');
    return { name: parts[0] || '', a: parts[1], b: parts[2] };
  }
  function go(hash) { location.hash = hash; }
  window.addEventListener('hashchange', function () { sheet = null; render(); });

  function boot() {
    api('/api/me').then(function (m) {
      me = m;
      if (!m.paired) { if (!route().name) go('#/pair'); else if (route().name !== 'pair') go('#/pair'); }
      else if (!route().name || route().name === 'pair') go('#/projects');
      render();
    }, function () { me = { paired: false }; render(); });
  }

  // ------------------------------------------------------------ polling --
  function startPolling() {
    if (pollTimer) return;
    var tick = function () {
      if (document.visibilityState !== 'visible' || !me || !me.paired) return;
      var r = route();
      if (r.name === 'project' && ptab === 'export') loadExports(true);
      if (r.name === 'project' || r.name === 'clip' || r.name === 'projects') loadProject(true);
    };
    pollTimer = setInterval(tick, 2500);
  }
  function stopPolling() { clearInterval(pollTimer); pollTimer = null; }
  function loadProject(quiet) {
    return api('/api/project').then(function (p) {
      var prev = project; project = p;
      var r = route().name;
      if (r === 'clip') { patchClip(prev); return p; }
      if (!quiet || !sameProjectSnapshot(prev, p)) render();
      return p;
    }).catch(function () { if (!quiet) render(); });
  }
  function sameProjectSnapshot(a, b) {
    if (a == null || b == null) return a === b;
    var aSnapshot = Object.assign({}, a), bSnapshot = Object.assign({}, b);
    delete aSnapshot.server_time;
    delete bSnapshot.server_time;
    return JSON.stringify(aSnapshot) === JSON.stringify(bSnapshot);
  }
  function loadExports(quiet) {
    return api('/api/exports').then(function (j) {
      var prev = JSON.stringify(exportsList); exportsList = j.exports;
      if (!quiet || prev !== JSON.stringify(exportsList)) render();
    }).catch(function () { if (!quiet) render(); });
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && me && me.paired) { loadProject(true); if (ptab === 'export') loadExports(true); } });
  window.addEventListener('online', function () { if (me && me.paired) loadProject(true); });

  // ------------------------------------------------------------- render --
  function render() {
    var r = route();
    if (!me) { app.innerHTML = '<div class="body"><p class="hint">Connecting…</p></div>'; return; }
    if (!me.paired) { app.innerHTML = viewPair(); return; }
    startPolling();
    var html;
    switch (r.name) {
      case 'projects': html = viewProjects(); break;
      case 'project': html = viewProject(r.a); break;
      case 'clip': html = viewClip(r.a, r.b); break;
      case 'footage': go('#/project/footage'); return;    // legacy routes
      case 'exports': go('#/project/export'); return;
      default: html = viewProjects();
    }
    app.innerHTML = html + (sheet ? viewSheet() : '') + (toast ? viewToast() : '') + devBar();
    afterRender(r);
  }
  function devBar() {
    if (!DEV_STATE) return '';
    return '<div class="devbar">dev state: ' + h(DEV_STATE) + '<a href="' + location.pathname + location.hash + '">clear</a></div>';
  }
  function topbar(title, backHash, endHtml) {
    return '<header class="topbar">' +
      (backHash ? '<a class="back" href="' + backHash + '" aria-label="Back">' + ICON.back + '<span>Back</span></a>' : '<span class="spacer"></span>') +
      '<h1>' + h(title) + '</h1><div class="end">' + (endHtml === undefined ? pillHtml() : endHtml) + '</div></header>';
  }
  // Short pill: a dot alone when all is well; a word when it isn't. The full story is in the connection sheet.
  var PILL = {
    connected: ['', '', 'Connected to ' + MAC], reconnecting: ['warn', 'Reconnecting…', 'Reconnecting to ' + MAC],
    unreachable: ['off', 'Offline', "Can't reach " + MAC], appclosed: ['off', 'App closed', "App isn't open on the Mac"], off: ['off', 'Off', 'Remote View is off']
  };
  function pillHtml() {
    var p = PILL[conn] || PILL.connected;
    return '<button class="pill ' + p[0] + (p[1] ? '' : ' dotonly') + '" data-act="connection" aria-label="Connection: ' + h(p[2]) + '"><i class="dot"></i>' + (p[1] ? '<span>' + h(p[1]) + '</span>' : '') + '</button>';
  }
  function paintPill() { var el = app.querySelector('.topbar .end'); if (el && el.querySelector('.pill')) el.innerHTML = pillHtml(); }
  function connCard() {
    if (conn === 'connected') return '';
    var age = Math.round((Date.now() - lastOk) / 1000);
    if (conn === 'reconnecting') return '<div class="banner warn"><b>Reconnecting…</b><span>Showing what the Mac had as of ' + (DEV_STATE ? 12 : age) + ' s ago. Accept and Reject still work and sync when the link is back.</span></div>';
    if (conn === 'unreachable') return '<div class="banner err"><b>Can\'t reach ' + MAC + '</b><span>Is the Mac awake, Tailscale on, and Remote View on?</span><button class="btn sm" data-act="retry-conn">Tap to retry</button></div>';
    if (conn === 'appclosed') return '<div class="banner err"><b>App isn\'t open on the Mac</b><span>Open AI Clip Assembler on ' + MAC + '.</span><button class="btn sm" data-act="retry-conn">Retry</button></div>';
    if (conn === 'off') return '<div class="banner"><b>Remote View is off</b><span>Turned off on the Mac. This phone stays approved and reconnects when it\'s back on.</span></div>';
    return '';
  }

  // --- 1. Pair
  function viewPair() {
    var reason = sessionStorage.rvReason, banner = '';
    var copy = { disconnected: 'You disconnected this phone.', removed: 'This phone was removed from ' + MAC + '.', expired: 'It\'s been a while — scan a new code on your Mac.' }[reason];
    if (copy) banner = '<div class="banner">' + h(copy) + '</div>';
    var body;
    if (pairStage === 'approving') {
      body = '<div class="hero"><div class="mark">' + ICON.mark + '</div><h1>Approve on your Mac</h1><p>' + MAC + ' is asking you to approve this phone. Settings → Remote View → Approve.</p></div>' +
        '<div class="card"><dl class="kv" style="padding:14px 16px"><dt>The Mac sees</dt><dd>' + h(deviceLabel()) + ' · elvijs@…</dd><dt>Waiting</dt><dd>approval on ' + MAC + '…</dd></dl></div>' +
        '<div class="pairfoot"><button class="btn" data-act="pair-cancel">Cancel</button>';
    } else {
      body = banner + '<div class="hero"><div class="mark">' + ICON.mark + '</div><h1>Pair with your Mac</h1><p>This phone will see the Projects you share from AI Clip Assembler on ' + MAC + '.</p></div>' +
        '<div class="pairfoot"><button class="btn primary" data-act="pair">Pair</button>';
    }
    return topbar('Remote View', null, '') + '<div class="body">' + body +
      '<div class="lock">' + ICON.lock + '<span>' + h(HOST) + ' · your tailnet only, never public</span></div></div></div>';
  }

  // --- 2. Projects
  function viewProjects() {
    var a2hs = localStorage.rvA2HS === '1' && !(navigator.standalone) ? '<div class="banner"><b>Add to Home Screen</b><span>Share → Add to Home Screen. The installed app pairs once more.</span><button class="btn sm" data-act="dismiss-a2hs">Got it</button></div>' : '';
    var rows = project ? '<a class="row" href="#/project/' + ptab + '"><div><div class="title">' + h(project.name) + '</div><div class="sub">' + plural(project.sources.length, 'Source Video') + ' · ' + plural(clipsFor('acc').length, 'clip') + ' kept</div></div><div class="right">' + ICON.chev + '</div></a>' :
      '<div class="row"><div><div class="title">Loading…</div></div></div>';
    return topbar('Projects') + '<div class="body">' + connCard() + a2hs + '<div class="label">Shown on this phone</div><div class="card">' + rows + '</div>' +
      '<p class="hint">Other Projects aren\'t shown on this phone. On the Mac: Settings → Remote View → Show on phone.</p></div>';
  }

  // --- 3. Project: four tabs
  function clipsFor(t) {
    if (!project) return [];
    return project.clips.filter(function (c) { return t === 'all' || (t === 'acc' ? c.decision === 'accepted' : !c.decision); });
  }
  function editItems() {   // Accepted Clips in Timeline order; accepted-but-unplaced go last by rank
    if (!project) return [];
    var order = project.timeline_order || [];
    return clipsFor('acc').slice().sort(function (a, b) {
      var ia = order.indexOf(a.clip_id), ib = order.indexOf(b.clip_id);
      if (ia < 0) ia = 1e6 + a.rank; if (ib < 0) ib = 1e6 + b.rank;
      return ia - ib;
    });
  }
  function editTotal(list) { return list.reduce(function (s, c) { return s + c.duration_sec; }, 0); }

  function pageHead(key) {
    var t = TABS.filter(function (x) { return x[0] === key; })[0];
    return '<div class="pagehead"><h2>' + t[1] + '</h2><span>' + t[2] + '</span></div>';
  }
  function tabbar(cur) {
    var counts = { footage: project.sources.length, clips: clipsFor('cand').length, edit: editItems().length, export: project.exports_active || 0 };
    var icons = { footage: ICON.tFootage, clips: ICON.tClips, edit: ICON.tEdit, export: ICON.tExport };
    return '<nav class="tabbar" aria-label="Project steps">' + TABS.map(function (t, i) {
      var n = counts[t[0]];
      return '<a href="#/project/' + t[0] + '"' + (cur === t[0] ? ' aria-current="page"' : '') + ' aria-label="' + (i + 1) + '. ' + t[1] + (n ? ' · ' + n : '') + '">' +
        icons[t[0]] + (n ? '<i class="n' + (t[0] === 'export' ? ' live' : '') + '">' + n + '</i>' : '') + '<span>' + t[1] + '</span></a>';
    }).join('') + '</nav>';
  }
  function viewProject(t) {
    if (!project) { loadProject(); return topbar('Project', '#/projects') + '<div class="body"><p class="hint">Loading…</p></div>'; }
    if (!TABS.some(function (x) { return x[0] === t; })) { go('#/project/' + ptab); return ''; }
    if (t !== ptab) { selecting = false; selection = {}; }
    ptab = t; localStorage.rvPTab = t;
    var body = { footage: tabFootage, clips: tabClips, edit: tabEdit, export: tabExport }[t]();
    var bar = selecting ? '<div class="bottombar above-tabs"><button class="btn primary" data-act="export-sel"' + (Object.keys(selection).length ? '' : ' disabled') + '>Export to phone' + (Object.keys(selection).length ? ' (' + Object.keys(selection).length + ')' : '') + '</button></div>' : '';
    return topbar(project.name, '#/projects') + '<div class="body has-tabs' + (selecting ? ' has-bar' : '') + '">' + connCard() + body + '</div>' + bar + tabbar(t);
  }

  // Tab 1 · Footage (desktop: Import)
  function tabFootage() {
    var byId = {}; items.forEach(function (i) { byId[i.id] = i; });
    var rows = items.map(fileRow);
    project.uploads.forEach(function (u) { if (!byId[u.id]) rows.push(fileRow({ id: u.id, name: u.name, size: u.size, sent: u.received || 0, server: u, state: 'server' })); });
    var sources = project.sources.map(function (s) {
      return '<div class="row"><div><div class="title">' + h(s.name) + '</div><div class="sub">' + s.width + '×' + s.height + ' · ' + tc(s.duration).replace(/\.\d$/, '') + ' · ' + fmtSize(s.size) + '</div></div><div class="right"><span class="mono">imported</span></div></div>';
    }).join('');
    return pageHead('footage') +
      '<label class="picker"><input id="pick" type="file" multiple accept="video/*,.mp4,.mov,.m4v" aria-label="Choose videos">' + ICON.film + '<b>Add footage</b><small>Photos or Files · sends right away</small></label>' +
      (rows.length ? '<div class="label">Sending to the Mac</div><div class="card">' + rows.join('') + '</div><p class="hint">Keep this screen open while sending. If the phone locks, sending pauses and picks up where it stopped.</p>' : '') +
      '<div class="card"><div class="toggle-row"><div><div class="title" style="font-weight:600">Analyze after upload</div><div class="sub muted">starts on the Mac</div></div><span class="toggle" aria-disabled="true"></span></div></div>' +
      '<div class="label">Source Videos · ' + project.sources.length + '</div><div class="card">' + (sources || '<div class="empty">No footage yet. Add some above.</div>') + '</div>';
  }

  // Tab 2 · Clips (desktop: Review)
  function cellHtml(c, listKey) {
    var selected = !!selection[c.clip_id];
    var badge = c.decision === 'accepted' ? '<span class="acc" aria-hidden="true">' + ICON.check + '</span>' : c.decision === 'rejected' ? '<span class="rej">rejected</span>' : '';
    var sel = selecting ? '<span class="sel' + (selected ? ' on' : '') + '">' + (selected ? ICON.check : '') + '</span>' : '';
    var label = 'Clip ' + c.rank + ', ' + c.duration_sec.toFixed(1) + ' seconds, score ' + c.overall_score.toFixed(1) + (c.decision ? ', ' + c.decision : '');
    return '<button class="cell' + (selected ? ' selected' : '') + (c.decision === 'rejected' ? ' rejected' : '') + (c.width > c.height ? ' wide' : '') + '" style="aspect-ratio:' + c.width + '/' + c.height + '" data-act="' + (selecting ? 'toggle-sel' : 'open-clip') + '" data-id="' + c.clip_id + '" data-list="' + listKey + '" aria-label="' + h(label) + '">' +
      '<img src="/thumb/' + c.clip_id + '.jpg" alt="" loading="lazy" width="' + c.width + '" height="' + c.height + '">' + badge + sel +
      '<span class="dur">' + c.duration_sec.toFixed(1) + ' s</span><span class="score ' + scoreCls(c.overall_score) + '">' + c.overall_score.toFixed(1) + '</span></button>';
  }
  function nowLine() {
    var now = project.now;
    if (now.state === 'rendering') return '<a class="now" href="#/project/export"><div class="line"><span class="title">' + h(now.title) + '</span><span class="pct">' + Math.round(now.progress * 100) + '%</span></div><div class="progress thin"><i style="width:' + Math.round(now.progress * 100) + '%"></i></div><div class="sub">' + h(now.sub) + '</div></a>';
    return '<div class="now compact"><div class="line"><span class="sub">Mac idle · ' + plural(project.sources.length, 'source') + ' · ' + plural(project.clips.length, 'clip') + ' · analyzed ' + ago(Date.parse(now.analyzed_at) / 1000) + '</span><span class="mono nowrap">' + h(project.harness) + '</span></div></div>';
  }
  function tabClips() {
    var list = clipsFor(tab);
    var grid = list.length ? '<div class="grid">' + list.map(function (c) { return cellHtml(c, tab); }).join('') + '</div>' :
      '<div class="empty">' + (tab === 'acc' ? 'No Accepted Clips yet. Open a clip and tap Accept.' : tab === 'cand' ? 'Every Candidate Clip has a decision. See Accepted or All.' : 'No clips yet. Analyze on the Mac.') + '</div>';
    var seg = ['cand', 'acc', 'all'].map(function (k, i) {
      var n = clipsFor(k).length; return '<button role="tab" aria-selected="' + (tab === k) + '" data-act="tab" data-tab="' + k + '">' + ['Candidates', 'Accepted', 'All'][i] + ' · ' + n + '</button>';
    }).join('');
    return '<div class="pagehead"><h2>Clips</h2><span>Pick the best clips</span><button class="link" data-act="select">' + (selecting ? 'Done' : 'Select') + '</button></div>' +
      '<div class="card">' + nowLine() + '</div>' +
      '<div class="seg" role="tablist">' + seg + '</div>' + grid +
      (selecting ? '<p class="hint">Pick clips to render each as its own file. To render the whole Edit, use Export.</p>' : '');
  }

  // Tab 3 · Edit (desktop: Timeline)
  function tabEdit() {
    var list = editItems();
    if (!list.length) return pageHead('edit') + '<div class="empty">Nothing in the Edit yet.<br>Accept clips in Clips and they land here in Timeline order.</div><a class="btn" href="#/project/clips">Go to Clips</a>';
    var first = list[0], allReady = list.every(function (c) { return c.proxy_status === 'ready'; });
    var preview = '<div class="player" style="--ar:' + first.width + '/' + first.height + ';--arn:' + (first.width / first.height).toFixed(4) + '">' +
      '<img class="poster" src="/thumb/' + first.clip_id + '.jpg" alt="">' +
      (allReady ? '<video id="ev" playsinline preload="metadata" poster="/thumb/' + first.clip_id + '.jpg" src="' + first.proxy + '#t=' + first.start_sec + '"></video><button class="play" id="eplay" aria-label="Play the Edit"></button>' : '<div class="prep">Preparing preview…</div>') +
      '<span class="tag q">preview</span><span class="tag rank" id="etag">1 of ' + list.length + ' · Clip ' + first.rank + '</span><span class="tag tc" id="etc">' + tc(0) + '</span></div>';
    var rows = list.map(function (c, i) {
      return '<button class="row item" data-act="open-clip" data-id="' + c.clip_id + '" data-list="acc"><span class="idx">' + (i + 1) + '</span><img class="th" src="/thumb/' + c.clip_id + '.jpg" alt=""><div><div class="title">Clip ' + c.rank + ' <span class="score-in ' + scoreCls(c.overall_score) + '">' + c.overall_score.toFixed(1) + '</span></div><div class="sub">' + h(c.file_name) + '</div></div><div class="right"><span class="mono">' + secs(c.duration_sec) + '</span>' + ICON.chev + '</div></button>';
    }).join('');
    return pageHead('edit') + preview +
      '<div class="sechead"><span class="label">The Edit · ' + plural(list.length, 'clip') + ' · ' + secs(editTotal(list)) + '</span></div>' +
      '<div class="card">' + rows + '</div>' +
      '<p class="hint">Order follows the Timeline on the Mac. Reorder and trim there.</p>' +
      '<a class="btn primary" href="#/project/export">Export the Edit to this phone</a>';
  }

  // Tab 4 · Export (desktop: Export) — the Edit, options, then Phone Exports history
  var exportOpts = { frame: 'original', audio: 'source', ids: [] };
  var exportsLoaded = false;
  function tabExport() {
    if (!exportsLoaded) { exportsLoaded = true; loadExports(); }
    var list = editItems(), total = editTotal(list), est = total * 1.2;   // measured: 9.5 MB for 8 s of 1080x1920 @ 59.94, crf 20
    var srcs = {}; list.forEach(function (c) { srcs[c.file_name] = 1; });
    var hasAudio = list.some(function (c) { return c.has_audio; });
    var edit = list.length ?
      '<div class="card"><div class="editcard">' + stackThumbs(list.map(function (c) { return c.clip_id; })) +
        '<div><div class="title">The Edit</div><div class="sub">' + plural(list.length, 'clip') + ' · ' + secs(total) + ' · from ' + plural(Object.keys(srcs).length, 'Source Video') + '</div>' +
        '<a class="link-sm" href="#/project/edit">See the clips</a></div></div>' +
        optRow('Frame', [['original', 'Original', frameNote(list[0])], ['vertical', 'Vertical 9:16', 'centre crop']], exportOpts.frame, 'frame') +
        (hasAudio ? optRow('Audio', [['source', 'Source audio', ''], ['muted', 'Muted', '']], exportOpts.audio, 'audio') : '') +
        '<div class="editfoot"><button class="btn primary" data-act="render-edit">Render on Mac · ~' + Math.max(1, Math.round(est)) + ' MB</button><span class="mono">1080p · H.264 + AAC · one MP4</span></div></div>' :
      '<div class="empty">Nothing to export yet.<br>Accept clips in Clips, then come back here to render the Edit.</div><a class="btn" href="#/project/clips">Go to Clips</a>';
    var rows = exportsList.map(exportRow).join('');
    return pageHead('export') + edit +
      '<div class="sechead"><span class="label">Phone Exports · ' + exportsList.length + '</span></div>' +
      (rows ? '<div class="card">' + rows + '</div>' : '<div class="empty">No Phone Exports yet. Rendered MP4s show up here.</div>') +
      '<p class="hint">Get video → Save Video from the share sheet. Then in Instagram: New reel → pick from Photos.</p>' +
      '<p class="hint">Phone Exports stay on the Mac until you remove them.</p>';
  }
  function frameNote(c) { return c.width > c.height ? '16:9 landscape' : '9:16 portrait'; }
  function stackThumbs(ids) {
    var two = ids.slice(0, 2);
    return '<span class="th' + (two.length > 1 ? ' stack' : '') + '">' + two.map(function (id, i) { return '<img src="/thumb/' + id + '.jpg" alt=""' + (i ? ' class="under"' : '') + '>'; }).reverse().join('') + '</span>';
  }
  function optRow(label, choices, cur, key) {
    return '<div class="opt"><span class="label">' + label + '</span><div class="choice" role="radiogroup">' + choices.map(function (c) {
      return '<button role="radio" aria-checked="' + (cur === c[0]) + '" data-act="opt" data-key="' + key + '" data-val="' + c[0] + '">' + c[1] + (c[2] ? '<small>' + h(c[2]) + '</small>' : '') + '</button>';
    }).join('') + '</div></div>';
  }
  // Phone Export row: name from fields (never the project folder), plain-words status, stacked thumbs for the Edit.
  function exportTitle(e) {
    var n = e.clip_ids.length, frame = e.frame === 'vertical' ? ' · 9:16' : '';
    if (e.kind === 'edit') return 'The Edit · ' + plural(n, 'clip') + ' · ' + secs(e.total_sec) + frame;
    var c = clipById(e.clip_ids[0]);
    return 'Clip ' + (c ? c.rank : '?') + ' · ' + secs(e.total_sec) + frame;
  }
  function exportSource(e) {
    var names = {}; e.clip_ids.forEach(function (id) { var c = clipById(id); if (c) names[c.file_name] = 1; });
    var k = Object.keys(names);
    return (k.length === 1 ? k[0] : 'from ' + plural(k.length, 'Source Video')) + (e.frame === 'vertical' ? ' · centre crop' : ' · original frame');
  }
  function exportRow(e) {
    var g = got[e.id] || {}, sub, act = '', bar = '', pct = Math.round((e.progress || 0) * 100);
    switch (e.state) {
      case 'queued': sub = 'Waiting to render on Mac'; act = btn('Cancel', 'cancel-export', e.id); break;
      case 'rendering': sub = '<b>Rendering on Mac</b> · ' + pct + '%'; bar = '<div class="progress"><i style="width:' + pct + '%"></i></div>'; act = btn('Cancel', 'cancel-export', e.id); break;
      case 'checking': sub = 'Checking the file on Mac'; bar = '<div class="progress ok"><i style="width:100%"></i></div>'; break;
      case 'failed': sub = '<span class="err">Couldn\'t render on Mac: ' + h(e.error || 'unknown') + '</span>'; act = btn('Try again', 'retry-export', e.id) + btn('Remove', 'remove-export', e.id); break;
      case 'cancelled': sub = 'Cancelled'; act = btn('Try again', 'retry-export', e.id) + btn('Remove', 'remove-export', e.id); break;
      case 'ready':
        var big = e.size > 100 * 1024 * 1024;
        if (g.state === 'getting') { sub = '<b>Downloading to phone</b> · ' + Math.round(g.progress * 100) + '%'; bar = '<div class="progress"><i style="width:' + Math.round(g.progress * 100) + '%"></i></div>'; }
        else if (g.state === 'got') { sub = '<span class="ok">On this phone</span> · ' + fmtSize(e.size); act = (g.canShare ? btn('Share video', 'share', e.id, 'primary') : '') + '<a class="btn xs" href="' + g.url + '" download="' + h(e.file) + '">Download</a>'; }
        else if (g.state === 'shared') { sub = '<span class="ok">Shared · ' + ago(g.at) + '</span>'; act = btn('Share again', 'share', e.id) + btn('Remove from Mac', 'remove-export', e.id); }
        else if (g.state === 'downloaded') { sub = '<span class="ok">Saved to Files</span> <span class="mono">In Files, tap the video → Share → Save Video.</span>'; act = btn('Remove from Mac', 'remove-export', e.id); }
        else if (g.state === 'error') { sub = '<span class="err">' + h(g.error) + '</span>'; act = btn('Try again', 'get', e.id, 'primary'); }
        else {
          sub = '<span class="ok">Ready on Mac</span> · ' + fmtSize(e.size) + ' · ' + e.width + '×' + e.height + (big ? '<br><span class="err">Too large to share directly — Download, then share from Files.</span>' : '');
          act = (big ? '' : btn('Get video', 'get', e.id, 'primary')) + '<a class="btn xs" href="/export/' + e.id + '.mp4?download=1" download="' + h(e.file) + '" data-act="dl-mark" data-id="' + e.id + '">Download</a>' + btn('Remove from Mac', 'remove-export', e.id);
        }
        break;
    }
    return '<div class="render">' + stackThumbs(e.kind === 'edit' ? e.clip_ids : [e.thumb]) + '<div><div class="name">' + h(exportTitle(e)) + '</div><div class="src">' + h(exportSource(e)) + ' · ' + ago(e.created_at) + '</div><div class="sub">' + sub + '</div>' + bar + (act ? '<div class="act">' + act + '</div>' : '') + '</div></div>';
  }
  function btn(label, act, id, cls) { return '<button class="btn xs ' + (cls || '') + '" data-act="' + act + '" data-id="' + id + '">' + label + '</button>'; }

  // --- 4. Clip player
  function viewClip(id, listKey) {
    if (!project) { loadProject(); return topbar('Clip', '#/project/clips') + '<div class="body"><p class="hint">Loading…</p></div>'; }
    var c = clipById(id);
    if (!c) return topbar('Clip', '#/project/clips') + '<div class="body"><div class="empty">Changed on the Mac — this clip is gone.</div></div>';
    listKey = listKey || 'all';
    var list = clipsFor(listKey), idx = list.indexOf(c);
    var ready = c.proxy_status === 'ready', failed = /^failed/.test(c.proxy_status);
    var media = '<img class="poster" src="/thumb/' + c.clip_id + '.jpg" alt="">' +
      (ready ? '<video id="v" playsinline preload="metadata" poster="/thumb/' + c.clip_id + '.jpg" src="' + c.proxy + '#t=' + c.start_sec + '"></video><button class="play" id="play" aria-label="Play"></button>' :
        failed ? '<div class="prep"><div>Couldn\'t prepare a preview: ' + h(c.proxy_status.replace(/^failed:\s*/, '')) + '<br><br><button class="btn sm" data-act="reload">Try again</button></div></div>' :
          '<div class="prep">Preparing preview…</div>');
    var chips = [['Smooth', c.smoothness_score], ['Sharp', c.sharpness_score], ['Exposure', c.exposure_score]].concat(c.visual_interest_score != null ? [['Interest', c.visual_interest_score]] : []).map(function (p) {
      return '<span class="chip ' + scoreCls(p[1]) + '">' + p[0] + ' ' + p[1].toFixed(1) + '</span>';
    }).join('') + (c.look_group != null ? '<span class="chip">Look ' + c.look_group + '</span>' : '');
    // The decision row shows the stored decision: the chosen button fills in and reads "Accepted ✓"; tapping it again undoes.
    var acc = c.decision === 'accepted', rej = c.decision === 'rejected';
    var decide = '<div class="decide">' +
      '<button class="btn reject' + (rej ? ' on' : '') + '" data-act="' + (rej ? 'undo-decision' : 'decide') + '" data-id="' + c.clip_id + '" data-d="rejected" data-list="' + listKey + '" aria-pressed="' + rej + '">' + (rej ? 'Rejected ✓' : 'Reject') + '</button>' +
      '<button class="btn accept' + (acc ? ' on' : '') + '" data-act="' + (acc ? 'undo-decision' : 'decide') + '" data-id="' + c.clip_id + '" data-d="accepted" data-list="' + listKey + '" aria-pressed="' + acc + '">' + (acc ? 'Accepted ✓' : 'Accept') + '</button></div>' +
      (c.decision ? '<p class="hint">Tap again to undo.' + (acc ? ' Accepted clips go into the Edit.' : '') + '</p>' : '');
    return topbar('Clip ' + c.rank + ' of ' + project.clips.length, '#/project/clips') + '<div class="body">' +
      '<div class="player" style="--ar:' + c.width + '/' + c.height + ';--arn:' + (c.width / c.height).toFixed(4) + '">' + media +
      '<span class="tag q">' + (ready ? '720p preview' : 'poster') + '</span><span class="tag rank">#' + c.rank + ' · ' + c.overall_score.toFixed(1) + '</span><span class="tag tc" id="tc">' + tc(c.start_sec) + '</span>' +
      (idx > 0 ? '<a class="nav prev" href="#/clip/' + list[idx - 1].clip_id + '/' + listKey + '" aria-label="Previous clip">' + ICON.prev + '</a>' : '') +
      (idx >= 0 && idx < list.length - 1 ? '<a class="nav next" href="#/clip/' + list[idx + 1].clip_id + '/' + listKey + '" aria-label="Next clip">' + ICON.next + '</a>' : '') + '</div>' +
      '<input class="scrub" id="scrub" type="range" min="' + c.start_sec + '" max="' + c.end_sec + '" step="0.05" value="' + c.start_sec + '" aria-label="Scrub"' + (ready ? '' : ' disabled') + '>' +
      '<div class="timeline"><span>' + tc(c.start_sec) + ' → ' + tc(c.end_sec) + ' · ' + secs(c.duration_sec) + '</span><span>' + h(c.file_name) + '</span></div>' +
      '<div class="chips">' + chips + '</div><p class="reason">' + h(c.ai_reason) + '</p>' + decide +
      '<button class="btn" data-act="export-one" data-id="' + c.clip_id + '">Export this clip to phone</button></div>';
  }
  function patchClip(prev) {
    var r = route(), c = clipById(r.a);
    var old = prev && prev.clips.filter(function (x) { return x.clip_id === r.a; })[0];
    if (c && old && c.proxy_status !== old.proxy_status) render();
  }
  function bindPlayer(c) {
    var v = document.getElementById('v'), play = document.getElementById('play'), scrub = document.getElementById('scrub'), tcEl = document.getElementById('tc');
    if (!v) return;
    player = v;
    var start = c.start_sec, end = c.end_sec;
    function paint() { var t = v.currentTime; scrub.value = t; scrub.style.setProperty('--p', ((t - start) / (end - start) * 100) + '%'); tcEl.textContent = tc(t); }
    v.addEventListener('loadedmetadata', function () { if (Math.abs(v.currentTime - start) > 0.2) v.currentTime = start; paint(); });
    v.addEventListener('timeupdate', function () { if (v.currentTime >= end - 0.04 || v.currentTime < start - 0.5) v.currentTime = start; paint(); });
    v.addEventListener('play', function () { play.hidden = true; });
    v.addEventListener('pause', function () { play.hidden = false; });
    play.addEventListener('click', function () { v.play().catch(function () {}); });
    v.addEventListener('click', function () { if (v.paused) v.play().catch(function () {}); else v.pause(); });
    scrub.addEventListener('input', function () { v.currentTime = parseFloat(scrub.value); paint(); });
  }
  // Edit preview: one <video>, plays the Accepted Clips back to back in Timeline order.
  function bindEditPlayer(list) {
    var v = document.getElementById('ev'), play = document.getElementById('eplay'), tag = document.getElementById('etag'), tcEl = document.getElementById('etc');
    if (!v) return;
    var i = 0, elapsed = 0;
    function load(k, autoplay) {
      i = k; var c = list[k];
      elapsed = list.slice(0, k).reduce(function (s, x) { return s + x.duration_sec; }, 0);
      tag.textContent = (k + 1) + ' of ' + list.length + ' · Clip ' + c.rank;
      v.src = c.proxy + '#t=' + c.start_sec;
      v.addEventListener('loadedmetadata', function once() { v.removeEventListener('loadedmetadata', once); v.currentTime = c.start_sec; if (autoplay) v.play().catch(function () {}); });
    }
    v.addEventListener('timeupdate', function () {
      var c = list[i]; tcEl.textContent = tc(elapsed + Math.max(0, v.currentTime - c.start_sec));
      if (v.currentTime >= c.end_sec - 0.04) { if (i < list.length - 1) load(i + 1, true); else { v.pause(); load(0, false); } }
    });
    v.addEventListener('play', function () { play.hidden = true; });
    v.addEventListener('pause', function () { play.hidden = false; });
    play.addEventListener('click', function () { v.play().catch(function () {}); });
    v.addEventListener('click', function () { if (v.paused) v.play().catch(function () {}); else v.pause(); });
  }

  // --- 5. Export sheet (each selected clip as its own file)
  function viewSheet() {
    var body;
    if (sheet.type === 'connection') {
      var d = me.device || {};
      var standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
      body = '<h2>Connected to ' + MAC + '</h2><div class="sub">as ' + h(d.label || deviceLabel()) + ' · since ' + (d.since ? clock(d.since) : '—') + '</div>' +
        '<dl class="kv"><dt>Path</dt><dd>Direct (Wi-Fi)</dd><dt>Mac</dt><dd>App open · Remote View on · ' + (me.connected_devices || 1) + ' device connected</dd><dt>Link</dt><dd>Your tailnet only, never public · signed in as ' + h(me.login) + '</dd><dt>This phone</dt><dd>' + h(d.label || deviceLabel()) + ' <span class="mono">(as the Mac shows it)</span></dd></dl>' +
        (standalone ? '' : '<button class="btn" data-act="a2hs">Add to Home Screen</button>') +
        '<button class="btn danger" data-act="disconnect">Disconnect this phone</button>';
    } else {
      var clips = exportOpts.ids.map(clipById).filter(Boolean);
      var dur = editTotal(clips), est = dur * 1.2, n = clips.length;
      var hasAudio = clips.some(function (c) { return c.has_audio; });
      body = '<h2>Export to phone</h2><div class="sub">' + plural(n, 'clip') + ' · ' + secs(dur) + ' · each as its own MP4 · rendered on the Mac at 1080p</div>' +
        optRow('Frame', [['original', 'Original', frameNote(clips[0])], ['vertical', 'Vertical 9:16', 'centre crop']], exportOpts.frame, 'frame') +
        (hasAudio ? optRow('Audio', [['source', 'Source audio', ''], ['muted', 'Muted', '']], exportOpts.audio, 'audio') : '') +
        '<button class="btn primary" data-act="render">Render on Mac · ' + plural(n, 'file') + ' · ~' + Math.max(1, Math.round(est)) + ' MB</button>' +
        '<p class="hint">To render the whole Edit as one video, use the Export tab.</p>';
    }
    return '<div class="scrim" data-act="close-sheet"><div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>' + body + '</div></div>';
  }

  function getVideo(e) {
    got[e.id] = { state: 'getting', progress: 0 }; render();
    fetch('/export/' + e.id + '.mp4', { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('server ' + r.status);
      var total = +r.headers.get('Content-Length') || e.size, reader = r.body.getReader(), chunks = [], rec = 0, last = 0;
      return (function pump() {
        return reader.read().then(function (x) {
          if (x.done) return new Blob(chunks, { type: 'video/mp4' });
          chunks.push(x.value); rec += x.value.length;
          if (Date.now() - last > 150) { last = Date.now(); got[e.id].progress = rec / total; if (ptab === 'export') render(); }
          return pump();
        });
      })();
    }).then(function (blob) {
      var file = new File([blob], e.file, { type: 'video/mp4' });
      var canShare = !!(navigator.canShare && navigator.canShare({ files: [file] }));
      got[e.id] = { state: 'got', file: file, url: URL.createObjectURL(blob), canShare: canShare };
      render();
    }).catch(function (err) { got[e.id] = { state: 'error', error: 'Couldn\'t get the video (' + err.message + ').' }; render(); });
  }
  function shareVideo(e) {
    var g = got[e.id]; if (!g || !g.file) return;
    navigator.share({ files: [g.file], title: exportTitle(e) }).then(function () { g.state = 'shared'; g.at = Date.now() / 1000; render(); },
      function (err) { if (err && err.name !== 'AbortError') { g.state = 'error'; g.error = 'Share failed (' + err.message + ').'; render(); } });
  }

  // --- 7. Uploads (protocol reused from the approved uploader)
  function fileRow(it) {
    var srv = it.server, pct = it.size ? Math.min(100, 100 * (it.sent || 0) / it.size) : 0, state, cls = '', bar = true, err = '', indet = false, note = '';
    if (srv && srv.state === 'verifying') { state = 'verifying on Mac'; pct = 100; }
    else if (srv && srv.state === 'imported') { state = 'imported · verified'; cls = 'ok'; pct = 100; bar = false; }
    else if (srv && srv.state === 'already') { state = 'already in Project'; cls = 'ok'; pct = 100; bar = false; }
    else if (srv && srv.state === 'mismatch') { state = 'failed'; cls = 'err'; bar = false; err = '<div class="err-line"><span>' + h(srv.error) + '</span>' + (it.file ? btn('Retry', 'retry-upload', it.id) : '') + '</div>'; }
    else if (it.state === 'queued') { state = 'waiting'; indet = true; }
    else if (it.state === 'hashing') { state = 'Preparing…'; indet = true; note = 'Fingerprinting the file on this phone so the Mac can verify it. Big files take a few seconds.'; }
    else if (it.state === 'retrying') { state = 'retrying'; cls = 'warn'; }
    else if (it.state === 'paused') { state = 'paused — return to resume'; cls = 'warn'; }
    else if (it.state === 'error') { state = 'failed'; cls = 'err'; bar = false; err = '<div class="err-line"><span>' + h(it.text) + '</span>' + btn('Retry', 'retry-upload', it.id) + '</div>'; }
    else if (it.state === 'server') { state = (srv && srv.state) === 'sending' ? 'paused — pick ' + h(it.name) + ' again to continue' : (srv && srv.state) || ''; cls = 'warn'; }
    else state = 'sending · ' + Math.round(pct) + '%';
    return '<div class="file" data-upload="' + it.id + '"><div class="line"><span class="name">' + h(it.name) + '</span><span class="state ' + cls + '">' + state + '</span></div>' +
      (bar ? '<div class="progress thin' + (cls === 'ok' ? ' ok' : '') + (indet ? ' indet' : '') + '" role="progressbar" aria-valuemin="0" aria-valuemax="100"' + (indet ? '' : ' aria-valuenow="' + Math.round(pct) + '"') + '><i style="width:' + (indet ? 40 : pct) + '%"></i></div>' : '') +
      (note ? '<div class="meta"><span>' + note + '</span></div>' : '<div class="meta"><span>' + fmtSize(it.sent || 0) + ' / ' + fmtSize(it.size) + '</span><span>' + (it.speed ? fmtSize(it.speed) + '/s' : '') + '</span></div>') + err + '</div>';
  }

  var CHUNK = 8 * 1024 * 1024, MAX_TRIES = 8, CHUNK_TIMEOUT = 180000, HASH_LIMIT = 400 * 1024 * 1024;
  var pending = [], working = false, wakeLock = null, wakeResolve = null;
  function fnv(str, seed) { var x = seed >>> 0; for (var i = 0; i < str.length; i++) { x ^= str.charCodeAt(i); x = Math.imul(x, 16777619) >>> 0; } return ('00000000' + x.toString(16)).slice(-8); }
  function uploadId(f) { var key = f.name + '|' + f.size + '|' + f.lastModified; return fnv(key, 2166136261) + fnv(key, 0x9747b28c); }
  function sleep(ms) { return new Promise(function (res) { var t = setTimeout(function () { wakeResolve = null; res(); }, ms); wakeResolve = function () { clearTimeout(t); wakeResolve = null; res(); }; }); }
  function wakeNow() { if (wakeResolve) wakeResolve(); }
  function holdAwake() { if (!('wakeLock' in navigator) || wakeLock) return; navigator.wakeLock.request('screen').then(function (l) { wakeLock = l; l.addEventListener('release', function () { wakeLock = null; }); }).catch(function () {}); }
  function releaseAwake() { if (wakeLock) { wakeLock.release().catch(function () {}); wakeLock = null; } }
  function paintUpload(it) {
    if (route().name !== 'project' || ptab !== 'footage') return;
    var el = app.querySelector('[data-upload="' + it.id + '"]');
    if (!el) { render(); return; }
    var tmp = document.createElement('div'); tmp.innerHTML = fileRow(it); el.replaceWith(tmp.firstChild);
  }
  function setStatus(it, state, text) { it.state = state; it.text = text; paintUpload(it); }
  function hashFile(f) {
    if (f.size > HASH_LIMIT || !window.crypto || !crypto.subtle) return Promise.resolve('');
    return f.arrayBuffer().then(function (buf) { return crypto.subtle.digest('SHA-256', buf); }).then(function (d) {
      return Array.prototype.map.call(new Uint8Array(d), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    }).catch(function () { return ''; });
  }
  function statusOf(id) { return fetch('/upload/' + id, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('status ' + r.status); return r.json(); }); }
  function putChunk(it, offset, end, onProgress) {
    return new Promise(function (res, rej) {
      var x = new XMLHttpRequest();
      x.open('PUT', '/upload/' + it.id + '?offset=' + offset + '&size=' + it.file.size + '&name=' + encodeURIComponent(it.file.name) + '&sha256=' + (it.sha || ''));
      x.timeout = CHUNK_TIMEOUT;
      x.upload.onprogress = function (e) { if (e.lengthComputable) onProgress(e.loaded); };
      x.onload = function () {
        var j = null; try { j = JSON.parse(x.responseText); } catch (e) {}
        if (x.status === 200 && j) return res(j);
        if (x.status === 409 && j) return res({ offset: j.offset, done: false, conflict: true });
        if (x.status === 415 && j) return rej(new Error(j.error));
        rej(new Error(x.status ? 'server ' + x.status : 'no response'));
      };
      x.onerror = function () { rej(new Error('network')); };
      x.ontimeout = function () { rej(new Error('timeout')); };
      x.onabort = function () { rej(new Error('aborted')); };
      x.send(it.file.slice(offset, end));
    });
  }
  function uploadFile(it) {
    var size = it.file.size, tries = 0, offset = 0, samples = [];
    function speed(sent) { var now = Date.now(); samples.push([now, sent]); while (samples.length > 2 && now - samples[0][0] > 5000) samples.shift(); var a = samples[0]; return now - a[0] > 400 ? (sent - a[1]) / ((now - a[0]) / 1000) : null; }
    function progress(sent) { it.sent = sent; it.speed = speed(sent); setStatus(it, 'sending', ''); }
    setStatus(it, 'hashing', '');
    return hashFile(it.file).then(function (sha) { it.sha = sha; return statusOf(it.id).catch(function () { return { offset: 0 }; }); }).then(function (st) {
      if (st.done && st.row) { it.server = st.row; return st; }
      offset = Math.min(st.offset, size);
      return (function loop() {
        if (offset >= size) {
          return putChunk(it, size, size, function () {}).then(function (r) {
            if (r.done) return r;
            offset = Math.min(r.offset, size); tries++; if (tries > MAX_TRIES) throw new Error('out of sync'); return loop();
          });
        }
        var end = Math.min(offset + CHUNK, size), base = offset;
        return putChunk(it, offset, end, function (loaded) { progress(base + loaded); }).then(function (r) {
          offset = r.offset;
          if (r.conflict) { tries++; if (tries > MAX_TRIES) throw new Error('out of sync'); return loop(); }
          tries = 0; progress(offset);
          return r.done ? r : loop();
        }, function (err) {
          if (/^Only /.test(err.message)) throw err;
          tries++; if (tries > MAX_TRIES) throw err;
          var wait = Math.min(30000, 1000 * Math.pow(2, tries - 1));
          setStatus(it, document.visibilityState === 'hidden' ? 'paused' : 'retrying', '');
          return sleep(wait).then(function () { return statusOf(it.id).then(function (st) { offset = Math.min(st.offset, size); }, function () {}); }).then(loop);
        });
      })();
    });
  }
  function enqueue(it) { setStatus(it, 'queued', ''); pending.push(it); if (!working) work(); }
  function work() {
    working = true; holdAwake();
    (function next() {
      var it = pending.shift();
      if (!it) { working = false; releaseAwake(); return; }
      uploadFile(it).then(function (r) {
        it.sent = it.file.size; it.server = r.row || { state: 'verifying' }; setStatus(it, 'done', '');
        watchVerify(it);
      }, function (err) { setStatus(it, 'error', friendly(err)); }).then(next);
    })();
  }
  function watchVerify(it) {
    var t = setInterval(function () {
      statusOf(it.id).then(function (st) {
        if (st.row) { it.server = st.row; paintUpload(it); }
        if (st.row && st.row.state !== 'verifying') { clearInterval(t); loadProject(true); }
      }).catch(function () {});
    }, 1000);
  }
  function friendly(err) {
    var m = String(err && err.message || err);
    if (/^Only /.test(m)) return m;
    if (m === 'network' || m === 'timeout' || m === 'no response') return 'Couldn\'t reach the Mac. Check Tailscale and try again.';
    if (m === 'out of sync') return 'The Mac and this phone disagree about this file. Try again.';
    if (/^server 5/.test(m)) return 'The Mac couldn\'t write the file (' + m + ').';
    return 'Upload failed (' + m + ').';
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') { if (working) holdAwake(); wakeNow(); } });
  window.addEventListener('online', wakeNow);
  window.addEventListener('pageshow', function () { if (working) holdAwake(); wakeNow(); });
  window.addEventListener('beforeunload', function (e) { if (working) { e.preventDefault(); e.returnValue = ''; } });

  // ------------------------------------------------------------ actions --
  // Toasts dock under the header, so they never cover a button.
  function showToast(text, undo) {
    clearTimeout(toastTimer); toast = { text: text, undo: undo };
    render(); toastTimer = setTimeout(function () { toast = null; render(); }, 4000);
  }
  function viewToast() { return '<div class="toast" role="status"><span>' + h(toast.text) + '</span>' + (toast.undo ? '<button data-act="undo">Undo</button>' : '') + '</div>'; }

  function decide(id, d, listKey) {
    var c = clipById(id), prev = c.decision;
    var listBefore = clipsFor(listKey), idx = listBefore.indexOf(c);
    c.decision = d;
    clearTimeout(toastTimer);
    toast = { text: (d === 'accepted' ? 'Accepted' : 'Rejected') + ' clip ' + c.rank, undo: { id: id, prev: prev } };
    toastTimer = setTimeout(function () { toast = null; render(); }, 4000);
    api('/api/decision', { method: 'POST', body: { clip_id: id, decision: d } }).catch(function () { c.decision = prev; showToast('Changed on the Mac — showing the latest.'); });
    // Auto-advance to the next clip in the list being reviewed; on the last one, stay and show the state.
    var after = clipsFor(listKey), nextC = listKey === 'cand' ? after[Math.min(idx, after.length - 1)] : listBefore[idx + 1];
    if (nextC && nextC !== c) go('#/clip/' + nextC.clip_id + '/' + listKey);
    else if (listKey === 'cand' && !nextC) go('#/project/clips');
    else render();
  }
  function undo(u) {
    var c = clipById(u.id);
    c.decision = u.prev; toast = null; clearTimeout(toastTimer); render();
    api('/api/decision', { method: 'POST', body: { clip_id: u.id, decision: u.prev || null } }).catch(function () {});
  }

  app.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-act]'); if (!el) return;
    var act = el.dataset.act, id = el.dataset.id;
    if (act !== 'dl-mark' && el.tagName !== 'A') ev.preventDefault();
    if (act === 'close-sheet') { if (ev.target === el) { sheet = null; render(); } return; }
    switch (act) {
      case 'pair':
        pairStage = 'approving'; render();
        setTimeout(function () {   // FAKE approval on the Mac
          api('/api/pair', { method: 'POST', body: { label: deviceLabel() } }).then(function () { return api('/api/me'); }).then(function (m) {
            me = m; pairStage = 'idle'; sessionStorage.removeItem('rvReason'); localStorage.rvA2HS = '1'; go('#/projects'); loadProject();
          }).catch(function () { pairStage = 'idle'; render(); });
        }, 1400);
        break;
      case 'pair-cancel': pairStage = 'idle'; render(); break;
      case 'connection': sheet = { type: 'connection' }; render(); break;
      case 'disconnect':
        api('/api/disconnect', { method: 'POST', body: {} }).then(function () { sessionStorage.rvReason = 'disconnected'; me = { paired: false }; sheet = null; stopPolling(); go('#/pair'); render(); });
        break;
      case 'a2hs': sheet = null; localStorage.rvA2HS = '1'; go('#/projects'); break;
      case 'dismiss-a2hs': localStorage.rvA2HS = '0'; render(); break;
      case 'retry-conn': failCount = 0; loadProject(); break;
      case 'reload': location.reload(); break;
      case 'tab': tab = el.dataset.tab; localStorage.rvTab = tab; render(); break;
      case 'select': selecting = !selecting; if (!selecting) selection = {}; render(); break;
      case 'toggle-sel': if (selection[id]) delete selection[id]; else selection[id] = true; render(); break;
      case 'open-clip': go('#/clip/' + id + '/' + el.dataset.list); break;
      case 'decide': decide(id, el.dataset.d, el.dataset.list); break;
      case 'undo': if (toast && toast.undo) undo(toast.undo); break;
      case 'undo-decision': undo({ id: id, prev: null }); break;
      case 'export-sel': exportOpts.ids = Object.keys(selection); sheet = { type: 'export' }; render(); break;
      case 'export-one': exportOpts.ids = [id]; sheet = { type: 'export' }; render(); break;
      case 'opt': exportOpts[el.dataset.key] = el.dataset.val; render(); break;
      case 'render':
        api('/api/exports', { method: 'POST', body: { what: 'each', clip_ids: exportOpts.ids, frame: exportOpts.frame, audio: exportOpts.audio } }).then(function () {
          sheet = null; selecting = false; selection = {}; go('#/project/export'); loadExports();
        });
        break;
      case 'render-edit':
        el.disabled = true; el.textContent = 'Sending to Mac…';
        api('/api/exports', { method: 'POST', body: { what: 'edit', frame: exportOpts.frame, audio: exportOpts.audio } }).then(function () { loadExports(); loadProject(true); });
        break;
      case 'cancel-export': api('/api/exports/' + id + '/cancel', { method: 'POST', body: {} }).then(function () { loadExports(); }); break;
      case 'retry-export': api('/api/exports/' + id + '/retry', { method: 'POST', body: {} }).then(function () { loadExports(); }); break;
      case 'remove-export': api('/api/exports/' + id + '/remove', { method: 'POST', body: {} }).then(function () { delete got[id]; loadExports(); }); break;
      case 'get': getVideo(exportsList.filter(function (e) { return e.id === id; })[0]); break;
      case 'share': shareVideo(exportsList.filter(function (e) { return e.id === id; })[0]); break;
      case 'dl-mark': got[id] = { state: 'downloaded' }; setTimeout(render, 300); break;
      case 'retry-upload':
        var it = items.filter(function (x) { return x.id === id; })[0];
        if (it && it.file) { it.sent = 0; it.server = null; enqueue(it); }
        break;
    }
  });

  function afterRender(r) {
    if (r.name === 'clip' && project) { var c = clipById(r.a); if (c) bindPlayer(c); }
    if (r.name === 'project' && ptab === 'edit' && project) bindEditPlayer(editItems());
    var pick = document.getElementById('pick');
    if (pick) pick.addEventListener('change', function () {
      var fs = Array.prototype.slice.call(this.files); this.value = '';
      fs.forEach(function (f) {
        var id = uploadId(f), existing = items.filter(function (x) { return x.id === id; })[0];
        if (existing && existing.state !== 'error') return;
        var it = existing || { id: id, name: f.name, size: f.size, sent: 0 };
        it.file = f; if (!existing) items.unshift(it);
        enqueue(it);
      });
      render();
    });
  }

  boot();
})();
