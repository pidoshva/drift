/* Dashboard (/dash/). Asks once for the read-only dashboard token (stored in localStorage),
   loads stats from the worker + inventory JSON from the site, renders KPI tiles, charts
   (inline SVG, no library) and tables. All text is inserted with textContent. */
(function () {
  'use strict';
  var body = document.body;
  var WORKER = body.getAttribute('data-worker-url') || '';
  var BASE = body.getAttribute('data-base') || '';
  var root = document.getElementById('dash');
  var TOKEN_KEY = 'drift_dash_token';
  var state = { days: 30, token: '', stats: null, listings: [], archive: [] };

  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { if (k === 'class') e.className = attrs[k]; else if (k === 'text') e.textContent = attrs[k]; else e.setAttribute(k, attrs[k]); });
    (children || []).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function svgEl(tag, attrs) { var e = document.createElementNS('http://www.w3.org/2000/svg', tag); Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); }); return e; }
  var fmt = function (n) { return (n || 0).toLocaleString('en-US'); };
  var money = function (n) { return n ? '$' + Math.round(n).toLocaleString('en-US') : '—'; };
  function getToken() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
  function setToken(t) { try { localStorage.setItem(TOKEN_KEY, t); } catch (e) { /* ignore */ } }

  // ---- Gate -----------------------------------------------------------------
  function renderGate(msg) {
    root.textContent = '';
    var input = el('input', { type: 'password', placeholder: 'Dashboard token', autocomplete: 'off' });
    var btn = el('button', { class: 'button button--primary', text: 'Open dashboard' });
    var form = el('form', { class: 'dash__gate' }, [el('h1', { text: 'Dashboard' }), el('p', { class: 'muted', text: msg || 'Enter the dashboard token (ask your developer).' }), input, el('div', { style: 'height:12px' }), btn]);
    form.addEventListener('submit', function (e) { e.preventDefault(); state.token = input.value.trim(); setToken(state.token); load(); });
    root.appendChild(form);
  }

  // ---- Data -------------------------------------------------------------------
  function load() {
    if (!WORKER) { renderGate('Worker URL is not configured (worker.url in drift.config.json).'); return; }
    root.style.opacity = '.5';
    Promise.all([
      fetch(WORKER + '/admin/stats?days=' + state.days, { headers: { authorization: 'Bearer ' + state.token } }).then(function (r) { if (r.status === 401 || r.status === 403) throw new Error('auth'); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }),
      fetch(BASE + '/api/listings.json').then(function (r) { return r.json(); }),
      fetch(BASE + '/api/archive.json').then(function (r) { return r.json(); })
    ]).then(function (res) {
      state.stats = res[0]; state.listings = res[1].listings || []; state.archive = res[2].listings || [];
      render();
    }).catch(function (err) {
      if (err.message === 'auth') { setToken(''); renderGate('That token was not accepted. Try again.'); }
      else { root.textContent = ''; root.appendChild(el('p', { class: 'empty-state', text: 'Could not load stats: ' + err.message })); }
    }).then(function () { root.style.opacity = '1'; });
  }

  // ---- Charts (inline SVG) -------------------------------------------------
  function lineChart(series, labels, opts) {
    // series: [{name, color, values[]}], labels: x labels. Thin lines, hover crosshair + tooltip.
    var W = 640, H = 220, P = { t: 12, r: 12, b: 28, l: 36 };
    var max = Math.max(1, Math.max.apply(null, series.map(function (s) { return Math.max.apply(null, s.values); })));
    var n = labels.length, iw = W - P.l - P.r, ih = H - P.t - P.b;
    var x = function (i) { return P.l + (n > 1 ? i * iw / (n - 1) : iw / 2); };
    var y = function (v) { return P.t + ih - v / max * ih; };
    var wrap = el('div', { class: 'chart' });
    var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': opts.label });
    var grid = svgEl('g', { class: 'grid' });
    var axis = svgEl('g', { class: 'axis' });
    [0, 0.5, 1].forEach(function (f) {
      var yy = y(max * f);
      grid.appendChild(svgEl('line', { x1: P.l, x2: W - P.r, y1: yy, y2: yy }));
      var t = svgEl('text', { x: P.l - 6, y: yy + 4, 'text-anchor': 'end' }); t.textContent = fmt(Math.round(max * f)); axis.appendChild(t);
    });
    var step = Math.max(1, Math.ceil(n / 8));
    labels.forEach(function (lab, i) { if (i % step === 0 || i === n - 1) { var t = svgEl('text', { x: x(i), y: H - 8, 'text-anchor': 'middle' }); t.textContent = lab.slice(5); axis.appendChild(t); } });
    svg.appendChild(grid); svg.appendChild(axis);
    series.forEach(function (s) {
      var d = s.values.map(function (v, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1); }).join(' ');
      svg.appendChild(svgEl('path', { class: 'line', d: d, stroke: s.color }));
    });
    var cross = svgEl('line', { x1: 0, x2: 0, y1: P.t, y2: P.t + ih, stroke: 'currentColor', 'stroke-dasharray': '3 3', opacity: 0 });
    svg.appendChild(cross);
    var markers = series.map(function (s) { var m = svgEl('circle', { class: 'marker', fill: s.color, opacity: 0 }); svg.appendChild(m); return m; });
    var tip = el('div', { class: 'chart__tooltip' }); tip.hidden = true;
    var hit = svgEl('rect', { class: 'hit', x: P.l, y: P.t, width: iw, height: ih });
    svg.appendChild(hit);
    function show(i) {
      cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('opacity', '.5');
      markers.forEach(function (m, k) { m.setAttribute('cx', x(i)); m.setAttribute('cy', y(series[k].values[i])); m.setAttribute('opacity', '1'); });
      tip.textContent = ''; tip.appendChild(el('div', { text: labels[i] }));
      series.forEach(function (s) { tip.appendChild(el('div', {}, [el('strong', { text: fmt(s.values[i]) }), ' ' + s.name])); });
      tip.hidden = false; var rect = wrap.getBoundingClientRect();
      tip.style.left = (x(i) / W * rect.width) + 'px'; tip.style.top = (y(Math.max.apply(null, series.map(function (s) { return s.values[i]; }))) / H * rect.height) + 'px';
    }
    function hide() { cross.setAttribute('opacity', '0'); markers.forEach(function (m) { m.setAttribute('opacity', '0'); }); tip.hidden = true; }
    hit.addEventListener('pointermove', function (ev) { var rect = svg.getBoundingClientRect(); var px = (ev.clientX - rect.left) / rect.width * W; var i = Math.round((px - P.l) / iw * (n - 1)); show(Math.max(0, Math.min(n - 1, i))); });
    hit.addEventListener('pointerleave', hide);
    var legend = el('div', { class: 'legend' }, series.map(function (s) { var i = el('i'); i.style.background = s.color; return el('span', {}, [i, s.name]); }));
    if (series.length > 1) wrap.appendChild(legend);
    wrap.appendChild(svg); wrap.appendChild(tip);
    return wrap;
  }
  function hbars(rows, opts) {
    var max = Math.max(1, Math.max.apply(null, rows.map(function (r) { return r.value; })));
    return el('div', {}, rows.length ? rows.map(function (r) {
      var fill = el('div', { class: 'hbar__fill' }); fill.style.width = (r.value / max * 100).toFixed(1) + '%';
      var name = r.href ? el('a', { href: r.href, class: 'hbar__name', text: r.name, title: r.name }) : el('span', { class: 'hbar__name', text: r.name, title: r.name });
      return el('div', { class: 'hbar', title: r.name + ': ' + fmt(r.value) + (opts && opts.unit ? ' ' + opts.unit : '') }, [name, el('div', { class: 'hbar__track' }, [fill]), el('span', { class: 'hbar__val', text: fmt(r.value) })]);
    }) : [el('p', { class: 'muted', text: 'No data yet.' })]);
  }
  function table(cols, rows) {
    var t = el('table', { class: 'table' });
    t.appendChild(el('thead', {}, [el('tr', {}, cols.map(function (c) { return el('th', { class: c.num ? 'num' : '', text: c.label }); }))]));
    t.appendChild(el('tbody', {}, rows.length ? rows.map(function (r) { return el('tr', {}, cols.map(function (c) { var v = c.render ? c.render(r) : r[c.key]; return el('td', { class: c.num ? 'num' : '' }, [typeof v === 'string' || typeof v === 'number' ? String(v) : v]); })); }) : [el('tr', {}, [el('td', { colspan: cols.length, class: 'muted', text: 'No data yet.' })])]));
    return t;
  }
  function kpi(label, value, sub) { return el('div', { class: 'kpi' }, [el('div', { class: 'kpi__label', text: label }), el('div', { class: 'kpi__value', text: value }), sub ? el('div', { class: 'kpi__delta', text: sub }) : null]); }
  function panel(title, content, wide) { return el('section', { class: 'panel' + (wide ? ' panel--wide' : '') }, [el('h3', { text: title }), content]); }

  // ---- Render -----------------------------------------------------------------
  function render() {
    var s = state.stats, t = s.totals;
    var byId = {}; state.listings.concat(state.archive).forEach(function (l) { byId[l.id] = l; });
    var since = Date.now() - state.days * 864e5;
    var sold = state.archive.filter(function (l) { return l.status === 'sold' && l.soldAt && Date.parse(l.soldAt) >= since; });
    var dts = sold.map(function (l) { return Math.round((Date.parse(l.soldAt) - Date.parse(l.firstSeenAt)) / 864e5); });
    var avgDts = dts.length ? Math.round(dts.reduce(function (a, b) { return a + b; }, 0) / dts.length) : null;
    var revenue = sold.reduce(function (a, l) { return a + (l.price || 0); }, 0);
    root.textContent = '';
    var select = el('select', {}, [7, 30, 90, 365].map(function (d) { var o = el('option', { value: d, text: 'Last ' + d + ' days' }); if (d === state.days) o.selected = true; return o; }));
    select.addEventListener('change', function () { state.days = Number(select.value); load(); });
    var logout = el('button', { class: 'button', text: 'Sign out', type: 'button' }); logout.addEventListener('click', function () { setToken(''); renderGate(); });
    root.appendChild(el('div', { class: 'dash__toolbar' }, [el('h1', { text: 'Dashboard' }), select, el('span', { class: 'muted small', text: s.from.slice(0, 10) + ' → ' + s.to.slice(0, 10) }), logout]));
    root.appendChild(el('div', { class: 'kpis' }, [
      kpi('Page views', fmt(t.pageviews)), kpi('Visitors', fmt(t.visitors)), kpi('Car views', fmt(t.listingViews)), kpi('Leads', fmt(t.leads)),
      kpi('Call clicks', fmt(t.callClicks)), kpi('Cars live', fmt(state.listings.length)), kpi('Sold', fmt(sold.length), revenue ? money(revenue) + ' total' : ''), kpi('Avg days to sell', avgDts === null ? '—' : String(avgDts))
    ]));
    var labels = s.daily.map(function (d) { return d.day; });
    var grid = el('div', { class: 'dash__grid' });
    grid.appendChild(panel('Traffic per day', lineChart([{ name: 'Page views', color: 'var(--series-1)', values: s.daily.map(function (d) { return d.pageviews; }) }, { name: 'Car views', color: 'var(--series-2)', values: s.daily.map(function (d) { return d.listingViews; }) }], labels, { label: 'Daily page views and car views' }), true));
    grid.appendChild(panel('Leads per day', lineChart([{ name: 'Leads', color: 'var(--series-3)', values: s.daily.map(function (d) { return d.leads; }) }], labels, { label: 'Daily leads' }), true));
    grid.appendChild(panel('Most viewed cars (website)', hbars(s.topListings.slice(0, 10).map(function (r) { var l = byId[r.listingId]; return { name: (l && l.title) || r.title || r.listingId, value: r.views, href: l && l.status === 'active' ? BASE + l.path : null }; }), { unit: 'views' })));
    grid.appendChild(panel('Most viewed cars (KSL)', hbars(state.listings.filter(function (l) { return l.sourceViews; }).sort(function (a, b) { return b.sourceViews - a.sourceViews; }).slice(0, 10).map(function (l) { return { name: l.title, value: l.sourceViews, href: BASE + l.path }; }), { unit: 'KSL views' })));
    var makeCounts = {}; sold.forEach(function (l) { makeCounts[l.make || '?'] = (makeCounts[l.make || '?'] || 0) + 1; });
    grid.appendChild(panel('Sold by make', hbars(Object.keys(makeCounts).map(function (k) { return { name: k, value: makeCounts[k] }; }).sort(function (a, b) { return b.value - a.value; }))));
    var bodyCounts = {}; state.listings.forEach(function (l) { bodyCounts[l.body || '?'] = (bodyCounts[l.body || '?'] || 0) + 1; });
    grid.appendChild(panel('Inventory by body style', hbars(Object.keys(bodyCounts).map(function (k) { return { name: k, value: bodyCounts[k] }; }).sort(function (a, b) { return b.value - a.value; }))));
    grid.appendChild(panel('Where visitors come from', table([{ label: 'Source', key: 'referrer', render: function (r) { return r.referrer || 'direct / typed'; } }, { label: 'Visits', key: 'count', num: true }], s.topReferrers)));
    grid.appendChild(panel('Visitor locations', table([{ label: 'City', render: function (r) { return [r.city, r.region].filter(Boolean).join(', ') || '?'; } }, { label: 'Country', key: 'country' }, { label: 'Visits', key: 'count', num: true }], s.cities)));
    grid.appendChild(panel('Devices', hbars(s.devices.map(function (d) { return { name: d.device, value: d.count }; }))));
    grid.appendChild(panel('Top pages', table([{ label: 'Page', key: 'path' }, { label: 'Views', key: 'count', num: true }], s.topPaths)));
    grid.appendChild(panel('Recent sales', table([{ label: 'Car', key: 'title' }, { label: 'Price', render: function (r) { return money(r.price); }, num: true }, { label: 'Days', render: function (r) { return String(Math.round((Date.parse(r.soldAt) - Date.parse(r.firstSeenAt)) / 864e5)); }, num: true }, { label: 'Sold', render: function (r) { return r.soldAt.slice(0, 10); } }], sold.slice(0, 15))));
    grid.appendChild(panel('Recent leads', table([{ label: 'When', render: function (r) { return r.ts.slice(0, 16).replace('T', ' '); } }, { label: 'Name', key: 'name' }, { label: 'Phone', render: function (r) { return el('a', { href: 'tel:' + r.phone, text: r.phone }); } }, { label: 'Car', render: function (r) { return r.listingTitle || '—'; } }, { label: 'Message', render: function (r) { return r.message.length > 80 ? r.message.slice(0, 80) + '…' : r.message; } }, { label: 'Sent via', key: 'delivered' }], s.recentLeads), true));
    grid.appendChild(panel('Sync runs', table([{ label: 'When', render: function (r) { return r.ts.slice(0, 16).replace('T', ' '); } }, { label: 'Job', key: 'type' }, { label: 'Status', key: 'status' }, { label: 'Summary', render: function (r) { var su = r.summary || {}; return ['+' + (su.added || 0), '~' + (su.updated || 0), '-' + (su.gone || 0), (su.active || 0) + ' live', su.errors ? su.errors + ' err' : ''].filter(Boolean).join('  '); } }], s.jobs), true));
    root.appendChild(grid);
  }

  state.token = getToken();
  if (state.token) load(); else renderGate();
})();
