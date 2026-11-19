// ====================================================================
//  adblock-preload.js — eseguito DENTRO il browser incorporato (webview),
//  all'inizio di ogni pagina, PRIMA degli script di YouTube.
//  Scritto per SonicDownloader. Tecnica: "potare" gli annunci dai dati
//  che YouTube manda al player (adPlacements / playerAds / adSlots), così
//  il player non sa nemmeno che deve mostrarli. Poi nasconde/salta i residui.
// ====================================================================
const { webFrame } = require('electron');

if (/(^|\.)youtube\.com$/i.test(location.hostname)) {
  const SCRIPT = `(function () {
  if (window.__sdPrune) return;
  var KEYS = ['adPlacements', 'playerAds', 'adSlots'];
  var on = function () { return window.__sdAdblockOn !== false; };

  function prune(o, depth) {
    if (!o || typeof o !== 'object' || (depth || 0) > 3) return o;
    try {
      if (Array.isArray(o)) { for (var i = 0; i < o.length && i < 50; i++) prune(o[i], (depth || 0) + 1); return o; }
      for (var k = 0; k < KEYS.length; k++) if (KEYS[k] in o) { try { delete o[KEYS[k]]; } catch (e) { o[KEYS[k]] = undefined; } }
      if (o.playerResponse) prune(o.playerResponse, (depth || 0) + 1);
      if (o.response && typeof o.response === 'object') prune(o.response, (depth || 0) + 1);
      if (o.streamingData && o.streamingData.serverAbrStreamingUrl === undefined) { /* niente */ }
    } catch (e) {}
    return o;
  }
  window.__sdPrune = prune;

  // 1) Dati iniziali della pagina: ytInitialPlayerResponse viene "assegnato" da YouTube
  //    -> intercettiamo l'assegnazione e togliamo gli annunci.
  (function () {
    var stored;
    try {
      Object.defineProperty(window, 'ytInitialPlayerResponse', {
        configurable: true,
        get: function () { return stored; },
        set: function (v) { stored = on() ? prune(v) : v; }
      });
    } catch (e) {}
  })();

  // 2) JSON.parse: molte risposte passano di qui
  var _parse = JSON.parse;
  JSON.parse = function () {
    var r = _parse.apply(this, arguments);
    try {
      if (on() && r && typeof r === 'object' && (r.adPlacements || r.playerAds || r.adSlots || r.playerResponse)) prune(r);
    } catch (e) {}
    return r;
  };

  // 3) fetch: le risposte del player (/youtubei/v1/player, get_watch, playlist...)
  var URL_RE = /youtubei\\/v1\\/(player|get_watch|next|reel\\/reel_item_watch)|[?&]pp=|\\/player\\?|get_watch\\?|watch\\?[tv]=|playlist\\?list=/;
  var _fetch = window.fetch;
  window.fetch = function (input, init) {
    var url = '';
    try { url = typeof input === 'string' ? input : (input && input.url) || ''; } catch (e) {}
    var p = _fetch.apply(this, arguments);
    if (!on() || !URL_RE.test(url)) return p;
    return p.then(function (res) {
      try {
        if (!res || !res.ok) return res;
        var ct = res.headers && res.headers.get && res.headers.get('content-type');
        if (ct && ct.indexOf('json') === -1) return res;
        return res.clone().text().then(function (txt) {
          if (!/adPlacements|playerAds|adSlots/.test(txt)) return res;
          var obj = _parse(txt);
          prune(obj);
          var headers = new Headers(res.headers);
          headers.delete('content-length');
          return new Response(JSON.stringify(obj), { status: res.status, statusText: res.statusText, headers: headers });
        }).catch(function () { return res; });
      } catch (e) { return res; }
    });
  };

  // 4) XMLHttpRequest (percorso di riserva)
  var _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, u) {
    try { this.__sdUrl = String(u); } catch (e) {}
    return _open.apply(this, arguments);
  };
  ['response', 'responseText'].forEach(function (prop) {
    var d = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, prop);
    if (!d || !d.get) return;
    Object.defineProperty(XMLHttpRequest.prototype, prop, {
      configurable: true, enumerable: d.enumerable,
      get: function () {
        var v = d.get.call(this);
        try {
          if (on() && typeof v === 'string' && this.__sdUrl && URL_RE.test(this.__sdUrl) && /adPlacements|playerAds|adSlots/.test(v)) {
            var o = _parse(v); prune(o); return JSON.stringify(o);
          }
        } catch (e) {}
        return v;
      }
    });
  });

  // 5) Residui: nascondi i blocchi pubblicitari, salta gli annunci del player,
  //    rimuovi il messaggio "i blocchi pubblicità violano i termini".
  var css = [
    '#masthead-ad','#player-ads','#offer-module','#sticker-layer','#promotion-shelf',
    '.ytp-ad-module','.ytp-ad-overlay-container','.ytp-ad-image-overlay','.ytp-suggested-action-badge',
    'ytd-ad-slot-renderer','ytd-in-feed-ad-layout-renderer','ytd-banner-promo-renderer','ytd-statement-banner-renderer',
    'ytd-display-ad-renderer','ytd-promoted-sparkles-web-renderer','ytd-promoted-video-renderer','ytd-companion-slot-renderer',
    'ytd-action-companion-ad-renderer','ytd-player-legacy-desktop-watch-ads-renderer','ytd-search-pyv-renderer',
    'ytd-merch-shelf-renderer','.yt-badge-shape--ad','ad-badge-view-model',
    'ytd-rich-item-renderer:has(ytd-ad-slot-renderer)','ytd-rich-section-renderer:has(ytd-statement-banner-renderer)',
    '#shorts-inner-container > .ytd-shorts:has(ytd-ad-slot-renderer)',
    'ytm-promoted-sparkles-web-renderer','ytmusic-mealbar-promo-renderer'
  ].join(',') + '{display:none!important}';
  function addStyle() {
    if (document.getElementById('__sdAdStyle')) return;
    var host = document.head || document.documentElement;
    if (!host) return;
    var st = document.createElement('style'); st.id = '__sdAdStyle'; st.textContent = css;
    host.appendChild(st);
  }
  try { addStyle(); } catch (e) {}
  var _t = setInterval(function () { try { addStyle(); if (document.getElementById('__sdAdStyle')) clearInterval(_t); } catch (e) {} }, 100);
  document.addEventListener('DOMContentLoaded', addStyle);

  var mutedBefore = null;
  setInterval(function () {
    if (!on()) return;
    try {
      var pl = document.getElementById('movie_player');
      var v = document.querySelector('video.html5-main-video') || document.querySelector('video');
      if (pl && pl.classList.contains('ad-showing')) {
        var b = document.querySelector('.ytp-skip-ad-button,.ytp-ad-skip-button,.ytp-ad-skip-button-modern,.ytp-ad-skip-button-container button');
        if (b) b.click();
        if (v) {
          if (mutedBefore === null) mutedBefore = v.muted;
          v.muted = true; v.playbackRate = 16;
          if (isFinite(v.duration) && v.duration > 0 && v.currentTime < v.duration - 0.1) v.currentTime = v.duration - 0.05;
        }
      } else if (mutedBefore !== null) {
        if (v) { v.muted = mutedBefore; v.playbackRate = 1; }
        mutedBefore = null;
      }
      // Messaggio anti-adblock: rimuovilo e riprendi la riproduzione
      var enf = document.querySelector('ytd-enforcement-message-view-model, tp-yt-paper-dialog:has(#dismiss-button.ytd-enforcement-message-view-model)');
      if (enf) {
        enf.remove();
        var bd = document.querySelector('tp-yt-iron-overlay-backdrop'); if (bd) bd.remove();
        document.body && (document.body.style.overflow = '');
        if (v && v.paused) v.play();
      }
    } catch (e) {}
  }, 250);
})();`;
  try { webFrame.executeJavaScript(SCRIPT); } catch (e) {}
}
