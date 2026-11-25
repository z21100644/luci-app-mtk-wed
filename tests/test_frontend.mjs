import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const VIEW_DIR = path.join(REPO_ROOT, 'luci-app-mtk-wed', 'htdocs', 'luci-static', 'resources', 'view', 'mtk_wed');

const TOKENS_SRC = fs.readFileSync(path.join(VIEW_DIR, 'ds-tokens.js'), 'utf8');
const UI_SRC = fs.readFileSync(path.join(VIEW_DIR, 'ui.js'), 'utf8');
const STATUS_SRC = fs.readFileSync(path.join(VIEW_DIR, 'status.js'), 'utf8');
const CSS_SRC = fs.readFileSync(path.join(VIEW_DIR, 'mtk-wed.css'), 'utf8');

/* Crockford jsmin (2013-03-29) matching OpenWrt luci-base minifier */
function jsmin(input) {
	let pos = 0;
	const EOF = -1;
	let theA = '\n', theB = 0, theLookahead = EOF, theX = EOF, theY = EOF;
	const out = [];
	function isAlphanum(c) {
		if (c === EOF || typeof c !== 'string') return false;
		const code = c.charCodeAt(0);
		return (code >= 97 && code <= 122) || (code >= 48 && code <= 57) ||
			(code >= 65 && code <= 90) || c === '_' || c === '$' || c === '\\' || code > 126;
	}
	function get() {
		let c = theLookahead;
		theLookahead = EOF;
		if (c === EOF) c = pos < input.length ? input[pos++] : EOF;
		if (c === EOF || c >= ' ' || c === '\n') return c;
		if (c === '\r') return '\n';
		return ' ';
	}
	function peek() { theLookahead = get(); return theLookahead; }
	function next() {
		let c = get();
		if (c === '/') {
			const p = peek();
			if (p === '/') {
				for (;;) { c = get(); if (c === EOF || c <= '\n') break; }
			} else if (p === '*') {
				get();
				while (c !== ' ') {
					const g = get();
					if (g === '*') { if (peek() === '/') { get(); c = ' '; } }
					else if (g === EOF) throw new Error('Unterminated comment');
				}
			}
		}
		theY = theX;
		theX = c;
		return c;
	}
	function action(d) {
		if (d <= 1) {
			out.push(theA);
			if ((theY === '\n' || theY === ' ') &&
				(theA === '+' || theA === '-' || theA === '*' || theA === '/') &&
				(theB === '+' || theB === '-' || theB === '*' || theB === '/')) out.push(theY);
		}
		if (d <= 2) {
			theA = theB;
			if (theA === "'" || theA === '"') {
				for (;;) {
					out.push(theA);
					theA = get();
					if (theA === theB) break;
					if (theA === '\\') { out.push(theA); theA = get(); }
					if (theA === EOF) throw new Error('Unterminated string');
				}
			}
		}
		if (d <= 3) {
			theB = next();
			if (theB === '/' && '(=,:!&|?;+-~*/{\n['.includes(theA)) {
				out.push(theA);
				if (theA === '/' || theA === '*') out.push(' ');
				out.push(theB);
				for (;;) {
					theA = get();
					if (theA === '[') {
						for (;;) {
							out.push(theA);
							theA = get();
							if (theA === ']') break;
							if (theA === '\\') { out.push(theA); theA = get(); }
							if (theA === EOF) throw new Error('Unterminated set');
						}
					} else if (theA === '/') {
						const p = peek();
						if (p === '/' || p === '*') throw new Error('Unterminated RegExp');
						break;
					} else if (theA === '\\') { out.push(theA); theA = get(); }
					if (theA === EOF) throw new Error('Unterminated RegExp');
					out.push(theA);
				}
				theB = next();
			}
		}
	}
	if (peek() === '\uFEFF') get();
	action(3);
	while (theA !== EOF) {
		if (theA === ' ') action(isAlphanum(theB) ? 1 : 2);
		else if (theA === '\n') {
			if ('{[ (+-!~'.includes(theB) && theB !== ' ') action(1);
			else if (theB === ' ') action(3);
			else action(isAlphanum(theB) ? 1 : 2);
		} else {
			if (theB === ' ') action(isAlphanum(theA) ? 1 : 3);
			else if (theB === '\n') action('}])+-"\'`'.includes(theA) ? 1 : (isAlphanum(theA) ? 1 : 3));
			else action(1);
		}
	}
	return out.join('');
}

function stripRequireDirectives(src) {
	return src.replace(/^\s*'require\s+[^']+';\s*$/gm, '');
}

function findAll(node, pred, out = []) {
	if (!node || node.tagName === '#text') return out;
	if (pred(node)) out.push(node);
	for (const ch of node.children || []) findAll(ch, pred, out);
	return out;
}

function createEnv(opts = {}) {
	let styleAttrCalls = 0;
	let styleTagCreations = 0;
	let nowMs = opts.nowMs || 1700000000000;
	const notifications = [];
	const activeTimeouts = new Set();
	const activeIntervals = new Set();

	class MockNode {
		constructor(tag, ns) {
			this.tagName = tag ? String(tag).toUpperCase() : '#text';
			this.ns = ns || null;
			this.attrs = {};
			this.children = [];
			this.parentNode = null;
			this.listeners = {};
			this.hidden = false;
			this.disabled = false;
			this.selected = false;
			this._value = '';
			this.scrollTop = 0;
			this.style = {};
			this._text = '';
			this._rect = { left: 0, top: 0, width: 560, height: 206 };
			const self = this;
			this.classList = {
				add(...cls) {
					const set = new Set(String(self.attrs.class || '').split(/\s+/).filter(Boolean));
					cls.forEach(c => set.add(c));
					self.attrs.class = Array.from(set).join(' ');
				},
				remove(...cls) {
					const set = new Set(String(self.attrs.class || '').split(/\s+/).filter(Boolean));
					cls.forEach(c => set.delete(c));
					self.attrs.class = Array.from(set).join(' ');
				},
				contains(c) {
					return String(self.attrs.class || '').split(/\s+/).filter(Boolean).includes(c);
				}
			};
		}
		get isConnected() {
			let cur = this;
			while (cur) {
				if (cur === docEl) return true;
				cur = cur.parentNode;
			}
			return false;
		}
		get childNodes() { return this.children; }
		get id() { return this.attrs.id || ''; }
		set id(v) { this.attrs.id = String(v); }
		get value() {
			if (this.tagName === 'SELECT') {
				const sel = this.children.find(o => o.selected) || this.children[0];
				return sel ? (sel.attrs.value || '') : '';
			}
			return this._value;
		}
		set value(v) {
			this._value = String(v);
			if (this.tagName === 'SELECT') {
				this.children.forEach(o => { o.selected = (o.attrs.value === String(v)); });
			}
		}
		get className() { return this.attrs.class || ''; }
		set className(v) { this.attrs.class = String(v); }
		get firstChild() { return this.children[0] || null; }
		get textContent() {
			if (this.tagName === '#text') return this._text;
			return this.children.map(c => c.textContent).join('');
		}
		set textContent(v) {
			if (this.tagName === '#text') { this._text = String(v); return; }
			this.children.forEach(c => { c.parentNode = null; });
			this.children = [];
			if (v !== '' && v !== null && v !== undefined) {
				const t = new MockNode(null);
				t._text = String(v);
				this.appendChild(t);
			}
		}
		setAttribute(k, v) {
			if (String(k).toLowerCase() === 'style') styleAttrCalls++;
			this.attrs[k] = String(v);
			if (k === 'hidden') this.hidden = true;
			if (k === 'disabled') this.disabled = true;
			if (k === 'value') this.value = String(v);
		}
		getAttribute(k) {
			return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null;
		}
		removeAttribute(k) {
			delete this.attrs[k];
			if (k === 'hidden') this.hidden = false;
			if (k === 'disabled') this.disabled = false;
		}
		appendChild(ch) {
			if (!ch) return ch;
			if (ch.parentNode) ch.parentNode.removeChild(ch);
			ch.parentNode = this;
			this.children.push(ch);
			return ch;
		}
		removeChild(ch) {
			const i = this.children.indexOf(ch);
			if (i >= 0) { this.children.splice(i, 1); ch.parentNode = null; }
			return ch;
		}
		replaceChild(n, o) {
			const i = this.children.indexOf(o);
			if (i >= 0) {
				if (n.parentNode) n.parentNode.removeChild(n);
				o.parentNode = null;
				n.parentNode = this;
				this.children[i] = n;
			}
			return o;
		}
		cloneNode() {
			if (this.tagName === '#text') {
				const t = new MockNode(null);
				t._text = this._text;
				return t;
			}
			const cp = new MockNode(this.tagName, this.ns);
			cp.attrs = Object.assign({}, this.attrs);
			this.children.forEach(c => cp.appendChild(c.cloneNode(true)));
			return cp;
		}
		contains(other) {
			let cur = other;
			while (cur) { if (cur === this) return true; cur = cur.parentNode; }
			return false;
		}
		addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); }
		removeEventListener(ev, fn) {
			if (!this.listeners[ev]) return;
			this.listeners[ev] = this.listeners[ev].filter(f => f !== fn);
		}
		dispatch(ev, extra = {}) {
			const e = Object.assign({
				type: ev, target: this, currentTarget: this,
				preventDefault() {}, stopPropagation() {}
			}, extra);
			(this.listeners[ev] || []).slice().forEach(fn => fn.call(this, e));
		}
		click() { this.dispatch('click'); }
		focus() { doc.activeElement = this; }
		blur() { if (doc.activeElement === this) doc.activeElement = doc.body; }
		scrollIntoView() {}
		getBoundingClientRect() { return this._rect; }
		querySelectorAll(sel) { return matchSelectorAll(this, sel); }
		querySelector(sel) { return matchSelectorAll(this, sel)[0] || null; }
	}

	function matchSingle(node, sel) {
		if (node.tagName === '#text') return false;
		sel = sel.trim();
		if (sel.startsWith('#')) return node.id === sel.slice(1);
		const attrM = sel.match(/^([^\[]*)\[([^=\]]+)(?:="([^"]*)")?\]$/);
		if (attrM) {
			const base = attrM[1], attr = attrM[2], val = attrM[3];
			if (base && !matchSingle(node, base)) return false;
			const got = node.getAttribute(attr);
			return val === undefined ? got !== null : got === val;
		}
		if (sel.startsWith('.')) {
			const parts = sel.slice(1).split('.');
			return parts.every(p => node.classList.contains(p));
		}
		const dotIdx = sel.indexOf('.');
		if (dotIdx > 0) {
			return node.tagName === sel.slice(0, dotIdx).toUpperCase() && matchSingle(node, sel.slice(dotIdx));
		}
		return node.tagName === sel.toUpperCase();
	}

	function matchSelectorAll(root, selector) {
		const groups = selector.split(',').map(s => s.trim()).filter(Boolean);
		const out = [];
		function walk(n) {
			for (const c of n.children) {
				for (const g of groups) {
					const parts = g.split(/\s+/);
					if (parts.length === 1) {
						if (matchSingle(c, parts[0]) && !out.includes(c)) out.push(c);
					} else if (matchSingle(c, parts[parts.length - 1])) {
						let anc = c.parentNode, matched = false;
						while (anc) {
							if (matchSingle(anc, parts[0])) { matched = true; break; }
							anc = anc.parentNode;
						}
						if (matched && !out.includes(c)) out.push(c);
					}
				}
				walk(c);
			}
		}
		walk(root);
		return out;
	}

	const head = new MockNode('head');
	const body = new MockNode('body');
	const docEl = new MockNode('html');
	docEl.appendChild(head);
	docEl.appendChild(body);
	const docListeners = {};

	const doc = {
		head, body, documentElement: docEl,
		hidden: !!opts.hidden,
		activeElement: body,
		createElement(t) {
			if (String(t).toLowerCase() === 'style') styleTagCreations++;
			return new MockNode(t);
		},
		createElementNS(ns, t) {
			if (String(t).toLowerCase() === 'style') styleTagCreations++;
			return new MockNode(t, ns);
		},
		createTextNode(s) { const n = new MockNode(null); n._text = String(s); return n; },
		getElementById(id) { return matchSelectorAll(docEl, '#' + id)[0] || null; },
		querySelector(s) { return matchSelectorAll(docEl, s)[0] || null; },
		querySelectorAll(s) { return matchSelectorAll(docEl, s); },
		addEventListener(ev, fn) { (docListeners[ev] = docListeners[ev] || []).push(fn); },
		removeEventListener(ev, fn) { if (docListeners[ev]) docListeners[ev] = docListeners[ev].filter(f => f !== fn); },
		dispatch(ev, extra = {}) {
			const e = Object.assign({ type: ev, preventDefault() {}, stopPropagation() {} }, extra);
			(docListeners[ev] || []).slice().forEach(fn => fn.call(doc, e));
		}
	};

	const lsStore = Object.assign({}, opts.localStorage || {});
	const localStorage = {
		getItem(k) { return Object.prototype.hasOwnProperty.call(lsStore, k) ? lsStore[k] : null; },
		setItem(k, v) { lsStore[k] = String(v); },
		removeItem(k) { delete lsStore[k]; }
	};

	function luciE(tag, attrs, children) {
		const el = doc.createElement(tag);
		if (attrs && typeof attrs === 'object' && !Array.isArray(attrs) && !(attrs instanceof MockNode)) {
			Object.keys(attrs).forEach(k => {
				if (attrs[k] === null || attrs[k] === undefined) return;
				el.setAttribute(k, attrs[k]);
			});
		} else {
			children = attrs;
		}
		function appendAny(c) {
			if (c === null || c === undefined || c === false) return;
			if (Array.isArray(c)) { c.forEach(appendAny); return; }
			if (c instanceof MockNode) { el.appendChild(c); return; }
			el.appendChild(doc.createTextNode(String(c)));
		}
		appendAny(children);
		return el;
	}

	const win = {
		document: doc,
		localStorage,
		E: luciE,
		isSecureContext: false,
		getComputedStyle() { return { backgroundColor: 'rgb(245, 247, 250)' }; },
		matchMedia() { return { matches: false, addEventListener() {} }; },
		addEventListener() {},
		removeEventListener() {}
	};

	const polls = [];
	const poll = {
		add(fn, sec) { polls.push({ fn, sec }); },
		remove(fn) {
			const idx = polls.findIndex(p => p.fn === fn);
			if (idx >= 0) polls.splice(idx, 1);
		}
	};

	const rpcMocks = opts.rpc || {};
	const rpc = {
		declare(spec) {
			return function(...args) {
				const impl = rpcMocks[spec.method];
				if (!impl) return Promise.resolve({});
				try {
					const out = impl(...args);
					return out && typeof out.then === 'function' ? out : Promise.resolve(out);
				} catch (err) {
					return Promise.reject(err);
				}
			};
		}
	};

	const uiMod = {
		addNotification(title, node, kind) {
			notifications.push({ title, text: node ? node.textContent : '', kind });
		}
	};

	const MockDate = class extends Date {
		constructor(...a) {
			if (a.length === 0) super(nowMs);
			else super(...a);
		}
		static now() { return nowMs; }
	};

	const sandbox = {
		window: win,
		document: doc,
		localStorage,
		navigator: {},
		Node: MockNode,
		Date: MockDate,
		setTimeout(fn, ms) {
			const id = setTimeout(() => { activeTimeouts.delete(id); fn(); }, Math.min(Number(ms) || 0, 20));
			activeTimeouts.add(id);
			return id;
		},
		clearTimeout(id) { activeTimeouts.delete(id); clearTimeout(id); },
		setInterval(fn, ms) {
			const id = setInterval(fn, Math.max(50, Number(ms) || 1000));
			activeIntervals.add(id);
			return id;
		},
		clearInterval(id) { activeIntervals.delete(id); clearInterval(id); },
		_: opts.translate || (s => String(s)),
		L: {
			hasViewPermission: () => opts.hasPermission !== false,
			url: p => '/cgi-bin/luci/' + p,
			resource: p => '/luci-static/resources/' + p
		},
		baseclass: { extend: o => o },
		view: { extend: o => o },
		poll,
		rpc,
		ui: uiMod
	};

	vm.createContext(sandbox);
	vm.runInContext(`String.prototype.format = function() {
		var args = arguments, i = 0;
		return this.replace(/%[sd]/g, function() { return String(args[i++]); });
	};`, sandbox);

	const transform = opts.useJsmin ? s => jsmin(stripRequireDirectives(s)) : stripRequireDirectives;
	const tokens = vm.runInContext(`(function() {\n${transform(TOKENS_SRC)}\n})()`, sandbox);
	sandbox.tokens = tokens;
	const aui = vm.runInContext(`(function() {\n${transform(UI_SRC)}\n})()`, sandbox);
	sandbox.aui = aui;
	const viewObj = vm.runInContext(`(function() {\n${transform(STATUS_SRC)}\n})()`, sandbox);

	/* Also expose pure internal helpers from status.js for direct combinatorics */
	const helpers = vm.runInContext(`(function() {\n${stripRequireDirectives(STATUS_SRC).replace(/return\s+view\.extend\([\s\S]*$/, '')}
		return {
			rpcError: rpcError,
			fmtAgeShort: fmtAgeShort,
			flowState: flowState,
			resolveWedBandMap: resolveWedBandMap,
			wedIdForBand: wedIdForBand,
			bandsForWed: bandsForWed,
			bandForWed: bandForWed
		};
	})()`, sandbox);

	function cleanup() {
		while (body.firstChild) body.removeChild(body.firstChild);
		doc.dispatch('visibilitychange');
		for (const id of activeTimeouts) clearTimeout(id);
		for (const id of activeIntervals) clearInterval(id);
		activeTimeouts.clear();
		activeIntervals.clear();
	}

	return {
		sandbox, doc, body, head, polls, notifications, aui, viewObj, helpers,
		advanceTime(deltaMs) { nowMs += deltaMs; },
		getNow() { return nowMs; },
		getStyleAttrCalls() { return styleAttrCalls; },
		getStyleTagCreations() { return styleTagCreations; },
		cleanup
	};
}

const flushAsync = (ms = 35) => new Promise(r => setTimeout(r, ms));

function makeBaseStatus(overrides = {}) {
	return Object.assign({
		model: 'MediaTek Filogic 880',
		compatible: 'mediatek,mt7988a-rfb',
		soc: 'mediatek,mt7988a',
		wo_firmware: '',
		wo_build: '20260301120000',
		cpu: {
			count: 4, arch: 'Cortex-A73', temp_milli: 51000, cpufreq: true,
			governor: 'schedutil', governors: 'schedutil performance powersave',
			frequencies: '1000000 1500000 1800000',
			cur_freq: 1500000, min_freq: 1000000, hw_max_freq: 1800000, max_freq: 1800000,
			cores: [
				{ id: 0, total: 1000, idle: 900, sirq: 10 },
				{ id: 1, total: 1000, idle: 920, sirq: 5 }
			]
		},
		wed: [
			{ id: 0, version: 3, attached: true, rx: true, wo_firmware: '', wo_build: '20260301120000' },
			{ id: 1, version: 3, attached: true, rx: true, wo_firmware: '', wo_build: '20260301120000' }
		],
		wed_param: { module: 'mt7996e', active: true, configured: true },
		flow_offload: { software: true, hardware: true, live_software: true, live_hardware: true }
	}, overrides);
}

function makeBasePorts() {
	return {
		ports: [
			{ netdev: 'eth1', role: 'wan', kind: 'gdm', gdm: 1, media: 'sfp', carrier: 1, speed_mbps: 10000, max_mbps: 10000, duplex: 'full', rx_bytes: 2048, tx_bytes: 4096, rx_packets: 20, tx_packets: 30, rx_errors: 0, tx_errors: 0, rx_dropped: 0, tx_dropped: 0 },
			{ netdev: 'lan1', role: 'lan', kind: 'gsw', gdm: 0, conduit: 'eth0', media: 'rj45', carrier: 1, speed_mbps: 2500, max_mbps: 2500, duplex: 'full', rx_bytes: 1024, tx_bytes: 2048, rx_packets: 10, tx_packets: 15, rx_errors: 0, tx_errors: 0, rx_dropped: 0, tx_dropped: 0 }
		]
	};
}

/* ── 1. Unified PPE Stale Telemetry & Last Good Timestamp ────────────────── */

describe('1. PPE stale consistency & last-good timestamp', () => {
	it('marks Gauge, Topology, open Inspector Drawer, Flows age badge, and Hero Header stale on getPpeEntries rejection', async (t) => {
		let ppeMode = 'ok';
		const env = createEnv({
			useJsmin: true,
			localStorage: { 'luci-app-mtk-wed.view': 'all' },
			rpc: {
				getStatus: () => makeBaseStatus(),
				getPorts: () => makeBasePorts(),
				getMacStats: () => ({ available: true, macs: [{ gdm: 0, netdev: 'eth0', ok: true, tx_packets: 100, rx_packets: 100 }] }),
				getWifiStats: () => ({ available: true, has_wifi: true, complete: true, stations: 1, bands: [{ band: 1, interfaces: 'phy1-ap0', stations: 1, tx_packets: 500, tx_retries: 5, tx_failed: 0, avg_phy_rate: 1200, avg_exp_throughput: 900, airtime_efficiency: 82, avg_signal: -52, min_signal: -58, tx_mbps: 120 }] }),
				getPpeEntries: () => {
					if (ppeMode === 'reject') return Promise.reject(new Error('RPCD timeout reading debugfs'));
					return {
						available: true,
						total: 100, bound: 90, unbound: 10, fin: 0, ipv4: 70, ipv6: 30,
						matched: 1, page: 0, sample_age: 2,
						ppe: [
							{ id: 0, bound: 50, total: 60, unbound: 10, fin: 0, ipv4: 40, ipv6: 20 },
							{ id: 1, bound: 40, total: 40, unbound: 0, fin: 0, ipv4: 30, ipv6: 10 }
						],
						entries: [
							{ ppe: 0, index: '001a', state: 'BND', type: 'IPv4 5T', orig: '192.168.1.10:52341->1.1.1.1:443', new: '203.0.113.2:52341->1.1.1.1:443', eth: 'aa:bb:cc:dd:ee:01->aa:bb:cc:dd:ee:02', vlan: '10', packets: 120, bytes: 96000 }
						]
					};
				}
			}
		});
		t.after(() => env.cleanup());

		await env.viewObj.load();
		const page = env.viewObj.render();
		env.body.appendChild(page);
		await flushAsync();

		/* Fresh baseline assertions */
		assert.ok(page.querySelector('#mtkw-head').textContent.includes('Hardware offload optimal'));
		const freshGauge = page.querySelector('#mtkw-sec-gauges').children[0];
		assert.ok(freshGauge.textContent.includes('90 / 100 bound'));
		assert.ok(!freshGauge.textContent.includes('(stale)'));

		/* Open PPE0 Inspector Drawer BEFORE failure so .catch live update is tested */
		const ppe0Node = findAll(page, n => n.getAttribute('data-topo-kind') === 'ppe' && n.getAttribute('data-topo-id') === '0')[0];
		assert.ok(ppe0Node, 'PPE0 topology node exists');
		ppe0Node.click();
		assert.ok(!page.querySelector('.mtkw-drawer').textContent.includes('Stale'));

		/* Advance clock 45s and fail getPpeEntries */
		env.advanceTime(45000);
		ppeMode = 'reject';
		const ppePoll = env.polls.find(p => p.sec !== 5);
		await ppePoll.fn();
		await flushAsync();

		/* 1) Overview PPE Arc Gauge: warn tone, Stale pill, 90 / 100 bound (stale), preserved ppeLastGoodAt */
		const staleGauge = page.querySelector('#mtkw-sec-gauges').children[0];
		const stalePill = findAll(staleGauge, n => n.classList.contains('mtkw-pill') && n.textContent === 'Stale')[0];
		assert.ok(stalePill, 'Overview PPE gauge shows Stale pill');
		assert.equal(stalePill.getAttribute('data-tone'), 'warn');
		const gaugeStops = findAll(staleGauge, n => n.tagName === 'STOP').map(s => s.getAttribute('stop-color'));
		assert.ok(gaugeStops.includes('var(--mtkw-warn-start)'), 'Overview PPE gauge arc uses warn gradient');
		assert.ok(staleGauge.textContent.includes('90 / 100 bound (stale)'), 'Arc gauge marks retained bound count as (stale)');
		const gaugeSub = staleGauge.querySelector('.mtkw-gauge-sub').textContent;
		assert.match(gaugeSub, /^2 PPE · Stale \(last \d{2}:\d{2}:\d{2}\)$/, 'Gauge subtitle preserves ppeLastGoodAt timestamp');

		/* 2) Datapath Topology PPE node: stale: true and var(--mtkw-warn) styling */
		const stalePpeNode = findAll(page, n => n.getAttribute('data-topo-kind') === 'ppe' && n.getAttribute('data-topo-id') === '0')[0];
		assert.ok(stalePpeNode.textContent.includes('BND 50/60 · Stale'));
		const staleFills = findAll(stalePpeNode, n => n.getAttribute('fill') === 'var(--mtkw-warn)');
		const staleTints = findAll(stalePpeNode, n => n.getAttribute('fill') === 'var(--mtkw-warn-tint)');
		assert.ok(staleFills.length >= 2, 'Topology PPE node uses var(--mtkw-warn) for accent/pct/bar');
		assert.ok(staleTints.length >= 1, 'Topology PPE node icon badge uses var(--mtkw-warn-tint)');
		const mobilePpeTop = findAll(page, n => n.classList.contains('mtkw-mtopo-node') && n.getAttribute('data-topo-kind') === 'ppe')[0];
		assert.equal(mobilePpeTop.querySelector('.mtkw-mtopo-top').getAttribute('data-tone'), 'warn');

		/* 3) Open PPE Inspector Drawer updated on .catch: Stale badge + error + last updated */
		const drawer = page.querySelector('.mtkw-drawer');
		assert.equal(drawer.querySelector('.mtkw-drawer-emblem').getAttribute('data-tone'), 'warn');
		const drawerStalePill = findAll(drawer.querySelector('.mtkw-drawer-pills'), n => n.textContent === 'Stale')[0];
		assert.ok(drawerStalePill && drawerStalePill.getAttribute('data-tone') === 'warn');
		assert.ok(drawer.textContent.includes('RPCD timeout reading debugfs'), 'Drawer displays getPpeEntries error message');
		assert.match(drawer.textContent, /Last updated\d{2}:\d{2}:\d{2} \(47s ago\)/, 'Drawer shows preserved last-good timestamp and elapsed age');

		/* 4) Flows card age badge & Hero Header */
		const flowAge = page.querySelector('#mtkw-flow-age');
		assert.equal(flowAge.getAttribute('data-tone'), 'warn');
		assert.equal(flowAge.textContent, 'Stale · 47s ago');

		const headTxt = page.querySelector('#mtkw-head').textContent;
		assert.ok(headTxt.includes('PPE read failed'), 'Hero header shows PPE read failed warning');
		assert.ok(!headTxt.includes('Hardware offload optimal'), 'Hero header never claims optimal while PPE read failed');
		assert.equal(env.getStyleAttrCalls(), 0);
		assert.equal(env.getStyleTagCreations(), 0);
	});

	it('handles available: false after initial PPE success and clears stale state upon recovery', async (t) => {
		let step = 0;
		const env = createEnv({
			localStorage: { 'luci-app-mtk-wed.view': 'all' },
			rpc: {
				getStatus: () => makeBaseStatus(),
				getPorts: () => makeBasePorts(),
				getMacStats: () => ({ available: true, macs: [] }),
				getWifiStats: () => ({ available: false, has_wifi: false }),
				getPpeEntries: () => {
					step++;
					if (step === 2) return { available: false };
					const bound = step === 1 ? 90 : 95;
					return {
						available: true, total: 100, bound, unbound: 100 - bound, fin: 0, ipv4: bound, ipv6: 0,
						matched: 0, page: 0, sample_age: 0,
						ppe: [{ id: 0, bound, total: 100, unbound: 100 - bound, fin: 0, ipv4: bound, ipv6: 0 }],
						entries: []
					};
				}
			}
		});
		t.after(() => env.cleanup());

		await env.viewObj.load();
		const page = env.viewObj.render();
		env.body.appendChild(page);
		await flushAsync();

		env.advanceTime(125000); // 2m 5s
		const ppePoll = env.polls.find(p => p.sec !== 5);
		await ppePoll.fn();
		await flushAsync();

		const gauge = page.querySelector('#mtkw-sec-gauges').children[0];
		assert.ok(gauge.textContent.includes('90 / 100 bound (stale)'));
		assert.match(gauge.querySelector('.mtkw-gauge-sub').textContent, /^1 PPE · Stale \(last \d{2}:\d{2}:\d{2}\)$/);
		assert.equal(page.querySelector('#mtkw-flow-age').textContent, 'Stale · 2m 5s ago');
		assert.ok(page.querySelector('#mtkw-head').textContent.includes('PPE read failed'));

		/* Recovery on 3rd poll clears all stale warnings */
		env.advanceTime(5000);
		await ppePoll.fn();
		await flushAsync();

		const recoveredGauge = page.querySelector('#mtkw-sec-gauges').children[0];
		assert.ok(recoveredGauge.textContent.includes('95 / 100 bound'));
		assert.ok(!recoveredGauge.textContent.includes('(stale)'));
		assert.ok(page.querySelector('#mtkw-head').textContent.includes('Hardware offload optimal'));
		assert.equal(page.querySelector('#mtkw-flow-age').getAttribute('data-tone'), null);
	});
});

/* ── 2. CPU History Chart Real Sample Timestamps & Gap Breaking ──────────── */

describe('2. CPU chart real timestamps & gap breaking', () => {
	it('renders -10m left axis, gap-broken segments, and accurate hover offsets for samples 600,000 ms apart', (t) => {
		const env = createEnv();
		t.after(() => env.cleanup());

		const t0 = 1700000000000;
		const wrapTwo = env.aui.cpuChartSvg({
			history: [
				{ ts: t0, freq: 1000000, temp: 46 },
				{ ts: t0 + 600000, freq: 1800000, temp: 58 }
			],
			hwMaxFreq: 1800000,
			maxFreq: 1800000,
			minFreq: 1000000,
			labels: { nowLabel: 'Now', unitTemp: '°C', tickSec: 5 }
		});

		const leftAxis = wrapTwo.querySelector('.mtkw-chart-x-start');
		assert.equal(leftAxis.textContent, '-10m', 'Two samples 600,000 ms apart produce -10m (not -5s)');

		/* >15s gap between the 2 samples: zero connecting line paths, 2 crisp isolated dots */
		assert.equal(wrapTwo.querySelectorAll('.mtkw-freq-line').length, 0, 'No connecting frequency line across 10m gap');
		assert.equal(wrapTwo.querySelectorAll('.mtkw-temp-line').length, 0, 'No connecting temperature line across 10m gap');
		const fDots = wrapTwo.querySelectorAll('.mtkw-freq-dot');
		assert.equal(fDots.length, 2);
		assert.equal(fDots[0].getAttribute('cx'), '44.0');
		assert.equal(fDots[1].getAttribute('cx'), '520.0');

		/* Multi-run history with non-uniform spacing + 2m outage gap */
		const wrapRuns = env.aui.cpuChartSvg({
			history: [
				{ ts: t0, freq: 1000000, temp: 45 },
				{ ts: t0 + 5000, freq: 1500000, temp: 49 },
				{ ts: t0 + 135000, freq: 1800000, temp: 54 },
				{ ts: t0 + 140000, freq: 1800000, temp: 55 }
			],
			hwMaxFreq: 1800000,
			maxFreq: 1800000,
			minFreq: 1000000,
			labels: { nowLabel: 'Now', unitTemp: '°C', tickSec: 5 }
		});

		assert.equal(wrapRuns.querySelector('.mtkw-chart-x-start').textContent, '-2m 20s');
		const freqLines = wrapRuns.querySelectorAll('.mtkw-freq-line');
		const tempLines = wrapRuns.querySelectorAll('.mtkw-temp-line');
		assert.equal(freqLines.length, 2, 'Frequency path splits into 2 contiguous segments across >15s gap');
		assert.equal(tempLines.length, 2, 'Temperature path splits into 2 contiguous segments across >15s gap');

		/* Proportional X: idx=1 is at 5s / 140s -> 44 + (5/140)*476 = 61.0 (not uniform 44 + 476/3 = 202.7) */
		assert.match(freqLines[0].getAttribute('d'), /^M44\.0,[0-9.]+ L61\.0,[0-9.]+$/);

		/* Hover lookup uses real X positions rather than uniform index assumption */
		const svg = wrapRuns.querySelector('svg');
		const tip = wrapRuns.querySelector('.mtkw-chart-tip');
		svg.dispatch('mousemove', { clientX: 61 });
		assert.equal(tip.textContent, '-2m 15s · 1500 MHz · 49.0 °C');
		svg.dispatch('mousemove', { clientX: 520 });
		assert.equal(tip.textContent, 'Now · 1800 MHz · 55.0 °C');
	});

	it('preserves legacy { freq, temp } fallback without ts and keeps null temperatures index-aligned', (t) => {
		const env = createEnv();
		t.after(() => env.cleanup());

		const wrap = env.aui.cpuChartSvg({
			history: [
				{ freq: 1000000, temp: 47 },
				{ freq: 1500000, temp: null },
				{ freq: 1800000, temp: 53 },
				{ freq: 1200000, temp: null }
			],
			hwMaxFreq: 1800000,
			maxFreq: 1800000,
			minFreq: 1000000,
			labels: { nowLabel: 'Now', unitTemp: '°C', tickSec: 5 }
		});

		assert.equal(wrap.querySelector('.mtkw-chart-x-start').textContent, '-15s');
		assert.equal(wrap.querySelectorAll('.mtkw-freq-line').length, 1);
		assert.equal(wrap.querySelectorAll('.mtkw-temp-line').length, 0);

		const tDots = wrap.querySelectorAll('.mtkw-temp-dot');
		assert.deepEqual(tDots.map(d => d.getAttribute('data-idx')), ['0', '2']);
		/* Index 2 in 4-point uniform plot is at 44 + (2/3)*476 = 361.3 */
		assert.equal(tDots[1].getAttribute('cx'), '361.3');

		const svg = wrap.querySelector('svg');
		const tip = wrap.querySelector('.mtkw-chart-tip');
		svg.dispatch('mousemove', { clientX: 203 }); // nearest idx = 1 (temp === null)
		assert.equal(tip.textContent, '-10s · 1500 MHz · —');
	});

	it('wires status.js refresh() real Date.now() timestamps end-to-end into #mtkw-sec-cpu chart', async (t) => {
		const env = createEnv({
			useJsmin: true,
			localStorage: { 'luci-app-mtk-wed.view': 'offload' },
			rpc: {
				getStatus: () => makeBaseStatus(),
				getPorts: () => makeBasePorts(),
				getMacStats: () => ({ available: true, macs: [] }),
				getWifiStats: () => ({ available: false, has_wifi: false }),
				getPpeEntries: () => ({ available: true, total: 0, bound: 0, unbound: 0, fin: 0, ipv4: 0, ipv6: 0, matched: 0, page: 0, sample_age: 0, ppe: [{ id: 0, bound: 0, total: 0 }], entries: [] })
			}
		});
		t.after(() => env.cleanup());

		await env.viewObj.load();
		const page = env.viewObj.render();
		env.body.appendChild(page);
		await flushAsync();

		/* Advance 10 minutes (600,000 ms) before 2nd status poll */
		env.advanceTime(600000);
		const statusPoll = env.polls.find(p => p.sec === 5);
		await statusPoll.fn();
		await flushAsync();

		const cpuCard = page.querySelector('#mtkw-sec-cpu');
		assert.equal(cpuCard.querySelector('.mtkw-chart-x-start').textContent, '-10m');
		assert.equal(cpuCard.querySelectorAll('.mtkw-freq-line').length, 0, '10m poll pause breaks line into isolated dots');
		assert.equal(cpuCard.querySelectorAll('.mtkw-freq-dot').length, 2);
	});
});

/* ── 3. Symmetric & Honest WED ↔ Wi-Fi Band Mapping ──────────────────────── */

describe('3. WED <-> Wi-Fi band symmetry & unmapped topology edges', () => {
	it('guarantees exact mathematical symmetry across all WED attachment masks and band subsets', (t) => {
		const env = createEnv();
		t.after(() => env.cleanup());
		const { resolveWedBandMap, wedIdForBand, bandsForWed, bandForWed } = env.helpers;

		const wedIdSets = [ [], [0], [1], [2], [0, 1], [0, 2], [1, 2], [0, 1, 2] ];
		const bandIdSets = [ [], [0], [1], [2], [0, 1], [0, 2], [1, 2], [0, 1, 2] ];

		let checkedTopologies = 0;
		for (const wIds of wedIdSets) {
			const maskCount = 1 << wIds.length;
			for (let mask = 0; mask < maskCount; mask++) {
				const weds = wIds.map((id, idx) => ({
					id,
					version: 3,
					attached: Boolean(mask & (1 << idx)),
					rx: true
				}));
				const attachedCount = weds.filter(w => w.attached).length;

				for (const bIds of bandIdSets) {
					const bands = bIds.map(band => ({ band, interfaces: 'phy' + band + '-ap0', stations: 1 }));
					const map = resolveWedBandMap(weds, bands);
					checkedTopologies++;

					assert.equal(map.estimated, attachedCount > 1 && bands.length > 0);

					/* Unattached WEDs NEVER map to any band */
					for (const w of weds) {
						const wb = Array.from(bandsForWed(w.id, weds, bands));
						if (!w.attached) {
							assert.deepEqual(wb, [], `Unattached WED${w.id} must have [] bands`);
						}
						assert.equal(bandForWed(w.id, weds, bands), wb[0] || null);
					}

					/* Exact bijective membership: b in bandsForWed(w) <=> wedIdForBand(b) === w */
					for (const b of bands) {
						const mappedWed = wedIdForBand(b.band, weds, bands);
						if (attachedCount === 0) {
							assert.equal(mappedWed, null, 'Band must map to null when 0 WEDs attached');
						} else {
							const targetW = weds.find(w => w.id === mappedWed);
							assert.ok(targetW && targetW.attached, 'Band must map only to an attached WED');
						}
						for (const w of weds) {
							const inWedList = bandsForWed(w.id, weds, bands).some(x => x.band === b.band);
							assert.equal(inWedList, mappedWed === w.id,
								`Symmetry violated for weds=${JSON.stringify(weds)} bands=${JSON.stringify(bIds)} w=${w.id} b=${b.band}`);
						}
					}
				}
			}
		}
		assert.ok(checkedTopologies >= 200, `Verified ${checkedTopologies} WED/band topologies`);

		/* Specific asymmetric bug repro: weds=[0,1] attached + bands=[{band:1}] */
		const w01 = [{ id: 0, attached: true }, { id: 1, attached: true }];
		const bOnly5G = [{ band: 1 }];
		assert.equal(wedIdForBand(1, w01, bOnly5G), 1);
		assert.deepEqual(Array.from(bandsForWed(1, w01, bOnly5G)).map(b => b.band), [1]);
		assert.deepEqual(Array.from(bandsForWed(0, w01, bOnly5G)), []);
		assert.equal(bandForWed(0, w01, bOnly5G), null);
	});

	it('draws 0 WED->Wi-Fi edges when b.wedId === null and renders symmetric WED/Wi-Fi Inspector drawers', async (t) => {
		const env = createEnv({
			localStorage: { 'luci-app-mtk-wed.view': 'overview' },
			rpc: {
				getStatus: () => makeBaseStatus({
					wed: [
						{ id: 0, version: 3, attached: true, rx: true, wo_build: '20260301120000' },
						{ id: 1, version: 3, attached: true, rx: true, wo_build: '20260301120000' }
					]
				}),
				getPorts: () => makeBasePorts(),
				getMacStats: () => ({ available: true, macs: [] }),
				getWifiStats: () => ({
					available: true, has_wifi: true, complete: true, stations: 1,
					bands: [{ band: 1, interfaces: 'phy1-ap0', stations: 1, tx_packets: 100, tx_retries: 0, tx_failed: 0, avg_phy_rate: 1200, avg_exp_throughput: 900, airtime_efficiency: 85, avg_signal: -50, min_signal: -55, tx_mbps: 100 }]
				}),
				getPpeEntries: () => ({ available: true, total: 10, bound: 8, unbound: 2, fin: 0, ipv4: 10, ipv6: 0, matched: 0, page: 0, sample_age: 0, ppe: [{ id: 0, bound: 8, total: 10, unbound: 2, fin: 0, ipv4: 10, ipv6: 0 }], entries: [] })
			}
		});
		t.after(() => env.cleanup());

		/* Direct topologySvg check: wedId: null draws 0 wed-wifi edges; wedId: undefined preserves legacy fallback */
		const unmappedTopo = env.aui.topologySvg({
			ports: [], gdmStats: [], ppeList: [{ id: 0, bound: 5, total: 10 }],
			wedList: [{ id: 0, attached: false }, { id: 1, attached: false }],
			wifiBands: [{ band: 0, wedId: null, stations: 1 }, { band: 1, wedId: null, stations: 1 }],
			hwOffload: true,
			selectedKey: 'wifi:0'
		});
		assert.equal(unmappedTopo.querySelectorAll('[data-edge="wed-wifi"]').length, 0, 'wedId: null draws 0 WED->Wi-Fi edges');
		const wed0UnmappedNode = findAll(unmappedTopo, n => n.getAttribute('data-topo-kind') === 'wed' && n.getAttribute('data-topo-id') === '0')[0];
		assert.ok(wed0UnmappedNode.classList.contains('is-dim'), 'Selecting unmapped Wi-Fi band does not highlight unattached WED0');

		const legacyTopo = env.aui.topologySvg({
			ports: [], gdmStats: [], ppeList: [],
			wedList: [{ id: 0, attached: true, rx: true }],
			wifiBands: [{ band: 0, stations: 1 }], // wedId omitted (undefined)
			hwOffload: true
		});
		assert.equal(legacyTopo.querySelectorAll('[data-edge="wed-wifi"]').length, 1, 'Legacy wedId: undefined still draws WED->Wi-Fi edge');

		/* Full view Inspector check for weds=[0,1] + bands=[{band:1}] */
		await env.viewObj.load();
		const page = env.viewObj.render();
		env.body.appendChild(page);
		await flushAsync();

		/* Inspect WED0: must show Band "—" (NOT 5G!) and 0 inspect-wifi buttons */
		findAll(page, n => n.getAttribute('data-topo-kind') === 'wed' && n.getAttribute('data-topo-id') === '0')[0].click();
		const drawer = page.querySelector('.mtkw-drawer');
		assert.ok(drawer.textContent.includes('Band—'), 'WED0 Inspector shows Band — when only 5 GHz is active on WED1');
		assert.equal(findAll(drawer, n => String(n.getAttribute('data-focus-key') || '').startsWith('inspect-wifi')).length, 0);

		/* Inspect WED1: must show 5G (~), Estimated badge, and multi-WED estimation note */
		findAll(page, n => n.getAttribute('data-topo-kind') === 'wed' && n.getAttribute('data-topo-id') === '1')[0].click();
		assert.ok(drawer.textContent.includes('Band5G (~)'));
		assert.ok(drawer.textContent.includes('Estimated'));
		assert.ok(drawer.textContent.includes('Band-to-WED pairing is estimated on multi-WED hardware.'));
	});
});

/* ── 4. Core Frontend Regressions & Strict-CSP / jsmin Hygiene ───────────── */

describe('4. Core frontend regressions (flowState, handleApplyCpu, read-only ACL, jsmin)', () => {
	it('evaluates flowState() 9-combination UCI vs live_hardware matrix without null aliasing cfgHw', (t) => {
		const env = createEnv();
		t.after(() => env.cleanup());
		const { flowState, rpcError } = env.helpers;

		const cases = [
			{ fo: { software: null, hardware: null, live_software: null, live_hardware: null }, text: 'Unknown', hwActive: null, on: false, mismatch: false, unknown: true },
			{ fo: { software: true, hardware: true, live_software: null, live_hardware: null }, text: 'Configured enabled', hwActive: null, on: true, mismatch: false, unknown: false },
			{ fo: { software: true, hardware: false, live_software: null, live_hardware: null }, text: 'Software only (configured)', hwActive: null, on: false, mismatch: false, unknown: false },
			{ fo: { software: false, hardware: false, live_software: null, live_hardware: null }, text: 'Configured disabled', hwActive: null, on: false, mismatch: false, unknown: false },
			{ fo: { software: true, hardware: true, live_software: true, live_hardware: true }, text: 'Enabled', hwActive: true, on: true, mismatch: false, unknown: false },
			{ fo: { software: true, hardware: true, live_software: false, live_hardware: false }, text: 'Configured enabled, rule not active', hwActive: false, on: true, mismatch: true, unknown: false },
			{ fo: { software: false, hardware: false, live_software: true, live_hardware: true }, text: 'Configured disabled, rule still active', hwActive: true, on: false, mismatch: true, unknown: false },
			{ fo: { software: null, hardware: null, live_software: true, live_hardware: true }, text: 'Rule active (config unknown)', hwActive: true, on: false, mismatch: true, unknown: false },
			{ fo: { software: null, hardware: null, live_software: false, live_hardware: false }, text: 'Rule inactive (config unknown)', hwActive: false, on: false, mismatch: false, unknown: true },
			{ fo: { software: true, hardware: false, live_software: true, live_hardware: false }, text: 'Software only', hwActive: false, on: false, mismatch: false, unknown: false },
			{ fo: { software: false, hardware: false, live_software: false, live_hardware: false }, text: 'Disabled', hwActive: false, on: false, mismatch: false, unknown: false }
		];

		for (const tc of cases) {
			const res = flowState({ flow_offload: tc.fo });
			assert.equal(res.text, tc.text);
			assert.equal(res.hwActive, tc.hwActive);
			assert.equal(res.on, tc.on);
			assert.equal(res.mismatch, tc.mismatch);
			assert.equal(res.unknown, tc.unknown);
		}

		assert.equal(rpcError('cannot restore previous CPU settings'), 'cannot restore previous CPU settings');
	});

	it('rejects unconfirmed {} or mismatched replies in handleApplyCpu and accepts confirmed reply', async (t) => {
		let cpuReply = {};
		const env = createEnv({
			useJsmin: true,
			localStorage: { 'luci-app-mtk-wed.view': 'offload' },
			rpc: {
				getStatus: () => makeBaseStatus(),
				getPorts: () => makeBasePorts(),
				getMacStats: () => ({ available: true, macs: [] }),
				getWifiStats: () => ({ available: false, has_wifi: false }),
				getPpeEntries: () => ({ available: true, total: 0, bound: 0, unbound: 0, fin: 0, ipv4: 0, ipv6: 0, matched: 0, page: 0, sample_age: 0, ppe: [{ id: 0, bound: 0, total: 0 }], entries: [] }),
				setCpuSettings: () => cpuReply
			}
		});
		t.after(() => env.cleanup());

		await env.viewObj.load();
		const page = env.viewObj.render();
		env.body.appendChild(page);
		await flushAsync();

		/* 1) Empty object {} must be rejected without mutating CPU state */
		const govSel = page.querySelector('#mtkw-cpu-gov');
		const freqSel = page.querySelector('#mtkw-cpu-maxf');
		govSel.value = 'performance';
		govSel.dispatch('change');
		freqSel.value = '1500000';
		freqSel.dispatch('change');
		page.querySelector('form.mtkw-cpu-panel').dispatch('submit');
		await flushAsync();

		const statusSpan = page.querySelector('.mtkw-cpu-save-status');
		assert.ok(statusSpan.classList.contains('is-err'));
		assert.equal(statusSpan.textContent, 'Error: The CPU settings update could not be confirmed.');
		assert.ok(!env.notifications.some(n => n.text.includes('CPU settings saved')));

		/* 2) Confirmed positive reply succeeds */
		cpuReply = { result: 'ok', governor: 'performance', freq: 1500000 };
		page.querySelector('#mtkw-cpu-gov').value = 'performance';
		page.querySelector('#mtkw-cpu-gov').dispatch('change');
		page.querySelector('#mtkw-cpu-maxf').value = '1500000';
		page.querySelector('#mtkw-cpu-maxf').dispatch('change');
		page.querySelector('form.mtkw-cpu-panel').dispatch('submit');
		await flushAsync();

		const okSpan = page.querySelector('.mtkw-cpu-save-status');
		assert.ok(okSpan.classList.contains('is-ok'));
		assert.equal(okSpan.textContent, 'Applied performance · 1500 MHz');
		assert.ok(env.notifications.some(n => n.text.includes('CPU settings saved')));
	});

	it('disables all write controls and shows Read-only badge when ACL view permission is read-only', async (t) => {
		const env = createEnv({
			hasPermission: false,
			localStorage: { 'luci-app-mtk-wed.view': 'all' },
			rpc: {
				getStatus: () => makeBaseStatus({
					wed_param: { module: 'mt7996e', active: false, configured: true } // triggers reboot banner too
				}),
				getPorts: () => makeBasePorts(),
				getMacStats: () => ({ available: true, macs: [] }),
				getWifiStats: () => ({ available: false, has_wifi: false }),
				getPpeEntries: () => ({ available: true, total: 0, bound: 0, unbound: 0, fin: 0, ipv4: 0, ipv6: 0, matched: 0, page: 0, sample_age: 0, ppe: [{ id: 0, bound: 0, total: 0 }], entries: [] })
			}
		});
		t.after(() => env.cleanup());

		await env.viewObj.load();
		const page = env.viewObj.render();
		env.body.appendChild(page);
		await flushAsync();

		assert.ok(page.querySelector('#mtkw-head').textContent.includes('Read-only'));
		assert.equal(page.querySelector('#mtkw-switch-hw').disabled, true);
		assert.equal(page.querySelector('#mtkw-switch-wed').disabled, true);
		assert.equal(page.querySelector('#mtkw-cpu-gov').disabled, true);
		assert.equal(page.querySelector('#mtkw-cpu-maxf').disabled, true);
		assert.equal(page.querySelector('#mtkw-btn-cpu-save').disabled, true);
		assert.equal(page.querySelector('#mtkw-btn-reboot-revert').disabled, true);
	});

	it('maintains pure LF, zero innerHTML, Strict-CSP safety, and Crockford jsmin compatibility', () => {
		for (const [name, src] of [['ds-tokens.js', TOKENS_SRC], ['ui.js', UI_SRC], ['status.js', STATUS_SRC], ['mtk-wed.css', CSS_SRC]]) {
			assert.equal(src.includes('\r'), false, `${name} must use pure LF (0 CR)`);
			assert.equal(src.charCodeAt(0) === 0xFEFF, false, `${name} must not have UTF-8 BOM`);
		}
		for (const [name, src] of [['ds-tokens.js', TOKENS_SRC], ['ui.js', UI_SRC], ['status.js', STATUS_SRC]]) {
			const minified = jsmin(stripRequireDirectives(src));
			assert.equal(/\binnerHTML\b/.test(minified), false, `${name} must never use innerHTML in executable code`);
			assert.doesNotThrow(() => new vm.Script(`(function() {\n${minified}\n})()`, { filename: name + '.min.js' }), `${name} must compile cleanly after Crockford jsmin`);
		}
		assert.equal(/\.style\b/.test(STATUS_SRC), false, 'status.js must have zero .style mutations');
	});
});
