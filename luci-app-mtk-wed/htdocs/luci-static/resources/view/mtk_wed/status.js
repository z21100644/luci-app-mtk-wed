'use strict';
'require view';
'require poll';
'require rpc';
'require ui';
'require view.mtk_wed.ui as aui';

/*
 * SPDX-License-Identifier: Apache-2.0
 *
 * Hardware offload status for MediaTek Filogic SoCs on the mainline kernel.
 * Layout follows luci-app-airoha-npu; the data comes from luci.mtk_wed.
 */

/* Text-safe E() from ui.js: backend strings must never be parsed as HTML. */
var E = aui.E;

var callStatus = rpc.declare({ object: 'luci.mtk_wed', method: 'getStatus', params: [ 'skip_ppe' ], reject: true });
var callPorts = rpc.declare({ object: 'luci.mtk_wed', method: 'getPorts', reject: true });
var callPpeEntries = rpc.declare({ object: 'luci.mtk_wed', method: 'getPpeEntries', params: [ 'page', 'state', 'type', 'ppe', 'refresh', 'interval' ], nobatch: true, reject: true });
var callMacStats = rpc.declare({ object: 'luci.mtk_wed', method: 'getMacStats', reject: true });
var callWifiStats = rpc.declare({ object: 'luci.mtk_wed', method: 'getWifiStats', reject: true });
var callSetFlowOffload = rpc.declare({ object: 'luci.mtk_wed', method: 'setFlowOffload', params: [ 'enabled' ], reject: true });
var callSetWedEnable = rpc.declare({ object: 'luci.mtk_wed', method: 'setWedEnable', params: [ 'enabled' ], reject: true });
var callSetCpuSettings = rpc.declare({ object: 'luci.mtk_wed', method: 'setCpuSettings', params: [ 'governor', 'freq' ], reject: true });

/* Users granted only the read part of the ACL get the page without controls. */
var readonly = !L.hasViewPermission();

/* LuCI appends a stack line to RPC errors; keep the message only. */
function errText(e) {
	return String((e && e.message) || e).split('\n')[0];
}

function notifyError(e) {
	ui.addNotification(null, E('p', {}, _('Error: %s').format(errText(e))), 'error');
}

/* Sections folded away, a view preference kept in this browser only, like
 * the PPE refresh interval. */
var FOLD_KEY = 'luci-app-mtk-wed.folded';
function foldedKeys() {
	try {
		var v = JSON.parse(window.localStorage.getItem(FOLD_KEY));
		if (Array.isArray(v)) return v;
	} catch (e) {}
	return [];
}

/* o.onOpen runs when the section is opened: what is drawn to its width
 * cannot be drawn while it is folded. */
function foldSection(key, o) {
	var opened = o.onOpen;
	o.key = key;
	o.collapsed = foldedKeys().indexOf(key) >= 0;
	o.onToggle = function(collapsed) {
		var keys = foldedKeys().filter(function(k) { return k !== key; });
		if (collapsed) keys.push(key);
		try { window.localStorage.setItem(FOLD_KEY, JSON.stringify(keys)); } catch (e) {}
		if (!collapsed && opened) opened();
	};
	return aui.section(o);
}

function setText(id, text) {
	var el = document.getElementById(id);
	if (el) el.textContent = text;
}

/* ── Port names ──────────────────────────────────────────────────────────
 * Named after the highest speed the port supports (max_mbps from ethtool or
 * the DT phy-mode), so a label does not change while a link renegotiates. */
function speedTag(mbps) {
	mbps = Number(mbps) || 0;
	if (mbps >= 10000) return '10G';
	if (mbps >= 5000) return '5G';
	if (mbps >= 2500) return '2.5G';
	if (mbps >= 1000) return '1G';
	if (mbps >= 100) return '100M';
	return '';
}

function portName(p) {
	var tag = speedTag(p.max_mbps || p.speed_mbps);
	return (tag ? tag + ' ' : '') + (p.role === 'wan' ? 'WAN' : 'LAN') + ' (' + p.netdev + ')';
}

function gdmLabel(gdm) {
	return (gdm === null || gdm === undefined) ? '—' : 'GDM' + (Number(gdm) + 1);
}

function hasGdm(p) {
	return p.role !== 'conduit' && p.gdm !== null && p.gdm !== undefined;
}

/* The ports behind one GDM, DSA user ports included. */
function gdmPorts(gdm, ports) {
	return (ports || []).filter(function(p) {
		return hasGdm(p) && Number(p.gdm) === Number(gdm);
	}).map(portName);
}

/* The PPEs a SoC has (mtk_soc_data.ppe_num), not the ones whose debugfs
 * could be read: three on MT7988, two on MT7981/MT7986/MT7987. */
function socPpeNum(soc) {
	soc = String(soc || '');
	return /mt7988/.test(soc) ? 3 : /mt798[167]/.test(soc) ? 2 : 0;
}

/* mtk_eth_soc.c (ppe_idx): GDM3 and GDM2 have their own PPE when the SoC has
 * that many; the rest use PPE0. Without a known SoC the PPE is unknown. */
function gdmPpe(gdm, ppeNum) {
	if (!ppeNum) return 'PPE ?';
	gdm = Number(gdm);
	return 'PPE' + (ppeNum >= 3 && gdm === 2 ? 2 : ppeNum >= 2 && gdm === 1 ? 1 : 0);
}

/* ── Formatting ── */
function fmtBytes(v) {
	if (typeof v !== 'number' || !isFinite(v)) return 'N/A';
	var u = [ 'B', 'KiB', 'MiB', 'GiB', 'TiB' ], i = 0;
	while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
	return (i ? v.toFixed(2) : v.toFixed(0)) + ' ' + u[i];
}

function fmtCount(v) {
	return (typeof v === 'number' && isFinite(v)) ? v.toLocaleString('en-US') : 'N/A';
}

/* mtk_ppe_debugfs prints IPv6 with %pI6 (eight full groups) and appends
 * ":port" without brackets. Shorten the address and bracket it when a port
 * follows, as RFC 5952 says, so the port is not read as part of it. */
function compactV6(s) {
	return String(s || '').replace(/\b([0-9a-f]{4}(?::[0-9a-f]{4}){7})(?::(\d{1,5}))?\b/gi, function(m, addr, port) {
		var groups = addr.split(':').map(function(g) { return g.replace(/^0+(?=.)/, ''); });
		var best = -1, bestLen = 1, cur = -1, len = 0;
		for (var i = 0; i <= groups.length; i++) {
			if (i < groups.length && groups[i] === '0') { if (cur < 0) cur = i; len = i - cur + 1; }
			else { if (len > bestLen) { best = cur; bestLen = len; } cur = -1; len = 0; }
		}
		var c = best < 0 ? groups.join(':')
			: groups.slice(0, best).join(':') + '::' + groups.slice(best + bestLen).join(':');
		return port ? '[' + c + ']:' + port : c;
	});
}

function prettyFlow(s) {
	return s ? compactV6(s).replace('->', ' → ') : '-';
}

/* ── Ethernet ports ── */
function renderPorts(pt) {
	pt = pt || {};
	var ports = (Array.isArray(pt.ports) ? pt.ports : []).filter(function(p) {
		return p.role !== 'conduit';
	}).sort(function(a, b) {
		if ((a.role === 'wan') !== (b.role === 'wan')) return a.role === 'wan' ? -1 : 1;
		return String(a.netdev).localeCompare(String(b.netdev), undefined, { numeric: true });
	});
	var t = aui.table({
		cols: [
			{ t: _('Port') }, { t: _('Path') }, { t: _('Link') }, { t: _('Speed / Duplex') },
			{ t: _('RX / TX bytes'), num: true }, { t: _('RX / TX packets'), num: true },
			{ t: _('RX / TX errors'), num: true }, { t: _('RX / TX dropped'), num: true }
		],
		rows: ports.map(function(p) {
			var up = p.carrier === 1;
			var path = p.kind === 'gsw'
				? _('Switch') + ' ' + p.netdev + ' → ' + gdmLabel(p.gdm)
				: gdmLabel(p.gdm);
			return [
				portName(p),
				path,
				aui.pill(up ? _('Link up') : _('Link down'), up ? 'ok' : ''),
				up && p.speed_mbps > 0 ? p.speed_mbps + ' Mbps' + (p.duplex ? ' / ' + p.duplex : '') : 'N/A',
				fmtBytes(p.rx_bytes) + ' / ' + fmtBytes(p.tx_bytes),
				fmtCount(p.rx_packets) + ' / ' + fmtCount(p.tx_packets),
				fmtCount(p.rx_errors) + ' / ' + fmtCount(p.tx_errors),
				fmtCount(p.rx_dropped) + ' / ' + fmtCount(p.tx_dropped)
			];
		}),
		emptyText: _('Port data unavailable'), stack: true
	});
	t.classList.add('ai-port-table');
	return t;
}

function portSummary(pt) {
	var ports = (Array.isArray((pt || {}).ports) ? pt.ports : []).filter(function(p) { return p.role !== 'conduit'; });
	return ports.length ? _('%d / %d up').format(ports.filter(function(p) { return p.carrier === 1; }).length, ports.length) : '';
}

/* ── CPU ── */
var cpuDirty = false, cpuSaving = false;
/* Saves bump this when they start and when they end: a status read that
 * overlaps a save may carry the old settings and must not show them. */
var settingsGen = 0, statusRefresh = function() {};
function settingsSaved() { settingsGen++; statusRefresh(); }
function settingsCurrent(owner) { return owner === activePage && (!owner || owner.isConnected); }
var FREQ_HISTORY_MAX = 120;
var freqHistory = [];

function governorLabel(g) {
	var labels = {
		conservative: _('conservative'), ondemand: _('ondemand'), performance: _('performance'),
		powersave: _('powersave'), schedutil: 'schedutil', userspace: _('userspace')
	};
	return labels[g] || g;
}

/* "mediatek,mt7981b" -> "MT7981B" */
function socName(s) {
	return s ? String(s).replace(/^[^,]*,/, '').toUpperCase() : '';
}

/* The WO firmware trailer holds no real version, only a placeholder such as
 * "____000000" or "DEV_000000"; its build time tells the firmwares apart. */
function woFirmware(w) {
	var ver = String(w.wo_firmware || '').trim(), built = String(w.wo_build || '').trim();
	var m = /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)$/.exec(built);
	if (m) built = m[1] + '-' + m[2] + '-' + m[3] + ' ' + m[4] + ':' + m[5] + ':' + m[6];
	if (!built) return ver || 'N/A';
	built = _('Built %s').format(built);
	return /^[A-Za-z_]*0+$/.test(ver) || !ver ? built : ver + ' · ' + built;
}

function cpuSummary(st) {
	var c = (st && st.cpu) || {};
	return [ c.cpufreq !== false && c.cur_freq > 0 ? Math.round(c.cur_freq / 1000) + ' MHz' : '',
		c.temp_milli ? (c.temp_milli / 1000).toFixed(1) + ' °C' : '' ].filter(Boolean).join(' · ');
}

function renderCpuInfo(st) {
	var c = (st && st.cpu) || {};
	return aui.card({
		name: _('CPU Info'), tag: _('CPU model / temperature'), accent: 'var(--ai-npu)',
		body: [
			aui.row(_('Model'), socName(st.soc) || st.compatible || '—'),
			aui.row(_('Architecture'), c.arch || '—'),
			aui.row(_('Core Count'), c.count ? String(c.count) : '—'),
			aui.row(_('Temperature'), c.temp_milli ? (c.temp_milli / 1000).toFixed(1) + ' °C' : 'N/A'),
			c.cpufreq === false ? E('div', { 'class': 'ai-hint', 'style': 'margin:var(--ds-sp-2) 0 0' },
				_('CPU frequency scaling is not available on this board')) : null
		]
	});
}

function cpuSelect(id, values, current, label) {
	var opts = values.map(function(v) {
		return E('option', { 'value': v, 'selected': String(v) === String(current) ? '' : null }, label(v));
	});
	/* A current value outside the list (or unread) is shown as unknown, not
	 * as the first option, and cannot be saved as such. */
	if (!values.length) opts = [ E('option', { 'value': '' }, 'N/A') ];
	else if (values.map(String).indexOf(String(current)) < 0) opts.unshift(E('option', { 'value': '', 'selected': '' }, '—'));
	var sel = E('select', { 'id': id, 'class': 'cbi-input-select', 'change': function() { cpuDirty = true; } }, opts);
	if (!values.length || readonly) sel.disabled = true;
	return sel;
}

function renderCpuControl(st) {
	var owner = activePage;
	var c = (st && st.cpu) || {};
	var govs = String(c.governors || '').split(/\s+/).filter(Boolean);
	var freqs = String(c.frequencies || '').split(/\s+/).filter(Boolean);
	cpuDirty = false;
	var gs = cpuSelect('mtkw-gov', govs, c.governor, governorLabel);
	var fs = cpuSelect('mtkw-maxf', freqs, c.max_freq, function(f) { return Math.round(f / 1000) + ' MHz'; });
	function valid() {
		return c.cpufreq && !readonly && govs.indexOf(gs.value) >= 0 &&
			freqs.indexOf(fs.value) >= 0 && /^[0-9]+$/.test(fs.value) &&
			Number.isSafeInteger(Number(fs.value)) && Number(fs.value) > 0;
	}
	function updateSave() { save.disabled = cpuSaving || !valid(); }
	var save = E('button', {
		'class': 'ai-btn ai-btn--primary',
		'click': function(ev) {
			if (!settingsCurrent(owner) || cpuSaving || !valid()) return;
			/* The form is locked while the save runs, so the reply always
			 * belongs to what is shown and a later edit cannot be lost. */
			var form = [ save, gs, fs ], was = form.map(function(el) { return el.disabled; });
			var unlock = function() { cpuSaving = false; save.textContent = _('Save'); form.forEach(function(el, i) { el.disabled = was[i]; }); settingsSaved(); };
			cpuSaving = true;
			settingsGen++;
			form.forEach(function(el) { el.disabled = true; });
			save.textContent = _('Saving…');
			callSetCpuSettings(gs.value, Number(fs.value)).then(function(r) {
				if (!settingsCurrent(owner)) return;
				unlock();
				/* Saved or not, the form follows the backend again. */
				cpuDirty = false;
				if (r && r.error)
					notifyError(_(r.error));
				else
					ui.addNotification(null, E('p', {}, _('CPU settings saved — they will persist after a reboot')), 'info');
			}).catch(function(e) { if (!settingsCurrent(owner)) return; unlock(); cpuDirty = false; notifyError(e); });
		}
	}, _('Save'));
	/* The backend takes only a listed governor and frequency. */
	updateSave();
	gs.addEventListener('change', updateSave);
	fs.addEventListener('change', updateSave);
	return aui.card({
		name: _('CPU Control'), accent: 'var(--ds-ok)',
		body: E('div', { 'class': 'ai-form' }, [
			E('div', { 'class': 'ai-field' }, [
				E('label', { 'class': 'ai-field-label', 'for': 'mtkw-gov' }, _('Governor')),
				gs
			]),
			E('div', { 'class': 'ai-field' }, [
				E('label', { 'class': 'ai-field-label', 'for': 'mtkw-maxf' }, _('Max Freq')),
				fs
			]),
			save
		])
	});
}

var SVG_NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs, children) {
	var el = document.createElementNS(SVG_NS, tag);
	for (var k in attrs) el.setAttribute(k, attrs[k]);
	(children || []).forEach(function(c) { el.appendChild(c); });
	return el;
}

function renderFreqChart(c, width) {
	var lo = c.min_freq || 800000, hi = c.hw_max_freq || c.max_freq || lo * 2, n = freqHistory.length;
	if (!n || hi <= lo) return aui.empty(_('No data'));
	var W = Math.round(width > 0 ? width : 600), H = 120, px = 6, top = 16, ih = H - top - 6, iw = W - px * 2;
	var pts = freqHistory.map(function(f, i) {
		var x = px + (FREQ_HISTORY_MAX - n + i) / (FREQ_HISTORY_MAX - 1) * iw;
		var y = top + ih - (Math.min(Math.max(f, lo), hi) - lo) / (hi - lo) * ih;
		return [ x, y ];
	});
	if (pts.length === 1) pts.unshift([ px, pts[0][1] ]);
	var line = pts.map(function(p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); });
	var area = [ pts[0][0].toFixed(1) + ',' + (top + ih) ].concat(line, [ pts[pts.length - 1][0].toFixed(1) + ',' + (top + ih) ]);
	var grid = 'stroke:var(--ds-border);stroke-width:1;stroke-dasharray:3 3';
	var lbl = 'fill:var(--ds-text-muted);font-size:9px;font-family:var(--ds-mono)';
	var last = pts[pts.length - 1];
	return svgEl('svg', { 'viewBox': '0 0 ' + W + ' ' + H, 'width': '100%', 'height': H, 'style': 'display:block', 'role': 'img', 'aria-label': _('Frequency History') }, [
		svgEl('line', { 'x1': px, 'y1': top, 'x2': W - px, 'y2': top, 'style': grid }),
		svgEl('line', { 'x1': px, 'y1': top + ih, 'x2': W - px, 'y2': top + ih, 'style': grid }),
		svgEl('text', { 'x': px + 2, 'y': top - 4, 'style': lbl }, [ document.createTextNode(Math.round(hi / 1000) + ' MHz') ]),
		svgEl('text', { 'x': px + 2, 'y': top + ih - 4, 'style': lbl }, [ document.createTextNode(Math.round(lo / 1000) + ' MHz') ]),
		/* The latest sample, so the chart answers "now" before it fills up. */
		svgEl('text', { 'x': W - px - 2, 'y': top - 4, 'text-anchor': 'end', 'style': lbl + ';fill:var(--ds-ok);font-size:11px;font-weight:700' },
			[ document.createTextNode(Math.round(freqHistory[n - 1] / 1000) + ' MHz') ]),
		svgEl('polygon', { 'points': area.join(' '), 'style': 'fill:var(--ds-ok);opacity:.12;stroke:none' }),
		svgEl('polyline', { 'points': line.join(' '), 'style': 'fill:none;stroke:var(--ds-ok);stroke-width:2;stroke-linejoin:round' }),
		svgEl('circle', { 'cx': last[0], 'cy': last[1], 'r': '3', 'style': 'fill:var(--ds-ok)' })
	]);
}

/* ── Offload engines ── */
function wedSummary(st) {
	var wed = Array.isArray(st.wed) ? st.wed : [];
	var attached = wed.filter(function(w) { return w.attached; }).length;
	return { total: wed.length, attached: attached };
}

function renderTiles(st) {
	/* No good PPE reply yet: the counts are unknown, not missing. */
	var known = Array.isArray(st.ppe), ppe = known ? st.ppe : [];
	var unknownValue = st.ppeFailed ? '—' : '…', unknownText = st.ppeFailed ? _('Unknown') : _('Loading…');
	var bound = 0, total = 0;
	ppe.forEach(function(p) { bound += p.bound || 0; total += p.total || 0; });
	var ws = wedSummary(st), wp = st.wed_param || {};
	var wedValue, wedAccent, wedSub;
	/* No status read yet: unknown, not missing. */
	if (!Array.isArray(st.wed)) { wedValue = '—'; wedAccent = 'var(--ds-text-muted)'; wedSub = _('Unknown'); }
	else if (!ws.total) { wedValue = _('Not available'); wedAccent = 'var(--ds-text-muted)'; wedSub = _('No WED instances found'); }
	else if (ws.attached) { wedValue = _('Active'); wedAccent = 'var(--ds-ok)'; wedSub = ws.attached + ' / ' + ws.total + ' ' + _('WED attached'); }
	else { wedValue = _('Inactive'); wedAccent = 'var(--ds-warn)'; wedSub = wp.active === false ? _('Disabled in the Wi-Fi driver') : _('No Wi-Fi device attached'); }
	var c = st.cpu || {};
	return E('div', { 'class': 'ai-grid ai-grid--tiles' }, [
		aui.tile({ title: _('PPE Engines'), value: ppe.length ? String(ppe.length) : known ? 'N/A' : unknownValue, accent: ppe.length ? 'var(--ai-npu)' : 'var(--ds-text-muted)',
			sub: ppe.length ? _('Packet processing engines') : known ? _('PPE debugfs not found') : unknownText }),
		aui.tile({ title: _('Wi-Fi Acceleration (WED)'), value: wedValue, accent: wedAccent, sub: wedSub }),
		aui.tile({ title: _('Offload Statistics'), value: known ? bound + ' / ' + total : unknownValue, accent: total ? 'var(--ai-npu)' : 'var(--ds-text-muted)',
			sub: _('Bound / total PPE flows') }),
		aui.tile({ title: _('CPU Temperature'), value: c.temp_milli ? (c.temp_milli / 1000).toFixed(1) : '—', unit: c.temp_milli ? '°C' : '',
			accent: 'var(--ds-ok)', sub: c.count ? c.count + ' ' + _('cores') + ' · ' + socName(st.soc) : _('Unknown') })
	]);
}

function offloadSummary(st) {
	if (!Array.isArray(st.ppe) || !st.ppe.length) return '';
	var bound = 0, total = 0;
	st.ppe.forEach(function(p) { bound += p.bound || 0; total += p.total || 0; });
	return _('%d / %d bound').format(bound, total);
}

function flowState(st) {
	var fo = st.flow_offload || {};
	return fo.hardware ? { on: true, kind: 'ok', text: _('Enabled') }
		: fo.software ? { on: false, kind: '', text: _('Software only') }
			: { on: false, kind: '', text: _('Disabled') };
}

function wedState(st) {
	var wp = st.wed_param || {};
	var active = wp.active, conf = wp.configured;
	if (active === null || active === undefined)
		return { on: !!conf, kind: '', text: _('Wi-Fi driver not loaded') };
	if (conf !== null && conf !== undefined && conf !== active)
		return { on: !!conf, kind: 'warn', text: _('Reboot required') };
	return active ? { on: true, kind: 'ok', text: _('Enabled') } : { on: false, kind: '', text: _('Disabled') };
}

/* A change on its way to the router: the switch is locked and its state
 * pulses until the reply. */
function setBusy(input, on) {
	var row = input.closest('.ai-switch-row');
	if (row) row.setAttribute('data-busy', on ? 'true' : 'false');
}

function setSwitch(rowId, state) {
	applySwitch(document.getElementById(rowId), state);
}

function applySwitch(row, state) {
	if (!row) return;
	var input = row.querySelector('input');
	/* A change in flight disables the input; anything else follows the
	 * backend, focused or not. */
	if (input && (readonly || !input.disabled)) input.checked = state.on;
	row.setAttribute('data-on', state.on ? 'true' : 'false');
	row.setAttribute('data-blocked', state.kind === 'warn' ? 'true' : 'false');
	var pill = row.querySelector('.ai-pill');
	if (pill) {
		pill.className = 'ai-pill' + (state.kind ? ' ai-pill--' + state.kind : '');
		pill.textContent = '';
		pill.appendChild(E('span', { 'class': 'dot' }));
		pill.appendChild(document.createTextNode(state.text));
	}
}

/* known=false: no status has arrived yet, so the switches show an unknown
 * state and stay locked instead of offering "Disabled" as a fact. */
function renderSwitches(st, known) {
	var owner = activePage;
	var unknown = { on: false, kind: '', text: _('Unknown') };
	var fs = known ? flowState(st) : unknown, ws = known ? wedState(st) : unknown, wp = st.wed_param || {};
	var flow = aui.switchRow({
		rowId: 'mtkw-flow', inputId: 'mtkw-flow-i', badgeId: 'mtkw-flow-b',
		name: _('Hardware Flow Offload'), note: 'flow_offloading_hw',
		on: fs.on, onLabel: fs.text, offLabel: fs.text,
		onChange: function(input) {
			if (!settingsCurrent(owner) || readonly || !known || input.disabled) return;
			var val = input.checked ? 1 : 0;
			input.disabled = true;
			setBusy(input, true);
			settingsGen++;
			callSetFlowOffload(val).then(function(r) {
				if (!settingsCurrent(owner)) return;
				input.disabled = false;
				setBusy(input, false);
				if (r && r.error) { input.checked = !val; notifyError(_(r.error)); }
				settingsSaved();
			}).catch(function(e) { if (!settingsCurrent(owner)) return; input.disabled = false; setBusy(input, false); input.checked = !val; notifyError(e); settingsSaved(); });
		}
	});
	var wed = aui.switchRow({
		rowId: 'mtkw-wed', inputId: 'mtkw-wed-i', badgeId: 'mtkw-wed-b',
		name: _('Wi-Fi Acceleration (WED)'), note: (wp.module ? wp.module + ' ' : '') + 'wed_enable · ' + _('takes effect after a reboot'),
		on: ws.on, onLabel: ws.text, offLabel: ws.text,
		onChange: function(input) {
			if (!settingsCurrent(owner) || readonly || !known || input.disabled) return;
			var val = input.checked ? 1 : 0;
			input.disabled = true;
			setBusy(input, true);
			settingsGen++;
			callSetWedEnable(val).then(function(r) {
				if (!settingsCurrent(owner)) return;
				input.disabled = false;
				setBusy(input, false);
				settingsSaved();
				if (r && r.error) { input.checked = !val; notifyError(_(r.error)); return; }
				ui.addNotification(null, E('p', {}, _('Saved. Reboot the router to apply the Wi-Fi acceleration change.')), 'info');
			}).catch(function(e) { if (!settingsCurrent(owner)) return; input.disabled = false; setBusy(input, false); input.checked = !val; notifyError(e); settingsSaved(); });
		}
	});
	if (readonly || !known) [ flow, wed ].forEach(function(row) { row.querySelector('input').disabled = true; });
	setTimeout(function() { applySwitch(flow, fs); applySwitch(wed, ws); }, 0);
	return E('div', { 'class': 'ai-offload-controls ai-grid ai-grid--2' }, [ flow, wed ]);
}

/* One card for all PPEs and one for all WEDs, side by side. */
function renderEngines(st) {
	var known = Array.isArray(st.ppe), ppe = known ? st.ppe : [];
	var wed = Array.isArray(st.wed) ? st.wed : [];
	var cards = [];
	/* Before the first PPE reply the counts are unknown, not zero. */
	if (ppe.length || (!known && wed.length)) {
		var sum = { bound: 0, total: 0, unbound: 0, ipv4: 0, ipv6: 0 }, u = st.ppeFailed ? '—' : '…';
		ppe.forEach(function(p) { Object.keys(sum).forEach(function(k) { sum[k] += p[k] || 0; }); });
		var rate = sum.total ? sum.bound / sum.total * 100 : 0;
		cards.push(aui.card({
			name: _('PPE Engines'), tag: ppe.map(function(p) { return 'PPE' + p.id; }).join(' + '), accent: 'var(--ai-npu)',
			body: [
				aui.bar({ pct: rate, accent: 'var(--ai-npu)', title: _('Bind rate'), right: !known ? u : sum.total ? rate.toFixed(1) + '%' : '—' }),
				aui.row(_('Bound'), known ? String(sum.bound) : u),
				aui.row(_('Total'), known ? String(sum.total) : u),
				aui.row(_('Unbound'), known ? String(sum.unbound) : u),
				aui.row('IPv4 / IPv6', known ? sum.ipv4 + ' / ' + sum.ipv6 : u)
			]
		}));
	}
	if (wed.length) {
		var attached = wed.filter(function(w) { return w.attached; }).length;
		var versions = wed.map(function(w) { return 'v' + (w.version != null ? w.version : '?'); }).filter(function(v, i, a) { return a.indexOf(v) === i; });
		/* WO runs only where the WED also offloads receiving; a TX-only WED
		 * (the second PCIe link of an MT7996) has none. */
		cards.push(aui.card({
			name: 'WED', tag: attached ? _('ACTIVE') : _('IDLE'),
			accent: attached ? 'var(--ds-ok)' : 'var(--ds-border-strong)',
			body: [ aui.row(_('Version / attached'), versions.join(' / ') + ' · ' + attached + ' / ' + wed.length) ].concat(wed.map(function(w) {
				/* rx is null when the register dump could not be read: say so,
				 * and keep a WO firmware that was logged for this WED. */
				var wo = w.wo_firmware || w.wo_build ? ' · WO ' + woFirmware(w) : '';
				return aui.row('WED' + w.id, !w.attached ? _('Not attached') : w.rx === true ? _('TX + RX') + ' · WO ' + woFirmware(w)
					: w.rx === false ? _('TX only') : _('TX, RX unknown') + wo);
			}))
		}));
	}
	if (!cards.length) return aui.empty(!known ? (st.ppeFailed ? _('Unknown') : _('Loading…')) : !Array.isArray(st.wed) ? _('Unknown')
		: _('No PPE or WED debugfs entries were found. Is debugfs mounted?'));
	return E('div', { 'class': 'ai-grid ai-grid--2' }, cards);
}

function renderMacs(ms, pt, st) {
	ms = ms || {};
	var ppeNum = socPpeNum(st && st.soc);
	var head = [ E('div', { 'class': 'ai-subhead' }, _('MAC Counters (GDM)')) ];
	if (!ms.available) {
		head.push(aui.empty(ms.reason === 'ethtool_missing'
			? _('Install the ethtool package to show the hardware MAC counters.')
			: _('MAC counters are unavailable.')));
		return E('div', {}, head);
	}
	head.push(E('p', { 'class': 'ai-hint' }, _('Hardware MIB counters of each GDM, read with ethtool -S.')));
	head.push(E('div', { 'class': 'ai-grid ai-grid--3' }, (ms.macs || []).map(function(m) {
		var body = [
			aui.row(_('TX packets'), aui.fmtK(m.tx_packets)),
			aui.row(_('RX packets'), aui.fmtK(m.rx_packets))
		];
		[ [ 'rx_overflow', _('RX overflow') ], [ 'rx_fcs_errors', _('FCS errors') ], [ 'rx_checksum_errors', _('Checksum errors') ],
		  [ 'rx_flow_control_packets', _('Flow control frames') ] ].forEach(function(k) {
			if (m[k[0]] > 0) body.push(aui.row(k[1], aui.fmtK(m[k[0]]), k[0] === 'rx_flow_control_packets' ? null : 'ai-err'));
		});
		var names = gdmPorts(m.gdm, pt && pt.ports);
		if (names.length) body.unshift(E('div', { 'class': 'ai-chips' }, names.map(function(n) { return E('span', { 'class': 'ai-chip' }, n); })));
		return aui.card({ name: gdmLabel(m.gdm), tag: m.netdev + ' · ' + gdmPpe(m.gdm, ppeNum), accent: 'var(--ai-npu)', body: body });
	})));
	return E('div', {}, head);
}

/* ── Wi-Fi bands ── */
/* The body of the Wi-Fi section, or null to hide it: no radio, or no
 * access point running. A failed query keeps the section with its reason,
 * so it does not look like a router without Wi-Fi. */
function renderWifi(wf, st) {
	wf = wf || {};
	var bands = Array.isArray(wf.bands) ? wf.bands : [];
	if (wf.available === false) {
		if (!wf.has_wifi) return null;
		return { body: aui.empty(wf.error
			? _('Cannot read the Wi-Fi statistics: %s').format(_(wf.error))
			: _('Install iw to see the Wi-Fi statistics.')), summary: '' };
	}
	if (!bands.length && wf.complete !== false) return null;
	var partial = wf.complete === false ? E('div', { 'class': 'ai-hint', 'style': 'margin:0 0 var(--ds-sp-2)' },
		_('Some Wi-Fi data could not be read or saved; the rates may be incomplete.')) : null;
	var path = !Array.isArray((st || {}).wed) ? '' : wedSummary(st).attached ? 'WED' : 'DMA';
	var clients = bands.reduce(function(n, b) { return n + (b.stations || 0); }, 0);
	return { summary: _('%d clients').format(clients), body: E('div', {}, [ partial, E('div', { 'class': 'ai-grid ai-grid--3' }, bands.map(function(b) {
		var info = aui.BANDS[b.band];
		var accent = info ? 'var(' + info.varName + ')' : 'var(--ds-border-strong)';
		var retry = (b.tx_packets + b.tx_retries) > 0 ? b.tx_retries / (b.tx_packets + b.tx_retries) * 100 : 0;
		var health = !b.stations ? [ _('No clients'), '' ] : retry > 50 ? [ _('Poor'), 'error' ] : retry > 20 ? [ _('Fair'), 'warn' ] : [ _('Good'), 'ok' ];
		var ifs = String(b.interfaces || '').split(/\s+/).filter(Boolean);
		return aui.card({
			name: info ? info.full : _('Band') + ' ' + b.band, tag: path, accent: accent,
			body: [
				ifs.length ? E('div', { 'class': 'ai-chips' }, ifs.map(function(n) { return E('span', { 'class': 'ai-chip' }, n); })) : null,
				aui.bar({ pct: b.airtime_efficiency, accent: accent, title: _('Airtime'), right: (b.airtime_efficiency || 0) + '%' }),
				aui.row(_('Status'), aui.pill(health[0], health[1])),
				aui.row(_('Clients'), String(b.stations || 0)),
				aui.row(_('Retry'), retry.toFixed(1) + '%'),
				aui.row(_('PHY / Expected'), aui.fmtMbps(b.avg_phy_rate) + ' / ' + aui.fmtMbps(b.avg_exp_throughput)),
				aui.row(_('Failed'), String(b.tx_failed || 0)),
				aui.row(_('Signal'), b.stations ? b.avg_signal + ' / ' + b.min_signal : 'N/A'),
				aui.row(_('TX'), aui.fmtMbps(b.tx_mbps) + ' Mbps')
			]
		});
	})) ]) };
}

/* ── PPE flow table ── */
var PAGE_SIZE = 50;
var flowRefresh = function() {};
/* Seconds between PPE table reads. It is a view preference, so it is kept
 * in this browser only and needs no write access to the router. */
var PPE_INTERVALS = [ 5, 10, 20, 30, 60 ], PPE_INTERVAL_KEY = 'luci-app-mtk-wed.ppe-interval';
var ppeInterval = (function() {
	try {
		var v = Number(window.localStorage.getItem(PPE_INTERVAL_KEY));
		if (PPE_INTERVALS.indexOf(v) >= 0) return v;
	} catch (e) {}
	return 10;
})();
var ppeIntervalSet = function() {};
var flowFilter = { state: '', type: '', ppe: '' }, flowPage = 0, flowData = { entries: [] };

function filteredFlows() {
	return (flowData.entries || []).filter(function(e) {
		return (!flowFilter.state || e.state === flowFilter.state) &&
			(!flowFilter.type || String(e.type).indexOf(flowFilter.type) === 0) &&
			(flowFilter.ppe === '' || String(e.ppe) === flowFilter.ppe);
	});
}

function flowCountText() {
	var d = flowData;
	if (d.available === false) return _('PPE table unavailable') + (d.error ? ': ' + d.error : '');
	var s = (d.total || 0) + ' ' + _('flows') + ' · BND ' + (d.bound || 0) + ' / UNB ' + (d.unbound || 0) +
		' · IPv4 ' + (d.ipv4 || 0) + ' / IPv6 ' + (d.ipv6 || 0);
	if (d.truncated) s += ' · ' + _('showing') + ' ' + (d.entries || []).length;
	if (d.updatedAt) s += ' · ' + _('Updated %s').format(d.updatedAt);
	return s;
}

/* Matches of the last reply: the backend pages its own matches, an older
 * one returns every row for the page to filter and split. */
function flowMatched() {
	return (flowData.page >= 0 ? flowData.matched : filteredFlows().length) || 0;
}

function flowPages() {
	return Math.max(1, Math.ceil(flowMatched() / PAGE_SIZE));
}

function updatePager(pages) {
	/* A failed read keeps the page, not a range of rows it cannot show. */
	var n = flowData.available === false ? 0 : flowMatched();
	setText('mtkw-page', (flowPage + 1) + ' / ' + pages);
	setText('mtkw-range', n ? _('%d–%d of %d').format(flowPage * PAGE_SIZE + 1, Math.min((flowPage + 1) * PAGE_SIZE, n), n) : '');
	var prev = document.getElementById('mtkw-prev'), next = document.getElementById('mtkw-next');
	if (prev) prev.disabled = flowPage === 0;
	if (next) next.disabled = flowPage + 1 >= pages;
}

/* "Clear filters" is offered while any filter is set. */
function syncFilterUi() {
	var clear = document.getElementById('mtkw-clear');
	if (clear) clear.hidden = !flowFilter.state && !flowFilter.type && flowFilter.ppe === '';
}

function updateFlowTable() {
	var paged = flowData.page >= 0;
	var rows = paged ? (flowData.entries || []) : filteredFlows();
	var pages = flowPages();
	flowPage = Math.min(flowPage, pages - 1);
	var tbody = document.querySelector('#mtkw-flows tbody');
	if (!tbody) return;
	tbody.textContent = '';
	var slice = paged ? rows : rows.slice(flowPage * PAGE_SIZE, (flowPage + 1) * PAGE_SIZE);
	if (!slice.length)
		tbody.appendChild(E('tr', {}, [ E('td', { 'colspan': '9' }, aui.empty(flowData.available === false ? _('PPE table unavailable') : _('No matching flows'))) ]));
	slice.forEach(function(e) {
		tbody.appendChild(E('tr', {}, [
			E('td', { 'class': 'f-key', 'data-label': 'PPE' }, 'PPE' + e.ppe),
			E('td', { 'class': 'f-key ai-num', 'data-label': _('Index') }, e.index),
			E('td', { 'class': 'f-key', 'data-label': _('State') }, aui.badge(e.state, e.state === 'BND' ? 'bnd' : 'unb')),
			E('td', { 'class': 'f-key', 'data-label': _('Type') }, e.type),
			E('td', { 'class': 'f-vlan', 'data-label': 'VLAN' }, e.vlan || '-'),
			E('td', { 'class': 'f-flow', 'data-label': _('Original Flow'), 'style': 'color:var(--ai-npu)' }, prettyFlow(e.orig)),
			E('td', { 'class': 'f-flow', 'data-label': _('New Flow') }, prettyFlow(e['new'])),
			E('td', { 'class': 'f-cnt ai-num', 'data-label': _('Packets') }, fmtCount(e.packets)),
			E('td', { 'class': 'f-cnt ai-num', 'data-label': _('Bytes') }, fmtBytes(e.bytes))
		]));
	});
	updatePager(pages);
	var badge = document.getElementById('mtkw-flow-count');
	if (badge) badge.textContent = flowCountText();
}

/* Offer the PPEs this SoC has: two on MT7981/MT7986/MT7987, three on MT7988. */
function syncPpeFilter(ppe) {
	var sel = document.getElementById('mtkw-ppe-filter');
	if (!sel || !Array.isArray(ppe)) return;
	var ids = ppe.map(function(p) { return String(p.id); });
	if (sel.getAttribute('data-ids') === ids.join(',')) return;
	sel.setAttribute('data-ids', ids.join(','));
	while (sel.options.length > 1) sel.remove(1);
	ids.forEach(function(id) { sel.appendChild(E('option', { 'value': id }, 'PPE' + id)); });
	/* Rebuilding the options drops the selection: restore it, or clear the
	 * filter once its PPE is gone. */
	if (ids.indexOf(flowFilter.ppe) < 0) flowFilter.ppe = '';
	sel.value = flowFilter.ppe;
	syncFilterUi();
}

/* How often the table is read; it sits in the section head. */
function renderIntervalSelect() {
	return E('select', { 'id': 'mtkw-ppe-interval', 'aria-label': _('Refresh interval'), 'title': _('Refresh interval'),
		'change': function(ev) { ppeIntervalSet(Number(ev.target.value)); } },
		PPE_INTERVALS.map(function(n) {
			return E('option', { 'value': n, 'selected': n === ppeInterval ? '' : null }, _('Every %d s').format(n));
		}));
}

/* Filters above the table, the pager below it, where reading a page ends. */
function renderFlowTable() {
	var filters = [];
	function filter(label, key, values) {
		var sel = E('select', { 'aria-label': label, 'change': function(ev) {
			flowFilter[key] = ev.target.value; flowPage = 0; syncFilterUi(); flowRefresh();
		} }, [ E('option', { 'value': '' }, label) ].concat(values.map(function(v) {
			return E('option', { 'value': v[0] }, v[1]);
		})));
		filters.push(sel);
		return sel;
	}
	var head = [ 'PPE', _('Index'), _('State'), _('Type'), 'VLAN', _('Original Flow'), _('New Flow'), _('Packets'), _('Bytes') ];
	var stateSel = filter(_('All states'), 'state', [ [ 'BND', 'BND' ], [ 'UNB', 'UNB' ], [ 'FIN', 'FIN' ] ]);
	var typeSel = filter(_('All types'), 'type', [ [ 'IPv4', 'IPv4' ], [ 'IPv6', 'IPv6' ], [ 'DS-LITE', 'DS-LITE' ], [ '6RD', '6RD' ] ]);
	var ppeSel = filter(_('All PPEs'), 'ppe', []);
	ppeSel.id = 'mtkw-ppe-filter';
	return E('div', {}, [
		E('div', { 'class': 'ai-flowbar' }, [
			stateSel, typeSel, ppeSel,
			E('button', { 'type': 'button', 'class': 'cbi-button', 'id': 'mtkw-clear', 'hidden': '',
				'click': function() {
					flowFilter = { state: '', type: '', ppe: '' }; flowPage = 0;
					filters.forEach(function(sel) { sel.value = ''; });
					syncFilterUi(); flowRefresh();
				} }, _('Clear filters'))
		]),
		E('div', { 'class': 'ai-table-wrap ai-flows-wrap' }, [
			E('table', { 'class': 'ai-table ai-table--mono ai-table--stack ai-flows', 'id': 'mtkw-flows' }, [
				E('thead', {}, E('tr', {}, head.map(function(h) { return E('th', { 'scope': 'col' }, h); }))),
				E('tbody', {})
			])
		]),
		E('div', { 'class': 'ai-flowfoot' }, [
			E('span', { 'class': 'ai-muted', 'id': 'mtkw-range' }, ''),
			E('span', { 'class': 'ai-spacer' }),
			E('span', { 'class': 'ai-pager' }, [
				E('button', { 'type': 'button', 'class': 'cbi-button', 'id': 'mtkw-prev', 'aria-label': _('Previous page'),
					'click': function() { if (flowPage > 0) { flowPage--; updatePager(flowPages()); flowRefresh(); } } }, '‹'),
				E('span', { 'id': 'mtkw-page', 'style': 'min-width:5em;text-align:center;font-variant-numeric:tabular-nums' }, '1 / 1'),
				E('button', { 'type': 'button', 'class': 'cbi-button', 'id': 'mtkw-next', 'aria-label': _('Next page'),
					'click': function() {
						var pages = flowPages();
						if (flowPage + 1 < pages) { flowPage++; updatePager(pages); flowRefresh(); }
					} }, '›')
			])
		])
	]);
}

/* ── View ── */
/* The view that owns the page. An SPA theme (luci-theme-footstrap) builds a
 * new instance on a revisit while replies of the old one are on the way,
 * and both find their elements by the same ids. */
var activePage = null;

function replace(id, node) {
	var el = document.getElementById(id);
	if (!el) return;
	el.textContent = '';
	if (node) el.appendChild(node);
}

return view.extend({
	load: function() {
		aui.ensureCss();
		return Promise.resolve();
	},

	render: function() {
		aui.ensureCss();
		/* Module state belongs to one view: a new one starts clean. */
		cpuDirty = cpuSaving = false; freqHistory = [];
		flowFilter = { state: '', type: '', ppe: '' }; flowPage = 0; flowData = { entries: [] };
		var updated = E('span', { 'class': 'ai-updated' }, '');
		/* Shown once a reply finds Wi-Fi to show. */
		var wifiSection = foldSection('wifi', { id: 'mtkw-wifi', title: _('WiFi Band Details'), summaryId: 'mtkw-wifi-sum',
			hint: _('Per-band airtime efficiency, negotiated and expected rates, and failure counts.'),
			body: E('div', { 'id': 'mtkw-wifi-body' }) });
		wifiSection.hidden = true;
		/* A div, not a header: themes style every header (Bootstrap makes it
		 * a sticky flex bar). The order of luci-app-airoha-npu: the ports and
		 * the CPU, the offload they feed, Wi-Fi, and the long flow table last.
		 * Every section folds; a folded one keeps a summary in its head. */
		var page = E('div', { 'class': 'cbi-map mtkw-page' }, [
			E('div', { 'class': 'ai-pagehead' }, [
				E('div', { 'class': 'ai-pagehead-text' }, [
					E('h2', {}, _('MediaTek SoC Status')),
					E('p', { 'class': 'ai-lede', 'id': 'mtkw-lede' }, '')
				]),
				updated
			]),
			foldSection('ports', { title: _('Ethernet Ports'), summaryId: 'mtkw-ports-sum',
				body: E('div', { 'id': 'mtkw-ports' }, aui.empty(_('Loading…'))) }),
			foldSection('cpu', { title: _('CPU Frequency'), summaryId: 'mtkw-cpu-sum', onOpen: function() { drawFreq(lastStatus.cpu || {}); }, body: E('div', {}, [
				E('div', { 'class': 'ai-grid ai-grid--2' }, [ E('div', { 'id': 'mtkw-cpu-info' }), E('div', { 'id': 'mtkw-cpu-ctl' }) ]),
				E('div', { 'class': 'ai-grid', 'id': 'mtkw-freq-wrap', 'style': 'margin-top:var(--ds-sp-2)' }, [
					aui.card({ name: _('Frequency History'), accent: 'var(--ai-npu)', body: E('div', { 'id': 'mtkw-freq' }) })
				])
			]) }),
			foldSection('offload', { title: _('Hardware Offload'), summaryId: 'mtkw-offload-sum',
				hint: _('Switches here apply the hardware offload settings for this device.'),
				body: E('div', {}, [
					E('div', { 'id': 'mtkw-tiles' }),
					E('div', { 'id': 'mtkw-switches', 'style': 'margin-top:var(--ds-sp-3)' }),
					E('div', { 'id': 'mtkw-engines', 'style': 'margin-top:var(--ds-sp-2)' }),
					E('div', { 'id': 'mtkw-macs', 'style': 'margin-top:var(--ds-sp-2)' })
				]) }),
			wifiSection,
			foldSection('flows', { title: _('PPE Flow Offload Entries'), count: '…', countId: 'mtkw-flow-count',
				actions: renderIntervalSelect(), body: renderFlowTable() })
		]);
		activePage = page;
		function isLive() { return activePage === page && (!started || page.isConnected); }

		/* The chart is drawn to the width it has, none while folded. */
		function drawFreq(c) {
			var fh = document.getElementById('mtkw-freq');
			if (fh && fh.clientWidth > 0) replace('mtkw-freq', renderFreqChart(c, fh.clientWidth));
		}
		var first = true, pending = null, switchesKnown = false;
		var lastStatus = {}, lastPorts = {}, lastGood = null, lastPortsGood = null, lastMacGood = null;
		var ppePending = null, statusReady = false, started = false;
		function flowQuery() { return [ flowPage, flowFilter.state, flowFilter.type, flowFilter.ppe ]; }
		function renderPpe() {
			lastStatus.ppe = flowData.ppe;
			lastStatus.ppeFailed = !!flowData.error;
			syncPpeFilter(lastStatus.ppe);
			replace('mtkw-tiles', renderTiles(lastStatus));
			replace('mtkw-engines', renderEngines(lastStatus));
			setText('mtkw-offload-sum', offloadSummary(lastStatus));
		}
		var refreshFlows = function(live) {
			if (!statusReady || stopDetached()) return Promise.resolve();
			if (document.hidden) return Promise.resolve();
			if (ppePending) return ppePending;
			var query = flowQuery(), key = JSON.stringify(query);
			ppePending = callPpeEntries.apply(null, query.concat([ live === true, ppeInterval ])).then(function(data) {
				if (!isLive() || key !== JSON.stringify(flowQuery())) return;
				/* Backend errors are fixed English strings with translations. */
				if (!data || data.error) throw new Error(data && data.error ? _(data.error) : _('PPE table unavailable'));
				// Flows can disappear while a later page is being viewed: go to
				// the last page that still exists.
				if (data.page >= 0 && flowPage > 0 && flowPage * PAGE_SIZE >= data.matched) {
					flowPage = Math.max(0, Math.ceil(data.matched / PAGE_SIZE) - 1);
					return;
				}
				flowData = data;
				flowData.updatedAt = new Date(Date.now() - (data.sample_age || 0) * 1000).toLocaleTimeString();
				renderPpe();
				updateFlowTable();
			}).catch(function(e) {
				if (!isLive() || key !== JSON.stringify(flowQuery())) return;
				// Keep the engines, filters and page of the last reply: one failed
				// poll must not reset what the user selected.
				flowData = { available: false, entries: [], ppe: flowData.ppe, page: flowPage,
					matched: flowData.page >= 0 ? flowData.matched : 0, error: errText(e) };
				renderPpe();
				updateFlowTable();
			}).finally(function() {
				ppePending = null;
				// Coalesce clicks during a request and discard obsolete replies.
				if (isLive() && key !== JSON.stringify(flowQuery())) refreshFlows();
			});
			return ppePending;
		};
		/* The first poll tick can land while the initial refresh is still
		 * running; reuse that request instead of running the backend twice. */
		var refresh = function() {
			if (!started || stopDetached()) return Promise.resolve();
			if (document.hidden) return Promise.resolve();
			if (pending) return pending;
			var stErr = null, ptErr = null, msErr = null, gen = settingsGen;
			pending = Promise.all([
				callStatus(true).catch(function(e) { stErr = e; return {}; }),
				callPorts().catch(function(e) { ptErr = e; return {}; }),
				callMacStats().catch(function(e) { msErr = e; return { available: false }; }),
				callWifiStats().catch(function(e) { return { available: false, has_wifi: true, error: errText(e) }; })
			]).then(function(d) {
				if (!isLive()) return;
				/* A failed read keeps showing the last status, as the switches
				 * do; the lede says that it failed. */
				var st = stErr ? Object.assign({}, lastGood || {}) : d[0] || {}, c = st.cpu || {};
				var pt = ptErr ? lastPortsGood || {} : d[1] || {}, ms = msErr ? lastMacGood || d[2] : d[2];
				if (!stErr) lastGood = st;
				if (!ptErr) lastPortsGood = pt;
				if (!msErr) lastMacGood = ms;
				var err = stErr || ptErr || msErr;
				/* A save started or ended while this was read: its settings
				 * may be the old ones; the save asks for a new status. */
				var fresh = gen === settingsGen;
				st.ppe = flowData.ppe;
				st.ppeFailed = !!flowData.error;
				lastStatus = st; lastPorts = pt;
				var lede = document.getElementById('mtkw-lede');
				if (lede) lede.setAttribute('data-error', err ? 'true' : 'false');
				updated.setAttribute('data-state', err ? 'stale' : 'ok');
				if (lede) lede.textContent = err ? _('Cannot read status from the luci.mtk_wed backend: %s').format(errText(err))
					: [ st.model, st.compatible ].filter(Boolean).join(' · ');
				replace('mtkw-ports', renderPorts(pt));
				setText('mtkw-ports-sum', portSummary(pt));
				setText('mtkw-cpu-sum', cpuSummary(st));
				replace('mtkw-cpu-info', renderCpuInfo(st));
				/* Most MT7981/MT7986 boards have no OPP table, hence no
				 * cpufreq: show the CPU card alone instead of empty controls. */
				var noScaling = c.cpufreq === false;
				var ctl = document.getElementById('mtkw-cpu-ctl'), fw = document.getElementById('mtkw-freq-wrap');
				if (ctl) ctl.style.display = noScaling ? 'none' : '';
				if (fw) fw.style.display = noScaling ? 'none' : '';
				var busy = ctl && ctl.contains(document.activeElement);
				if (!noScaling && (first || (!stErr && fresh && !cpuDirty && !busy && !cpuSaving))) replace('mtkw-cpu-ctl', renderCpuControl(st));
				if (!stErr && c.cur_freq > 0) {
					freqHistory.push(c.cur_freq);
					if (freqHistory.length > FREQ_HISTORY_MAX) freqHistory.shift();
				}
				if (!noScaling) drawFreq(c);
				replace('mtkw-tiles', renderTiles(st));
				setText('mtkw-offload-sum', offloadSummary(st));
				/* Without a status reply the switch state is unknown: keep the
				 * last known one, or locked unknown switches until a first
				 * reply builds the real ones. */
				if (!stErr && !switchesKnown) { replace('mtkw-switches', renderSwitches(st, true)); switchesKnown = true; }
				else if (!stErr && fresh) { setSwitch('mtkw-flow', flowState(st)); setSwitch('mtkw-wed', wedState(st)); }
				else if (first) replace('mtkw-switches', renderSwitches(st, false));
				replace('mtkw-engines', renderEngines(st));
				replace('mtkw-macs', renderMacs(ms, pt, st));
				var wifi = renderWifi(d[3], st), wifiEl = document.getElementById('mtkw-wifi');
				if (wifiEl) wifiEl.hidden = !wifi;
				replace('mtkw-wifi-body', wifi && wifi.body);
				setText('mtkw-wifi-sum', wifi ? wifi.summary : '');
				if (!err) updated.textContent = _('Updated %s').format(new Date().toLocaleTimeString());
				first = false;
			}).finally(function() { pending = null; });
			return pending;
		};
		flowRefresh = refreshFlows;
		/* After a save: a new status read, behind any one in flight. */
		statusRefresh = function() { var p = pending; return p ? p.then(refresh, refresh) : refresh(); };
		var pollPpe = function() { return refreshFlows(true); };
		ppeIntervalSet = function(n) {
			if (PPE_INTERVALS.indexOf(n) < 0 || !started || stopDetached()) return;
			ppeInterval = n;
			try { window.localStorage.setItem(PPE_INTERVAL_KEY, String(n)); } catch (e) {}
			poll.remove(pollPpe);
			poll.add(pollPpe, n);
			refreshFlows(true);
		};
		/* Start after LuCI has inserted the render result. From then on a
		 * disconnected page is finished, even if its first RPC is pending. */
		function stopDetached() {
			if (activePage === page && page.isConnected) return false;
			document.removeEventListener('visibilitychange', onVisibility);
			poll.remove(refresh); poll.remove(pollPpe);
			return true;
		}
		var onVisibility = function() {
			if (!started || stopDetached()) return;
			if (!document.hidden) { refresh(); refreshFlows(true); }
		};
		document.addEventListener('visibilitychange', onVisibility);
		// Keep PPE off the initial batch and off the fast status critical path.
		setTimeout(function() {
			started = true;
			if (stopDetached()) return;
			refresh().then(function() {
				if (stopDetached()) return;
				statusReady = true;
				return refreshFlows(true);
			});
		}, 0);
		poll.add(refresh, 5);
		poll.add(pollPpe, ppeInterval);
		return page;
	},

	handleSaveApply: null, handleSave: null, handleReset: null
});
