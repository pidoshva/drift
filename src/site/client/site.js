/* Browser JS for every page. No framework, no build step. Loaded with `defer`.
   Responsibilities: analytics beacon, click tracking, contact form, inventory filters,
   gallery, mobile nav. Config comes from <body data-*> attributes written at build time. */
(function () {
  'use strict';
  var body = document.body;
  var WORKER = body.getAttribute('data-worker-url') || '';
  var ANALYTICS = body.getAttribute('data-analytics') === '1';
  var LISTING_ID = body.getAttribute('data-listing-id') || '';

  // ---- Analytics ---------------------------------------------------------
  function sessionId() {
    try {
      var k = 'drift_sid', v = sessionStorage.getItem(k);
      if (!v) { v = Math.random().toString(36).slice(2) + Date.now().toString(36); sessionStorage.setItem(k, v); }
      return v;
    } catch (e) { return ''; }
  }
  function track(type, extra) {
    if (!ANALYTICS || !WORKER) return;
    var payload = Object.assign({ t: type, p: location.pathname, l: LISTING_ID, r: document.referrer || '', s: sessionId(), w: window.innerWidth }, extra || {});
    // Sent as text/plain on purpose: a "simple" cross-origin request needs no CORS preflight,
    // so it survives page unloads. The worker parses the body as JSON regardless of content-type.
    var data = JSON.stringify(payload);
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(WORKER + '/e', data)) return;
    } catch (e) { /* fall through */ }
    try { fetch(WORKER + '/e', { method: 'POST', body: data, keepalive: true }); } catch (e) { /* ignore */ }
  }
  if (!/[?&]drift-notrack/.test(location.search) && !localStorage.getItem('drift_notrack')) {
    track(LISTING_ID ? 'listing_view' : 'pageview');
    document.addEventListener('click', function (ev) {
      var a = ev.target.closest && ev.target.closest('[data-track]');
      if (a) track('click_' + a.getAttribute('data-track'), { l: a.closest('[data-listing-id]') ? a.closest('[data-listing-id]').getAttribute('data-listing-id') : LISTING_ID });
    });
  }

  // ---- Mobile nav ----------------------------------------------------------
  var toggle = document.querySelector('[data-nav-toggle]');
  var nav = document.querySelector('[data-nav]');
  if (toggle && nav) toggle.addEventListener('click', function () {
    var open = nav.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  // ---- Gallery ---------------------------------------------------------------
  var gallery = document.querySelector('[data-gallery]');
  if (gallery) {
    var main = gallery.querySelector('[data-gallery-main]');
    gallery.querySelectorAll('[data-gallery-thumb]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        main.src = btn.getAttribute('data-gallery-thumb');
        gallery.querySelectorAll('.gallery__thumb').forEach(function (b) { b.classList.remove('is-active'); });
        btn.classList.add('is-active');
      });
    });
  }

  // ---- Inventory filters ---------------------------------------------------
  var filters = document.querySelector('[data-filters]');
  var grid = document.querySelector('[data-inventory-grid]');
  if (filters && grid) {
    var cards = Array.prototype.slice.call(grid.querySelectorAll('.car-card'));
    var empty = document.querySelector('[data-inventory-empty]');
    var count = document.querySelector('[data-inventory-count]');
    var num = function (el, k) { var v = parseFloat(el.getAttribute('data-' + k)); return isNaN(v) ? Infinity : v; };
    var sorters = {
      'newest': null,
      'price-asc': function (a, b) { return num(a, 'price') - num(b, 'price'); },
      'price-desc': function (a, b) { return (num(b, 'price') === Infinity ? -1 : num(b, 'price')) - (num(a, 'price') === Infinity ? -1 : num(a, 'price')); },
      'mileage-asc': function (a, b) { return num(a, 'mileage') - num(b, 'mileage'); },
      'year-desc': function (a, b) { return (num(b, 'year') === Infinity ? 0 : num(b, 'year')) - (num(a, 'year') === Infinity ? 0 : num(a, 'year')); }
    };
    function apply() {
      var q = (filters.q.value || '').trim().toLowerCase();
      var make = filters.make.value, bodyStyle = filters.body.value, sort = filters.sort.value;
      var visible = cards.filter(function (c) {
        return (!q || c.getAttribute('data-text').indexOf(q) >= 0) && (!make || c.getAttribute('data-make') === make) && (!bodyStyle || c.getAttribute('data-body') === bodyStyle);
      });
      var ordered = sorters[sort] ? visible.slice().sort(sorters[sort]) : visible;
      cards.forEach(function (c) { c.hidden = visible.indexOf(c) < 0; });
      ordered.forEach(function (c) { grid.appendChild(c); });
      if (empty) empty.hidden = visible.length > 0;
      if (count) count.textContent = '(' + visible.length + ')';
    }
    filters.addEventListener('input', apply);
    filters.addEventListener('change', apply);
    filters.addEventListener('submit', function (e) { e.preventDefault(); });
    // Support /inventory/?make=Toyota deep links.
    var params = new URLSearchParams(location.search);
    ['make', 'body', 'q', 'sort'].forEach(function (k) { if (params.get(k) && filters[k]) filters[k].value = params.get(k); });
    apply();
  }

  // ---- Contact form ----------------------------------------------------------
  document.querySelectorAll('[data-contact-form]').forEach(function (form) {
    var status = form.querySelector('.contact-form__status');
    var button = form.querySelector('button[type=submit]');
    function say(msg, cls) { status.textContent = msg; status.className = 'contact-form__status ' + (cls || ''); }
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (!WORKER) { say('Messaging is not set up yet — please call us.', 'is-error'); return; }
      var fd = new FormData(form);
      var data = {
        name: (fd.get('name') || '').toString().trim(), phone: (fd.get('phone') || '').toString().trim(),
        email: (fd.get('email') || '').toString().trim(), message: (fd.get('message') || '').toString().trim(),
        listingId: (fd.get('listingId') || '').toString(), website: (fd.get('website') || '').toString(),
        turnstileToken: (fd.get('cf-turnstile-response') || '').toString(), page: location.href, sid: sessionId()
      };
      if (!data.name || !data.phone || !data.message) { say('Please fill in your name, phone and a message.', 'is-error'); return; }
      button.disabled = true; say('Sending…');
      fetch(WORKER + '/contact', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
        .then(function (res) {
          if (res.ok && res.body.ok) { say('Thanks! We got your message and will reach out shortly.', 'is-ok'); form.reset(); track('contact_submit', { l: data.listingId }); }
          else say(res.body.error || 'Something went wrong. Please call us instead.', 'is-error');
        })
        .catch(function () { say('Could not send. Please check your connection or call us.', 'is-error'); })
        .then(function () { button.disabled = false; if (window.turnstile) try { window.turnstile.reset(); } catch (e) { /* ignore */ } });
    });
  });
})();
