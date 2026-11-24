'use strict';
'require baseclass';
'require view.mtk_wed.ds-tokens as tokens';

/*
 * SPDX-License-Identifier: Apache-2.0
 *
 * V2 Spatial Hardware Studio UI component kit for luci-app-mtk-wed.
 *
 * Architecture & safety guarantees:
 * - 100% TEXT-FREE: zero hardcoded natural-language labels; callers pass all
 *   localized copy via options so status.js owns every gettext msgid.
 * - Text-safe DOM & SVG: E() forces primitive children to text nodes and
 *   svgEl() builds inline SVG via createElementNS — zero innerHTML anywhere.
 * - Strict-CSP safe: styles live in external static `mtk-wed.css` loaded via
 *   `<link id="mtkw-ds-css" rel="stylesheet">` (zero `<style>` injection and
 *   zero inline `style` attributes).
 * - Bulletproof LuCI theme isolation: every rule is scoped under `.mtkw-page`
 *   (including `.mtkw-drawer-layer` mounted inside `.mtkw-page`), zero global
 *   body/width rules, no modern parent-combinator selectors, and never relies on
 *   host legacy background-color custom properties.
 * - Runtime dark-mode detection supports Argon Dark (#1e1e1e without
 *   data-darkmode), Bootstrap Dark, Aurora Dark, Glass Dark, and OS scheme.
 */

/* LuCI's window.E() parses a plain string child as HTML. Wrap any primitive
 * argument in a single-element array so LuCI inserts text nodes only. */
var E = (function(create) {
	function text(c) {
		return (c !== null && c !== undefined && typeof c !== 'object' && typeof c !== 'function') ? [ String(c) ] : c;
	}
	return function(tag, attrs, children) {
		return create(tag, text(attrs), text(children));
	};
})(window.E);

var SVG_NS = 'http://www.w3.org/2000/svg';
var STYLE_ID = 'mtkw-ds-css';
var svgUid = 0;

function nextSvgId(prefix) {
	return (prefix || 'mtkw-svg') + '-' + (++svgUid);
}

/* Text-safe inline SVG builder */
function appendSvgKids(parent, kids) {
	if (kids === null || kids === undefined || kids === false) return;
	if (Array.isArray(kids)) {
		for (var i = 0; i < kids.length; i++) appendSvgKids(parent, kids[i]);
	} else if (kids instanceof Node) {
		parent.appendChild(kids);
	} else {
		parent.appendChild(document.createTextNode(String(kids)));
	}
}

function svgEl(tag, attrs, children) {
	var node = document.createElementNS(SVG_NS, tag);
	if (attrs) {
		for (var k in attrs) {
			if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
			var v = attrs[k];
			if (v === null || v === undefined || v === false) continue;
			if (k === 'className' || k === 'class') {
				node.setAttribute('class', String(v));
			} else if (k === 'style' && typeof v === 'object') {
				for (var sk in v) {
					if (Object.prototype.hasOwnProperty.call(v, sk)) node.style[sk] = v[sk];
				}
			} else if (k.indexOf('on') === 0 && typeof v === 'function') {
				node.addEventListener(k.slice(2).toLowerCase(), v);
			} else {
				node.setAttribute(k, String(v));
			}
		}
	}
	appendSvgKids(node, children);
	return node;
}

function appendDomKids(parent, kids) {
	if (kids === null || kids === undefined || kids === false) return;
	if (Array.isArray(kids)) {
		for (var i = 0; i < kids.length; i++) appendDomKids(parent, kids[i]);
	} else if (kids instanceof Node) {
		parent.appendChild(kids);
	} else {
		parent.appendChild(document.createTextNode(String(kids)));
	}
}

function clearNode(node) {
	while (node && node.firstChild) node.removeChild(node.firstChild);
}

/* Band metadata shared by gauges, topology and Wi-Fi cards */
var BANDS = [
	{ name: '2.4G', full: '2.4 GHz', tone: 'b24', varName: '--mtkw-band-24', tintVar: '--mtkw-band-24-tint', maxMbps: 688 },
	{ name: '5G',   full: '5 GHz',   tone: 'b5',  varName: '--mtkw-band-5',  tintVar: '--mtkw-band-5-tint',  maxMbps: 5765 },
	{ name: '6G',   full: '6 GHz',   tone: 'b6',  varName: '--mtkw-band-6',  tintVar: '--mtkw-band-6-tint',  maxMbps: 11529 }
];

/* Unified 20x20 smooth rounded-stroke SVG icon set (1.75px) */
var ICONS = {
	router: [ 'M2.5 11.5h15a1.5 1.5 0 0 1 1.5 1.5v2.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 1 15.5V13a1.5 1.5 0 0 1 1.5-1.5z', 'M5.5 14.2h.01 M8.5 14.2h.01 M12 14.2h3', 'M6 11.5V6.5 M14 11.5V6.5', 'M3.8 5a3 3 0 0 1 4.4 0 M11.8 5a3 3 0 0 1 4.4 0' ],
	sfp: [ 'M2.5 5.5h15a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 1 13V7a1.5 1.5 0 0 1 1.5-1.5z', 'M6.5 10a1.6 1.6 0 1 0 0 .01 M13.5 10a1.6 1.6 0 1 0 0 .01', 'M7 14.5v2h6v-2' ],
	rj45: [ 'M6.5 3h7v2h3a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 16.5 17h-13A1.5 1.5 0 0 1 2 15.5v-9A1.5 1.5 0 0 1 3.5 5h3z', 'M6.2 13v2.5 M8.7 13v2.5 M11.3 13v2.5 M13.8 13v2.5' ],
	port: [ 'M3.5 4.5h13a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 2 14V6a1.5 1.5 0 0 1 1.5-1.5z', 'M6 9.5h8', 'M7 12.5h6' ],
	gmac: [ 'M5.5 5.5h9a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 13V7a1.5 1.5 0 0 1 1.5-1.5z', 'M8 8.5h4v3H8z', 'M7.5 2.5v3 M12.5 2.5v3 M7.5 14.5v3 M12.5 14.5v3 M2 8h2 M2 12h2 M16 8h2 M16 12h2' ],
	ppe: [ 'M10 2.2l6.5 3.8v8L10 17.8 3.5 14V6z', 'M7.2 7.8L10 10l-2.8 2.2 M10.8 7.8L13.6 10l-2.8 2.2' ],
	wed: [ 'M3 5.5h6.5a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5H3A1.5 1.5 0 0 1 1.5 13V7A1.5 1.5 0 0 1 3 5.5z', 'M5 8.8h2.5v2.4H5z', 'M13.2 7.5a3.5 3.5 0 0 1 0 5', 'M15.8 5.2a6.8 6.8 0 0 1 0 9.6' ],
	cpu: [ 'M5.5 4.5h9a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 14V6a1.5 1.5 0 0 1 1.5-1.5z', 'M6.8 10h1.6l1-2.5 1.4 5 1-2.5h1.5', 'M7.5 2v2.5 M12.5 2v2.5 M7.5 15.5V18 M12.5 15.5V18 M2 8h2 M2 12h2 M16 8h2 M16 12h2' ],
	wifi: [ 'M2.8 7.8a10.2 10.2 0 0 1 14.4 0', 'M5.6 10.8a6.2 6.2 0 0 1 8.8 0', 'M8.2 13.6a2.5 2.5 0 0 1 3.6 0' ],
	layers: [ 'M10 3l7.5 4-7.5 4-7.5-4z', 'M2.5 10.8L10 14.8l7.5-4', 'M2.5 14.2L10 18.2l7.5-4' ],
	pause: [ 'M7 4.5v11 M13 4.5v11' ],
	play: [ 'M6.5 4.5l9 5.5-9 5.5z' ],
	refresh: [ 'M16.8 10a6.8 6.8 0 1 1-1.7-4.4 M16.8 3.2v3.2h-3.2' ],
	alert: [ 'M10 2.8L17.6 16H2.4L10 2.8z M10 7.8v3.8 M10 13.8h.01' ],
	check: [ 'M4.2 10.4l3.8 3.8 7.8-8.2' ],
	lock: [ 'M6 9V6.8a4 4 0 0 1 8 0V9 M4.5 9h11a1.5 1.5 0 0 1 1.5 1.5v5.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 16v-5.5A1.5 1.5 0 0 1 4.5 9z' ],
	search: [ 'M8.8 14.4a5.6 5.6 0 1 1 0-11.2 5.6 5.6 0 0 1 0 11.2z M13 13l4.2 4.2' ],
	snowflake: [ 'M10 2.5v15 M3.5 6.2l13 7.6 M16.5 6.2l-13 7.6 M8.2 4l1.8 1.8L11.8 4 M8.2 16l1.8-1.8 1.8 1.8' ],
	copy: [ 'M7 7h9.5v9.5H7z M3.5 13V3.5H13' ],
	close: [ 'M5 5l10 10 M15 5L5 15' ],
	'arrow-right': [ 'M3.5 10h13 M11.5 5l5 5-5 5' ],
	'chevron-down': [ 'M5 7.5l5 5 5-5' ],
	bolt: [ 'M11 2L4.2 11.2H10L9 18l6.8-9.2H10L11 2z' ],
	inspect: [ 'M3 3.8h14a1.2 1.2 0 0 1 1.2 1.2v10a1.2 1.2 0 0 1-1.2 1.2H3A1.2 1.2 0 0 1 1.8 15V5A1.2 1.2 0 0 1 3 3.8z M12.2 3.8v12.4 M5.5 8h3.8 M5.5 12h3.8' ]
};

/* ── Pure Formatting & Escaping Utilities ────────────────────────────────── */

function esc(s) {
	return String(s == null ? '' : s).replace(/[&<>"]/g, function(c) {
		return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
	});
}

function nf(n) {
	return (n === undefined || n === null || isNaN(n)) ? '—' : Number(n).toLocaleString('en-US');
}

function fmtK(n) {
	n = Number(n) || 0;
	if (n >= 999950000) return (n / 1e9).toFixed(2) + 'G';
	if (n >= 999950) return (n / 1e6).toFixed(1) + 'M';
	if (n >= 999.5) return (n / 1e3).toFixed(1) + 'K';
	return String(Math.round(n));
}

function fmtBytes(v) {
	if (typeof v !== 'number' || !isFinite(v)) return '—';
	var u = [ 'B', 'KiB', 'MiB', 'GiB', 'TiB' ], i = 0;
	while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
	return (i ? v.toFixed(2) : v.toFixed(0)) + ' ' + u[i];
}

function fmtFreq(khz) {
	return (!khz) ? '—' : Math.round(khz / 1000) + ' MHz';
}

function fmtMbps(v) {
	v = Number(v) || 0;
	return v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2);
}

function fmtPct(v, d) {
	return (Number(v) || 0).toFixed(d === undefined ? 1 : d) + '%';
}

function clampPct(v) {
	v = Number(v) || 0;
	return Math.max(0, Math.min(100, v));
}

function hasWifiRadio(o) {
	o = o || {};
	if (typeof o.has_wifi === 'boolean') return o.has_wifi;
	if (Array.isArray(o.bands) && o.bands.length > 0) return true;
	if (o.available === false) return false;
	return true;
}

function bandColor(band) {
	var info = BANDS[band];
	return info ? 'var(' + info.varName + ')' : 'var(--mtkw-text-muted)';
}

function toneGradient(tone) {
	if (tone === 'err' || tone === 'error') return [ 'var(--mtkw-err-start)', 'var(--mtkw-err-end)' ];
	if (tone === 'warn') return [ 'var(--mtkw-warn-start)', 'var(--mtkw-warn-end)' ];
	if (tone === 'wed' || tone === 'ok') return [ 'var(--mtkw-wed-start)', 'var(--mtkw-wed-end)' ];
	if (tone === 'b24') return [ 'var(--mtkw-band-24)', 'var(--mtkw-warn-end)' ];
	if (tone === 'b5') return [ 'var(--mtkw-band-5)', 'var(--mtkw-primary)' ];
	if (tone === 'b6') return [ 'var(--mtkw-band-6)', 'var(--mtkw-primary)' ];
	return [ 'var(--mtkw-ppe-start)', 'var(--mtkw-primary)' ];
}

function toneColor(tone) {
	if (tone === 'err' || tone === 'error') return 'var(--mtkw-err)';
	if (tone === 'warn') return 'var(--mtkw-warn)';
	if (tone === 'wed' || tone === 'ok') return 'var(--mtkw-wed)';
	if (tone === 'primary') return 'var(--mtkw-primary)';
	if (tone === '5g') return 'var(--mtkw-spd-5g)';
	if (tone === '10m') return 'var(--mtkw-spd-10m)';
	if (tone === 'b24' || tone === 0) return 'var(--mtkw-band-24)';
	if (tone === 'b5' || tone === 1) return 'var(--mtkw-band-5)';
	if (tone === 'b6' || tone === 2) return 'var(--mtkw-band-6)';
	return 'var(--mtkw-ppe)';
}

function varToTone(s) {
	if (!s) return '';
	s = String(s);
	if (s.indexOf('--mtkw-ppe') >= 0) return 'ppe';
	if (s.indexOf('--mtkw-wed') >= 0) return 'wed';
	if (s.indexOf('--mtkw-primary') >= 0) return 'primary';
	if (s.indexOf('--mtkw-spd-5g') >= 0) return '5g';
	if (s.indexOf('--mtkw-spd-10m') >= 0) return '10m';
	if (s.indexOf('--mtkw-warn') >= 0) return 'warn';
	if (s.indexOf('--mtkw-err') >= 0) return 'err';
	if (s.indexOf('--mtkw-band-24') >= 0) return 'b24';
	if (s.indexOf('--mtkw-band-5') >= 0) return 'b5';
	if (s.indexOf('--mtkw-band-6') >= 0) return 'b6';
	if (s.indexOf('--mtkw-text-muted') >= 0 || s.indexOf('--mtkw-surface') >= 0) return 'muted';
	return '';
}

function barFill(cls, pct) {
	var el = E('div', { 'class': cls });
	el.style.width = clampPct(pct).toFixed(1) + '%';
	return el;
}

function isPortUp(port) {
	if (!port) return false;
	if (port.carrier !== undefined && port.carrier !== null) {
		return port.carrier === 1 || port.carrier === true;
	}
	return port.up === true;
}

function resolvePortMedia(port, opts) {
	opts = opts || {};
	port = port || {};
	var raw = opts.media || port.media;
	if (raw === 'sfp' || raw === 'rj45') return raw;
	if (opts.isSfp === true || port.isSfp === true) return 'sfp';
	if (opts.isSfp === false || port.isSfp === false) return 'rj45';
	if (port.kind === 'gsw') return 'rj45';
	return 'unknown';
}

function portSpeedTone(port) {
	port = port || {};
	var faults = (port.rx_errors || 0) + (port.tx_errors || 0) + (port.rx_dropped || 0) + (port.tx_dropped || 0);
	if (faults > 0) {
		return { code: 'err', tone: 'err', color: 'var(--mtkw-err)', tint: 'var(--mtkw-err-tint)', faults: faults };
	}
	if (!isPortUp(port)) {
		return { code: 'down', tone: '', color: 'var(--mtkw-text-muted)', tint: 'var(--mtkw-surface-2)', faults: 0 };
	}
	var mbps = Number(port.speed_mbps);
	if (!isFinite(mbps) || mbps <= 0) {
		return { code: 'up', tone: 'ok', color: 'var(--mtkw-wed)', tint: 'var(--mtkw-wed-tint)', faults: 0 };
	}
	if (mbps >= 10000) return { code: '10g', tone: 'wed', color: 'var(--mtkw-wed)', tint: 'var(--mtkw-wed-tint)', faults: 0 };
	if (mbps >= 5000) return { code: '5g', tone: '5g', color: 'var(--mtkw-spd-5g)', tint: 'var(--mtkw-spd-5g-tint)', faults: 0 };
	if (mbps >= 2500) return { code: '2.5g', tone: 'primary', color: 'var(--mtkw-primary)', tint: 'var(--mtkw-primary-tint)', faults: 0 };
	if (mbps >= 1000) return { code: '1g', tone: 'warn', color: 'var(--mtkw-warn)', tint: 'var(--mtkw-warn-tint)', faults: 0 };
	if (mbps >= 100) return { code: '100m', tone: 'warn', color: 'var(--mtkw-warn)', tint: 'var(--mtkw-warn-tint)', faults: 0 };
	return { code: '10m', tone: '10m', color: 'var(--mtkw-spd-10m)', tint: 'var(--mtkw-spd-10m-tint)', faults: 0 };
}

/* ── Dark-Mode Probe & Stylesheet Injection ──────────────────────────────── */

function isDarkMode() {
	var root = document.documentElement;
	var body = document.body;

	var rootDark = root ? String(root.getAttribute('data-darkmode') || '').toLowerCase() : '';
	if (rootDark === 'true') return true;
	if (rootDark === 'false') return false;

	var rootTheme = root ? String(root.getAttribute('data-theme') || '').toLowerCase() : '';
	if (rootTheme === 'dark') return true;
	if (rootTheme === 'light') return false;

	if (body) {
		var bodyDark = String(body.getAttribute('data-darkmode') || '').toLowerCase();
		if (bodyDark === 'true') return true;
		if (bodyDark === 'false') return false;
		var bodyTheme = String(body.getAttribute('data-theme') || '').toLowerCase();
		if (bodyTheme === 'dark') return true;
		if (bodyTheme === 'light') return false;
		if (body.classList && (body.classList.contains('dark') || body.classList.contains('darkmode'))) return true;
	}

	var els = [
		body, root,
		document.querySelector('.main-right'),
		document.querySelector('.container'),
		document.querySelector('.main-content'),
		document.querySelector('#maincontent'),
		document.querySelector('.cbi-map'),
		document.querySelector('.main-left')
	];
	for (var i = 0; i < els.length; i++) {
		if (!els[i]) continue;
		var bg = window.getComputedStyle(els[i]).backgroundColor;
		var m = bg && bg.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,\/]+([\d.]+))?/i);
		if (m) {
			var a = m[4] === undefined ? 1 : parseFloat(m[4]);
			if (a < 0.1) continue;
			var lum = (parseFloat(m[1]) * 299 + parseFloat(m[2]) * 587 + parseFloat(m[3]) * 114) / 1000;
			return lum < 128;
		}
	}

	var sheets = document.querySelectorAll('link[rel~="stylesheet"][href], style[id]');
	for (var j = 0; j < sheets.length; j++) {
		var sheet = sheets[j];
		if (sheet.id === STYLE_ID) continue;
		var marker = String(sheet.getAttribute('href') || sheet.getAttribute('id') || '').toLowerCase();
		if (marker.indexOf('dark') < 0) continue;
		if (sheet.disabled || (sheet.sheet && sheet.sheet.disabled)) continue;
		var media = String(sheet.getAttribute('media') ||
			(sheet.sheet && sheet.sheet.media ? sheet.sheet.media.mediaText : '') || '').trim();
		if (!media || media.toLowerCase() === 'all') return true;
		try {
			if (window.matchMedia && window.matchMedia(media).matches) return true;
		} catch (e) {}
	}

	try {
		if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) return true;
	} catch (e) {}
	return false;
}

function stylesheetHref() {
	var rel = (tokens && tokens.cssPath) ? tokens.cssPath : 'view/mtk_wed/mtk-wed.css';
	if (typeof L !== 'undefined' && L && typeof L.resource === 'function') {
		return L.resource(rel);
	}
	return '/luci-static/resources/' + rel;
}

function applyDarkClass(dark) {
	var root = document.documentElement;
	if (root) {
		if (dark) {
			if (root.getAttribute('data-mtkw-dark') !== '1') root.setAttribute('data-mtkw-dark', '1');
		} else {
			if (root.getAttribute('data-mtkw-dark') !== null) root.removeAttribute('data-mtkw-dark');
		}
	}
	if (document.querySelectorAll) {
		var pages = document.querySelectorAll('.mtkw-page');
		for (var i = 0; i < pages.length; i++) {
			if (dark) pages[i].classList.add('mtkw-dark');
			else pages[i].classList.remove('mtkw-dark');
		}
	}
}

var mqBound = false;
var themeObserver = null;
var obsRootBound = false;
var obsBodyBound = false;
var obsHeadBound = false;

function syncTheme() {
	var node = document.getElementById(STYLE_ID);
	var dark = isDarkMode();
	var changed = false;
	if (node && node.getAttribute('data-dark') !== String(dark)) {
		node.setAttribute('data-dark', String(dark));
		changed = true;
	}
	applyDarkClass(dark);
	return changed;
}

function bindThemeWatchers() {
	if (!mqBound) {
		mqBound = true;
		try {
			var mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
			if (mq && mq.addEventListener) {
				mq.addEventListener('change', syncTheme);
			}
		} catch (e) {}
	}
	try {
		if (typeof MutationObserver === 'function') {
			if (!themeObserver) {
				themeObserver = new MutationObserver(function(records) {
					for (var i = 0; i < records.length; i++) {
						var r = records[i];
						if (r.target && r.target.id === STYLE_ID) continue;
						syncTheme();
						return;
					}
				});
			}
			var attrOpts = {
				attributes: true,
				attributeFilter: [ 'class', 'style', 'data-darkmode', 'data-theme' ]
			};
			if (!obsRootBound && document.documentElement) {
				themeObserver.observe(document.documentElement, attrOpts);
				obsRootBound = true;
			}
			if (!obsBodyBound && document.body) {
				themeObserver.observe(document.body, attrOpts);
				obsBodyBound = true;
			}
			if (!obsHeadBound && document.head) {
				themeObserver.observe(document.head, { childList: true });
				obsHeadBound = true;
			}
		}
	} catch (e) {}
}

function ensureCss() {
	var dark = isDarkMode();
	var el = document.getElementById(STYLE_ID);
	if (!el) {
		el = document.createElement('link');
		el.id = STYLE_ID;
		el.rel = 'stylesheet';
		el.href = stylesheetHref();
		el.setAttribute('data-dark', String(dark));
		if (document.head) document.head.appendChild(el);
	} else if (el.getAttribute('data-dark') !== String(dark)) {
		el.setAttribute('data-dark', String(dark));
	}
	applyDarkClass(dark);
	bindThemeWatchers();
	return el;
}

/* ── SVG Icon & Signal Glyphs ────────────────────────────────────────────── */

function icon(name, size) {
	var s = size || 16;
	var list = ICONS[name] || ICONS.bolt;
	var kids = list.map(function(d) { return svgEl('path', { d: d }); });
	if (name === 'wifi') {
		kids.push(svgEl('circle', { cx: '10', cy: '16.2', r: '1.15', fill: 'currentColor', stroke: 'none' }));
	}
	return svgEl('svg', {
		width: s, height: s, viewBox: '0 0 20 20',
		fill: 'none', stroke: 'currentColor',
		'stroke-width': '1.75', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
		'aria-hidden': 'true'
	}, kids);
}

function svgIconBadge(name, cx, cy, tintFill, strokeCol) {
	var list = ICONS[name] || ICONS.gmac;
	var kids = list.map(function(d) { return svgEl('path', { d: d }); });
	if (name === 'wifi') {
		kids.push(svgEl('circle', { cx: '10', cy: '16.2', r: '1.15', fill: strokeCol, stroke: 'none' }));
	}
	return svgEl('g', null, [
		svgEl('rect', { x: cx - 10, y: cy - 10, width: 20, height: 20, rx: 6, fill: tintFill }),
		svgEl('g', {
			transform: 'translate(' + (cx - 6.5) + ',' + (cy - 6.5) + ') scale(0.65)',
			fill: 'none', stroke: strokeCol, 'stroke-width': '2',
			'stroke-linecap': 'round', 'stroke-linejoin': 'round'
		}, kids)
	]);
}

function isValidDbm(v) {
	return typeof v === 'number' && isFinite(v) && v < 0;
}

function signalBarsSvg(dbm) {
	var valid = isValidDbm(dbm);
	var level = !valid ? 0 : dbm >= -55 ? 4 : dbm >= -65 ? 3 : dbm >= -75 ? 2 : 1;
	var bars = [];
	for (var i = 0; i < 4; i++) {
		var h = 4 + i * 3;
		var active = valid && i < level;
		bars.push(svgEl('rect', {
			x: i * 4, y: 13 - h, width: 2.6, height: h, rx: 1,
			'data-active': active ? 'true' : 'false',
			fill: active ? 'currentColor' : 'var(--mtkw-border-strong)',
			opacity: active ? '1' : '0.35'
		}));
	}
	return svgEl('svg', { width: 16, height: 13, viewBox: '0 0 16 13', 'data-level': String(level), 'aria-hidden': 'true' }, bars);
}

/* ── Reusable UI Primitives (100% Text-Free) ─────────────────────────────── */

function pill(text, tone, opts) {
	opts = opts || {};
	var isBtn = typeof opts.onClick === 'function';
	var cls = 'mtkw-pill' + (opts.mono ? ' mtkw-mono' : '') + (isBtn ? ' mtkw-pill-btn' : '') + (opts.className ? ' ' + opts.className : '');
	var attrs = { 'class': cls };
	if (tone) attrs['data-tone'] = tone;
	if (opts.id) attrs.id = opts.id;
	if (opts.title) attrs.title = opts.title;
	if (opts.ariaLabel) attrs['aria-label'] = opts.ariaLabel;
	if (opts.ariaExpanded !== undefined) attrs['aria-expanded'] = String(!!opts.ariaExpanded);
	if (isBtn) attrs.type = 'button';

	var kids = [];
	if (opts.dot) {
		var dAttrs = { 'class': 'mtkw-dot' + (opts.live ? ' is-live' : '') };
		if (tone) dAttrs['data-tone'] = tone;
		kids.push(E('span', dAttrs));
	}
	if (opts.icon) kids.push(icon(opts.icon, opts.iconSize || 12));
	if (text !== null && text !== undefined && text !== '') kids.push(String(text));

	var node = E(isBtn ? 'button' : 'span', attrs, kids);
	if (isBtn) node.addEventListener('click', opts.onClick);
	return node;
}

function badge(text, tone, opts) {
	var merged = Object.assign({ mono: true }, opts || {});
	return pill(text, tone, merged);
}

function toggleSwitch(opts) {
	opts = opts || {};
	var checked = !!opts.checked;
	var attrs = {
		'type': 'button',
		'role': 'switch',
		'class': 'mtkw-switch' + (opts.className ? ' ' + opts.className : ''),
		'aria-checked': String(checked),
		'data-busy': String(!!opts.busy)
	};
	if (opts.id) attrs.id = opts.id;
	if (opts.tone) attrs['data-tone'] = opts.tone;
	if (opts.ariaLabel) attrs['aria-label'] = opts.ariaLabel;
	if (opts.title) attrs.title = opts.title;
	if (opts.disabled || opts.busy) attrs.disabled = '';

	var btn = E('button', attrs);
	btn.disabled = !!(opts.disabled || opts.busy);
	if (typeof opts.onChange === 'function') {
		btn.addEventListener('click', function() {
			if (btn.disabled) return;
			opts.onChange(!checked, btn);
		});
	}
	return btn;
}

/* ── Smooth-Gradient 240° Arc Gauge & CPU Dual-Ring Gauge ────────────────── */

function polar(cx, cy, r, deg) {
	var rad = (deg * Math.PI) / 180;
	return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx, cy, r, startDeg, endDeg) {
	var p1 = polar(cx, cy, r, startDeg);
	var p2 = polar(cx, cy, r, endDeg);
	var large = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
	return 'M' + p1.x.toFixed(2) + ',' + p1.y.toFixed(2) + ' A' + r + ',' + r + ' 0 ' + large + ' 1 ' + p2.x.toFixed(2) + ',' + p2.y.toFixed(2);
}

function arcGauge(opts) {
	opts = opts || {};
	var cx = 92, cy = 76, r = opts.outerR || 68, sw = 10.5;
	var startDeg = 150, sweepDeg = 240;
	var ratio = clampPct(opts.pct) / 100;
	var gradId = opts.gradId || nextSvgId('mtkw-arc');
	var gColors = toneGradient(opts.tone);
	var c1 = opts.c1 || gColors[0];
	var c2 = opts.c2 || gColors[1];

	var defs = [
		svgEl('linearGradient', { id: gradId, x1: '0%', y1: '100%', x2: '100%', y2: '0%' }, [
			svgEl('stop', { offset: '0%', 'stop-color': c1 }),
			svgEl('stop', { offset: '100%', 'stop-color': c2 })
		])
	];

	var kids = [
		svgEl('defs', null, defs),
		svgEl('path', {
			d: arcPath(cx, cy, r, startDeg, startDeg + sweepDeg),
			fill: 'none', stroke: 'var(--mtkw-track)', 'stroke-width': sw, 'stroke-linecap': 'round'
		})
	];

	if (ratio > 0.006) {
		kids.push(svgEl('path', {
			className: 'mtkw-arc-glow',
			d: arcPath(cx, cy, r, startDeg, startDeg + sweepDeg * ratio),
			fill: 'none', stroke: 'url(#' + gradId + ')', 'stroke-width': sw, 'stroke-linecap': 'round'
		}));
	}

	kids.push(
		svgEl('text', {
			x: cx, y: 74, 'text-anchor': 'middle',
			fill: opts.valueColor || 'var(--mtkw-text)',
			'font-family': 'var(--mtkw-font-mono)', 'font-size': '22', 'font-weight': '750'
		}, opts.valueText !== undefined ? String(opts.valueText) : ''),
		svgEl('text', {
			x: cx, y: 92, 'text-anchor': 'middle',
			fill: 'var(--mtkw-text-muted)',
			'font-family': 'var(--mtkw-font-sans)', 'font-size': '10.8', 'font-weight': '600'
		}, opts.subText !== undefined ? String(opts.subText) : '')
	);

	return svgEl('svg', {
		className: 'mtkw-gauge-svg',
		viewBox: '0 0 184 126',
		role: 'img',
		'aria-label': opts.ariaLabel || ''
	}, kids);
}

function dualRingGauge(opts) {
	opts = opts || {};
	var cx = 92, cy = 76, rOut = 69, swOut = 10.5, rIn = 54, swIn = 4.5;
	var startDeg = 150, sweepDeg = 240;
	var outRatio = clampPct(opts.tempPct) / 100;
	var inRatio = clampPct(opts.freqPct) / 100;
	var baseId = opts.gradId || nextSvgId('mtkw-dual');
	var outGrad = baseId + '-out';
	var inGrad = baseId + '-in';
	var gColors = toneGradient(opts.tempTone || 'wed');
	var valCol = opts.valueColor || ((opts.tempTone === 'err' || opts.tempTone === 'error') ? 'var(--mtkw-err)' : 'var(--mtkw-text)');

	var kids = [
		svgEl('defs', null, [
			svgEl('linearGradient', { id: outGrad, x1: '0%', y1: '100%', x2: '100%', y2: '0%' }, [
				svgEl('stop', { offset: '0%', 'stop-color': gColors[0] }),
				svgEl('stop', { offset: '100%', 'stop-color': gColors[1] })
			]),
			svgEl('linearGradient', { id: inGrad, x1: '0%', y1: '100%', x2: '100%', y2: '0%' }, [
				svgEl('stop', { offset: '0%', 'stop-color': 'var(--mtkw-ppe-start)' }),
				svgEl('stop', { offset: '100%', 'stop-color': 'var(--mtkw-primary)' })
			])
		]),
		svgEl('path', {
			d: arcPath(cx, cy, rOut, startDeg, startDeg + sweepDeg),
			fill: 'none', stroke: 'var(--mtkw-track)', 'stroke-width': swOut, 'stroke-linecap': 'round'
		})
	];

	if (outRatio > 0.006) {
		kids.push(svgEl('path', {
			className: 'mtkw-arc-glow',
			d: arcPath(cx, cy, rOut, startDeg, startDeg + sweepDeg * outRatio),
			fill: 'none', stroke: 'url(#' + outGrad + ')', 'stroke-width': swOut, 'stroke-linecap': 'round'
		}));
	}

	kids.push(svgEl('path', {
		d: arcPath(cx, cy, rIn, startDeg, startDeg + sweepDeg),
		fill: 'none', stroke: 'var(--mtkw-track)', 'stroke-width': swIn, 'stroke-linecap': 'round'
	}));

	if (inRatio > 0.006) {
		kids.push(svgEl('path', {
			d: arcPath(cx, cy, rIn, startDeg, startDeg + sweepDeg * inRatio),
			fill: 'none', stroke: 'url(#' + inGrad + ')', 'stroke-width': swIn, 'stroke-linecap': 'round'
		}));
	}

	kids.push(
		svgEl('text', {
			x: cx, y: 74, 'text-anchor': 'middle',
			fill: valCol,
			'font-family': 'var(--mtkw-font-mono)', 'font-size': '20', 'font-weight': '750'
		}, opts.tempText !== undefined ? String(opts.tempText) : ''),
		svgEl('text', {
			x: cx, y: 92, 'text-anchor': 'middle',
			fill: 'var(--mtkw-text-muted)',
			'font-family': 'var(--mtkw-font-sans)', 'font-size': '10.8', 'font-weight': '600'
		}, opts.freqText !== undefined ? String(opts.freqText) : '')
	);

	return svgEl('svg', {
		className: 'mtkw-gauge-svg',
		viewBox: '0 0 184 126',
		role: 'img',
		'aria-label': opts.ariaLabel || ''
	}, kids);
}

function sparklineSvg(values, maxVal, opts) {
	opts = opts || {};
	var arr = Array.isArray(values) ? values.slice(-24) : [];
	var w = opts.width || 110;
	var h = opts.height || 26;
	var minV = opts.minVal !== undefined ? Number(opts.minVal) : 0;
	var maxV = Math.max(Number(maxVal) || 1, minV + 1);

	if (opts.disabled || arr.length < 2) {
		return svgEl('svg', { width: w, height: h, viewBox: '0 0 120 26', 'aria-hidden': 'true' }, [
			svgEl('line', { x1: 4, y1: 13, x2: 116, y2: 13, stroke: 'var(--mtkw-border-strong)', 'stroke-dasharray': '3 3' })
		]);
	}

	var gradId = opts.gradId || nextSvgId('mtkw-sp');
	var pts = arr.map(function(v, i) {
		var sx = (i / (arr.length - 1)) * 116 + 2;
		var ratio = Math.max(0, Math.min(1, (Number(v) - minV) / (maxV - minV)));
		var sy = 23 - ratio * 19;
		return sx.toFixed(1) + ',' + sy.toFixed(1);
	});

	return svgEl('svg', { width: w, height: h, viewBox: '0 0 120 26', 'aria-hidden': 'true' }, [
		svgEl('defs', null, [
			svgEl('linearGradient', { id: gradId, x1: '0', y1: '0', x2: '0', y2: '1' }, [
				svgEl('stop', { offset: '0%', 'stop-color': 'var(--mtkw-ppe-start)', 'stop-opacity': '0.32' }),
				svgEl('stop', { offset: '100%', 'stop-color': 'var(--mtkw-ppe-start)', 'stop-opacity': '0.02' })
			])
		]),
		svgEl('path', { d: 'M2,25 L' + pts.join(' L') + ' L118,25 Z', fill: 'url(#' + gradId + ')' }),
		svgEl('path', { d: 'M' + pts.join(' L'), fill: 'none', stroke: 'var(--mtkw-primary)', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })
	]);
}

/* ── Physical Port Faceplate Jack SVG (SFP+ / RJ45 / Neutral Unknown) ────── */

function portFaceplateSvg(port, opts) {
	port = port || {};
	opts = opts || {};
	var spd = portSpeedTone(port);
	var media = resolvePortMedia(port, opts);
	var isUp = isPortUp(port);
	var fault = spd.faults > 0;
	var cavFill = isUp ? 'var(--mtkw-cage-inner)' : 'var(--mtkw-cage-down)';
	var ledL = isUp ? spd.color : 'var(--mtkw-border-strong)';
	var ledR = fault ? 'var(--mtkw-err)' : isUp ? 'var(--mtkw-wed)' : 'var(--mtkw-border-strong)';

	if (media === 'sfp') {
		var sfpKids = [
			svgEl('rect', { x: 1, y: 1, width: 74, height: 46, rx: 6, fill: 'var(--mtkw-surface-2)', stroke: 'var(--mtkw-border-mid)', 'stroke-width': '1.2' }),
			svgEl('circle', { cx: 14, cy: 7.5, r: 2.6, fill: ledL }),
			svgEl('circle', { cx: 62, cy: 7.5, r: 2.6, fill: ledR }),
			svgEl('rect', { x: 7, y: 13, width: 62, height: 28, rx: 4, fill: cavFill })
		];
		if (isUp) {
			sfpKids.push(
				svgEl('rect', { x: 12, y: 16.5, width: 22, height: 17, rx: 3, fill: '#223045', stroke: 'rgba(255,255,255,0.12)', 'stroke-width': '1' }),
				svgEl('rect', { x: 42, y: 16.5, width: 22, height: 17, rx: 3, fill: '#223045', stroke: 'rgba(255,255,255,0.12)', 'stroke-width': '1' }),
				svgEl('circle', { cx: 23, cy: 25, r: 4, fill: '#090e17', stroke: spd.color, 'stroke-width': '1.5' }),
				svgEl('circle', { cx: 53, cy: 25, r: 4, fill: '#090e17', stroke: spd.color, 'stroke-width': '1.5' }),
				svgEl('path', { d: 'M20 37.5h36', stroke: '#38bdf8', 'stroke-width': '2', 'stroke-linecap': 'round', opacity: '0.85' })
			);
		} else {
			sfpKids.push(
				svgEl('rect', { x: 13, y: 18, width: 50, height: 18, rx: 3, fill: 'none', stroke: 'rgba(148,163,184,0.38)', 'stroke-width': '1.1', 'stroke-dasharray': '3 2.5' })
			);
			if (opts.openLabel) {
				sfpKids.push(svgEl('text', {
					x: 38, y: 29.5, 'text-anchor': 'middle', fill: '#cbd5e1',
					'font-family': 'var(--mtkw-font-mono)', 'font-size': '7.8', 'font-weight': '700', 'letter-spacing': '0.04em'
				}, String(opts.openLabel)));
			}
		}
		return svgEl('svg', { width: 76, height: 48, viewBox: '0 0 76 48', 'data-media': 'sfp', 'aria-hidden': 'true' }, sfpKids);
	}

	if (media === 'rj45') {
		var pinCol = isUp ? '#eab308' : '#64748b';
		var rjKids = [
			svgEl('rect', { x: 2, y: 1, width: 68, height: 46, rx: 6, fill: 'var(--mtkw-surface-2)', stroke: 'var(--mtkw-border-mid)', 'stroke-width': '1.2' }),
			svgEl('rect', { x: 9, y: 5.5, width: 10, height: 3.6, rx: 1.5, fill: ledL }),
			svgEl('rect', { x: 53, y: 5.5, width: 10, height: 3.6, rx: 1.5, fill: ledR }),
			svgEl('path', { d: 'M12 15h11v-2.8h5V9.5h16v2.7h5V15h11v25H12z', fill: cavFill })
		];
		for (var i = 0; i < 8; i++) {
			rjKids.push(svgEl('rect', { x: 17.5 + i * 4.8, y: 30.5, width: 2.2, height: 8, rx: 0.8, fill: pinCol, opacity: isUp ? '0.95' : '0.45' }));
		}
		return svgEl('svg', { width: 72, height: 48, viewBox: '0 0 72 48', 'data-media': 'rj45', 'aria-hidden': 'true' }, rjKids);
	}

	/* Neutral hardware Ethernet socket when connector media is unknown */
	var genKids = [
		svgEl('rect', { x: 2, y: 1, width: 68, height: 46, rx: 6, fill: 'var(--mtkw-surface-2)', stroke: 'var(--mtkw-border-mid)', 'stroke-width': '1.2' }),
		svgEl('circle', { cx: 13, cy: 7.5, r: 2.4, fill: ledL }),
		svgEl('circle', { cx: 59, cy: 7.5, r: 2.4, fill: ledR }),
		svgEl('rect', { x: 9, y: 13, width: 54, height: 28, rx: 4, fill: cavFill }),
		svgEl('rect', {
			x: 16, y: 19, width: 40, height: 16, rx: 3,
			fill: isUp ? '#223045' : 'none',
			stroke: isUp ? spd.color : 'rgba(148,163,184,0.38)',
			'stroke-width': isUp ? '1.3' : '1.1',
			'stroke-dasharray': isUp ? null : '3 2.5'
		}),
		svgEl('path', {
			d: 'M24 27h24',
			stroke: isUp ? spd.color : '#64748b',
			'stroke-width': '2', 'stroke-linecap': 'round',
			opacity: isUp ? '0.9' : '0.45'
		})
	];
	return svgEl('svg', { width: 72, height: 48, viewBox: '0 0 72 48', 'data-media': 'unknown', 'aria-hidden': 'true' }, genKids);
}

/* ── Spatial 5-Column Interactive Hardware Datapath Topology ─────────────── */

function parseSelectedKey(sel) {
	if (!sel) return null;
	if (typeof sel === 'object' && sel.kind) return { kind: String(sel.kind), id: String(sel.id) };
	var s = String(sel);
	var idx = s.indexOf(':');
	if (idx <= 0) return null;
	return { kind: s.slice(0, idx), id: s.slice(idx + 1) };
}

function computeTopologyRelations(sel, ports, gdmStats, ppeList, wedList, wifiBands) {
	if (!sel) return null;
	var rel = { port: {}, gdm: {}, ppe: {}, wed: {}, wifi: {}, busActive: false };

	var gdmToPpe = {};
	gdmStats.forEach(function(g) { gdmToPpe[String(g.gdm)] = String(g.ppeId); });

	function linkAllAttachedWeds() {
		rel.busActive = true;
		wedList.forEach(function(w) {
			if (!w.attached) return;
			rel.wed[String(w.id)] = true;
			wifiBands.forEach(function(b) {
				var wid = b.wedId !== undefined && b.wedId !== null ? b.wedId : b.band;
				if (String(wid) === String(w.id)) rel.wifi[String(b.band)] = true;
			});
		});
	}

	if (sel.kind === 'port') {
		var p = ports.filter(function(x) { return String(x.netdev) === sel.id; })[0];
		if (p) {
			rel.port[String(p.netdev)] = true;
			if (p.gdm !== null && p.gdm !== undefined) {
				rel.gdm[String(p.gdm)] = true;
				if (gdmToPpe[String(p.gdm)] !== undefined) rel.ppe[gdmToPpe[String(p.gdm)]] = true;
				linkAllAttachedWeds();
			}
		}
	} else if (sel.kind === 'gdm') {
		rel.gdm[sel.id] = true;
		ports.forEach(function(p) { if (String(p.gdm) === sel.id) rel.port[String(p.netdev)] = true; });
		if (gdmToPpe[sel.id] !== undefined) rel.ppe[gdmToPpe[sel.id]] = true;
		rel.busActive = true;
		wedList.forEach(function(w) { if (w.attached) rel.wed[String(w.id)] = true; });
	} else if (sel.kind === 'ppe') {
		rel.ppe[sel.id] = true;
		gdmStats.forEach(function(g) {
			if (String(g.ppeId) === sel.id) {
				rel.gdm[String(g.gdm)] = true;
				ports.forEach(function(p) { if (String(p.gdm) === String(g.gdm)) rel.port[String(p.netdev)] = true; });
			}
		});
		linkAllAttachedWeds();
	} else if (sel.kind === 'wed') {
		rel.wed[sel.id] = true;
		wifiBands.forEach(function(b) {
			var wid = b.wedId !== undefined && b.wedId !== null ? b.wedId : b.band;
			if (String(wid) === sel.id) rel.wifi[String(b.band)] = true;
		});
		rel.busActive = true;
		ppeList.forEach(function(e) { rel.ppe[String(e.id)] = true; });
	} else if (sel.kind === 'wifi') {
		rel.wifi[sel.id] = true;
		var bandObj = wifiBands.filter(function(b) { return String(b.band) === sel.id; })[0];
		var wid = bandObj && bandObj.wedId !== undefined && bandObj.wedId !== null ? String(bandObj.wedId) : sel.id;
		wedList.forEach(function(w) { if (String(w.id) === wid) rel.wed[String(w.id)] = true; });
		rel.busActive = true;
		ppeList.forEach(function(e) { rel.ppe[String(e.id)] = true; });
	}
	return rel;
}

function topologySvg(opts) {
	opts = opts || {};
	var ports = Array.isArray(opts.ports) ? opts.ports : [];
	var gdmStats = Array.isArray(opts.gdmStats) ? opts.gdmStats : [];
	var ppeList = Array.isArray(opts.ppeList) ? opts.ppeList : [];
	var wedList = Array.isArray(opts.wedList) ? opts.wedList : [];
	var wifiBands = Array.isArray(opts.wifiBands) ? opts.wifiBands : [];
	var hwOn = !!opts.hwOffload;
	var labels = opts.labels || {};
	var onSelect = typeof opts.onSelectNode === 'function' ? opts.onSelectNode : function() {};
	var sel = parseSelectedKey(opts.selectedKey);
	var rel = computeTopologyRelations(sel, ports, gdmStats, ppeList, wedList, wifiBands);

	var uid = nextSvgId('mtkw-topo');
	var gradPpeId = uid + '-edge-ppe';
	var gradWedId = uid + '-edge-wed';
	var gradBusId = uid + '-bus';
	var shadowId = uid + '-sh';

	var W = 1260, topY = 36, portH = 40, portGap = 8, nodeH = 74;
	var portAreaH = Math.max(244, ports.length * portH + Math.max(0, ports.length - 1) * portGap);
	var H = topY + portAreaH + 16;

	var cols = {
		port: { x: 14,   w: 206 },
		gdm:  { x: 264,  w: 174 },
		ppe:  { x: 480,  w: 222 },
		bus:  { x: 730,  w: 36  },
		wed:  { x: 794,  w: 180 },
		wifi: { x: 1020, w: 226 }
	};

	function spreadY(count, boxH) {
		if (count <= 0) return [];
		if (count === 1) return [ topY + (portAreaH - boxH) / 2 ];
		var totalBox = count * boxH;
		var avail = portAreaH - totalBox;
		var gap = Math.max(8, avail / (count - 1));
		var start = topY + Math.max(0, (portAreaH - (totalBox + gap * (count - 1))) / 2);
		var ys = [];
		for (var i = 0; i < count; i++) ys.push(start + i * (boxH + gap));
		return ys;
	}

	var portYs = spreadY(ports.length, portH);
	var gdmYs = spreadY(gdmStats.length, nodeH);
	var ppeYs = spreadY(ppeList.length, nodeH);
	var wedYs = spreadY(wedList.length, nodeH);
	var wifiYs = spreadY(Math.max(1, wifiBands.length), nodeH);

	var posPort = {}, posGdm = {}, posPpe = {}, posWed = {}, posWifi = {};
	ports.forEach(function(p, i) { posPort[String(p.netdev)] = { x: cols.port.x, y: portYs[i], w: cols.port.w, h: portH, obj: p }; });
	gdmStats.forEach(function(g, i) { posGdm[String(g.gdm)] = { x: cols.gdm.x, y: gdmYs[i], w: cols.gdm.w, h: nodeH, obj: g }; });
	ppeList.forEach(function(e, i) { posPpe[String(e.id)] = { x: cols.ppe.x, y: ppeYs[i], w: cols.ppe.w, h: nodeH, obj: e }; });
	wedList.forEach(function(w, i) { posWed[String(w.id)] = { x: cols.wed.x, y: wedYs[i], w: cols.wed.w, h: nodeH, obj: w }; });
	wifiBands.forEach(function(b, i) { posWifi[String(b.band)] = { x: cols.wifi.x, y: wifiYs[i], w: cols.wifi.w, h: nodeH, obj: b }; });

	var svgEdges = svgEl('g', null);
	var svgPulses = svgEl('g', null);
	var svgBus = svgEl('g', null);
	var svgNodes = svgEl('g', null);
	var svgDots = svgEl('g', { 'pointer-events': 'none' });

	function bezier(x1, y1, x2, y2) {
		var mx = (x1 + x2) / 2;
		return 'M' + x1 + ',' + y1 + ' C' + mx + ',' + y1 + ' ' + mx + ',' + y2 + ' ' + x2 + ',' + y2;
	}

	function addDot(x, y, col, dim) {
		svgDots.appendChild(svgEl('circle', {
			cx: x, cy: y, r: '3.2', fill: 'var(--mtkw-surface)', stroke: col, 'stroke-width': '1.8', opacity: dim ? '0.25' : '1'
		}));
	}

	function addEdge(d, eOpts) {
		var cls = 'mtkw-topo-edge';
		var strokeAttr = null;
		if (eOpts.bypass) cls += ' is-bypass';
		else if (eOpts.err) cls += ' is-err';
		else if (eOpts.wed) { cls += ' is-active'; strokeAttr = 'url(#' + gradWedId + ')'; }
		else if (eOpts.active) { cls += ' is-active'; strokeAttr = 'url(#' + gradPpeId + ')'; }
		if (rel) cls += eOpts.related ? ' is-hl' : ' is-dim';

		var pAttrs = { d: d, className: cls };
		if (strokeAttr) pAttrs.stroke = strokeAttr;
		svgEdges.appendChild(svgEl('path', pAttrs));

		if (eOpts.pulse && !eOpts.bypass && !eOpts.err) {
			var pCls = 'mtkw-topo-pulse' + (eOpts.wed ? ' is-wed' : '');
			if (rel && !eOpts.related) pCls += ' is-dim';
			svgPulses.appendChild(svgEl('path', { d: d, className: pCls }));
		}
	}

	/* Edges 1: Port -> GDM */
	ports.forEach(function(p) {
		var a = posPort[String(p.netdev)];
		var b = posGdm[String(p.gdm)];
		if (!a || !b) return;
		var isUp = p.carrier === 1;
		var hasErr = (p.faults || 0) > 0;
		var isRel = !!(rel && rel.port[String(p.netdev)] && rel.gdm[String(p.gdm)]);
		var dotCol = hasErr ? 'var(--mtkw-err)' : isUp && hwOn ? 'var(--mtkw-ppe)' : 'var(--mtkw-border-strong)';
		addEdge(bezier(a.x + a.w, a.y + a.h / 2, b.x, b.y + b.h / 2), { active: isUp && hwOn, err: hasErr, bypass: !isUp && !hasErr, pulse: isUp && hwOn, related: isRel });
		addDot(a.x + a.w, a.y + a.h / 2, dotCol, rel && !isRel);
		addDot(b.x, b.y + b.h / 2, dotCol, rel && !isRel);
	});

	/* Edges 2: GDM -> PPE */
	gdmStats.forEach(function(g) {
		var a = posGdm[String(g.gdm)];
		var b = posPpe[String(g.ppeId)];
		if (!a || !b) return;
		var hasErr = (g.errCount || 0) > 0;
		var isRel = !!(rel && rel.gdm[String(g.gdm)] && rel.ppe[String(g.ppeId)]);
		var dotCol = hasErr ? 'var(--mtkw-err)' : hwOn ? 'var(--mtkw-ppe)' : 'var(--mtkw-border-strong)';
		addEdge(bezier(a.x + a.w, a.y + a.h / 2, b.x, b.y + b.h / 2), { active: hwOn, err: hasErr, bypass: !hwOn && !hasErr, pulse: hwOn, related: isRel });
		addDot(a.x + a.w, a.y + a.h / 2, dotCol, rel && !isRel);
		addDot(b.x, b.y + b.h / 2, dotCol, rel && !isRel);
	});

	/* Vertical Rounded Pill Offload Bus */
	var busYs = [];
	ppeList.forEach(function(e) { busYs.push(posPpe[String(e.id)].y + nodeH / 2); });
	wedList.forEach(function(w) { busYs.push(posWed[String(w.id)].y + nodeH / 2); });
	var busTop = Math.max(topY, (busYs.length ? Math.min.apply(null, busYs) : topY + 22) - 22);
	var busBot = Math.min(H - 12, (busYs.length ? Math.max.apply(null, busYs) : H - 34) + 22);
	var busH = Math.max(126, busBot - busTop);
	var busActive = hwOn && wedList.some(function(w) { return w.attached; });
	var busDim = !!(rel && !rel.busActive);

	svgBus.appendChild(svgEl('g', { opacity: busDim ? '0.26' : '1' }, [
		svgEl('rect', {
			x: cols.bus.x, y: busTop, width: cols.bus.w, height: busH, rx: 16,
			fill: busActive ? 'url(#' + gradBusId + ')' : 'var(--mtkw-surface-2)',
			stroke: busActive ? 'var(--mtkw-ppe)' : 'var(--mtkw-border-strong)',
			'stroke-opacity': busActive ? '0.45' : '0.6',
			'stroke-width': '1.3', 'stroke-dasharray': busActive ? null : '5 4',
			filter: 'url(#' + shadowId + ')'
		}),
		svgEl('text', {
			x: cols.bus.x + cols.bus.w / 2, y: busTop + busH / 2,
			'text-anchor': 'middle', 'dominant-baseline': 'central',
			transform: 'rotate(-90 ' + (cols.bus.x + cols.bus.w / 2) + ' ' + (busTop + busH / 2) + ')',
			fill: busActive ? 'var(--mtkw-text)' : 'var(--mtkw-text-muted)',
			'font-family': 'var(--mtkw-font-mono)', 'font-size': '9.5', 'font-weight': '750', 'letter-spacing': '0.08em'
		}, labels.busLabel || 'MTK FE ↔ WED')
	]));

	/* Edges 3: PPE -> Bus & Bus -> WED */
	ppeList.forEach(function(e) {
		var a = posPpe[String(e.id)], y = a.y + a.h / 2;
		var isRel = !!(rel && rel.ppe[String(e.id)] && rel.busActive);
		var dotCol = hwOn && e.bound > 0 ? 'var(--mtkw-ppe)' : 'var(--mtkw-border-strong)';
		addEdge('M' + (a.x + a.w) + ',' + y + ' L' + cols.bus.x + ',' + y, { active: hwOn && e.bound > 0, bypass: !hwOn, pulse: hwOn && e.bound > 0, related: isRel });
		addDot(a.x + a.w, y, dotCol, rel && !isRel);
		addDot(cols.bus.x, y, dotCol, rel && !isRel);
	});

	wedList.forEach(function(w) {
		var b = posWed[String(w.id)], y = b.y + b.h / 2;
		var isRel = !!(rel && rel.wed[String(w.id)] && rel.busActive);
		var dotCol = w.attached && hwOn ? 'var(--mtkw-wed)' : 'var(--mtkw-border-strong)';
		addEdge('M' + (cols.bus.x + cols.bus.w) + ',' + y + ' L' + b.x + ',' + y, { wed: w.attached && hwOn, bypass: !w.attached || !hwOn, pulse: w.attached && hwOn, related: isRel });
		addDot(cols.bus.x + cols.bus.w, y, dotCol, rel && !isRel);
		addDot(b.x, y, dotCol, rel && !isRel);
	});

	/* Edges 4: WED -> Wi-Fi */
	wifiBands.forEach(function(b) {
		var wid = b.wedId !== undefined && b.wedId !== null ? b.wedId : b.band;
		var a = posWed[String(wid)], c = posWifi[String(b.band)];
		if (!a || !c) return;
		var wObj = a.obj;
		var isRel = !!(rel && rel.wed[String(wid)] && rel.wifi[String(b.band)]);
		var dotCol = wObj && wObj.attached ? 'var(--mtkw-wed)' : 'var(--mtkw-border-strong)';
		addEdge(bezier(a.x + a.w, a.y + a.h / 2, c.x, c.y + c.h / 2), { wed: wObj && wObj.attached, bypass: !wObj || !wObj.attached, pulse: wObj && wObj.attached && hwOn && (b.stations || 0) > 0, related: isRel });
		addDot(a.x + a.w, a.y + a.h / 2, dotCol, rel && !isRel);
		addDot(c.x, c.y + c.h / 2, dotCol, rel && !isRel);
	});

	function nodeCard(kind, id, item, box, ariaLabel, topAccentCol, errHalo, children) {
		var sId = String(id);
		var isSel = !!(sel && sel.kind === kind && sel.id === sId);
		var isRel = !!(rel && rel[kind] && rel[kind][sId]);
		var cls = 'mtkw-topo-node';
		if (isSel) cls += ' is-selected';
		else if (isRel) cls += ' is-related';
		else if (rel) cls += ' is-dim';
		if (errHalo) cls += ' is-err';

		var parts = [];
		if (errHalo) {
			parts.push(svgEl('rect', {
				className: 'mtkw-coral-halo',
				x: box.x - 3.5, y: box.y - 3.5, width: box.w + 7, height: box.h + 7, rx: 14.5,
				fill: 'none', stroke: 'var(--mtkw-err)', 'stroke-width': '2'
			}));
		}
		parts.push(svgEl('rect', { className: 'mtkw-node-bg', x: box.x, y: box.y, width: box.w, height: box.h, rx: 12, filter: 'url(#' + shadowId + ')' }));
		if (topAccentCol) {
			parts.push(svgEl('rect', { x: box.x + 14, y: box.y + 0.5, width: box.w - 28, height: 3, rx: 1.5, fill: topAccentCol }));
		}
		svgNodes.appendChild(svgEl('g', {
			className: cls, role: 'button', tabindex: '0', 'aria-label': ariaLabel || sId,
			'data-topo-kind': kind, 'data-topo-id': sId,
			onClick: function() { onSelect(kind, id, item); },
			onKeydown: function(ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onSelect(kind, id, item); } }
		}, parts.concat(children)));
	}

	/* Col 1: Ports */
	ports.forEach(function(p) {
		var box = posPort[String(p.netdev)];
		var spd = portSpeedTone(p);
		var errCnt = p.faults !== undefined ? p.faults : spd.faults;
		var isUp = isPortUp(p);
		var media = resolvePortMedia(p);
		var glyph = media === 'sfp' ? 'sfp' : media === 'rj45' ? 'rj45' : 'port';

		nodeCard('port', p.netdev, p, box, p.ariaLabel || p.netdev, (isUp || errCnt > 0) ? spd.color : null, errCnt > 0, [
			svgIconBadge(glyph, box.x + 20, box.y + 20, spd.tint, spd.color),
			svgEl('text', { x: box.x + 36, y: box.y + 18, className: 'mtkw-node-title' }, p.title || p.netdev),
			svgEl('text', { x: box.x + box.w - 11, y: box.y + 18, 'text-anchor': 'end', className: 'mtkw-node-mono' }, p.netdev),
			svgEl('text', { x: box.x + 36, y: box.y + 32, className: 'mtkw-node-mono' }, p.subLeft || ''),
			svgEl('text', { x: box.x + box.w - 11, y: box.y + 32, 'text-anchor': 'end', className: 'mtkw-node-mono', fill: errCnt > 0 ? 'var(--mtkw-err)' : 'var(--mtkw-text-muted)' }, p.subRight || '')
		]);
	});

	/* Col 2: GDMs */
	gdmStats.forEach(function(g) {
		var box = posGdm[String(g.gdm)];
		var errCnt = g.errCount || 0;
		var acc = errCnt > 0 ? 'var(--mtkw-err)' : 'var(--mtkw-ppe)';
		var statCol = g.statTone ? toneColor(g.statTone) : (errCnt > 0 ? 'var(--mtkw-err)' : 'var(--mtkw-wed)');

		nodeCard('gdm', g.gdm, g, box, g.ariaLabel || g.label, acc, errCnt > 0, [
			svgIconBadge('gmac', box.x + 21, box.y + 22, errCnt > 0 ? 'var(--mtkw-err-tint)' : 'var(--mtkw-ppe-tint)', acc),
			svgEl('text', { x: box.x + 37, y: box.y + 21, className: 'mtkw-node-title' }, g.label || ('GDM' + (Number(g.gdm) + 1))),
			svgEl('text', { x: box.x + box.w - 11, y: box.y + 21, 'text-anchor': 'end', className: 'mtkw-node-mono' }, g.netdev || ''),
			svgEl('text', { x: box.x + 12, y: box.y + 45, className: 'mtkw-node-val' }, g.ppeLabel ? ('→ ' + g.ppeLabel) : ''),
			svgEl('text', { x: box.x + box.w - 11, y: box.y + 45, 'text-anchor': 'end', className: 'mtkw-node-mono', fill: statCol }, g.statText || ''),
			svgEl('text', { x: box.x + 12, y: box.y + 62, className: 'mtkw-node-mono' }, g.pktText || '')
		]);
	});

	/* Col 3: PPEs */
	function ppeCompact(n) {
		n = Number(n) || 0;
		if (n >= 999500) return (n / 1e6).toFixed(1) + 'M';
		if (n >= 99950) return Math.round(n / 1e3) + 'K';
		if (n >= 1e4) return (n / 1e3).toFixed(1) + 'K';
		return String(Math.round(n));
	}
	ppeList.forEach(function(e) {
		var box = posPpe[String(e.id)];
		var total = Number(e.total) || 0;
		var bound = Number(e.bound) || 0;
		var unbound = Number(e.unbound) || 0;
		var ipv4 = Number(e.ipv4) || 0;
		var ipv6 = Number(e.ipv6) || 0;
		var rate = total > 0 ? (bound / total) * 100 : 0;
		var barW = box.w - 20;
		var bndW = total > 0 ? Math.round((bound / total) * barW) : 0;
		var unbW = total > 0 ? Math.round((unbound / total) * barW) : 0;
		var acc = hwOn ? 'var(--mtkw-ppe)' : 'var(--mtkw-warn)';
		var bndStr = (bound >= 10000 || total >= 10000)
			? ('BND ' + ppeCompact(bound) + '/' + ppeCompact(total))
			: (e.bndText || ('BND ' + bound + '/' + total));
		var protoStr = (ipv4 >= 10000 || ipv6 >= 10000)
			? ('v4:' + ppeCompact(ipv4) + ' v6:' + ppeCompact(ipv6))
			: (e.protoText || ('v4:' + ipv4 + ' v6:' + ipv6));
		var dense = (bndStr.length + protoStr.length) > 26;
		var bndAttrs = { x: box.x + 10, y: box.y + 57, className: 'mtkw-node-mono' };
		var protoAttrs = { x: box.x + box.w - 10, y: box.y + 57, 'text-anchor': 'end', className: 'mtkw-node-mono' };
		if (dense) {
			bndAttrs['font-size'] = '9.5';
			protoAttrs['font-size'] = '9.5';
		}

		nodeCard('ppe', e.id, e, box, e.ariaLabel || ('PPE' + e.id), acc, false, [
			svgIconBadge('ppe', box.x + 20, box.y + 21, hwOn ? 'var(--mtkw-ppe-tint)' : 'var(--mtkw-warn-tint)', acc),
			svgEl('text', { x: box.x + 36, y: box.y + 21, className: 'mtkw-node-title' }, e.title || ('PPE' + e.id)),
			svgEl('text', { x: box.x + box.w - 10, y: box.y + 21, 'text-anchor': 'end', className: 'mtkw-node-val', fill: acc }, e.pctText || (rate.toFixed(1) + '%')),
			svgEl('rect', { x: box.x + 10, y: box.y + 36, width: barW, height: 6, rx: 3, fill: 'var(--mtkw-track)' }),
			bndW > 0 ? svgEl('rect', { x: box.x + 10, y: box.y + 36, width: bndW, height: 6, rx: 3, fill: hwOn ? 'url(#' + gradPpeId + ')' : 'var(--mtkw-border-strong)' }) : null,
			unbW > 0 ? svgEl('rect', { x: box.x + 10 + bndW, y: box.y + 36, width: Math.min(unbW, barW - bndW), height: 6, rx: 2, fill: 'var(--mtkw-warn)' }) : null,
			svgEl('text', bndAttrs, bndStr),
			svgEl('text', protoAttrs, protoStr)
		]);
	});

	/* Col 4: WEDs */
	wedList.forEach(function(w) {
		var box = posWed[String(w.id)];
		var col = !w.attached ? 'var(--mtkw-text-muted)' : w.rx ? 'var(--mtkw-wed)' : 'var(--mtkw-warn)';
		var tint = !w.attached ? 'var(--mtkw-surface-2)' : w.rx ? 'var(--mtkw-wed-tint)' : 'var(--mtkw-warn-tint)';

		nodeCard('wed', w.id, w, box, w.ariaLabel || ('WED' + w.id), w.attached ? col : null, false, [
			svgIconBadge('wed', box.x + 21, box.y + 22, tint, col),
			svgEl('text', { x: box.x + 37, y: box.y + 22, className: 'mtkw-node-title' }, w.title || ('WED' + w.id)),
			svgEl('text', { x: box.x + box.w - 11, y: box.y + 22, 'text-anchor': 'end', className: 'mtkw-node-mono' }, w.verText !== undefined ? w.verText : (w.version !== undefined && w.version !== null ? ('v' + w.version) : '')),
			svgEl('text', { x: box.x + 12, y: box.y + 46, className: 'mtkw-node-mono', fill: col, 'font-weight': '700' }, w.modeText ? ('● ' + w.modeText) : ''),
			svgEl('text', { x: box.x + 12, y: box.y + 62, className: 'mtkw-node-mono' }, w.buildText || '')
		]);
	});

	/* Col 5: Wi-Fi Bands */
	if (wifiBands.length) {
		wifiBands.forEach(function(b) {
			var box = posWifi[String(b.band)];
			var info = BANDS[b.band] || { full: String(b.band), varName: '--mtkw-ppe', tintVar: '--mtkw-ppe-tint' };
			var bCol = 'var(' + info.varName + ')';
			var bTint = 'var(' + info.tintVar + ')';
			var qCol = b.qualityTone ? toneColor(b.qualityTone) : 'var(--mtkw-wed)';
			var acc = (b.qualityTone === 'err' || b.qualityTone === 'error') ? 'var(--mtkw-err)' : bCol;

			nodeCard('wifi', b.band, b, box, b.ariaLabel || info.full, acc, false, [
				svgIconBadge('wifi', box.x + 21, box.y + 22, bTint, bCol),
				svgEl('text', { x: box.x + 37, y: box.y + 22, className: 'mtkw-node-title' }, b.label || info.full),
				svgEl('text', { x: box.x + box.w - 11, y: box.y + 22, 'text-anchor': 'end', className: 'mtkw-node-mono' }, b.linksText || ''),
				svgEl('text', { x: box.x + 12, y: box.y + 45, className: 'mtkw-node-mono' }, b.airtimeText || ''),
				svgEl('text', { x: box.x + box.w - 11, y: box.y + 45, 'text-anchor': 'end', className: 'mtkw-node-mono', fill: qCol, 'font-weight': '700' }, b.qualityText || ''),
				svgEl('text', { x: box.x + 12, y: box.y + 62, className: 'mtkw-node-mono' }, b.txText || ''),
				svgEl('text', { x: box.x + box.w - 11, y: box.y + 62, 'text-anchor': 'end', className: 'mtkw-node-mono' }, b.sigText || '')
			]);
		});
	} else {
		var eb = { x: cols.wifi.x, y: wifiYs[0], w: cols.wifi.w, h: nodeH };
		svgNodes.appendChild(svgEl('g', { opacity: '0.72' }, [
			svgEl('rect', { x: eb.x, y: eb.y, width: eb.w, height: eb.h, rx: 12, fill: 'var(--mtkw-surface)', stroke: 'var(--mtkw-border-mid)', 'stroke-dasharray': '5 4' }),
			svgEl('text', { x: eb.x + eb.w / 2, y: eb.y + 33, 'text-anchor': 'middle', className: 'mtkw-node-title', fill: 'var(--mtkw-text-muted)' }, labels.emptyWifiTitle || ''),
			svgEl('text', { x: eb.x + eb.w / 2, y: eb.y + 52, 'text-anchor': 'middle', className: 'mtkw-node-mono' }, labels.emptyWifiSub || '')
		]));
	}

	var svgDefs = svgEl('defs', null, [
		svgEl('linearGradient', { id: gradPpeId, x1: '0%', y1: '0%', x2: '100%', y2: '0%' }, [
			svgEl('stop', { offset: '0%', 'stop-color': 'var(--mtkw-ppe-start)' }),
			svgEl('stop', { offset: '100%', 'stop-color': 'var(--mtkw-primary)' })
		]),
		svgEl('linearGradient', { id: gradWedId, x1: '0%', y1: '0%', x2: '100%', y2: '0%' }, [
			svgEl('stop', { offset: '0%', 'stop-color': 'var(--mtkw-wed-start)' }),
			svgEl('stop', { offset: '100%', 'stop-color': 'var(--mtkw-wed-end)' })
		]),
		svgEl('linearGradient', { id: gradBusId, x1: '0%', y1: '0%', x2: '0%', y2: '100%' }, [
			svgEl('stop', { offset: '0%', 'stop-color': 'var(--mtkw-ppe-tint)' }),
			svgEl('stop', { offset: '100%', 'stop-color': 'var(--mtkw-wed-tint)' })
		]),
		svgEl('filter', { id: shadowId, x: '-8%', y: '-12%', width: '116%', height: '132%' }, [
			svgEl('feDropShadow', { dx: '0', dy: '2', stdDeviation: '3', 'flood-color': '#0f172a', 'flood-opacity': isDarkMode() ? '0.38' : '0.07' })
		])
	]);

	var svgHeaders = svgEl('g', null, [
		svgEl('text', { x: cols.port.x + 2, y: 21, className: 'mtkw-topo-col-lbl' }, labels.colPorts || 'PORTS'),
		svgEl('text', { x: cols.gdm.x + 2,  y: 21, className: 'mtkw-topo-col-lbl' }, labels.colGdm || 'GDM'),
		svgEl('text', { x: cols.ppe.x + 2,  y: 21, className: 'mtkw-topo-col-lbl' }, labels.colPpe || 'PPE'),
		(!hwOn && labels.swForwardBadge) ? svgEl('g', null, [
			svgEl('rect', { x: cols.ppe.x + cols.ppe.w - 94, y: 8, width: 94, height: 18, rx: 9, fill: 'var(--mtkw-warn-tint)' }),
			svgEl('text', { x: cols.ppe.x + cols.ppe.w - 47, y: 20, 'text-anchor': 'middle', fill: 'var(--mtkw-warn)', 'font-family': 'var(--mtkw-font-sans)', 'font-size': '9.5', 'font-weight': '700' }, labels.swForwardBadge)
		]) : null,
		svgEl('text', { x: cols.wed.x + 2,  y: 21, className: 'mtkw-topo-col-lbl' }, labels.colWed || 'WED'),
		svgEl('text', { x: cols.wifi.x + 2, y: 21, className: 'mtkw-topo-col-lbl' }, labels.colWifi || 'Wi-Fi')
	]);

	var svg = svgEl('svg', {
		className: 'mtkw-topo-svg', viewBox: '0 0 ' + W + ' ' + H,
		role: 'img', 'aria-label': labels.ariaLabel || ''
	}, [ svgDefs, svgHeaders, svgEdges, svgPulses, svgBus, svgNodes, svgDots ]);

	/* Responsive Mobile Vertical Spatial Pipeline */
	function mNode(kind, id, item, glyph, titleTxt, subTxt, tone, isErr) {
		var sId = String(id);
		var isSel = !!(sel && sel.kind === kind && sel.id === sId);
		var isRel = !!(rel && rel[kind] && rel[kind][sId]);
		var cls = 'mtkw-mtopo-node' + (isSel ? ' is-selected' : isRel ? ' is-related' : rel ? ' is-dim' : '') + (isErr ? ' is-err' : '');
		var btn = E('button', { 'type': 'button', 'class': cls, 'data-topo-kind': kind, 'data-topo-id': sId }, [
			tone ? E('span', { 'class': 'mtkw-mtopo-top', 'data-tone': tone }) : null,
			E('span', { 'class': 'mtkw-mtopo-title' }, [
				E('span', { 'class': 'mtkw-ico-wrap mtkw-tone', 'data-tone': tone || 'muted' }, [ icon(glyph, 14) ]),
				titleTxt || sId
			]),
			E('span', { 'class': 'mtkw-mono mtkw-mtopo-sub' }, subTxt || '')
		]);
		btn.addEventListener('click', function() { onSelect(kind, id, item); });
		return btn;
	}

	var mobileTopo = E('div', { 'class': 'mtkw-topo-mobile' }, [
		E('div', { 'class': 'mtkw-mtopo-tier' }, [
			E('div', { 'class': 'mtkw-mtopo-lbl' }, labels.mColPorts || labels.colPorts || 'PORTS'),
			E('div', { 'class': 'mtkw-mtopo-grid' }, ports.map(function(p) {
				var sp = portSpeedTone(p);
				var errCnt = p.faults !== undefined ? p.faults : sp.faults;
				var media = resolvePortMedia(p);
				var glyph = media === 'sfp' ? 'sfp' : media === 'rj45' ? 'rj45' : 'port';
				return mNode('port', p.netdev, p, glyph, p.mobileTitle || p.title || p.netdev, p.mobileSub || p.subLeft || '', (isPortUp(p) || errCnt > 0) ? (sp.tone || 'muted') : '', errCnt > 0);
			}))
		]),
		E('div', { 'class': 'mtkw-mtopo-tier' }, [
			E('div', { 'class': 'mtkw-mtopo-lbl' }, labels.mColGdm || labels.colGdm || 'GDM'),
			E('div', { 'class': 'mtkw-mtopo-grid' }, gdmStats.map(function(g) {
				var gErr = (g.errCount || 0) > 0;
				return mNode('gdm', g.gdm, g, 'gmac', g.mobileTitle || g.label, g.mobileSub || (g.ppeLabel ? ('→ ' + g.ppeLabel) : ''), gErr ? 'err' : 'ppe', gErr);
			}))
		]),
		E('div', { 'class': 'mtkw-mtopo-tier' }, [
			E('div', { 'class': 'mtkw-mtopo-lbl' }, labels.mColPpe || labels.colPpe || 'PPE'),
			E('div', { 'class': 'mtkw-mtopo-grid' }, ppeList.map(function(e) {
				return mNode('ppe', e.id, e, 'ppe', e.mobileTitle || (e.title || 'PPE' + e.id), e.mobileSub || e.bndText || '', hwOn ? 'ppe' : 'warn', false);
			}))
		]),
		E('div', { 'class': 'mtkw-mtopo-bus' }, labels.mBusLabel || labels.busLabel || 'MTK FE ↔ WED'),
		E('div', { 'class': 'mtkw-mtopo-tier' }, [
			E('div', { 'class': 'mtkw-mtopo-lbl' }, labels.mColWedWifi || ((labels.colWed || 'WED') + ' / ' + (labels.colWifi || 'Wi-Fi'))),
			E('div', { 'class': 'mtkw-mtopo-grid' },
				wedList.map(function(w) {
					return mNode('wed', w.id, w, 'wed', w.mobileTitle || ((w.title || 'WED' + w.id) + (w.verText ? ' ' + w.verText : '')), w.mobileSub || w.modeText || '', !w.attached ? '' : w.rx ? 'wed' : 'warn', false);
				}).concat(wifiBands.map(function(b) {
					var info = BANDS[b.band] || { full: String(b.band), tone: 'ppe' };
					return mNode('wifi', b.band, b, 'wifi', b.label || info.full, b.mobileSub || b.airtimeText || '', info.tone || 'ppe', b.qualityTone === 'err' || b.qualityTone === 'error');
				}))
			)
		])
	]);

	return E('div', { 'class': 'mtkw-topo-stage' }, [
		E('div', { 'class': 'mtkw-topo-svg-host' }, [ svg ]),
		mobileTopo
	]);
}

/* ── Dual-Layer Smooth-Gradient CPU Frequency & Temperature Chart ────────── */

function toTempDegC(v) {
	if (typeof v !== 'number' || !isFinite(v) || v <= 0) return null;
	return v >= 1000 ? v / 1000 : v;
}

function cpuChartSvg(opts) {
	opts = opts || {};
	var labels = opts.labels || {};
	var freqHist = [], tempHist = [];

	/* Strict 1:1 index alignment: missing temperatures stay explicitly null */
	if (Array.isArray(opts.history)) {
		for (var i = 0; i < opts.history.length; i++) {
			var pt = opts.history[i] || {};
			freqHist.push(Number(pt.freq) || 0);
			tempHist.push(toTempDegC(pt.temp));
		}
	} else if (opts.history && typeof opts.history === 'object') {
		var rawF = Array.isArray(opts.history.freqs) ? opts.history.freqs : [];
		var rawT = Array.isArray(opts.history.temps) ? opts.history.temps : [];
		var len = Math.max(rawF.length, rawT.length);
		for (var j = 0; j < len; j++) {
			freqHist.push(Number(rawF[j]) || 0);
			tempHist.push(toTempDegC(rawT[j]));
		}
	}

	var N = freqHist.length;
	var validFreqs = freqHist.filter(function(x) { return x > 0; });
	var defMin = validFreqs.length ? Math.min.apply(null, validFreqs) : 400000;
	var defMax = validFreqs.length ? Math.max.apply(null, validFreqs) : 1800000;
	var rawMin = Number(opts.minFreq);
	var minF = (opts.minFreq !== undefined && opts.minFreq !== null && opts.minFreq !== '' && isFinite(rawMin) && rawMin > 0)
		? Math.min(rawMin, defMin)
		: defMin;
	var rawHwMax = Number(opts.hwMaxFreq);
	var rawMax = Number(opts.maxFreq);
	var hwMax = Math.max(
		(isFinite(rawHwMax) && rawHwMax > 0) ? rawHwMax : 0,
		(isFinite(rawMax) && rawMax > 0) ? rawMax : 0,
		defMax
	) || 1800000;
	var curMax = (isFinite(rawMax) && rawMax > 0) ? rawMax : hwMax;
	var tickSec = Number(labels.tickSec) || 5;
	var freqInKhz = hwMax >= 10000;

	function fmtFreqAxis(v) { return String(Math.round(freqInKhz ? (v / 1000) : v)); }
	function fmtFreqTip(v) { return freqInKhz ? fmtFreq(v) : (Math.round(v) + ' MHz'); }

	/* Anti-overlap rule: yTopFreq = hwMax * 1.12 -> 12% clean breathing margin */
	var yTopFreq = hwMax * 1.12;
	var yBotFreq = Math.max(0, minF - (hwMax - minF) * 0.08);
	var cw = 560, ch = 206, padL = 44, padR = 40, padT = 16, padB = 24;
	var plotW = cw - padL - padR, plotH = ch - padT - padB;

	function xAt(idx, len) { return len <= 1 ? padL + plotW : padL + (idx / (len - 1)) * plotW; }
	function yFreq(v) { return padT + plotH - Math.max(0, Math.min(1, (v - yBotFreq) / Math.max(1, yTopFreq - yBotFreq))) * plotH; }
	function yTemp(degC) { return padT + plotH - Math.max(0, Math.min(1, (degC - 35) / 60)) * plotH; }

	var fPts = freqHist.map(function(f, idx) { return xAt(idx, N).toFixed(1) + ',' + yFreq(f).toFixed(1); });
	var fLine = fPts.length ? 'M' + fPts.join(' L') : '';
	var fArea = fPts.length ? ('M' + xAt(0, N).toFixed(1) + ',' + (padT + plotH) + ' L' + fPts.join(' L') + ' L' + xAt(N - 1, N).toFixed(1) + ',' + (padT + plotH) + ' Z') : '';

	/* Break temperature path across null gaps; draw crisp dots for isolated points */
	var tSegments = [];
	var tIsolatedDots = [];
	var curRun = [];
	function flushTempRun() {
		if (curRun.length >= 2) {
			tSegments.push('M' + curRun.map(function(p) { return p.x.toFixed(1) + ',' + p.y.toFixed(1); }).join(' L'));
		} else if (curRun.length === 1) {
			tIsolatedDots.push(curRun[0]);
		}
		curRun = [];
	}
	for (var ti = 0; ti < N; ti++) {
		if (tempHist[ti] !== null) {
			curRun.push({ idx: ti, x: xAt(ti, N), y: yTemp(tempHist[ti]), deg: tempHist[ti] });
		} else {
			flushTempRun();
		}
	}
	flushTempRun();
	var tLine = tSegments.join(' ');

	var lastTempValid = N > 0 && tempHist[N - 1] !== null;
	var lastTempAlreadyDot = tIsolatedDots.some(function(d) { return d.idx === N - 1; });

	var gridKids = [];
	var rawTicks = hwMax > minF ? [ hwMax, Math.round((hwMax + minF) / 2), minF ] : [ hwMax ];
	var seenTickY = {}, seenTickLbl = {};
	rawTicks.forEach(function(tk) {
		var yy = yFreq(tk);
		var lbl = fmtFreqAxis(tk);
		var yKey = yy.toFixed(1);
		if (seenTickY[yKey] || seenTickLbl[lbl]) return;
		seenTickY[yKey] = true;
		seenTickLbl[lbl] = true;
		gridKids.push(svgEl('line', { x1: padL, y1: yy, x2: cw - padR, y2: yy, stroke: 'var(--mtkw-border)', 'stroke-width': '1' }));
		gridKids.push(svgEl('text', { x: padL - 7, y: yy + 3.5, 'text-anchor': 'end', fill: 'var(--mtkw-text-muted)', 'font-family': 'var(--mtkw-font-mono)', 'font-size': '10' }, lbl));
	});
	[ 95, 80, 65, 35 ].forEach(function(degC) {
		var yy = yTemp(degC);
		gridKids.push(svgEl('text', { x: cw - padR + 7, y: yy + 3.5, 'text-anchor': 'start', fill: degC === 80 ? 'var(--mtkw-err)' : 'var(--mtkw-text-muted)', 'font-family': 'var(--mtkw-font-mono)', 'font-size': '9.5' }, degC + '°'));
	});

	var uid = nextSvgId('mtkw-cpu');
	var areaId = uid + '-area';
	var strokeId = uid + '-stroke';

	var hoverLine = svgEl('line', { x1: 0, y1: padT, x2: 0, y2: padT + plotH, stroke: 'var(--mtkw-primary)', 'stroke-width': '1.2', 'stroke-dasharray': '3 3', opacity: '0' });
	var hoverDotF = svgEl('circle', { cx: 0, cy: 0, r: 4.5, fill: 'var(--mtkw-primary)', stroke: 'var(--mtkw-surface)', 'stroke-width': '2', opacity: '0' });
	var hoverDotT = svgEl('circle', { cx: 0, cy: 0, r: 3.8, fill: 'var(--mtkw-warn)', stroke: 'var(--mtkw-surface)', 'stroke-width': '1.8', opacity: '0' });

	var tDotEls = tIsolatedDots.map(function(d) {
		return svgEl('circle', {
			className: 'mtkw-temp-dot', 'data-idx': String(d.idx),
			cx: d.x.toFixed(1), cy: d.y.toFixed(1), r: 3.2,
			fill: 'var(--mtkw-band-24)', stroke: 'var(--mtkw-surface)', 'stroke-width': '1.5'
		});
	});

	var svgChart = svgEl('svg', {
		className: 'mtkw-chart-svg', viewBox: '0 0 ' + cw + ' ' + ch,
		role: 'img', 'aria-label': labels.ariaLabel || ''
	}, [
		svgEl('defs', null, [
			svgEl('linearGradient', { id: areaId, x1: '0', y1: '0', x2: '0', y2: '1' }, [
				svgEl('stop', { offset: '0%', 'stop-color': 'var(--mtkw-ppe-start)', 'stop-opacity': '0.32' }),
				svgEl('stop', { offset: '100%', 'stop-color': 'var(--mtkw-ppe-start)', 'stop-opacity': '0.01' })
			]),
			svgEl('linearGradient', { id: strokeId, x1: '0', y1: '0', x2: '1', y2: '0' }, [
				svgEl('stop', { offset: '0%', 'stop-color': 'var(--mtkw-ppe-start)' }),
				svgEl('stop', { offset: '100%', 'stop-color': 'var(--mtkw-primary)' })
			])
		]),
		svgEl('g', null, gridKids),
		fArea ? svgEl('path', { d: fArea, fill: 'url(#' + areaId + ')' }) : null,
		/* Dashed max-freq cap line only — cap pill lives in caller legend to prevent overlap */
		svgEl('line', { x1: padL, y1: yFreq(curMax), x2: cw - padR, y2: yFreq(curMax), stroke: 'var(--mtkw-warn)', 'stroke-width': '1.4', 'stroke-dasharray': '5 4', opacity: '0.85' }),
		tLine ? svgEl('path', { className: 'mtkw-temp-line', d: tLine, fill: 'none', stroke: 'var(--mtkw-band-24)', 'stroke-width': '1.75', 'stroke-linejoin': 'round', opacity: '0.85' }) : null,
		fLine ? svgEl('path', { d: fLine, fill: 'none', stroke: 'url(#' + strokeId + ')', 'stroke-width': '2.4', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }) : null,
		N ? svgEl('circle', { cx: xAt(N - 1, N), cy: yFreq(freqHist[N - 1]), r: 4, fill: 'var(--mtkw-primary)', stroke: 'var(--mtkw-surface)', 'stroke-width': '1.8' }) : null,
		(lastTempValid && !lastTempAlreadyDot) ? svgEl('circle', { className: 'mtkw-temp-dot', 'data-idx': String(N - 1), cx: xAt(N - 1, N), cy: yTemp(tempHist[N - 1]), r: 3.2, fill: 'var(--mtkw-band-24)', stroke: 'var(--mtkw-surface)', 'stroke-width': '1.5' }) : null,
		svgEl('g', { className: 'mtkw-temp-dots' }, tDotEls),
		svgEl('text', { x: padL, y: ch - 6, fill: 'var(--mtkw-text-muted)', 'font-family': 'var(--mtkw-font-mono)', 'font-size': '9.5' }, '-' + Math.round(Math.max(0, N - 1) * tickSec) + 's'),
		svgEl('text', { x: cw - padR, y: ch - 6, 'text-anchor': 'end', fill: 'var(--mtkw-text-muted)', 'font-family': 'var(--mtkw-font-mono)', 'font-size': '9.5' }, labels.axisHint || ''),
		hoverLine, hoverDotF, hoverDotT
	]);

	var tip = E('div', { 'class': 'mtkw-chart-tip' }, '');
	svgChart.addEventListener('mousemove', function(ev) {
		if (!N) return;
		var rect = svgChart.getBoundingClientRect();
		if (!rect.width) return;
		var relX = ((ev.clientX - rect.left) / rect.width) * cw;
		var idx = Math.round(Math.max(0, Math.min(1, (relX - padL) / plotW)) * (N - 1));
		var px = xAt(idx, N);
		hoverLine.setAttribute('x1', px);
		hoverLine.setAttribute('x2', px);
		hoverLine.setAttribute('opacity', '1');
		hoverDotF.setAttribute('cx', px);
		hoverDotF.setAttribute('cy', yFreq(freqHist[idx]));
		hoverDotF.setAttribute('opacity', '1');

		var tDeg = tempHist[idx];
		if (tDeg !== null) {
			hoverDotT.setAttribute('cx', px);
			hoverDotT.setAttribute('cy', yTemp(tDeg));
			hoverDotT.setAttribute('opacity', '1');
		} else {
			hoverDotT.setAttribute('opacity', '0');
		}

		var secAgo = (N - 1 - idx) * tickSec;
		if (typeof labels.fmtHover === 'function') {
			tip.textContent = labels.fmtHover(freqHist[idx], tDeg, idx, secAgo);
		} else {
			var tStr = tDeg !== null ? (tDeg.toFixed(1) + ' ' + (labels.unitTemp || '°C')) : '—';
			tip.textContent = (secAgo === 0 ? (labels.nowLabel || '0s') : ('-' + secAgo + 's')) + ' · ' + fmtFreqTip(freqHist[idx]) + ' · ' + tStr;
		}
		tip.style.left = Math.max(20, Math.min(80, (px / cw) * 100)) + '%';
		tip.classList.add('is-show');
	});
	svgChart.addEventListener('mouseleave', function() {
		hoverLine.setAttribute('opacity', '0');
		hoverDotF.setAttribute('opacity', '0');
		hoverDotT.setAttribute('opacity', '0');
		tip.classList.remove('is-show');
	});

	return E('div', { 'class': 'mtkw-chart-wrap' }, [ svgChart, tip ]);
}

/* ── Per-Core CPU Utilization Dual-Segment Capsule Grid ──────────────────── */

function coreGrid(opts) {
	opts = opts || {};
	var cores = Array.isArray(opts.cores) ? opts.cores : [];
	var labels = opts.labels || {};
	var corePrefix = labels.corePrefix || 'CPU';
	var userLabel = labels.userLabel || '';
	var sirqLabel = labels.sirqLabel || 'SoftIRQ';

	var tiles = cores.map(function(c, idx) {
		var cid = c.id !== undefined ? c.id : idx;
		var rawU = c.usage_pct !== undefined ? c.usage_pct : c.usagePct;
		var rawS = c.sirq_pct !== undefined ? c.sirq_pct : c.sirqPct;
		var rawUser = c.user_sys_pct !== undefined ? c.user_sys_pct : c.userSysPct;
		var pending = rawU === null || rawU === undefined || !isFinite(Number(rawU));

		var usage = pending ? 0 : clampPct(rawU);
		var sirq = pending ? 0 : Math.max(0, Math.min(usage, clampPct(rawS)));
		var userSys = pending ? 0 : (rawUser !== undefined && isFinite(Number(rawUser))
			? Math.max(0, Math.min(100 - sirq, clampPct(rawUser)))
			: Math.max(0, usage - sirq));

		var level = pending ? 'normal' : usage >= 85 ? 'crit' : usage >= 70 ? 'warn' : usage < 25 ? 'cool' : 'normal';
		var tileCls = 'mtkw-core-tile' + (!pending && usage >= 80 ? ' is-crit' : !pending && usage >= 70 ? ' is-warn' : '');
		var sirqCls = 'mtkw-core-sirq' + (!pending && sirq >= 40 ? ' is-high' : !pending && sirq >= 20 ? ' is-elevated' : '');

		var showUser = !pending && userSys > 0.05;
		var showSirq = !pending && sirq > 0.05;
		var segs = [];
		if (showUser) {
			segs.push(barFill('mtkw-core-seg is-user' + (!showSirq ? ' is-sole' : ''), userSys));
		}
		if (showSirq) {
			segs.push(barFill('mtkw-core-seg is-sirq' + (!showUser ? ' is-sole' : ''), sirq));
		}

		var barAria = typeof labels.barAria === 'function'
			? labels.barAria({ id: cid, usage: usage, userSys: userSys, sirq: sirq, pending: pending })
			: (corePrefix + cid + ' ' + (pending ? '—' : (usage.toFixed(1) + '%')));

		return E('div', { 'class': tileCls, 'data-core-id': String(cid) }, [
			E('div', { 'class': 'mtkw-core-top' }, [
				E('span', { 'class': 'mtkw-core-id' }, corePrefix + cid),
				E('span', { 'class': 'mtkw-core-pct', 'data-level': level }, pending ? '—' : (usage.toFixed(1) + '%'))
			]),
			E('div', { 'class': 'mtkw-core-bar', 'role': 'img', 'aria-label': barAria }, segs),
			E('div', { 'class': 'mtkw-core-meta' }, [
				E('span', {}, (userLabel ? userLabel + ' ' : '') + (pending ? '—' : (userSys.toFixed(1) + '%'))),
				E('span', { 'class': sirqCls }, sirqLabel + ' ' + (pending ? '—' : (sirq.toFixed(1) + '%')))
			])
		]);
	});

	return E('div', { 'class': 'mtkw-cores-grid' }, tiles);
}

/* ── Wi-Fi Circular Airtime Ring & Signal Spectrum Bar ───────────────────── */

function wifiRingSvg(pct, tone, opts) {
	opts = opts || {};
	var isEmpty = opts.empty === true || pct === null || pct === undefined || pct === '' || !isFinite(Number(pct));
	var p = isEmpty ? 0 : Math.round(clampPct(pct));
	var r = 33, circ = 2 * Math.PI * r;
	var dash = (p / 100) * circ;
	var col = opts.color || toneColor(tone);
	var centerText = isEmpty ? (opts.emptyText !== undefined ? String(opts.emptyText) : '—') : (p + '%');

	var svgAttrs = {
		width: 82, height: 82, viewBox: '0 0 82 82',
		role: 'img', 'aria-label': opts.ariaLabel || centerText
	};
	if (isEmpty) svgAttrs['data-empty'] = 'true';

	return svgEl('svg', svgAttrs, [
		svgEl('circle', { cx: 41, cy: 41, r: r, fill: 'none', stroke: 'var(--mtkw-track)', 'stroke-width': '7.5' }),
		(!isEmpty && p > 0) ? svgEl('circle', {
			className: 'mtkw-ring-arc',
			cx: 41, cy: 41, r: r, fill: 'none', stroke: col, 'stroke-width': '7.5',
			'stroke-linecap': 'round', 'stroke-dasharray': dash.toFixed(1) + ' ' + circ.toFixed(1),
			transform: 'rotate(-90 41 41)'
		}) : null,
		svgEl('text', {
			x: 41, y: opts.subLabel ? 40 : 46, 'text-anchor': 'middle',
			fill: isEmpty ? 'var(--mtkw-text-muted)' : 'var(--mtkw-text)',
			'font-family': 'var(--mtkw-font-mono)', 'font-size': '16', 'font-weight': '750'
		}, centerText),
		opts.subLabel ? svgEl('text', { x: 41, y: 53, 'text-anchor': 'middle', fill: 'var(--mtkw-text-muted)', 'font-size': '9.5', 'font-weight': '600' }, String(opts.subLabel)) : null
	]);
}

function signalBar(avgDbm, worstDbm, opts) {
	opts = opts || {};
	var hasAvg = isValidDbm(avgDbm);
	var hasWorst = isValidDbm(worstDbm);
	var attrs = { 'class': 'mtkw-sig-track' };
	if (opts.ariaLabel) { attrs.role = 'img'; attrs['aria-label'] = opts.ariaLabel; }

	if (!hasAvg && !hasWorst) {
		attrs['data-empty'] = 'true';
		return E('div', attrs, []);
	}

	function dbmPct(v) { return Math.max(0, Math.min(100, ((v + 90) / 55) * 100)); }
	var barTone = (opts.tone !== undefined && opts.tone !== null && opts.tone !== '')
		? (BANDS[opts.tone] ? BANDS[opts.tone].tone : String(opts.tone))
		: (varToTone(opts.color) || 'ppe');
	var kids = [];
	if (hasAvg) {
		var pAvg = dbmPct(avgDbm);
		var pMin = hasWorst ? dbmPct(worstDbm) : pAvg;
		var left = Math.min(pMin, pAvg);
		var width = Math.max(5, Math.abs(pAvg - pMin));
		var rangeEl = E('div', { 'class': 'mtkw-sig-range', 'data-tone': barTone });
		rangeEl.style.left = left.toFixed(1) + '%';
		rangeEl.style.width = width.toFixed(1) + '%';
		var avgEl = E('div', { 'class': 'mtkw-sig-avg' });
		avgEl.style.left = pAvg.toFixed(1) + '%';
		kids.push(rangeEl, avgEl);
	} else {
		var pW = dbmPct(worstDbm);
		var wRange = E('div', { 'class': 'mtkw-sig-range', 'data-tone': barTone });
		wRange.style.left = Math.max(0, pW - 2.5).toFixed(1) + '%';
		wRange.style.width = '5%';
		kids.push(wRange);
	}
	return E('div', attrs, kids);
}

/* ── Spatial 18px Frosted Slide-Over Drawer (Bottom Sheet <= 768px) ──────── */

function createDrawer(container, opts) {
	opts = opts || {};
	var closeLabel = opts.closeLabel || '×';
	var onClose = typeof opts.onClose === 'function' ? opts.onClose : null;
	var titleId = nextSvgId('mtkw-drawer-title');
	var openState = false;
	var currentTitle = '';
	var currentCloseBtn = null;
	var lastFocused = null;
	var lastFocusedId = '';
	var lastFocusedTopo = null;
	var FOCUSABLE_SEL = 'button,a[href],input,select,textarea,[tabindex]:not([tabindex="-1"])';

	var backdrop = E('div', { 'class': 'mtkw-drawer-backdrop' });
	var headEl = E('div', { 'class': 'mtkw-drawer-head' }, [
		E('div', { 'id': titleId, 'class': 'mtkw-mono mtkw-drawer-title' }, '')
	]);
	var bodyEl = E('div', { 'class': 'mtkw-drawer-body' });
	var footEl = E('div', { 'class': 'mtkw-drawer-footer', 'hidden': '' });
	var aside = E('aside', {
		'class': 'mtkw-drawer',
		'role': 'dialog',
		'aria-modal': 'true',
		'aria-labelledby': titleId,
		'aria-hidden': 'true'
	}, [
		E('div', { 'class': 'mtkw-drawer-handle', 'aria-hidden': 'true' }),
		headEl,
		bodyEl,
		footEl
	]);
	aside.inert = true;
	aside.setAttribute('inert', '');
	var layer = E('div', { 'class': 'mtkw-drawer-layer' }, [ backdrop, aside ]);
	if (container) container.appendChild(layer);

	function focusSafe(el) {
		if (!el || typeof el.focus !== 'function') return;
		try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
	}

	function isNodeConnected(el) {
		if (!el) return false;
		if (el.isConnected !== undefined) return !!el.isConnected;
		return document.contains ? document.contains(el) : true;
	}

	function getSectionName(el) {
		if (!el) return '';
		if (headEl.contains && headEl.contains(el)) return 'head';
		if (bodyEl.contains && bodyEl.contains(el)) return 'body';
		if (footEl.contains && footEl.contains(el)) return 'foot';
		return '';
	}

	function getSectionEl(name) {
		if (name === 'head') return headEl;
		if (name === 'body') return bodyEl;
		if (name === 'foot') return footEl;
		return aside;
	}

	function listFocusables(root) {
		if (!root || !root.querySelectorAll) return [];
		return Array.prototype.slice.call(root.querySelectorAll(FOCUSABLE_SEL));
	}

	function captureDrawerFocus(active) {
		if (!active || !aside.contains || !aside.contains(active)) return null;
		var secName = getSectionName(active);
		var secEl = getSectionEl(secName);
		var list = listFocusables(secEl);
		return {
			focusKey: active.getAttribute ? active.getAttribute('data-focus-key') : null,
			isClose: !!(currentCloseBtn && active === currentCloseBtn),
			section: secName,
			tag: String(active.tagName || '').toLowerCase(),
			ariaLabel: active.getAttribute ? (active.getAttribute('aria-label') || '') : '',
			text: String(active.textContent || '').trim(),
			index: list.indexOf(active)
		};
	}

	function findMatchingDrawerControl(sig) {
		if (!sig) return null;
		if (sig.isClose && currentCloseBtn) return currentCloseBtn;
		var all = listFocusables(aside);
		if (sig.focusKey) {
			for (var i = 0; i < all.length; i++) {
				if (all[i].getAttribute && all[i].getAttribute('data-focus-key') === sig.focusKey) {
					return all[i];
				}
			}
		}
		var secList = listFocusables(getSectionEl(sig.section));
		if (sig.ariaLabel) {
			for (var j = 0; j < secList.length; j++) {
				if (String(secList[j].tagName || '').toLowerCase() === sig.tag &&
					secList[j].getAttribute && secList[j].getAttribute('aria-label') === sig.ariaLabel) {
					return secList[j];
				}
			}
		}
		if (sig.text) {
			for (var k = 0; k < secList.length; k++) {
				if (String(secList[k].tagName || '').toLowerCase() === sig.tag &&
					String(secList[k].textContent || '').trim() === sig.text) {
					return secList[k];
				}
			}
		}
		if (sig.index >= 0 && sig.index < secList.length &&
			String(secList[sig.index].tagName || '').toLowerCase() === sig.tag) {
			return secList[sig.index];
		}
		return null;
	}

	function close() {
		if (!openState) return;
		openState = false;
		currentTitle = '';
		aside.classList.remove('is-open');
		aside.setAttribute('aria-hidden', 'true');
		aside.inert = true;
		aside.setAttribute('inert', '');
		backdrop.classList.remove('is-open');

		var restoreTarget = lastFocused;
		var restoreId = lastFocusedId;
		var restoreTopo = lastFocusedTopo;
		lastFocused = null;
		lastFocusedId = '';
		lastFocusedTopo = null;

		var target = null;
		if (isNodeConnected(restoreTarget)) {
			target = restoreTarget;
		} else if (container) {
			if (restoreId && document.getElementById) {
				var byIdEl = document.getElementById(restoreId);
				if (byIdEl && (!container.contains || container.contains(byIdEl))) target = byIdEl;
			}
			if (!target && restoreTopo && container.querySelectorAll) {
				var nodes = container.querySelectorAll('[data-topo-kind]');
				for (var i = 0; i < nodes.length; i++) {
					if (nodes[i].getAttribute('data-topo-kind') === restoreTopo.kind &&
						nodes[i].getAttribute('data-topo-id') === restoreTopo.id) {
						target = nodes[i];
						break;
					}
				}
			}
		}
		if (target) focusSafe(target);
		if (onClose) onClose();
	}

	function onKeyDown(ev) {
		if (ev.key === 'Escape' && openState) close();
	}

	backdrop.addEventListener('click', close);
	document.addEventListener('keydown', onKeyDown);

	function open(cfg) {
		cfg = cfg || {};
		var wasClosed = !openState;
		var nextTitle = cfg.title !== undefined ? String(cfg.title) : '';
		var sameView = !wasClosed && (cfg.silent === true || nextTitle === currentTitle);
		var prevScroll = wasClosed ? 0 : (bodyEl.scrollTop || 0);
		var active = document.activeElement;
		var focusSig = !wasClosed ? captureDrawerFocus(active) : null;
		var hadFocus = !!focusSig;

		if (wasClosed) {
			if (active && active !== document.body && active !== document.documentElement && (!aside.contains || !aside.contains(active))) {
				lastFocused = active;
				lastFocusedId = active.id || '';
				var tk = active.getAttribute ? active.getAttribute('data-topo-kind') : null;
				var tid = active.getAttribute ? active.getAttribute('data-topo-id') : null;
				lastFocusedTopo = (tk && tid !== null) ? { kind: tk, id: tid } : null;
			} else {
				lastFocused = null;
				lastFocusedId = '';
				lastFocusedTopo = null;
			}
		}

		clearNode(headEl);
		clearNode(bodyEl);
		clearNode(footEl);

		var leftKids = [];
		if (cfg.iconName) {
			var emblemTone = cfg.iconTone || varToTone(cfg.iconColor) || varToTone(cfg.iconBg) || 'ppe';
			leftKids.push(E('div', {
				'class': 'mtkw-drawer-emblem',
				'data-tone': emblemTone
			}, [ icon(cfg.iconName, 18) ]));
		}

		var titleStack = [];
		if (cfg.eyebrow) {
			titleStack.push(E('div', { 'class': 'mtkw-eyebrow mtkw-mono mtkw-drawer-eyebrow' }, String(cfg.eyebrow)));
		}
		if (Array.isArray(cfg.pills) && cfg.pills.length) {
			var pRow = E('div', { 'class': 'mtkw-drawer-pills' });
			appendDomKids(pRow, cfg.pills);
			titleStack.push(pRow);
		}
		titleStack.push(E('div', {
			'id': titleId,
			'class': 'mtkw-mono mtkw-drawer-title'
		}, nextTitle));

		leftKids.push(E('div', { 'class': 'mtkw-drawer-title-stack' }, titleStack));
		headEl.appendChild(E('div', { 'class': 'mtkw-drawer-head-left' }, leftKids));

		var closeBtn = E('button', {
			'type': 'button',
			'class': 'mtkw-btn mtkw-btn-soft mtkw-btn-icon',
			'aria-label': closeLabel,
			'data-focus-key': 'close'
		}, [ icon('close', 15) ]);
		closeBtn.addEventListener('click', close);
		headEl.appendChild(closeBtn);
		currentCloseBtn = closeBtn;

		if (Array.isArray(cfg.breadcrumbs) && cfg.breadcrumbs.length) {
			var crumbRow = E('div', { 'class': 'mtkw-drawer-crumb' });
			cfg.breadcrumbs.forEach(function(c, idx) {
				if (idx > 0) crumbRow.appendChild(E('span', { 'class': 'mtkw-mono mtkw-crumb-sep' }, '→'));
				if (c.current || typeof c.onClick !== 'function') {
					crumbRow.appendChild(E('span', { 'class': 'mtkw-crumb-btn is-current' }, String(c.label)));
				} else {
					var cb = E('button', {
						'type': 'button',
						'class': 'mtkw-crumb-btn',
						'data-focus-key': c.focusKey ? String(c.focusKey) : ('crumb:' + String(c.label))
					}, String(c.label));
					cb.addEventListener('click', c.onClick);
					crumbRow.appendChild(cb);
				}
			});
			bodyEl.appendChild(crumbRow);
		}

		if (Array.isArray(cfg.kpis) && cfg.kpis.length) {
			bodyEl.appendChild(E('div', { 'class': 'mtkw-mib-grid' }, cfg.kpis.map(function(k) {
				return E('div', { 'class': 'mtkw-mib-tile' + (k.err ? ' is-err' : '') }, [
					E('div', { 'class': 'mtkw-mib-lbl' }, String(k.label || '')),
					E('div', { 'class': 'mtkw-mib-val' }, String(k.value !== undefined ? k.value : ''))
				]);
			})));
		}

		appendDomKids(bodyEl, cfg.body);

		if (cfg.footer) {
			appendDomKids(footEl, cfg.footer);
			footEl.hidden = false;
		} else {
			footEl.hidden = true;
		}

		currentTitle = nextTitle;
		openState = true;
		aside.inert = false;
		aside.removeAttribute('inert');
		aside.classList.add('is-open');
		aside.setAttribute('aria-hidden', 'false');
		backdrop.classList.add('is-open');

		if (!wasClosed && (cfg.preserveScroll === true || (cfg.preserveScroll !== false && sameView))) {
			bodyEl.scrollTop = prevScroll;
		} else if (wasClosed || cfg.preserveScroll === false || !sameView) {
			bodyEl.scrollTop = 0;
		}

		if (wasClosed) {
			if (cfg.silent !== true) focusSafe(closeBtn);
		} else if (hadFocus) {
			var shouldPreserve = cfg.silent === true || cfg.preserveFocus === true || sameView;
			if (shouldPreserve) {
				var restored = findMatchingDrawerControl(focusSig);
				focusSafe(restored || closeBtn);
			} else {
				focusSafe(closeBtn);
			}
		}
	}

	function destroy() {
		document.removeEventListener('keydown', onKeyDown);
		backdrop.removeEventListener('click', close);
		openState = false;
		currentTitle = '';
		currentCloseBtn = null;
		lastFocused = null;
		lastFocusedId = '';
		lastFocusedTopo = null;
		if (layer.parentNode) layer.parentNode.removeChild(layer);
	}

	return {
		open: open,
		close: close,
		isOpen: function() { return openState; },
		destroy: destroy
	};
}

/* ── Toast & Clipboard Helpers (HTTP LAN Fallback Safe) ──────────────────── */

function createToast(container) {
	var node = E('div', { 'class': 'mtkw-toast', 'role': 'status', 'aria-live': 'polite' }, '');
	if (container) container.appendChild(node);
	var timer = null;
	return {
		show: function(msg) {
			node.textContent = String(msg || '');
			node.classList.add('is-show');
			if (timer) clearTimeout(timer);
			timer = setTimeout(function() { node.classList.remove('is-show'); }, 2000);
		},
		destroy: function() {
			if (timer) clearTimeout(timer);
			if (node.parentNode) node.parentNode.removeChild(node);
		}
	};
}

function legacyCopy(str) {
	var prev = document.activeElement;
	var ta = null;
	try {
		ta = document.createElement('textarea');
		ta.className = 'mtkw-sr-copy';
		ta.value = str;
		ta.setAttribute('readonly', '');
		document.body.appendChild(ta);
		ta.focus();
		ta.select();
		ta.setSelectionRange(0, ta.value.length);
		var ok = false;
		try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
		return ok;
	} catch (e) {
		return false;
	} finally {
		if (ta && ta.parentNode) ta.parentNode.removeChild(ta);
		if (prev && prev !== document.body && prev !== document.documentElement && typeof prev.focus === 'function') {
			var connected = prev.isConnected !== undefined ? prev.isConnected : (!document.contains || document.contains(prev));
			if (connected) {
				try { prev.focus({ preventScroll: true }); } catch (e) { prev.focus(); }
			}
		}
	}
}

function flashCopyBtn(btnEl, iconSize) {
	if (!btnEl) return;
	if (!btnEl.classList.contains('is-copied')) {
		var orig = [];
		for (var i = 0; i < btnEl.childNodes.length; i++) orig.push(btnEl.childNodes[i].cloneNode(true));
		btnEl._mtkwOrigNodes = orig;
	}
	if (btnEl._mtkwCopyTimer) clearTimeout(btnEl._mtkwCopyTimer);
	btnEl.classList.add('is-copied');
	clearNode(btnEl);
	btnEl.appendChild(icon('check', iconSize || 13));
	btnEl._mtkwCopyTimer = setTimeout(function() {
		btnEl._mtkwCopyTimer = null;
		if (!btnEl.isConnected) return;
		btnEl.classList.remove('is-copied');
		clearNode(btnEl);
		if (btnEl._mtkwOrigNodes && btnEl._mtkwOrigNodes.length) {
			btnEl._mtkwOrigNodes.forEach(function(n) { btnEl.appendChild(n); });
		} else {
			btnEl.appendChild(icon('copy', iconSize || 13));
		}
		btnEl._mtkwOrigNodes = null;
	}, 1400);
}

function copyText(text, btnEl, labels) {
	labels = labels || {};
	var str = String(text == null ? '' : text);
	var done = function(ok) {
		if (ok) flashCopyBtn(btnEl, labels.iconSize || 13);
		if (typeof labels.onCopied === 'function') labels.onCopied(ok);
		return ok;
	};

	if (window.isSecureContext && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
		return navigator.clipboard.writeText(str).then(
			function() { return done(true); },
			function() { return done(legacyCopy(str)); }
		);
	}
	return Promise.resolve(done(legacyCopy(str)));
}

return baseclass.extend({
	E: E,
	svgEl: svgEl,
	CSS_PATH: (tokens && tokens.cssPath) ? tokens.cssPath : 'view/mtk_wed/mtk-wed.css',
	BANDS: BANDS,
	ensureCss: ensureCss,
	syncTheme: syncTheme,
	isDarkMode: isDarkMode,
	hasWifiRadio: hasWifiRadio,
	bandColor: bandColor,
	toneColor: toneColor,
	varToTone: varToTone,
	barFill: barFill,
	portSpeedTone: portSpeedTone,
	esc: esc,
	nf: nf,
	fmtK: fmtK,
	fmtBytes: fmtBytes,
	fmtFreq: fmtFreq,
	fmtMbps: fmtMbps,
	fmtPct: fmtPct,
	clampPct: clampPct,
	icon: icon,
	signalBarsSvg: signalBarsSvg,
	pill: pill,
	badge: badge,
	toggleSwitch: toggleSwitch,
	arcGauge: arcGauge,
	dualRingGauge: dualRingGauge,
	sparklineSvg: sparklineSvg,
	portFaceplateSvg: portFaceplateSvg,
	topologySvg: topologySvg,
	cpuChartSvg: cpuChartSvg,
	coreGrid: coreGrid,
	wifiRingSvg: wifiRingSvg,
	signalBar: signalBar,
	createDrawer: createDrawer,
	createToast: createToast,
	copyText: copyText
});
