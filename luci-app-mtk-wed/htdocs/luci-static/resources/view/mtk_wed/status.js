'use strict';
'require view';
'require poll';
'require rpc';
'require ui';
'require view.mtk_wed.ui as aui';

/*
 * SPDX-License-Identifier: Apache-2.0
 *
 * V2 Spatial Hardware Studio view controller for MediaTek Filogic SoCs
 * on the mainline kernel. Wired 100% to the luci.mtk_wed rpcd backend.
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

var VIEW_KEY = 'luci-app-mtk-wed.view';
var FOLD_KEY = 'luci-app-mtk-wed.folded';
var PPE_INTERVAL_KEY = 'luci-app-mtk-wed.ppe-interval';
var PPE_INTERVALS = [ 5, 10, 20, 30, 60 ];
var VALID_TABS = [ 'overview', 'ports', 'offload', 'wifi', 'flows' ];
var VALID_FOLD_KEYS = [ 'faceplate', 'datapath', 'cpu', 'ports', 'wifi', 'flows', 'offload-ctrl' ];
var PAGE_SIZE = 50;
var FREQ_HISTORY_MAX = 120;
var WED_RECOVERY_PREFIX = 'cannot save or restore the WED settings; recovery files: ';

/* The view that owns the page. An SPA theme (e.g. luci-theme-footstrap) can
 * build a new instance while replies of the old one are still in flight. */
var activePage = null;
var activeCleanup = null;

/* ── Safe Storage & Error Helpers ────────────────────────────────────────── */

function lsGet(key, fallback) {
	try {
		var v = window.localStorage.getItem(key);
		return v === null ? fallback : v;
	} catch (e) {
		return fallback;
	}
}

function lsSet(key, value) {
	try { window.localStorage.setItem(key, value); } catch (e) {}
}

function foldedKeys() {
	try {
		var v = JSON.parse(window.localStorage.getItem(FOLD_KEY));
		if (Array.isArray(v)) {
			var seen = {};
			var pruned = [];
			for (var i = 0; i < v.length; i++) {
				var k = v[i];
				if (typeof k === 'string' && VALID_FOLD_KEYS.indexOf(k) >= 0 && !seen[k]) {
					seen[k] = true;
					pruned.push(k);
				}
			}
			if (pruned.length !== v.length) lsSet(FOLD_KEY, JSON.stringify(pruned));
			return pruned;
		}
	} catch (e) {}
	return [];
}

function isFolded(key) {
	return foldedKeys().indexOf(key) >= 0;
}

function setFolded(key, collapsed) {
	var keys = foldedKeys().filter(function(k) { return k !== key; });
	if (collapsed && VALID_FOLD_KEYS.indexOf(key) >= 0) keys.push(key);
	lsSet(FOLD_KEY, JSON.stringify(keys));
}

function readPpeInterval() {
	var v = Number(lsGet(PPE_INTERVAL_KEY, '10'));
	return PPE_INTERVALS.indexOf(v) >= 0 ? v : 10;
}

/* Translate the fixed template before adding the recovery directory. */
function rpcError(message) {
	message = String(message || '');
	if (message.indexOf(WED_RECOVERY_PREFIX) === 0)
		return _('cannot save or restore the WED settings; recovery files: %s').format(message.slice(WED_RECOVERY_PREFIX.length));
	if (message === 'cannot restore previous CPU settings')
		return _('cannot restore previous CPU settings');
	return _(message);
}

/* LuCI appends a stack line to RPC errors; keep the message only. */
function errText(e) {
	return String((e && e.message) || e).split('\n')[0];
}

function notifyError(e) {
	ui.addNotification(null, E('p', {}, _('Error: %s').format(errText(e))), 'error');
}

function clearEl(node) {
	while (node && node.firstChild) node.removeChild(node.firstChild);
}

function setChildren(parent, kids) {
	if (!parent) return;
	clearEl(parent);
	appendKids(parent, kids);
}

function appendKids(parent, kids) {
	if (!parent || kids === null || kids === undefined || kids === false) return;
	if (Array.isArray(kids)) {
		for (var i = 0; i < kids.length; i++) appendKids(parent, kids[i]);
	} else if (kids instanceof Node) {
		parent.appendChild(kids);
	} else {
		parent.appendChild(document.createTextNode(String(kids)));
	}
}

function prefersReducedMotion() {
	return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

function fmtTimeHMS(ts) {
	if (!ts) return '—';
	var d = new Date(ts);
	function pad(n) { return n < 10 ? '0' + n : String(n); }
	return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

function fmtAgeShort(sec) {
	sec = Math.max(0, Math.floor(Number(sec) || 0));
	if (sec < 60) return sec + 's';
	if (sec < 3600) {
		var m = Math.floor(sec / 60), s = sec % 60;
		return s ? (m + 'm ' + s + 's') : (m + 'm');
	}
	var h = Math.floor(sec / 3600), rm = Math.floor((sec % 3600) / 60);
	return rm ? (h + 'h ' + rm + 'm') : (h + 'h');
}

/* ── Domain Formatters & Helpers ─────────────────────────────────────────── */

function speedTag(mbps) {
	mbps = Number(mbps) || 0;
	if (mbps >= 10000) return '10G';
	if (mbps >= 5000) return '5G';
	if (mbps >= 2500) return '2.5G';
	if (mbps >= 1000) return '1G';
	if (mbps >= 100) return '100M';
	if (mbps >= 10) return '10M';
	if (mbps > 0) return Math.round(mbps) + 'M';
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
	return p && p.role !== 'conduit' && p.gdm !== null && p.gdm !== undefined;
}

/* The PPEs a SoC has (mtk_soc_data.ppe_num): three on MT7988, two on MT7981/6/7. */
function socPpeNum(soc) {
	soc = String(soc || '');
	return (/mt7988/).test(soc) ? 3 : (/mt798[167]/).test(soc) ? 2 : 0;
}

function gdmPpeId(gdm, ppeNum) {
	if (!ppeNum || gdm === null || gdm === undefined) return null;
	gdm = Number(gdm);
	return ppeNum >= 3 && gdm === 2 ? 2 : ppeNum >= 2 && gdm === 1 ? 1 : 0;
}

function gdmPpe(gdm, ppeNum) {
	var pid = gdmPpeId(gdm, ppeNum);
	return pid === null ? 'PPE ?' : 'PPE' + pid;
}

/* "mediatek,mt7981b" -> "MT7981B" */
function socName(s) {
	return s ? String(s).replace(/^[^,]*,/, '').toUpperCase() : '';
}

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
		var groups = addr.toLowerCase().split(':').map(function(g) { return g.replace(/^0+(?=.)/, ''); });
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

function parseVlanTags(raw) {
	if (raw === null || raw === undefined) return [];
	return String(raw).split(',').map(function(s) {
		return s.trim();
	}).filter(function(s) {
		if (!s || s === '-' || s === '0' || s.toLowerCase() === 'none') return false;
		if (/^0+$/.test(s)) return false;
		return true;
	});
}

function formatVlanCell(raw) {
	var tags = parseVlanTags(raw);
	return tags.length ? tags.join(',') : '-';
}

function hexIndex(idx) {
	var s = String(idx == null ? '' : idx);
	if (!s) return '—';
	return s.indexOf('0x') === 0 ? s : '0x' + s;
}

/* The WO firmware trailer holds no real version, only a placeholder such as
 * "____000000" or "DEV_000000"; its build time tells the firmwares apart. */
function wedFwSource(w, st) {
	if (!w) return st;
	if (String(w.wo_firmware || '').trim() || String(w.wo_build || '').trim()) return w;
	return (w.attached && w.rx !== false) ? st : w;
}
function woFirmware(w) {
	w = w || {};
	var ver = String(w.wo_firmware || '').trim(), built = String(w.wo_build || '').trim();
	var m = /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)$/.exec(built);
	if (m) built = m[1] + '-' + m[2] + '-' + m[3] + ' ' + m[4] + ':' + m[5] + ':' + m[6];
	if (!built) return ver || 'N/A';
	built = _('Built %s').format(built);
	return (/^[A-Za-z_]*0+$/).test(ver) || !ver ? built : ver + ' · ' + built;
}

function woShortBuild(w) {
	var built = String((w && w.wo_build) || '').trim();
	if (built.length >= 8) return 'WO ' + built.slice(0, 4) + '-' + built.slice(4, 6) + '-' + built.slice(6, 8);
	if (w && w.wo_firmware && !/^[A-Za-z_]*0+$/.test(String(w.wo_firmware).trim())) return 'WO ' + String(w.wo_firmware).trim();
	return _('No WO firmware');
}

function governorLabel(g) {
	var labels = {
		conservative: _('conservative'),
		ondemand: _('ondemand'),
		performance: _('performance'),
		powersave: _('powersave'),
		schedutil: 'schedutil',
		userspace: _('userspace')
	};
	return labels[g] || g;
}

function fmtTempC(milli) {
	return (typeof milli === 'number' && isFinite(milli) && milli > 0) ? milli / 1000 : null;
}

function tempGrade(c) {
	if (c === null) return { tone: '', text: 'N/A' };
	if (c >= 80) return { tone: 'err', text: _('High Temp') };
	if (c >= 65) return { tone: 'warn', text: _('Warm') };
	return { tone: 'wed', text: _('Nominal') };
}

function naturalSortPorts(ports) {
	return (Array.isArray(ports) ? ports : [])
		.filter(function(p) { return p && p.role !== 'conduit'; })
		.slice()
		.sort(function(a, b) {
			if ((a.role === 'wan') !== (b.role === 'wan')) return a.role === 'wan' ? -1 : 1;
			return String(a.netdev || '').localeCompare(String(b.netdev || ''), undefined, { numeric: true });
		});
}

function portMedia(p) {
	if (!p) return 'unknown';
	if (p.media === 'sfp' || p.media === 'rj45') return p.media;
	if (p.kind === 'gsw') return 'rj45';
	return 'unknown';
}

function portIconName(p) {
	var m = portMedia(p);
	if (m === 'sfp') return 'sfp';
	if (m === 'rj45') return 'rj45';
	return 'port';
}

function portInterfaceLabel(p) {
	var m = portMedia(p);
	if (m === 'sfp') return _('SFP+ Optical');
	if (p && p.kind === 'gsw') return _('DSA Switch RJ45');
	if (m === 'rj45') return _('Direct RJ45');
	return _('Direct GDM');
}

function portFaultCount(p) {
	if (!p) return 0;
	return (p.rx_errors || 0) + (p.tx_errors || 0) + (p.rx_dropped || 0) + (p.tx_dropped || 0);
}

function portSpeedBadge(p) {
	var st = aui.portSpeedTone(p);
	var label;
	if (st.code === 'err') label = '!' + aui.fmtK(st.faults);
	else if (st.code === 'down') label = 'DOWN';
	else if (st.code === 'up') label = 'UP';
	else if (st.code === '10g') label = '10G';
	else if (st.code === '5g') label = '5G';
	else if (st.code === '2.5g') label = '2.5G';
	else if (st.code === '1g') label = '1G';
	else if (st.code === '100m') label = '100M';
	else label = speedTag(p && p.speed_mbps) || '10M';
	return Object.assign({ label: label }, st);
}

function duplexText(duplex) {
	if (!duplex) return '';
	if (duplex === 'full') return _('Full duplex');
	if (duplex === 'half') return _('Half duplex');
	return duplex;
}

function portPathText(p, ppeNum) {
	var g = gdmLabel(p.gdm), ppe = gdmPpe(p.gdm, ppeNum);
	if (p.kind === 'gsw') {
		return _('Switch') + ' ' + (p.conduit || p.netdev) + ' → ' + g + ' · ' + ppe;
	}
	return g + ' · ' + ppe;
}

function isMacStatOk(m) {
	return !!(m && m.ok !== false &&
		typeof m.tx_packets === 'number' && isFinite(m.tx_packets) &&
		typeof m.rx_packets === 'number' && isFinite(m.rx_packets));
}

function gdmErrorSum(mac) {
	if (!isMacStatOk(mac)) return 0;
	return (mac.rx_overflow || 0) + (mac.rx_fcs_errors || 0) + (mac.rx_checksum_errors || 0) +
		(mac.rx_short_errors || 0) + (mac.rx_long_errors || 0) + (mac.tx_skip || 0) + (mac.tx_collisions || 0);
}

function isValidDbm(v) {
	return typeof v === 'number' && isFinite(v) && v < 0;
}

function bandAvgSig(b) {
	if (!b) return null;
	var v = b.avg_signal !== undefined ? b.avg_signal : b.signal_avg;
	return isValidDbm(v) ? v : null;
}

function bandMinSig(b) {
	if (!b) return null;
	var v = b.min_signal !== undefined ? b.min_signal : b.signal_min;
	return isValidDbm(v) ? v : null;
}

function hasValidEff(b) {
	return !!(b && (b.stations || 0) > 0 && typeof b.airtime_efficiency === 'number' && isFinite(b.airtime_efficiency));
}

function isIwMissing(wf) {
	return !!(wf && wf.available === false && wf.reason === 'iw_missing');
}

function isNoAp(wf) {
	return !!(wf && wf.available === true && wf.has_wifi === true &&
		(!Array.isArray(wf.bands) || !wf.bands.length) && wf.complete !== false);
}

function triBool(v) {
	return v === true ? true : v === false ? false : null;
}

function flowLabelPair(sw, hw) {
	if (hw === true) return _('Enabled');
	if (sw === true) return _('Software only');
	if (hw === false) return _('Disabled');
	return _('Unknown');
}

function flowState(st) {
	var fo = (st && st.flow_offload) || {};
	var cfgSw = triBool(fo.software);
	var cfgHw = triBool(fo.hardware);
	var liveSw = triBool(fo.live_software);
	var liveHw = triBool(fo.live_hardware);
	var hwActive = liveHw;
	var switchOn = cfgHw === true;
	var kind = '', text = _('Unknown'), mismatch = false, unknown = false;

	if (cfgHw === null && liveHw === null) {
		kind = '';
		text = _('Unknown');
		unknown = true;
	} else if (liveHw !== null) {
		if (cfgHw === true && liveHw === true) {
			kind = 'ok';
			text = _('Enabled');
		} else if (cfgHw === true && liveHw === false) {
			kind = 'warn';
			text = _('Configured enabled, rule not active');
			mismatch = true;
		} else if (cfgHw === false && liveHw === true) {
			kind = 'warn';
			text = _('Configured disabled, rule still active');
			mismatch = true;
		} else if (cfgHw === null && liveHw === true) {
			kind = 'warn';
			text = _('Rule active (config unknown)');
			mismatch = true;
		} else if (cfgHw === null && liveHw === false) {
			kind = '';
			text = liveSw === true ? _('Software only (config unknown)') : _('Rule inactive (config unknown)');
			unknown = true;
		} else if (cfgSw === true && liveSw === false) {
			kind = 'warn';
			text = _('Software configured, rule not active');
			mismatch = true;
		} else if (liveSw === true) {
			kind = 'info';
			text = _('Software only');
		} else {
			kind = '';
			text = _('Disabled');
		}
	} else {
		if (cfgHw === true) {
			kind = '';
			text = _('Configured enabled');
		} else if (cfgSw === true) {
			kind = 'info';
			text = _('Software only (configured)');
		} else {
			kind = '';
			text = _('Configured disabled');
		}
	}

	var detail = _('Saved config: %s · Live fw4 rule: %s').format(
		flowLabelPair(cfgSw, cfgHw),
		liveHw !== null ? flowLabelPair(liveSw, liveHw) : _('Unavailable')
	);

	return {
		on: switchOn,
		hwActive: hwActive,
		cfgSw: cfgSw,
		cfgHw: cfgHw,
		liveSw: liveSw,
		liveHw: liveHw,
		mismatch: mismatch,
		unknown: unknown,
		kind: kind,
		text: text,
		detail: detail
	};
}

function wedState(st) {
	var wp = (st && st.wed_param) || {};
	var active = wp.active, conf = wp.configured;
	if (wp.saving === true)
		return { on: !!active, kind: 'info', code: 'saving', text: _('Saving…') };
	if (active === null || active === undefined)
		return { on: !!conf, kind: '', code: 'unloaded', text: _('Wi-Fi driver not loaded') };
	if (conf !== null && conf !== undefined && conf !== active)
		return { on: !!conf, kind: 'warn', code: 'reboot_required', text: _('Reboot required') };
	return active
		? { on: true, kind: 'ok', code: 'enabled', text: _('Enabled') }
		: { on: false, kind: '', code: 'disabled', text: _('Disabled') };
}

function wifiBandQuality(band) {
	if (!band || !(Number(band.stations) > 0)) return { tone: '', label: _('No clients'), retryPct: 0 };
	var txPkts = Number(band.tx_packets) || 0;
	var txRet = Number(band.tx_retries) || 0;
	var denom = txPkts + txRet;
	var retryPct = denom > 0 ? (txRet / denom) * 100 : 0;
	if (retryPct > 50) return { tone: 'err', label: _('Poor'), retryPct: retryPct };
	if (retryPct > 20) return { tone: 'warn', label: _('Fair'), retryPct: retryPct };
	return { tone: 'wed', label: _('Good'), retryPct: retryPct };
}

function flowFinCount(d) {
	d = d || {};
	if (typeof d.fin === 'number' && isFinite(d.fin)) return d.fin;
	if (Array.isArray(d.ppe) && d.ppe.length) {
		return d.ppe.reduce(function(sum, p) { return sum + (Number(p.fin) || 0); }, 0);
	}
	return Math.max(0, (Number(d.total) || 0) - (Number(d.bound) || 0) - (Number(d.unbound) || 0));
}

function resolveWedBandMap(weds, bands) {
	var allWeds = Array.isArray(weds) ? weds : [];
	var actBands = Array.isArray(bands)
		? bands.filter(function(b) { return b && b.band !== undefined && b.band !== null; })
		: [];
	var wedToBands = {};
	var bandToWed = {};

	allWeds.forEach(function(w) {
		if (w && w.id !== undefined && w.id !== null) wedToBands[w.id] = [];
	});
	actBands.forEach(function(b) {
		bandToWed[b.band] = null;
	});

	var attachedWeds = allWeds
		.filter(function(w) { return w && w.attached === true && w.id !== undefined && w.id !== null; })
		.slice()
		.sort(function(a, b) { return Number(a.id) - Number(b.id); });

	if (!attachedWeds.length || !actBands.length) {
		return { bandToWed: bandToWed, wedToBands: wedToBands, estimated: false };
	}

	var sortedBands = actBands.slice().sort(function(a, b) { return Number(a.band) - Number(b.band); });

	if (attachedWeds.length === 1) {
		var w0 = attachedWeds[0].id;
		sortedBands.forEach(function(b) {
			bandToWed[b.band] = w0;
			wedToBands[w0].push(b);
		});
		return { bandToWed: bandToWed, wedToBands: wedToBands, estimated: false };
	}

	var claimedBand = {};
	var claimedWed = {};

	/* Pass 1: exact band index === WED id pairing among attached WEDs */
	sortedBands.forEach(function(b) {
		var bKey = String(b.band);
		if (claimedBand[bKey]) return;
		for (var i = 0; i < attachedWeds.length; i++) {
			var w = attachedWeds[i];
			var wKey = String(w.id);
			if (!claimedWed[wKey] && Number(w.id) === Number(b.band)) {
				claimedBand[bKey] = true;
				claimedWed[wKey] = true;
				bandToWed[b.band] = w.id;
				wedToBands[w.id].push(b);
				break;
			}
		}
	});

	/* Pass 2: pair remaining unclaimed bands with remaining unclaimed attached WEDs in ascending order */
	var freeWeds = attachedWeds.filter(function(w) { return !claimedWed[String(w.id)]; });
	var freeIdx = 0;
	sortedBands.forEach(function(b) {
		var bKey = String(b.band);
		if (claimedBand[bKey]) return;
		var targetWed = freeIdx < freeWeds.length ? freeWeds[freeIdx++] : attachedWeds[0];
		claimedBand[bKey] = true;
		bandToWed[b.band] = targetWed.id;
		wedToBands[targetWed.id].push(b);
	});

	Object.keys(wedToBands).forEach(function(wid) {
		wedToBands[wid].sort(function(a, b) { return Number(a.band) - Number(b.band); });
	});

	return { bandToWed: bandToWed, wedToBands: wedToBands, estimated: true };
}

function wedIdForBand(bandIdx, weds, bands) {
	var map = resolveWedBandMap(weds, bands);
	var wid = map.bandToWed[bandIdx];
	return (wid === undefined || wid === null) ? null : wid;
}

function bandsForWed(wedId, weds, bands) {
	var map = resolveWedBandMap(weds, bands);
	return map.wedToBands[wedId] ? map.wedToBands[wedId].slice() : [];
}

function bandForWed(wedId, weds, bands) {
	var list = bandsForWed(wedId, weds, bands);
	return list.length ? list[0] : null;
}

function summarizeCoreSamples(samples) {
	if (!Array.isArray(samples) || !samples.length) return null;
	var ready = samples.filter(function(c) { return c.usage_pct !== null && c.usage_pct !== undefined && isFinite(c.usage_pct); });
	if (!ready.length) {
		return { count: samples.length, pending: true, avgUsage: null, avgSirq: null, maxUsage: null, maxSirq: null };
	}
	var sumU = 0, sumS = 0, maxU = 0, maxS = 0;
	for (var i = 0; i < ready.length; i++) {
		var u = ready[i].usage_pct;
		var s = ready[i].sirq_pct || 0;
		sumU += u;
		sumS += s;
		if (u > maxU) maxU = u;
		if (s > maxS) maxS = s;
	}
	return {
		count: samples.length,
		pending: false,
		avgUsage: sumU / ready.length,
		avgSirq: sumS / ready.length,
		maxUsage: maxU,
		maxSirq: maxS
	};
}

function getMibSpecs() {
	return [
		{ key: 'tx_packets', label: _('TX packets'), fmt: fmtCount, err: false },
		{ key: 'tx_bytes', label: _('TX bytes'), fmt: fmtBytes, err: false },
		{ key: 'rx_packets', label: _('RX packets'), fmt: fmtCount, err: false },
		{ key: 'rx_bytes', label: _('RX bytes'), fmt: fmtBytes, err: false },
		{ key: 'rx_overflow', label: _('RX overflow'), fmt: fmtCount, err: true },
		{ key: 'rx_fcs_errors', label: _('FCS errors'), fmt: fmtCount, err: true },
		{ key: 'rx_checksum_errors', label: _('Checksum errors'), fmt: fmtCount, err: true },
		{ key: 'rx_flow_control_packets', label: _('Flow control frames'), fmt: fmtCount, err: false },
		{ key: 'tx_skip', label: _('TX skip'), fmt: fmtCount, err: true },
		{ key: 'tx_collisions', label: _('TX collisions'), fmt: fmtCount, err: true },
		{ key: 'rx_short_errors', label: _('RX short errors'), fmt: fmtCount, err: true },
		{ key: 'rx_long_errors', label: _('RX long errors'), fmt: fmtCount, err: true }
	];
}

/* ── Main LuCI View ──────────────────────────────────────────────────────── */

return view.extend({
	load: function() {
		aui.ensureCss();
		return Promise.resolve();
	},

	render: function() {
		aui.ensureCss();
		if (typeof activeCleanup === 'function') {
			var prevCleanup = activeCleanup;
			activeCleanup = null;
			prevCleanup();
		}
		readonly = !L.hasViewPermission();

		var savedView = lsGet(VIEW_KEY, 'overview');
		var initAllInOne = savedView === 'all';
		var initTab = VALID_TABS.indexOf(savedView) >= 0 ? savedView : 'overview';

		/* Per-view isolated runtime state (resets cleanly on SPA revisit) */
		var app = {
			statusKnown: false,
			lastStatus: {},
			lastGood: null,
			lastPorts: {},
			lastPortsGood: null,
			lastMac: { available: false, macs: [] },
			lastMacGood: null,
			lastWifi: null,
			lastCompleteWifiRates: {},
			lastUpdated: null,
			lastErr: null,
			stale: false,

			/* Real delta & history engines */
			cpuHistory: [],
			prevCores: {},
			coreSamples: [],
			coreFastScheduled: false,
			prevPortBytes: {},
			portRates: {},

			/* Navigation & interaction state */
			activeTab: initTab,
			allInOne: initAllInOne,
			portsSubTab: 'ports',
			selectedPortInline: null,
			selectedTopo: null,
			expandedWifiBands: {},
			mloPopoverOpen: false,
			drawerCtx: null,

			/* Polling & control state */
			paused: false,
			bgPaused: !!document.hidden,
			refreshing: false,
			settingsGen: 0,
			wedGen: 0,
			hwBusy: false,
			wedBusy: false,
			wedError: null,
			cpuDirty: false,
			cpuSaving: false,
			cpuDraftGov: null,
			cpuDraftFreq: null,
			cpuSavedMsg: '',
			cpuSavedErr: false,

			/* PPE Flow workbench state */
			flowFrozen: false,
			flowInterval: readPpeInterval(),
			flowFilter: { state: '', type: '', ppe: '' },
			flowSearch: '',
			flowSortBy: '',
			flowSortDir: 'desc',
			flowPage: 0,
			flowData: { entries: [] },
			flowBaseAge: 0,
			flowFetchedAt: null,
			ppeLastGoodAt: null,
			ppeLastGoodBaseAge: 0
		};

		/* Page shell */
		var headEl = E('div', { 'class': 'mtkw-head', 'id': 'mtkw-head' });
		var navEl = E('div', { 'class': 'mtkw-nav-row', 'id': 'mtkw-nav' });
		var rebootBannerEl = E('div', { 'class': 'mtkw-reboot-banner', 'id': 'mtkw-reboot-banner', 'role': 'status', 'hidden': '' });
		rebootBannerEl.hidden = true;
		var workspaceEl = E('div', { 'id': 'mtkw-workspace' });

		var page = E('div', { 'class': 'cbi-map mtkw-page' }, [
			headEl,
			navEl,
			rebootBannerEl,
			workspaceEl
		]);

		activePage = page;

		var destroyed = false;
		var started = false;
		var statusReady = false;
		var initialBootStarted = false;
		var pending = null;
		var ppePending = null;
		var ppePendingLive = false;
		var ppeNeedLive = false;
		var bootTimer = null;
		var coreFastTimer = null;
		var wedSettleTimer = null;
		var ageTimer = null;

		function byId(id) {
			return id ? page.querySelector('#' + id) : null;
		}

		var toast = aui.createToast(page);
		var drawerClosedAt = 0;
		var drawer = aui.createDrawer(page, {
			closeLabel: _('Close'),
			onClose: function() {
				if (!isLive()) { stopDetached(); return; }
				drawerClosedAt = Date.now();
				var wasFlow = app.drawerCtx && app.drawerCtx.kind === 'flow';
				app.drawerCtx = null;
				if (wasFlow && (app.allInOne || app.activeTab === 'flows')) {
					syncFlowRowSelection();
				}
			}
		});

		function isLive() {
			return !destroyed && activePage === page && (!started || page.isConnected);
		}

		function settingsCurrent() {
			return !destroyed && activePage === page && page.isConnected;
		}

		function activeFormCardId() {
			var ae = document.activeElement;
			if (!ae || !ae.id || !page.contains(ae)) return null;
			if (ae.id === 'mtkw-cpu-gov' || ae.id === 'mtkw-cpu-maxf') return 'mtkw-sec-cpu';
			if (ae.id === 'mtkw-flow-search' || ae.id === 'mtkw-ppe-interval') return 'mtkw-sec-flows';
			return null;
		}

		function showWifiSection() {
			var wf = app.lastWifi;
			if (!wf) return false;
			if (wf.available === false) return !!wf.has_wifi;
			var bands = Array.isArray(wf.bands) ? wf.bands : [];
			return bands.length > 0 || wf.complete === false;
		}

		function copyAction(text, label, btnEl) {
			aui.copyText(text, btnEl, {
				iconSize: 13,
				onCopied: function(ok) {
					if (ok) toast.show(label ? _('Copied %s').format(label) : _('Copied'));
				}
			});
		}

		function scrollToId(id) {
			var t = byId(id);
			if (!t) return;
			try {
				t.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'nearest' });
			} catch (e) {
				t.scrollIntoView();
			}
			t.classList.add('is-flash');
			setTimeout(function() { if (t.isConnected) t.classList.remove('is-flash'); }, 850);
		}

		function navigateTo(tabKey, anchorId, unfoldKey) {
			if (unfoldKey && isFolded(unfoldKey)) setFolded(unfoldKey, false);
			if (app.allInOne) {
				renderWorkspace();
				if (anchorId) scrollToId(anchorId);
			} else {
				app.activeTab = tabKey;
				lsSet(VIEW_KEY, tabKey);
				renderNav();
				renderWorkspace();
				if (anchorId) scrollToId(anchorId);
			}
		}

		function effectivePpeNum() {
			var n = socPpeNum(app.lastStatus.soc);
			if (n) return n;
			return Array.isArray(app.lastStatus.ppe) && app.lastStatus.ppe.length ? app.lastStatus.ppe.length : 0;
		}

		function ppeStaleAgeSec() {
			if (app.ppeLastGoodAt === null) return 0;
			return (Number(app.ppeLastGoodBaseAge) || 0) + Math.max(0, Math.floor((Date.now() - app.ppeLastGoodAt) / 1000));
		}

		/* ── Delta Engines ────────────────────────────────────────────────── */

		function ingestCores(rawCores) {
			if (!Array.isArray(rawCores) || !rawCores.length) {
				app.coreSamples = [];
				return false;
			}
			var prevComputed = {};
			app.coreSamples.forEach(function(c) { prevComputed[String(c.id)] = c; });

			var nextSamples = [];
			var needsDelta = false;

			for (var i = 0; i < rawCores.length; i++) {
				var c = rawCores[i];
				if (!c || c.id === undefined || c.id === null) continue;
				var cid = c.id;
				var key = String(cid);
				var hasRaw = typeof c.total === 'number' && isFinite(c.total) &&
					typeof c.idle === 'number' && isFinite(c.idle);

				if (hasRaw) {
					var prev = app.prevCores[key];
					var sirqVal = (typeof c.sirq === 'number' && isFinite(c.sirq)) ? c.sirq : 0;
					if (prev) {
						var dTotal = c.total - prev.total;
						var dIdle = c.idle - prev.idle;
						var dSirq = sirqVal - prev.sirq;
						if (dTotal > 0 && dIdle >= 0 && dIdle <= dTotal && dSirq >= 0) {
							var usage = Math.max(0, Math.min(100, ((dTotal - dIdle) / dTotal) * 100));
							var sirq = Math.max(0, Math.min(usage, (dSirq / dTotal) * 100));
							nextSamples.push({ id: cid, usage_pct: usage, sirq_pct: sirq, user_sys_pct: Math.max(0, usage - sirq) });
						} else if (prevComputed[key] && prevComputed[key].usage_pct !== null) {
							nextSamples.push(prevComputed[key]);
						} else {
							nextSamples.push({ id: cid, usage_pct: null, sirq_pct: null, user_sys_pct: null });
							needsDelta = true;
						}
					} else {
						nextSamples.push({ id: cid, usage_pct: null, sirq_pct: null, user_sys_pct: null });
						needsDelta = true;
					}
					app.prevCores[key] = { total: c.total, idle: c.idle, sirq: sirqVal };
				} else if (typeof c.usage_pct === 'number' && isFinite(c.usage_pct)) {
					var u = Math.max(0, Math.min(100, c.usage_pct));
					var s = Math.max(0, Math.min(u, Number(c.sirq_pct) || 0));
					nextSamples.push({ id: cid, usage_pct: u, sirq_pct: s, user_sys_pct: Math.max(0, u - s) });
				}
			}

			app.coreSamples = nextSamples;
			return needsDelta;
		}

		function ingestPortRates(ports) {
			var now = Date.now();
			(Array.isArray(ports) ? ports : []).forEach(function(p) {
				if (!p || !p.netdev) return;
				var key = p.netdev;
				var prev = app.prevPortBytes[key];
				if (p.carrier !== 1) {
					app.portRates[key] = { rx_mbps: 0, tx_mbps: 0 };
				} else if (prev) {
					var dt = (now - prev.ts) / 1000;
					if (dt >= 0.4) {
						var drx = (typeof p.rx_bytes === 'number' && typeof prev.rx === 'number' && p.rx_bytes >= prev.rx)
							? (p.rx_bytes - prev.rx) : 0;
						var dtx = (typeof p.tx_bytes === 'number' && typeof prev.tx === 'number' && p.tx_bytes >= prev.tx)
							? (p.tx_bytes - prev.tx) : 0;
						app.portRates[key] = {
							rx_mbps: (drx * 8) / (dt * 1e6),
							tx_mbps: (dtx * 8) / (dt * 1e6)
						};
					}
				} else if (!app.portRates[key]) {
					app.portRates[key] = { rx_mbps: 0, tx_mbps: 0 };
				}
				app.prevPortBytes[key] = { rx: p.rx_bytes, tx: p.tx_bytes, ts: now };
			});
		}

		function applyWifiRateHold(wf) {
			if (!wf || wf.available !== true || !Array.isArray(wf.bands)) return wf;
			if (wf.complete !== false) {
				wf.bands.forEach(function(b) {
					if (typeof b.tx_mbps === 'number' && isFinite(b.tx_mbps)) {
						app.lastCompleteWifiRates[b.band] = b.tx_mbps;
					}
				});
				return wf;
			}
			var heldBands = wf.bands.map(function(b) {
				var held = app.lastCompleteWifiRates[b.band];
				if (held !== undefined) return Object.assign({}, b, { tx_mbps: held });
				return b;
			});
			return Object.assign({}, wf, { bands: heldBands });
		}

		/* ── Collapsible Spatial Card Helper (persisted in FOLD_KEY) ─────── */

		function makeSpatialCard(opts) {
			var foldKey = opts.foldKey || null;
			var collapsed = foldKey ? isFolded(foldKey) : false;

			var bodyWrap = E('div', { 'class': 'mtkw-card-body' }, opts.body || []);
			bodyWrap.hidden = collapsed;

			var titleEl;
			if (foldKey) {
				titleEl = E('button', {
					'type': 'button',
					'class': 'mtkw-card-toggle',
					'aria-expanded': String(!collapsed)
				}, [
					E('span', { 'class': 'mtkw-card-toggle-ico' }, [ aui.icon('chevron-down', 14) ]),
					E('span', { 'class': 'mtkw-card-title' }, opts.title)
				]);
			} else {
				titleEl = E('h2', { 'class': 'mtkw-card-title' }, opts.title);
			}

			var headKids = [
				E('div', { 'class': 'mtkw-card-title-group' }, [ titleEl ].concat(opts.badges || []))
			];
			if (opts.actions && opts.actions.length) {
				headKids.push(E('div', { 'class': 'mtkw-card-actions' }, opts.actions));
			}

			var attrs = { 'class': 'mtkw-card' + (opts.className ? ' ' + opts.className : '') };
			if (opts.id) attrs.id = opts.id;
			if (opts.frozen !== undefined) attrs['data-frozen'] = opts.frozen ? 'true' : 'false';
			if (foldKey) attrs['data-collapsed'] = collapsed ? 'true' : 'false';

			var sec = E('section', attrs, [
				E('div', { 'class': 'mtkw-card-head' }, headKids),
				bodyWrap
			]);

			if (foldKey) {
				titleEl.addEventListener('click', function() {
					var nextCollapsed = sec.getAttribute('data-collapsed') !== 'true';
					setFolded(foldKey, nextCollapsed);
					sec.setAttribute('data-collapsed', nextCollapsed ? 'true' : 'false');
					titleEl.setAttribute('aria-expanded', String(!nextCollapsed));
					bodyWrap.hidden = nextCollapsed;
				});
			}

			return sec;
		}

		/* ── MIB Tile Grid & ethtool-missing Card ────────────────────────── */

		function buildMibTilesGrid(gdmId, colClass, missingId) {
			var ms = app.lastMac || {};
			if (!ms.available) {
				var copyBtn = E('button', {
					'type': 'button',
					'class': 'mtkw-btn mtkw-btn-soft mtkw-btn-xs'
				}, [ aui.icon('copy', 13), _('Copy') ]);
				copyBtn.addEventListener('click', function() {
					copyAction('opkg install ethtool', 'opkg install ethtool', copyBtn);
				});
				var cardAttrs = { 'class': 'mtkw-empty-card mtkw-ethtool-missing' };
				if (missingId) cardAttrs.id = missingId;
				return E('div', cardAttrs, [
					E('div', { 'class': 'mtkw-row' }, [
						aui.pill(ms.reason === 'ethtool_missing' ? _('ethtool not installed') : _('Unavailable'), 'warn'),
						E('strong', { 'class': 'mtkw-t-text' }, _('MAC Counters (GDM)'))
					]),
					E('div', {}, ms.reason === 'ethtool_missing'
						? _('Install the ethtool package to show the hardware MAC counters.')
						: _('MAC counters are unavailable.')),
					ms.reason === 'ethtool_missing'
						? E('div', { 'class': 'mtkw-row' }, [
							E('code', { 'class': 'mtkw-cmd-box' }, 'opkg install ethtool'),
							E('code', { 'class': 'mtkw-cmd-box' }, 'apk add ethtool'),
							copyBtn
						])
						: null
				]);
			}

			var mac = (ms.macs || []).filter(function(m) { return Number(m.gdm) === Number(gdmId); })[0];
			if (!mac || !isMacStatOk(mac)) {
				return E('div', { 'class': 'mtkw-empty-card' }, [
					E('div', { 'class': 'mtkw-row' }, [
						aui.pill(_('MIB unavailable'), 'warn'),
						E('strong', { 'class': 'mtkw-t-text' }, gdmLabel(gdmId))
					]),
					E('div', {}, _('Unable to read hardware MAC counters for this GDM.'))
				]);
			}

			return E('div', { 'class': 'mtkw-mib-grid ' + (colClass || 'is-3col') }, getMibSpecs().map(function(spec) {
				var rawVal = mac[spec.key];
				var isErr = spec.err && typeof rawVal === 'number' && rawVal > 0;
				return E('div', { 'class': 'mtkw-mib-tile' + (isErr ? ' is-err' : '') }, [
					E('div', { 'class': 'mtkw-mib-lbl' }, spec.label),
					E('div', { 'class': 'mtkw-mib-val' }, spec.fmt(rawVal))
				]);
			}));
		}

		/* ── Hardware Write Handlers (with settingsGen & readonly Guards) ── */

		function settingsSaved() {
			app.settingsGen++;
			statusRefresh();
		}

		function handleToggleHwOffload(nextVal) {
			if (!settingsCurrent() || readonly || !app.statusKnown || app.hwBusy) return;
			var val = nextVal ? 1 : 0;
			app.hwBusy = true;
			app.settingsGen++;
			renderWorkspace();

			callSetFlowOffload(val).then(function(r) {
				if (!settingsCurrent()) return;
				app.hwBusy = false;
				if (r && r.error) {
					notifyError(rpcError(r.error));
				} else if (!r || r.result !== 'ok' || r.enabled !== val) {
					notifyError(_('cannot verify the committed firewall settings'));
				} else {
					if (!app.lastStatus.flow_offload) app.lastStatus.flow_offload = {};
					app.lastStatus.flow_offload.hardware = !!val;
					if (val) app.lastStatus.flow_offload.software = true;
					if (app.lastStatus.flow_offload.live_hardware !== null && app.lastStatus.flow_offload.live_hardware !== undefined) {
						app.lastStatus.flow_offload.live_hardware = !!val;
						if (val) app.lastStatus.flow_offload.live_software = true;
					}
					toast.show(val ? _('Hardware flow offload enabled') : _('Switched to software forwarding'));
				}
				settingsSaved();
				renderAll();
			}).catch(function(e) {
				if (!settingsCurrent()) return;
				app.hwBusy = false;
				notifyError(e);
				settingsSaved();
				renderAll();
			});
		}

		function clearWedSettleTimer() {
			if (wedSettleTimer) {
				clearTimeout(wedSettleTimer);
				wedSettleTimer = null;
			}
		}

		function applyWedRereadOutcome(errObj, nextWp, prevConfigured) {
			if (!errObj) return;
			var nextConf = nextWp ? triBool(nextWp.configured) : null;
			var nextRecPath = (nextWp && nextWp.recovery_path) ? String(nextWp.recovery_path) : '';
			errObj.pendingSave = false;
			if (nextRecPath) {
				errObj.recoveryPath = nextRecPath;
				errObj.hint = _('Automatic rollback could not complete. Inspect the recovery directory above on the router before rebooting.');
			} else if (nextConf === null) {
				errObj.hint = _('Could not verify the saved WED configuration. Inspect /etc/modules.conf and /etc/modules.d/ before rebooting.');
			} else if (prevConfigured === null) {
				errObj.hint = nextConf
					? _('Re-read found the saved WED configuration is enabled on disk (previous saved state was unknown). Review the current switch state before rebooting.')
					: _('Re-read found the saved WED configuration is disabled on disk (previous saved state was unknown). Review the current switch state before rebooting.');
			} else if (nextConf === prevConfigured) {
				errObj.hint = _('Re-read confirmed the saved WED configuration still matches the previous state.');
			} else {
				errObj.hint = _('Re-read found the saved WED configuration changed on disk. Review the current switch state before rebooting.');
			}
		}

		function scheduleWedSettlePoll(wGen) {
			clearWedSettleTimer();
			wedSettleTimer = setTimeout(function() {
				wedSettleTimer = null;
				if (!settingsCurrent() || wGen !== app.wedGen) return;
				if (!app.wedError || !app.wedError.pendingSave || app.wedError.wedGen !== wGen) return;
				statusRefresh();
			}, 1500);
		}

		function handleToggleWed(explicitVal) {
			if (!settingsCurrent() || readonly || !app.statusKnown || app.wedBusy) return;
			var wp = app.lastStatus.wed_param || {};
			if (wp.saving === true) return;
			if (wp.active === null || wp.active === undefined) return;
			var prevConfigured = triBool(wp.configured);
			var curOn = prevConfigured !== null ? prevConfigured : !!wp.active;
			var nextBool = explicitVal !== undefined ? !!explicitVal : !curOn;
			var val = nextBool ? 1 : 0;

			clearWedSettleTimer();
			app.wedBusy = true;
			app.settingsGen++;
			app.wedGen++;
			renderRebootBanner();
			renderWorkspace();

			function handleWedInterrupted(errOrMsg, alreadyTranslated) {
				var msg = errText(errOrMsg);
				var wGen = app.wedGen;
				app.wedError = {
					title: _('Failed to save WED settings'),
					message: alreadyTranslated ? msg : rpcError(msg),
					raw: msg,
					recoveryPath: '',
					hint: _('The request was interrupted before confirmation. Re-reading the saved WED configuration...')
				};
				notifyError(errOrMsg);
				renderAll();
				scrollToId('mtkw-wed-error');

				callStatus(true).then(function(st) {
					if (!settingsCurrent() || wGen !== app.wedGen) return;
					var nextWp = st && st.wed_param;
					if (nextWp) {
						app.lastStatus.wed_param = nextWp;
						if (app.lastGood) app.lastGood.wed_param = nextWp;
					}
					if (nextWp && nextWp.saving === true) {
						if (app.wedError) {
							app.wedError.pendingSave = true;
							app.wedError.prevConfigured = prevConfigured;
							app.wedError.wedGen = wGen;
							app.wedError.hint = _('A WED settings save is still in progress on the router. Wait a moment and refresh before rebooting.');
						}
						renderAll();
						scheduleWedSettlePoll(wGen);
						return;
					}
					applyWedRereadOutcome(app.wedError, nextWp, prevConfigured);
					settingsSaved();
					renderAll();
				}).catch(function() {
					if (!settingsCurrent() || wGen !== app.wedGen) return;
					if (app.wedError) {
						app.wedError.hint = _('Could not re-read the saved WED configuration after the interrupted request. Refresh the page before rebooting.');
					}
					renderAll();
				});
			}

			callSetWedEnable(val).then(function(r) {
				if (!settingsCurrent()) return;
				app.wedBusy = false;
				if (r && r.error) {
					var raw = String(r.error);
					var translated = rpcError(raw);
					var recoveryPath = raw.indexOf(WED_RECOVERY_PREFIX) === 0 ? raw.slice(WED_RECOVERY_PREFIX.length) : '';
					var isQuoteOrLen = raw.indexOf('quotes spanning') >= 0 || raw.indexOf('oversized') >= 0;
					app.wedError = {
						title: _('Failed to save WED settings'),
						message: translated,
						raw: raw,
						recoveryPath: recoveryPath,
						hint: recoveryPath
							? _('Automatic rollback could not complete. Inspect the recovery directory above on the router before rebooting.')
							: isQuoteOrLen
								? _('To avoid corrupting module files, writing was aborted. Check /etc/modules.conf, /etc/modules-boot.d/, and /etc/modules.d/ so quoted values stay on one line under 511 characters.')
								: _('The switch has been restored to the current saved configuration.')
					};
					notifyError(translated);
					settingsSaved();
					renderAll();
					scrollToId('mtkw-wed-error');
					return;
				}
				if (!r || r.result !== 'ok' || r.enabled !== val) {
					handleWedInterrupted(_('The WED settings update could not be confirmed.'), true);
					return;
				}
				app.wedError = null;
				if (app.lastStatus.wed_param) {
					app.lastStatus.wed_param.configured = !!val;
					delete app.lastStatus.wed_param.recovery_path;
				}
				settingsSaved();
				renderAll();
				var mismatch = app.lastStatus.wed_param && app.lastStatus.wed_param.configured !== app.lastStatus.wed_param.active;
				if (mismatch) {
					ui.addNotification(null, E('p', {}, _('Saved. Reboot the router to apply the Wi-Fi acceleration change.')), 'info');
				} else {
					toast.show(_('WED configuration reverted to active state'));
				}
			}).catch(function(e) {
				if (!settingsCurrent()) return;
				app.wedBusy = false;
				handleWedInterrupted(e);
			});
		}

		function handleApplyCpu(gov, freqStr) {
			if (!settingsCurrent() || readonly || app.cpuSaving) return;
			var c = app.lastStatus.cpu || {};
			var govs = String(c.governors || '').split(/\s+/).filter(Boolean);
			var freqs = String(c.frequencies || '').split(/\s+/).filter(Boolean);
			if (!c.cpufreq || govs.indexOf(gov) < 0 || freqs.indexOf(String(freqStr)) < 0 ||
				!/^[0-9]+$/.test(String(freqStr)) || !Number.isSafeInteger(Number(freqStr)) || Number(freqStr) <= 0) {
				return;
			}

			app.cpuSaving = true;
			app.settingsGen++;
			renderWorkspace();

			callSetCpuSettings(gov, Number(freqStr)).then(function(r) {
				if (!settingsCurrent()) return;
				app.cpuSaving = false;
				app.cpuDirty = false;
				app.cpuDraftGov = null;
				app.cpuDraftFreq = null;
				if (r && r.error) {
					var msg = rpcError(r.error);
					app.cpuSavedErr = true;
					app.cpuSavedMsg = _('Error: %s').format(msg);
					notifyError(msg);
				} else if (!r || r.result !== 'ok' || r.governor !== gov || Number(r.freq) !== Number(freqStr)) {
					var unconf = _('The CPU settings update could not be confirmed.');
					app.cpuSavedErr = true;
					app.cpuSavedMsg = _('Error: %s').format(unconf);
					notifyError(unconf);
				} else {
					if (app.lastStatus.cpu) {
						app.lastStatus.cpu.governor = gov;
						app.lastStatus.cpu.max_freq = Number(freqStr);
					}
					app.cpuSavedErr = false;
					app.cpuSavedMsg = _('Applied %s · %s').format(governorLabel(gov), aui.fmtFreq(Number(freqStr)));
					ui.addNotification(null, E('p', {}, _('CPU settings saved — they will persist after a reboot')), 'info');
				}
				settingsSaved();
				renderAll();
			}).catch(function(e) {
				if (!settingsCurrent()) return;
				app.cpuSaving = false;
				app.cpuDirty = false;
				app.cpuDraftGov = null;
				app.cpuDraftFreq = null;
				app.cpuSavedErr = true;
				app.cpuSavedMsg = _('Error: %s').format(errText(e));
				notifyError(e);
				settingsSaved();
				renderAll();
			});
		}

		/* ── Inspector Sheet (Frosted Drawer) ─────────────────────────────── */

		function kvBox(boxTitle, rows, badgeNode) {
			return E('div', { 'class': 'mtkw-drawer-box' }, [
				E('div', { 'class': 'mtkw-drawer-box-head' }, [ E('span', {}, boxTitle), badgeNode || null ]),
				E('div', {}, rows.map(function(r) {
					return E('div', { 'class': 'mtkw-kv-row' + (r.err ? ' is-err' : '') }, [
						E('span', { 'class': 'mtkw-kv-k' }, r.k),
						E('span', { 'class': 'mtkw-kv-v' }, r.v)
					]);
				}))
			]);
		}

		function openInspector(kind, id, extra) {
			app.drawerCtx = { kind: kind, id: id, extra: extra || null };
			syncFlowRowSelection();
			renderDrawerContent(false);
		}

		function renderDrawerContent(silent) {
			if (!app.drawerCtx) return;
			var kind = app.drawerCtx.kind;
			var id = app.drawerCtx.id;
			var st = app.lastStatus || {};
			var ppeNum = effectivePpeNum();
			var ports = naturalSortPorts(app.lastPorts && app.lastPorts.ports);
			var weds = Array.isArray(st.wed) ? st.wed : [];
			var wf = app.lastWifi || {};
			var bands = (wf.available && Array.isArray(wf.bands)) ? wf.bands : [];

			var title = _('Inspector');
			var iconName = 'inspect';
			var iconTone = 'ppe';
			var pills = [];
			var breadcrumbs = [];
			var kpis = [];
			var body = [];
			var footer = null;

			if (kind === 'flow') {
				var fl = app.drawerCtx.extra;
				if (!fl) { drawer.close(); return; }
				var hIdx = hexIndex(fl.index);
				title = 'PPE' + fl.ppe + ' · ' + hIdx;
				iconName = 'ppe';
				var avgPkt = fl.packets > 0 && typeof fl.bytes === 'number' ? Math.round(fl.bytes / fl.packets) : 0;
				var origPretty = prettyFlow(fl.orig);
				var newPretty = fl['new'] ? prettyFlow(fl['new']) : _('No NAT translation (or unbound)');
				var ethParts = fl.eth ? String(fl.eth).split('->') : [];
				var srcMac = ethParts[0] ? ethParts[0].trim() : '—';
				var dstMac = ethParts[1] ? ethParts[1].trim() : '—';
				var vlanParts = parseVlanTags(fl.vlan);

				pills.push(aui.badge(fl.state, fl.state === 'BND' ? 'ppe' : fl.state === 'UNB' ? 'warn' : ''));
				pills.push(aui.badge(fl.type, ''));
				if (vlanParts.length >= 2) {
					pills.push(aui.badge('QinQ ' + vlanParts[0] + '/' + vlanParts[1], 'primary'));
				} else if (vlanParts.length === 1) {
					pills.push(aui.badge('VLAN ' + vlanParts[0], ''));
				}

				breadcrumbs = [
					{ label: 'GDM' + (Number(fl.ppe) + 1), focusKey: 'gdm-' + fl.ppe, onClick: function() { openInspector('gdm', Number(fl.ppe)); } },
					{ label: 'PPE' + fl.ppe, focusKey: 'ppe-' + fl.ppe, onClick: function() { openInspector('ppe', Number(fl.ppe)); } },
					{ label: hIdx, current: true }
				];

				kpis = [
					{ label: _('Packets'), value: fmtCount(fl.packets) },
					{ label: _('Bytes'), value: fmtBytes(fl.bytes) },
					{ label: _('Avg packet'), value: avgPkt + ' B' }
				];

				var copyOrigBtn = E('button', {
					'type': 'button', 'class': 'mtkw-btn mtkw-btn-soft mtkw-btn-xs',
					'data-focus-key': 'copy-orig',
					'aria-label': _('Copy Original Flow')
				}, [ aui.icon('copy', 12) ]);
				copyOrigBtn.addEventListener('click', function() { copyAction(origPretty, _('Original Flow'), copyOrigBtn); });

				var copyNewBtn = E('button', {
					'type': 'button', 'class': 'mtkw-btn mtkw-btn-soft mtkw-btn-xs',
					'data-focus-key': 'copy-new',
					'aria-label': _('Copy New Flow')
				}, [ aui.icon('copy', 12) ]);
				copyNewBtn.addEventListener('click', function() { copyAction(newPretty, _('New Flow'), copyNewBtn); });

				var copyMacBtn = E('button', {
					'type': 'button', 'class': 'mtkw-btn mtkw-btn-soft mtkw-btn-xs',
					'data-focus-key': 'copy-mac',
					'aria-label': _('Copy L2 MAC')
				}, [ aui.icon('copy', 12) ]);
				copyMacBtn.addEventListener('click', function() { copyAction(fl.eth || '', 'L2 MAC', copyMacBtn); });

				body.push(
					E('div', { 'class': 'mtkw-drawer-box' }, [
						E('div', { 'class': 'mtkw-drawer-box-head' }, [
							E('span', {}, _('Original Flow (5-Tuple · RFC 5952)')),
							copyOrigBtn
						]),
						E('div', { 'class': 'mtkw-mono mtkw-drawer-code' }, origPretty)
					]),
					E('div', { 'class': 'mtkw-drawer-box' }, [
						E('div', { 'class': 'mtkw-drawer-box-head' }, [
							E('span', {}, _('New / NAT Flow')),
							E('div', { 'class': 'mtkw-inline mtkw-inline--tight' }, [
								aui.pill(fl['new'] && fl['new'] !== fl.orig ? _('NAT') : _('Direct'), ''),
								copyNewBtn
							])
						]),
						E('div', { 'class': 'mtkw-mono mtkw-drawer-code' }, newPretty)
					]),
					E('div', { 'class': 'mtkw-drawer-box' }, [
						E('div', { 'class': 'mtkw-drawer-box-head' }, [
							E('span', {}, _('L2 Ethernet (eth MAC)')),
							copyMacBtn
						]),
						E('div', { 'class': 'mtkw-mac-vis' }, [
							E('span', { 'class': 'mtkw-mac-pill' }, srcMac),
							E('div', { 'class': 'mtkw-mac-arrow' }, [
								E('span', { 'class': 'mtkw-mono mtkw-mac-tag' }, 'L2 ETH'),
								E('div', { 'class': 'mtkw-mac-line' })
							]),
							E('span', { 'class': 'mtkw-mac-pill' }, dstMac)
						])
					])
				);

				var copySummaryBtn = E('button', { 'type': 'button', 'class': 'mtkw-btn mtkw-btn-primary', 'data-focus-key': 'copy-summary' }, [
					aui.icon('copy', 14), _('Copy Summary')
				]);
				copySummaryBtn.addEventListener('click', function() {
					var summary = 'PPE' + fl.ppe + ' ' + hIdx + ' [' + fl.state + ' ' + fl.type + '] ' +
						origPretty + ' => ' + newPretty + ' | MAC ' + srcMac + ' -> ' + dstMac + ' | VLAN ' + formatVlanCell(fl.vlan);
					copyAction(summary, _('Flow summary'), copySummaryBtn);
				});

				var filterPpeBtn = E('button', { 'type': 'button', 'class': 'mtkw-btn', 'data-focus-key': 'filter-ppe' },
					_('Filter %s flows').format('PPE' + fl.ppe));
				filterPpeBtn.addEventListener('click', function() {
					setFlowPpeAndJump(String(fl.ppe), false);
				});

				footer = [ copySummaryBtn, filterPpeBtn ];
			} else if (kind === 'port') {
				var p = ports.filter(function(x) { return x.netdev === id; })[0];
				if (!p) { drawer.close(); return; }
				title = portName(p);
				iconName = portIconName(p);
				var spd = portSpeedBadge(p);
				var fCnt = portFaultCount(p);
				iconTone = spd.tone || 'muted';
				var rate = app.portRates[p.netdev] || { rx_mbps: 0, tx_mbps: 0 };
				var ppeLbl = gdmPpe(p.gdm, ppeNum);
				var ppeIdx = gdmPpeId(p.gdm, ppeNum);
				var linkSpdTag = speedTag(p.speed_mbps);

				var portPillTxt = p.carrier !== 1
					? _('Link down')
					: linkSpdTag ? (linkSpdTag + ' · ' + _('Link up'))
						: fCnt > 0 ? (spd.label + ' · ' + _('Link up')) : _('Link up');
				pills = [ aui.badge(portPillTxt, spd.tone) ];
				breadcrumbs = [ { label: p.netdev, current: true } ];
				if (hasGdm(p)) {
					breadcrumbs.push({ label: gdmLabel(p.gdm), focusKey: 'gdm-' + p.gdm, onClick: function() { openInspector('gdm', p.gdm); } });
					if (ppeIdx !== null) {
						breadcrumbs.push({ label: ppeLbl, focusKey: 'ppe-' + ppeIdx, onClick: function() { openInspector('ppe', ppeIdx); } });
					}
				}

				kpis = [
					{ label: _('Live RX'), value: aui.fmtMbps(rate.rx_mbps) + ' M' },
					{ label: _('Live TX'), value: aui.fmtMbps(rate.tx_mbps) + ' M' },
					{ label: _('Errors / Dropped'), value: fmtCount(fCnt), err: fCnt > 0 }
				];

				var speedDuplexVal = p.carrier !== 1
					? _('Link down')
					: p.speed_mbps > 0
						? ((linkSpdTag ? linkSpdTag + ' · ' : '') + p.speed_mbps + ' Mbps' + (p.duplex ? ' / ' + duplexText(p.duplex) : ''))
						: (_('Unknown speed') + (p.duplex ? ' / ' + duplexText(p.duplex) : ''));

				body.push(
					kvBox(_('Port Specifications & Counters'), [
						{ k: _('Interface type'), v: portInterfaceLabel(p) },
						{ k: _('Speed / Duplex'), v: speedDuplexVal },
						{ k: _('Path'), v: portPathText(p, ppeNum) },
						{ k: _('RX / TX bytes'), v: fmtBytes(p.rx_bytes) + ' / ' + fmtBytes(p.tx_bytes) },
						{ k: _('RX / TX packets'), v: fmtCount(p.rx_packets) + ' / ' + fmtCount(p.tx_packets) },
						{ k: _('RX / TX errors'), v: fmtCount(p.rx_errors) + ' / ' + fmtCount(p.tx_errors), err: (p.rx_errors || 0) + (p.tx_errors || 0) > 0 },
						{ k: _('RX / TX dropped'), v: fmtCount(p.rx_dropped) + ' / ' + fmtCount(p.tx_dropped), err: (p.rx_dropped || 0) + (p.tx_dropped || 0) > 0 }
					])
				);

				if (hasGdm(p)) {
					body.push(E('div', { 'class': 'mtkw-drawer-box' }, [
						E('div', { 'class': 'mtkw-drawer-box-head' }, [ E('span', {}, gdmLabel(p.gdm) + ' · ' + _('MAC Counters (GDM)')) ]),
						E('div', { 'class': 'mtkw-drawer-pad' }, [ buildMibTilesGrid(p.gdm, 'is-2col') ])
					]));
				}

				if (ppeIdx !== null) {
					var pJumpBtn = E('button', { 'type': 'button', 'class': 'mtkw-btn mtkw-btn-primary', 'data-focus-key': 'filter-ppe' }, [
						_('Filter %s flows').format(ppeLbl), aui.icon('arrow-right', 14)
					]);
					pJumpBtn.addEventListener('click', function() { setFlowPpeAndJump(String(ppeIdx), true); });
					footer = [ pJumpBtn ];
				}
			} else if (kind === 'gdm') {
				var gId = Number(id);
				var ppeN = gdmPpeId(gId, ppeNum);
				var ppeNm = gdmPpe(gId, ppeNum);
				var macObj = ((app.lastMac && app.lastMac.macs) || []).filter(function(m) { return Number(m.gdm) === gId; })[0];
				var macOk = !!(app.lastMac && app.lastMac.available && isMacStatOk(macObj));
				var gErr = macOk ? gdmErrorSum(macObj) : 0;
				var attached = ports.filter(function(x) { return hasGdm(x) && Number(x.gdm) === gId; });
				title = gdmLabel(gId) + ' (' + (macObj ? macObj.netdev : 'eth' + gId) + ')';
				iconName = 'gmac';
				if (!macOk) iconTone = 'warn';
				else if (gErr > 0) iconTone = 'err';

				if (attached.length) breadcrumbs.push({ label: attached[0].netdev, focusKey: 'port-' + attached[0].netdev, onClick: function() { openInspector('port', attached[0].netdev); } });
				breadcrumbs.push({ label: gdmLabel(gId), current: true });
				if (ppeN !== null) breadcrumbs.push({ label: ppeNm, focusKey: 'ppe-' + ppeN, onClick: function() { openInspector('ppe', ppeN); } });

				kpis = [
					{ label: _('TX packets'), value: macOk ? aui.fmtK(macObj.tx_packets) : '—' },
					{ label: _('RX packets'), value: macOk ? aui.fmtK(macObj.rx_packets) : '—' },
					{ label: _('MIB errors'), value: macOk ? fmtCount(gErr) : '—', err: macOk && gErr > 0 }
				];

				body.push(E('div', { 'class': 'mtkw-drawer-box' }, [
					E('div', { 'class': 'mtkw-drawer-box-head' }, [ E('span', {}, _('Hardware MIB Counters (ethtool -S)')) ]),
					E('div', { 'class': 'mtkw-drawer-pad' }, [ buildMibTilesGrid(gId, 'is-2col') ])
				]));

				if (ppeN !== null) {
					var gJumpBtn = E('button', { 'type': 'button', 'class': 'mtkw-btn mtkw-btn-primary', 'data-focus-key': 'filter-ppe' }, [
						_('Filter %s flows').format(ppeNm), aui.icon('arrow-right', 14)
					]);
					gJumpBtn.addEventListener('click', function() { setFlowPpeAndJump(String(ppeN), true); });
					footer = [ gJumpBtn ];
				}
			} else if (kind === 'ppe') {
				var ppes = Array.isArray(st.ppe) ? st.ppe : [];
				var eng = ppes.filter(function(x) { return Number(x.id) === Number(id); })[0];
				if (!eng) { drawer.close(); return; }
				var foPpe = app.statusKnown ? flowState(st) : { hwActive: null, cfgSw: null, cfgHw: null, liveSw: null, liveHw: null, mismatch: false, unknown: true, kind: '', text: _('Unknown') };
				var ppeIsStale = !!st.ppeFailed;
				var engBound = Number(eng.bound) || 0;
				var engTotal = Number(eng.total) || 0;
				var engUnb = Number(eng.unbound) || 0;
				var engFin = Number(eng.fin) || 0;
				var pct = engTotal > 0 ? ((engBound / engTotal) * 100).toFixed(1) + '%' : '0.0%';
				title = 'PPE' + eng.id + ' · ' + _('PPE Engines');
				iconName = 'ppe';
				if (ppeIsStale || foPpe.mismatch || foPpe.hwActive === false) iconTone = 'warn';
				else if (foPpe.hwActive === null) iconTone = 'muted';
				pills = [
					aui.badge(foPpe.text, foPpe.kind === 'ok' ? 'ppe' : (foPpe.kind === 'warn' || foPpe.kind === 'info') ? 'warn' : '')
				];
				if (ppeIsStale) {
					pills.push(aui.badge(_('Stale'), 'warn'));
				}

				breadcrumbs = [
					{ label: 'GDM' + (Number(eng.id) + 1), focusKey: 'gdm-' + eng.id, onClick: function() { openInspector('gdm', Number(eng.id)); } },
					{ label: 'PPE' + eng.id, current: true }
				];
				if (weds.length) {
					breadcrumbs.push({ label: 'WED' + weds[0].id, focusKey: 'wed-' + weds[0].id, onClick: function() { openInspector('wed', weds[0].id); } });
				}

				kpis = [
					{ label: _('Bind rate'), value: pct },
					{ label: _('Bound'), value: engBound + '/' + engTotal },
					{ label: 'UNB / FIN', value: engUnb + ' / ' + engFin }
				];

				var ppeRows = [
					{ k: _('Status'), v: foPpe.text, err: foPpe.mismatch }
				];
				if (ppeIsStale) {
					ppeRows.push({
						k: _('Last updated'),
						v: app.ppeLastGoodAt
							? (fmtTimeHMS(app.ppeLastGoodAt) + ' (' + _('%s ago').format(fmtAgeShort(ppeStaleAgeSec())) + ')')
							: _('Unavailable'),
						err: true
					});
				} else if (app.ppeLastGoodAt) {
					ppeRows.push({ k: _('Last updated'), v: fmtTimeHMS(app.ppeLastGoodAt) });
				}
				ppeRows.push(
					{ k: _('Saved config'), v: flowLabelPair(foPpe.cfgSw, foPpe.cfgHw) },
					{ k: _('Live fw4 rule'), v: foPpe.liveHw !== null ? flowLabelPair(foPpe.liveSw, foPpe.liveHw) : _('Unavailable') },
					{ k: _('Bound'), v: fmtCount(engBound) },
					{ k: _('Unbound'), v: fmtCount(engUnb) },
					{ k: 'FIN', v: fmtCount(engFin) },
					{ k: 'IPv4 / DS-LITE', v: fmtCount(Number(eng.ipv4) || 0) },
					{ k: 'IPv6 / 6RD', v: fmtCount(Number(eng.ipv6) || 0) }
				);

				if (ppeIsStale) {
					var ppeErrMsg = (app.flowData && app.flowData.error) ? String(app.flowData.error) : _('PPE table unavailable');
					body.push(E('div', { 'class': 'mtkw-mlo-popover is-flush', 'role': 'alert' }, [
						E('strong', { 'class': 'mtkw-t-warn' }, _('PPE read failed')),
						E('div', { 'class': 'mtkw-mt-3' }, ppeErrMsg)
					]));
				}
				body.push(kvBox('PPE' + eng.id + ' · ' + _('Offload Statistics'), ppeRows));

				var eJumpBtn = E('button', { 'type': 'button', 'class': 'mtkw-btn mtkw-btn-primary', 'data-focus-key': 'filter-ppe' }, [
					_('Filter %s flows').format('PPE' + eng.id), aui.icon('arrow-right', 14)
				]);
				eJumpBtn.addEventListener('click', function() { setFlowPpeAndJump(String(eng.id), true); });
				footer = [ eJumpBtn ];
			} else if (kind === 'wed') {
				var w = weds.filter(function(x) { return Number(x.id) === Number(id); })[0];
				if (!w) { drawer.close(); return; }
				var wp = st.wed_param || {};
				title = 'WED' + w.id + ' · ' + _('Wi-Fi Acceleration (WED)');
				iconName = 'wed';
				iconTone = (w.attached && w.rx === true) ? 'wed' : 'warn';

				var wedMap = resolveWedBandMap(weds, bands);
				var wBands = wedMap.wedToBands[w.id] || [];
				var isEst = !!(wedMap.estimated && wBands.length);
				if (isEst) {
					pills.push(aui.badge(_('Estimated'), ''));
				}
				breadcrumbs = [
					{ label: 'PPE0', focusKey: 'ppe-0', onClick: function() { openInspector('ppe', 0); } },
					{ label: 'WED' + w.id + (w.version != null ? ' v' + w.version : ''), current: true }
				];
				wBands.forEach(function(bObj) {
					var bInfo = aui.BANDS[bObj.band] || { name: 'B' + bObj.band, full: _('Band') + ' ' + bObj.band };
					breadcrumbs.push({
						label: bInfo.full + (wedMap.estimated ? ' (~)' : ''),
						focusKey: 'wifi-' + bObj.band,
						onClick: function() { openInspector('wifi', bObj.band); }
					});
				});

				var modeShort = !w.attached ? _('Not attached') : w.rx === true ? _('TX + RX') : w.rx === false ? _('TX only') : _('TX, RX unknown');
				var bandKpiVal = !wBands.length
					? '—'
					: wBands.map(function(bObj) {
						var bi = aui.BANDS[bObj.band];
						return bi ? bi.name : ('B' + bObj.band);
					}).join(' / ') + (wedMap.estimated ? ' (~)' : '');
				kpis = [
					{ label: _('Version'), value: w.version != null ? 'WED v' + w.version : '—' },
					{ label: _('Mode'), value: modeShort },
					{ label: _('Band'), value: bandKpiVal }
				];

				body.push(
					kvBox('WED' + w.id + ' · WO', [
						{ k: _('Driver module'), v: wp.module || '—' },
						{ k: _('WO firmware'), v: woFirmware(wedFwSource(w, st)) },
						{ k: _('Active'), v: wp.active === true ? _('Enabled (Y)') : wp.active === false ? _('Disabled (N)') : _('Wi-Fi driver not loaded') },
						{ k: _('Configured'), v: wp.configured === true ? _('Enabled (Y)') : wp.configured === false ? _('Disabled (N)') : '—' }
					]),
					E('div', { 'class': 'mtkw-drawer-box' }, [
						E('div', { 'class': 'mtkw-drawer-box-head' }, _('Offload Direction')),
						E('div', { 'class': 'mtkw-drawer-note' },
							!w.attached ? _('No Wi-Fi device attached to this WED instance.')
								: w.rx === true ? _('Bidirectional TX and RX wireless hardware offload active with WO firmware.')
									: w.rx === false ? _('TX-only wireless hardware offload active; RX frames are handled by CPU DMA.')
										: _('TX offload active; RX buffer manager register could not be read.'))
					])
				);
				if (isEst) {
					body.push(E('div', { 'class': 'mtkw-drawer-box' }, [
						E('div', { 'class': 'mtkw-drawer-box-head' }, [
							E('span', {}, _('Band')),
							aui.badge(_('Estimated'), '')
						]),
						E('div', { 'class': 'mtkw-drawer-note' }, _('Band-to-WED pairing is estimated on multi-WED hardware.'))
					]));
				}

				if (wBands.length) {
					footer = wBands.map(function(bObj, idx) {
						var bInfo = aui.BANDS[bObj.band] || { name: 'B' + bObj.band, full: _('Band') + ' ' + bObj.band };
						var wBandBtn = E('button', {
							'type': 'button',
							'class': idx === 0 ? 'mtkw-btn mtkw-btn-primary' : 'mtkw-btn',
							'data-focus-key': 'inspect-wifi-' + bObj.band
						}, [
							_('Inspect %s band').format(bInfo.full), aui.icon('arrow-right', 14)
						]);
						wBandBtn.addEventListener('click', function() { openInspector('wifi', bObj.band); });
						return wBandBtn;
					});
				}
			} else if (kind === 'wifi') {
				var band = bands.filter(function(b) { return Number(b.band) === Number(id); })[0];
				if (!band) { drawer.close(); return; }
				var meta = aui.BANDS[band.band] || { full: _('Band') + ' ' + band.band, tone: 'ppe', varName: '--mtkw-ppe', tintVar: '--mtkw-ppe-tint' };
				var q = wifiBandQuality(band);
				var wedMapWifi = resolveWedBandMap(weds, bands);
				var wid = wedMapWifi.bandToWed[band.band];
				title = meta.full + ' · ' + _('Wi-Fi Band Details');
				iconName = 'wifi';
				iconTone = meta.tone || 'ppe';

				if (wid !== null && wid !== undefined) {
					var wedCrumbLbl = 'WED' + wid + (wedMapWifi.estimated ? ' (' + _('Estimated') + ')' : '');
					breadcrumbs = [
						{ label: wedCrumbLbl, focusKey: 'wed-' + wid, onClick: function() { openInspector('wed', wid); } },
						{ label: meta.full, current: true }
					];
					if (wedMapWifi.estimated) {
						pills.push(aui.badge('WED' + wid + ' · ' + _('Estimated'), ''));
					}
				}

				var avgSig = bandAvgSig(band);
				var minSig = bandMinSig(band);
				var sigPairTxt = avgSig !== null
					? (minSig !== null ? (avgSig + ' / ' + minSig + ' dBm') : (avgSig + ' dBm'))
					: '—';

				kpis = [
					{ label: _('Airtime'), value: hasValidEff(band) ? (band.airtime_efficiency + '%') : '—' },
					{ label: _('TX'), value: aui.fmtMbps(band.tx_mbps) + ' M' },
					{ label: _('Signal'), value: avgSig !== null ? (avgSig + ' dBm') : '—' }
				];

				var totalClients = typeof wf.stations === 'number' ? wf.stations : bands.reduce(function(n, b) { return n + (Number(b.stations) || 0); }, 0);
				body.push(kvBox(meta.full, [
					{ k: _('Interfaces'), v: band.interfaces || '—' },
					{ k: _('Status'), v: q.label },
					{ k: _('Clients'), v: (Number(band.stations) || 0) + ' (' + _('%d unique').format(totalClients) + ')' },
					{ k: _('Retry'), v: q.retryPct.toFixed(1) + '% (' + fmtCount(Number(band.tx_retries) || 0) + ')', err: q.retryPct > 50 },
					{ k: _('Failed'), v: fmtCount(Number(band.tx_failed) || 0), err: (Number(band.tx_failed) || 0) > 500 },
					{ k: _('PHY / Expected'), v: aui.fmtMbps(band.avg_phy_rate) + ' / ' + aui.fmtMbps(band.avg_exp_throughput) + ' Mbps' },
					{ k: _('Signal'), v: sigPairTxt }
				]));

				if (wf.complete === false) {
					body.push(E('div', { 'class': 'mtkw-mlo-popover is-flush' }, [
						E('strong', { 'class': 'mtkw-t-warn' }, _('Partial sampling · MLO incomplete')),
						E('div', { 'class': 'mtkw-mt-3' }, _('Some Wi-Fi data could not be read or saved; the rates may be incomplete.'))
					]));
				}
			}

			drawer.open({
				title: title,
				iconName: iconName,
				iconTone: iconTone,
				pills: pills,
				breadcrumbs: breadcrumbs,
				kpis: kpis,
				body: body,
				footer: footer,
				silent: !!silent,
				preserveScroll: !!silent,
				preserveFocus: !!silent
			});
		}

		/* ── Selection & Cross-Highlight Handlers ─────────────────────────── */

		function setFlowPpeAndJump(ppeIdStr, shouldCloseDrawer) {
			app.flowFilter.ppe = ppeIdStr;
			app.flowPage = 0;
			if (shouldCloseDrawer) drawer.close();
			navigateTo('flows', 'mtkw-sec-flows', 'flows');
			refreshFlows(true, true);
		}

		function handleFaceplatePortClick(netdev) {
			if (app.selectedPortInline === netdev) {
				app.selectedPortInline = null;
				if (app.selectedTopo && app.selectedTopo.kind === 'port' && app.selectedTopo.id === netdev) {
					app.selectedTopo = null;
				}
			} else {
				app.selectedPortInline = netdev;
				app.selectedTopo = { kind: 'port', id: netdev };
			}
			renderWorkspace();
		}

		function handleSelectNode(kind, id) {
			app.selectedTopo = { kind: kind, id: id };
			if (kind === 'port') {
				app.selectedPortInline = id;
				if (isFolded('faceplate')) setFolded('faceplate', false);
				renderWorkspace();
				if (byId('mtkw-port-inline')) {
					scrollToId('mtkw-port-inline');
				} else {
					openInspector('port', id);
				}
				return;
			}
			openInspector(kind, id);
			renderWorkspace();
		}

		function clearTopoSelection() {
			app.selectedTopo = null;
			app.selectedPortInline = null;
			renderWorkspace();
		}

		/* ── Render: Hero Header ──────────────────────────────────────────── */

		function renderHead() {
			var st = app.lastStatus || {};
			var c = st.cpu || {};
			var tempC = fmtTempC(c.temp_milli);
			var wp = st.wed_param || {};
			var ports = naturalSortPorts(app.lastPorts && app.lastPorts.ports);
			var wf = app.lastWifi || {};

			var anomalies = [];
			if (app.statusKnown) {
				if (wp.recovery_path) {
					anomalies.push({
						tone: 'err',
						text: _('WED recovery required'),
						onClick: function() { navigateTo('offload', app.allInOne ? 'mtkw-sec-datapath' : 'mtkw-sec-offload-ctrl', app.allInOne ? 'datapath' : 'offload-ctrl'); }
					});
				}
				if (wp.active !== null && wp.active !== undefined && wp.configured !== null && wp.configured !== undefined && wp.configured !== wp.active) {
					anomalies.push({ tone: 'warn', text: _('WED reboot required'), onClick: function() { scrollToId('mtkw-reboot-banner'); } });
				}
				if (tempC !== null && tempC >= 80) {
					anomalies.push({ tone: 'err', text: 'CPU ' + tempC.toFixed(1) + ' °C', onClick: function() { navigateTo('offload', 'mtkw-sec-cpu', 'cpu'); } });
				}
				var errPorts = ports.filter(function(p) { return portFaultCount(p) > 0; });
				if (errPorts.length) {
					anomalies.push({
						tone: 'err',
						text: _('%d port errors').format(errPorts.length),
						onClick: function() {
							app.selectedPortInline = errPorts[0].netdev;
							app.selectedTopo = { kind: 'port', id: errPorts[0].netdev };
							navigateTo('overview', 'mtkw-port-inline', 'faceplate');
						}
					});
				}
				if (wf.has_wifi && wf.complete === false) {
					anomalies.push({
						tone: 'warn',
						text: _('Incomplete MLO sampling'),
						onClick: function() { app.mloPopoverOpen = true; navigateTo('wifi', 'mtkw-sec-wifi', 'wifi'); }
					});
				}
				var foHead = flowState(st);
				if (foHead.mismatch || foHead.hwActive === false) {
					anomalies.push({
						tone: 'warn',
						text: foHead.text,
						onClick: function() { navigateTo('offload', app.allInOne ? 'mtkw-sec-datapath' : 'mtkw-sec-offload-ctrl', app.allInOne ? 'datapath' : 'offload-ctrl'); }
					});
				}
				if (st.ppeFailed && !st.ppeAbsent) {
					anomalies.push({
						tone: 'warn',
						text: _('PPE read failed'),
						onClick: function() { navigateTo('flows', 'mtkw-sec-flows', 'flows'); }
					});
				}
			}

			var titleRowKids = [
				E('h2', { 'class': 'mtkw-title' }, st.model || _('MediaTek SoC Status'))
			];
			if (st.soc) titleRowKids.push(aui.badge(socName(st.soc), 'primary'));
			if (c.count || c.arch) {
				var cpuMeta = [ c.arch || '', c.count ? (c.count + ' ' + _('cores')) : '' ].filter(Boolean).join(' · ');
				titleRowKids.push(aui.pill(cpuMeta, ''));
			}
			if (app.statusKnown) {
				if (!anomalies.length) {
					var foOpt = flowState(st);
					if (foOpt.hwActive === true) {
						titleRowKids.push(aui.pill(_('Hardware offload optimal'), 'wed', { icon: 'check', iconSize: 12 }));
					} else if (foOpt.cfgHw !== null) {
						titleRowKids.push(aui.pill(foOpt.text, ''));
					} else {
						titleRowKids.push(aui.pill(_('Offload status unknown'), ''));
					}
				} else {
					anomalies.forEach(function(a) {
						titleRowKids.push(aui.pill(a.text, a.tone, { icon: 'alert', iconSize: 12, onClick: a.onClick }));
					});
				}
			} else if (!app.stale) {
				titleRowKids.push(aui.pill(_('Loading…'), ''));
			}

			var eyebrowText = app.stale && app.lastErr
				? _('Cannot read status from the luci.mtk_wed backend: %s').format(errText(app.lastErr))
				: [ _('MediaTek SoC Status'), st.compatible || '' ].filter(Boolean).join(' · ');

			var liveState = app.stale ? 'stale' : (app.paused || app.bgPaused) ? 'paused' : 'live';
			var liveText = app.stale ? _('Connection stale')
				: app.paused ? _('Paused')
					: app.bgPaused ? _('Background paused')
						: _('Live · 5s');

			var pauseBtn = E('button', {
				'type': 'button',
				'id': 'mtkw-btn-pause',
				'class': 'mtkw-btn',
				'aria-pressed': String(app.paused)
			}, [ aui.icon(app.paused ? 'play' : 'pause', 13), app.paused ? _('Resume') : _('Pause') ]);
			pauseBtn.addEventListener('click', function() {
				app.paused = !app.paused;
				renderHead();
				if (!app.paused && !document.hidden) {
					if (!statusReady) {
						bootInitialFetch();
					} else {
						refresh();
						if (!app.flowFrozen) refreshFlows(true);
					}
				}
			});

			var refreshBtn = E('button', {
				'type': 'button',
				'id': 'mtkw-btn-refresh',
				'class': 'mtkw-btn'
			}, [
				E('span', { 'class': 'mtkw-ico-wrap' + (app.refreshing ? ' mtkw-spin' : '') }, [ aui.icon('refresh', 13) ]),
				app.refreshing ? _('Refreshing…') : _('Refresh')
			]);
			refreshBtn.disabled = app.refreshing;
			refreshBtn.addEventListener('click', function() {
				if (app.refreshing) return;
				app.refreshing = true;
				renderHead();
				var tasks = !statusReady ? [ bootInitialFetch() ] : [ refresh(true) ];
				if (statusReady && !app.flowFrozen) tasks.push(refreshFlows(true, true));
				Promise.all(tasks).finally(function() {
					if (!isLive()) return;
					app.refreshing = false;
					renderHead();
				});
			});

			var dotAttrs = { 'class': 'mtkw-dot' + (liveState === 'live' ? ' is-live' : '') };
			if (liveState === 'live') dotAttrs['data-tone'] = 'ok';
			else if (liveState === 'stale') dotAttrs['data-tone'] = 'warn';

			setChildren(headEl, [
				E('div', { 'class': 'mtkw-head-left' }, [
					E('div', { 'class': 'mtkw-emblem' }, [ aui.icon('router', 22) ]),
					E('div', { 'class': 'mtkw-head-stack' }, [
						E('div', {
							'class': 'mtkw-eyebrow mtkw-mono',
							'id': 'mtkw-lede',
							'data-error': app.stale ? 'true' : 'false'
						}, eyebrowText),
						E('div', { 'class': 'mtkw-title-row' }, titleRowKids)
					])
				]),
				E('div', { 'class': 'mtkw-head-right' }, [
					readonly ? aui.pill(_('Read-only'), 'warn', {
						icon: 'lock', iconSize: 12,
						title: _('Read-only access; settings cannot be modified')
					}) : null,
					E('div', { 'class': 'mtkw-live-cluster' }, [
						E('span', dotAttrs),
						E('span', { 'class': 'mtkw-live-label' }, liveText),
						E('span', { 'class': 'mtkw-mono mtkw-live-clock', 'id': 'mtkw-live-clock' }, fmtTimeHMS(app.lastUpdated)),
						pauseBtn,
						refreshBtn
					])
				])
			]);
		}

		/* ── Render: Segmented Navigation + All-in-One Bar ───────────────── */

		function renderNav() {
			var st = app.lastStatus || {};
			var ports = naturalSortPorts(app.lastPorts && app.lastPorts.ports);
			var hasPortErr = ports.some(function(p) { return portFaultCount(p) > 0; }) ||
				(app.lastMac && app.lastMac.available && (app.lastMac.macs || []).some(function(m) { return gdmErrorSum(m) > 0; }));
			var tempC = fmtTempC(st.cpu && st.cpu.temp_milli);
			var wp = st.wed_param || {};
			var foDot = flowState(st);
			var hasOffWarn = app.statusKnown && (
				(tempC !== null && tempC >= 80) ||
				!!wp.recovery_path ||
				(wp.active !== null && wp.active !== undefined && wp.configured !== null && wp.configured !== undefined && wp.configured !== wp.active) ||
				foDot.mismatch || foDot.hwActive === false || (foDot.liveHw === null && foDot.cfgHw === false)
			);
			var wf = app.lastWifi || {};
			var hasWifi = showWifiSection();
			var hasWifiWarn = hasWifi && (wf.complete === false || wf.available === false);

			var fd = app.flowData || {};
			var flowErr = fd.available === false || !!fd.error;
			var flowKnown = !flowErr && Array.isArray(fd.ppe);
			var fFiltered = !!(app.flowFilter.state || app.flowFilter.type || app.flowFilter.ppe !== '' || app.flowSearch);
			var fMatched = flowKnown ? (fd.page >= 0 ? (fd.matched || 0) : (fd.entries || []).length) : 0;
			var fTotal = Number(fd.total) || 0;
			var fCountTxt = flowErr ? '—'
				: !flowKnown ? '…'
					: fFiltered ? (fMatched + '/' + fTotal) : String(fTotal);

			var tabs = [
				{ id: 'overview', label: _('Overview'), anchor: 'mtkw-sec-faceplate', unfold: 'faceplate' },
				{ id: 'ports', label: _('Ports & GDM'), anchor: 'mtkw-sec-ports', unfold: 'ports', dot: hasPortErr ? 'err' : null },
				{ id: 'offload', label: _('Hardware Offload'), anchor: 'mtkw-sec-cpu', unfold: 'cpu', dot: hasOffWarn ? (tempC !== null && tempC >= 80 ? 'err' : 'warn') : null }
			];
			if (hasWifi) {
				tabs.push({ id: 'wifi', label: _('Wi-Fi & MLO'), anchor: 'mtkw-sec-wifi', unfold: 'wifi', dot: hasWifiWarn ? 'warn' : null });
			}
			tabs.push({ id: 'flows', label: _('PPE Flows'), anchor: 'mtkw-sec-flows', unfold: 'flows', count: fCountTxt, filtered: !flowErr && fFiltered, dot: flowErr ? 'err' : null });

			var segBtns = tabs.map(function(t) {
				var sel = !app.allInOne && app.activeTab === t.id;
				var btn = E('button', {
					'type': 'button',
					'role': 'tab',
					'class': 'mtkw-seg-btn',
					'aria-selected': String(sel),
					'data-tab': t.id
				}, [
					E('span', {}, t.label),
					t.dot ? E('span', { 'class': 'mtkw-dot', 'data-tone': t.dot }) : null,
					t.count !== undefined ? E('span', { 'class': 'mtkw-seg-count' + (t.filtered ? ' is-filtered' : '') }, t.count) : null
				]);
				btn.addEventListener('click', function() {
					if (t.unfold && isFolded(t.unfold)) setFolded(t.unfold, false);
					if (app.allInOne) {
						renderWorkspace();
						scrollToId(t.anchor);
					} else {
						app.activeTab = t.id;
						lsSet(VIEW_KEY, t.id);
						renderNav();
						renderWorkspace();
					}
				});
				return btn;
			});

			var allBtn = E('button', {
				'type': 'button',
				'id': 'mtkw-btn-all-in-one',
				'class': 'mtkw-all-toggle',
				'aria-pressed': String(app.allInOne)
			}, [ aui.icon('layers', 15), app.allInOne ? _('Back to Tabs') : _('All-in-One') ]);
			allBtn.addEventListener('click', function() {
				app.allInOne = !app.allInOne;
				lsSet(VIEW_KEY, app.allInOne ? 'all' : app.activeTab);
				renderNav();
				renderWorkspace();
			});

			setChildren(navEl, [
				E('div', { 'class': 'mtkw-seg-rail', 'role': 'tablist', 'aria-label': _('Status views') }, segBtns),
				allBtn
			]);
		}

		/* ── Render: Persistent Top-Level Uncollapsible WED Reboot Banner ── */

		function renderRebootBanner() {
			var wp = (app.lastStatus && app.lastStatus.wed_param) || {};
			var need = wp.active !== null && wp.active !== undefined &&
				wp.configured !== null && wp.configured !== undefined &&
				wp.configured !== wp.active;
			rebootBannerEl.hidden = !need;
			if (!need) {
				clearEl(rebootBannerEl);
				return;
			}

			var revertBtn = E('button', {
				'type': 'button',
				'id': 'mtkw-btn-reboot-revert',
				'class': 'mtkw-btn'
			}, app.wedBusy ? _('Reverting…') : _('Revert'));
			revertBtn.disabled = readonly || app.wedBusy || wp.saving === true;
			revertBtn.addEventListener('click', function() { handleToggleWed(!!wp.active); });

			var rebootLink = null;
			if (!readonly) {
				var rebootHref = (typeof L !== 'undefined' && typeof L.url === 'function')
					? L.url('admin/system/reboot') : '/cgi-bin/luci/admin/system/reboot';
				rebootLink = E('a', {
					'class': 'mtkw-btn mtkw-btn-warn',
					'id': 'mtkw-link-reboot',
					'href': rebootHref
				}, [ _('System → Reboot'), aui.icon('arrow-right', 13) ]);
			}

			setChildren(rebootBannerEl, [
				E('div', { 'class': 'mtkw-reboot-body' }, [
					E('div', { 'class': 'mtkw-reboot-ico-box' }, [ aui.icon('alert', 18) ]),
					E('div', {}, [
						E('div', { 'class': 'mtkw-reboot-title' }, _('Wi-Fi Acceleration (WED) setting changed — reboot required')),
						E('div', { 'class': 'mtkw-reboot-diff' }, [
							aui.badge((wp.module || 'mt79xx') + ' wed_enable', ''),
							E('span', {}, _('Active') + ':'),
							E('strong', { 'class': 'mtkw-mono' }, wp.active ? _('Enabled (Y)') : _('Disabled (N)')),
							E('span', {}, '→'),
							E('span', {}, _('Configured') + ':'),
							E('strong', { 'class': 'mtkw-mono mtkw-t-warn' }, wp.configured ? _('Enabled (Y)') : _('Disabled (N)'))
						])
					])
				]),
				E('div', { 'class': 'mtkw-reboot-actions' }, [ revertBtn, rebootLink ])
			]);
		}

		/* ── Card 1 (Hero): Tactile SFP+/RJ45 Faceplate + Inline Detail ──── */

		function buildInlinePortDiagnostic(p) {
			var ppeNum = effectivePpeNum();
			var spd = portSpeedBadge(p);
			var faults = portFaultCount(p);
			var rate = app.portRates[p.netdev] || { rx_mbps: 0, tx_mbps: 0 };
			var rxBytes = Number(p.rx_bytes) || 0;
			var txBytes = Number(p.tx_bytes) || 0;
			var totBytes = rxBytes + txBytes;
			var rxPct = totBytes > 0 ? Math.round((rxBytes / totBytes) * 100) : 0;
			var txPct = totBytes > 0 ? 100 - rxPct : 0;
			var ppeLbl = gdmPpe(p.gdm, ppeNum);
			var ppeIdx = gdmPpeId(p.gdm, ppeNum);
			var mac = app.lastMac && app.lastMac.available
				? (app.lastMac.macs || []).filter(function(m) { return Number(m.gdm) === Number(p.gdm); })[0]
				: null;
			var macOk = !!(app.lastMac && app.lastMac.available && isMacStatOk(mac));
			var gErr = macOk ? gdmErrorSum(mac) : 0;
			var linkSpdTag = speedTag(p.speed_mbps);

			var chainNodes = [ aui.badge(p.netdev, spd.tone) ];
			if (p.kind === 'gsw' && p.conduit) {
				chainNodes.push(E('span', { 'class': 'mtkw-mono mtkw-t-muted' }, '→'));
				chainNodes.push(aui.badge(_('Switch') + ' ' + p.conduit, ''));
			}
			if (hasGdm(p)) {
				chainNodes.push(E('span', { 'class': 'mtkw-mono mtkw-t-muted' }, '→'));
				chainNodes.push(aui.badge(gdmLabel(p.gdm), gErr > 0 ? 'err' : 'ppe'));
				chainNodes.push(E('span', { 'class': 'mtkw-mono mtkw-t-muted' }, '→'));
				chainNodes.push(aui.badge(ppeLbl, 'ppe'));
			}

			var inspectBtn = E('button', {
				'type': 'button', 'class': 'mtkw-btn mtkw-btn-soft mtkw-btn-sm'
			}, [ aui.icon('inspect', 13), _('Inspector') ]);
			inspectBtn.addEventListener('click', function() { openInspector('port', p.netdev); });

			var closeBtn = E('button', {
				'type': 'button', 'class': 'mtkw-btn mtkw-btn-soft mtkw-btn-sm'
			}, [ aui.icon('close', 13), _('Collapse') ]);
			closeBtn.addEventListener('click', function() {
				app.selectedPortInline = null;
				if (app.selectedTopo && app.selectedTopo.kind === 'port' && app.selectedTopo.id === p.netdev) {
					app.selectedTopo = null;
				}
				renderWorkspace();
			});

			var filterBtn = null;
			if (ppeIdx !== null) {
				filterBtn = E('button', {
					'type': 'button', 'class': 'mtkw-btn mtkw-btn-primary mtkw-btn-sm'
				}, [ _('Filter %s flows').format(ppeLbl), aui.icon('arrow-right', 13) ]);
				filterBtn.addEventListener('click', function() { setFlowPpeAndJump(String(ppeIdx), false); });
			}

			return E('div', { 'class': 'mtkw-port-detail', 'id': 'mtkw-port-inline' }, [
				E('div', { 'class': 'mtkw-pd-head' }, [
					E('div', { 'class': 'mtkw-row mtkw-row--gap8' }, [
						E('span', { 'class': 'mtkw-ico-wrap mtkw-tone', 'data-tone': spd.tone || 'muted' }, [ aui.icon(portIconName(p), 18) ]),
						E('strong', { 'class': 'mtkw-pd-title' }, portName(p)),
						aui.badge(p.carrier !== 1
							? _('Link down')
							: p.speed_mbps > 0
								? ((linkSpdTag ? linkSpdTag + ' · ' : '') + p.speed_mbps + ' Mbps' + (p.duplex ? ' · ' + duplexText(p.duplex) : ''))
								: (_('Link up') + ' · ' + _('Unknown speed') + (p.duplex ? ' · ' + duplexText(p.duplex) : '')), spd.tone)
					]),
					E('div', { 'class': 'mtkw-row mtkw-row--gap6' }, [ inspectBtn, closeBtn ])
				]),
				E('div', { 'class': 'mtkw-pd-route-row' }, [
					E('div', { 'class': 'mtkw-route-chain' }, chainNodes),
					filterBtn
				]),
				E('div', { 'class': 'mtkw-pd-grid' }, [
					E('div', { 'class': 'mtkw-pd-sub' }, [
						E('div', { 'class': 'mtkw-pd-sub-head' }, [
							E('span', {}, _('Live Throughput & Port Counters')),
							aui.badge(faults > 0 ? _('%s errors/dropped').format(fmtCount(faults)) : _('0 errors'), faults > 0 ? 'err' : 'wed')
						]),
						E('div', { 'class': 'mtkw-pd-rates' }, [
							E('span', { 'class': 'mtkw-t-primary' }, '↓ RX ' + aui.fmtMbps(rate.rx_mbps) + ' Mbps'),
							E('span', { 'class': 'mtkw-t-wed' }, '↑ TX ' + aui.fmtMbps(rate.tx_mbps) + ' Mbps')
						]),
						E('div', { 'class': 'mtkw-pd-bar' }, [
							aui.barFill('mtkw-pd-bar-rx', rxPct),
							aui.barFill('mtkw-pd-bar-tx', txPct)
						]),
						E('div', { 'class': 'mtkw-mib-grid is-2col' }, [
							E('div', { 'class': 'mtkw-mib-tile' }, [
								E('div', { 'class': 'mtkw-mib-lbl' }, _('RX bytes / packets')),
								E('div', { 'class': 'mtkw-mib-val' }, fmtBytes(p.rx_bytes) + ' (' + aui.fmtK(p.rx_packets) + ')')
							]),
							E('div', { 'class': 'mtkw-mib-tile' }, [
								E('div', { 'class': 'mtkw-mib-lbl' }, _('TX bytes / packets')),
								E('div', { 'class': 'mtkw-mib-val' }, fmtBytes(p.tx_bytes) + ' (' + aui.fmtK(p.tx_packets) + ')')
							]),
							E('div', { 'class': 'mtkw-mib-tile' + ((p.rx_errors || 0) + (p.tx_errors || 0) > 0 ? ' is-err' : '') }, [
								E('div', { 'class': 'mtkw-mib-lbl' }, _('RX / TX errors')),
								E('div', { 'class': 'mtkw-mib-val' }, fmtCount(p.rx_errors) + ' / ' + fmtCount(p.tx_errors))
							]),
							E('div', { 'class': 'mtkw-mib-tile' + ((p.rx_dropped || 0) + (p.tx_dropped || 0) > 0 ? ' is-err' : '') }, [
								E('div', { 'class': 'mtkw-mib-lbl' }, _('RX / TX dropped')),
								E('div', { 'class': 'mtkw-mib-val' }, fmtCount(p.rx_dropped) + ' / ' + fmtCount(p.tx_dropped))
							])
						])
					]),
					E('div', { 'class': 'mtkw-pd-sub' }, [
						E('div', { 'class': 'mtkw-pd-sub-head' }, [
							E('span', {}, gdmLabel(p.gdm) + ' · ' + _('Hardware MIB Counters (ethtool -S)')),
							!(app.lastMac && app.lastMac.available)
								? aui.pill(app.lastMac && app.lastMac.reason === 'ethtool_missing' ? _('ethtool not installed') : _('MIB unavailable'), 'warn')
								: !macOk
									? aui.pill(_('MIB unavailable'), 'warn')
									: aui.badge(gErr > 0 ? _('%s errors').format(fmtCount(gErr)) : _('0 errors'), gErr > 0 ? 'err' : 'wed')
						]),
						hasGdm(p) ? buildMibTilesGrid(p.gdm, 'is-3col') : E('div', { 'class': 'mtkw-empty-card' }, _('MAC counters are unavailable.'))
					])
				])
			]);
		}

		function buildFaceplateCard() {
			var st = app.lastStatus || {};
			var ports = naturalSortPorts(app.lastPorts && app.lastPorts.ports);
			var ppeNum = effectivePpeNum();
			var upPorts = ports.filter(function(p) { return p.carrier === 1; }).length;
			var directPorts = ports.filter(function(p) { return p.kind !== 'gsw'; });
			var gswPorts = ports.filter(function(p) { return p.kind === 'gsw'; });

			var selPort = app.selectedPortInline ? ports.filter(function(x) { return x.netdev === app.selectedPortInline; })[0] : null;
			var selGdm = selPort && hasGdm(selPort) ? selPort.gdm
				: (app.selectedTopo && app.selectedTopo.kind === 'gdm' ? Number(app.selectedTopo.id) : null);

			function makeBay(p) {
				var spd = portSpeedBadge(p);
				var media = portMedia(p);
				var sfp = media === 'sfp';
				var faults = portFaultCount(p);
				var isSel = app.selectedPortInline === p.netdev ||
					(app.selectedTopo && app.selectedTopo.kind === 'port' && app.selectedTopo.id === p.netdev);
				var sameGdm = selGdm !== null && hasGdm(p) && Number(p.gdm) === Number(selGdm);
				var maxTag = speedTag(p.max_mbps || p.speed_mbps);

				var btn = E('button', {
					'type': 'button',
					'class': 'mtkw-port-bay' + (sfp ? ' is-sfp' : '') + (isSel ? ' is-selected' : '') + (faults > 0 ? ' is-err' : ''),
					'data-port-bay': p.netdev,
					'data-same-gdm': sameGdm ? 'true' : 'false',
					'aria-expanded': String(app.selectedPortInline === p.netdev),
					'aria-label': portName(p) + ' ' + spd.label
				}, [
					E('div', { 'class': 'mtkw-bay-top' }, [
						E('span', { 'class': 'mtkw-role-tag' + (p.role === 'wan' ? ' is-wan' : '') },
							(maxTag ? maxTag + ' ' : '') + (p.role === 'wan' ? 'WAN' : 'LAN')),
						E('span', { 'class': 'mtkw-speed-pill', 'data-spd': spd.code }, spd.label)
					]),
					E('div', { 'class': 'mtkw-bay-jack' }, [
						aui.portFaceplateSvg(p, { media: media, openLabel: sfp ? _('SFP+ OPEN') : _('Link down') })
					]),
					E('div', { 'class': 'mtkw-bay-dev' }, p.netdev),
					E('div', { 'class': 'mtkw-bay-route' }, gdmLabel(p.gdm) + ' · ' + gdmPpe(p.gdm, ppeNum))
				]);
				btn.addEventListener('click', function() { handleFaceplatePortClick(p.netdev); });
				return btn;
			}

			var legend = E('div', { 'class': 'mtkw-fp-legend' }, [
				E('span', { 'class': 'mtkw-fp-leg-item' }, [ E('span', { 'class': 'mtkw-dot', 'data-tone': 'wed' }), '10G' ]),
				E('span', { 'class': 'mtkw-fp-leg-item' }, [ E('span', { 'class': 'mtkw-dot', 'data-tone': '5g' }), '5G' ]),
				E('span', { 'class': 'mtkw-fp-leg-item' }, [ E('span', { 'class': 'mtkw-dot', 'data-tone': 'primary' }), '2.5G' ]),
				E('span', { 'class': 'mtkw-fp-leg-item' }, [ E('span', { 'class': 'mtkw-dot', 'data-tone': 'warn' }), '1G / 100M' ]),
				E('span', { 'class': 'mtkw-fp-leg-item' }, [ E('span', { 'class': 'mtkw-dot', 'data-tone': '10m' }), '10M' ]),
				E('span', { 'class': 'mtkw-fp-leg-item' }, [ E('span', { 'class': 'mtkw-dot' }), _('Link down') ]),
				E('span', { 'class': 'mtkw-fp-leg-item' }, [ E('span', { 'class': 'mtkw-dot', 'data-tone': 'err' }), _('Error') ])
			]);

			var bodyNodes = [];
			if (!ports.length) {
				bodyNodes.push(E('div', { 'class': 'mtkw-empty-card' }, app.statusKnown ? _('Port data unavailable') : _('Loading…')));
			} else {
				var groups = [];
				if (directPorts.length) {
					var allDirectSfp = directPorts.every(function(p) { return portMedia(p) === 'sfp'; });
					groups.push(E('div', { 'class': 'mtkw-port-group is-direct' }, [
						E('div', { 'class': 'mtkw-pg-head' }, [
							E('span', {}, allDirectSfp ? _('Direct SFP+ Ports (GDM)') : _('Direct Ports (GDM)')),
							E('span', {}, _('%d ports').format(directPorts.length))
						]),
						E('div', { 'class': 'mtkw-port-bays' }, directPorts.map(makeBay))
					]));
				}
				if (gswPorts.length) {
					var gswGdm = gswPorts[0].gdm, conduit = gswPorts[0].conduit || 'eth0';
					groups.push(E('div', { 'class': 'mtkw-port-group is-switch' }, [
						E('div', { 'class': 'mtkw-pg-head' }, [
							E('span', {}, _('Switch') + ' (' + conduit + ') → ' + gdmLabel(gswGdm) + ' · ' + gdmPpe(gswGdm, ppeNum)),
							E('span', {}, _('%d ports').format(gswPorts.length))
						]),
						E('div', { 'class': 'mtkw-port-bays' }, gswPorts.map(makeBay))
					]));
				}

				var ppeCnt = Array.isArray(st.ppe) ? st.ppe.length : 0;
				var wedCnt = Array.isArray(st.wed) ? st.wed.length : 0;
				bodyNodes.push(E('div', { 'class': 'mtkw-chassis' }, [
					E('div', { 'class': 'mtkw-silkscreen' }, [
						E('span', {}, String(st.model || 'FILOGIC').toUpperCase() + ' · FRONT PANEL / ' + (socName(st.soc) || 'MT798X')),
						E('span', {}, ppeCnt + ' PPE · ' + wedCnt + ' WED')
					]),
					E('div', { 'class': 'mtkw-chassis-groups' }, groups)
				]));

				if (selPort) {
					bodyNodes.push(buildInlinePortDiagnostic(selPort));
				} else {
					bodyNodes.push(E('div', { 'class': 'mtkw-fp-hint' }, [
						E('span', {}, _('Select any physical port to expand live throughput, GDM → PPE path, and hardware MAC MIB counters.')),
						E('span', { 'class': 'mtkw-mono mtkw-fw-650' }, _('%d / %d up').format(upPorts, ports.length))
					]));
				}
			}

			return makeSpatialCard({
				id: 'mtkw-sec-faceplate',
				foldKey: 'faceplate',
				title: _('Ethernet Ports'),
				badges: [ ports.length ? aui.badge(_('%d / %d up').format(upPorts, ports.length), '') : null ],
				actions: [ legend ],
				body: bodyNodes
			});
		}

		/* ── Card 2: 4-Up Lush Smooth-Gradient 240° Arc Gauges ───────────── */

		function buildArcGaugesGrid() {
			var st = app.lastStatus || {};
			var ppeKnown = Array.isArray(st.ppe);
			var ppes = ppeKnown ? st.ppe : [];
			var weds = Array.isArray(st.wed) ? st.wed : [];
			var cpu = st.cpu || {};
			var wf = app.lastWifi || {};

			/* 1. PPE Bind Rate */
			var tot = 0, bnd = 0;
			ppes.forEach(function(e) { tot += Number(e.total) || 0; bnd += Number(e.bound) || 0; });
			var bindPct = tot > 0 ? (bnd / tot) * 100 : 0;
			var foSt = app.statusKnown ? flowState(st) : { hwActive: null, cfgHw: null, liveHw: null, mismatch: false, unknown: true, kind: '', text: _('Unknown') };
			var hwActive = foSt.hwActive;
			var ppeModeTxt = foSt.mismatch ? foSt.text
				: hwActive === true ? _('Hardware offload')
					: hwActive === false ? _('Software bypass')
						: foSt.text;
			var ppePillTone = foSt.kind === 'ok' ? 'ppe' : (foSt.kind === 'warn' || foSt.kind === 'info') ? 'warn' : '';
			var ppeAbsent = !!st.ppeAbsent || (ppeKnown && !ppes.length && !st.ppeFailed);
			var ppeStale = !ppeAbsent && !!st.ppeFailed && ppeKnown && ppes.length > 0;
			var ppeArcTone = (ppeStale || foSt.mismatch || hwActive === false) ? 'warn' : 'ppe';

			var ppeFooterKids = ppes.length ? ppes.map(function(e) {
				var eBound = Number(e.bound) || 0;
				var eTotal = Number(e.total) || 0;
				var p = eTotal > 0 ? Math.round((eBound / eTotal) * 100) : 0;
				var eCntTxt = (eTotal >= 10000 || eBound >= 10000) ? (aui.fmtK(eBound) + '/' + aui.fmtK(eTotal)) : (eBound + '/' + eTotal);
				var rowBtn = E('button', {
					'type': 'button',
					'class': 'mtkw-ppe-row-btn',
					'title': _('Filter %s flows').format('PPE' + e.id)
				}, [
					E('span', { 'class': 'mtkw-ppe-row-lbl' }, 'PPE' + e.id),
					E('div', { 'class': 'mtkw-cap-bar' }, [ aui.barFill('mtkw-cap-fill', p) ]),
					E('span', { 'class': 'mtkw-ppe-row-cnt' }, eCntTxt)
				]);
				rowBtn.addEventListener('click', function() { setFlowPpeAndJump(String(e.id), false); });
				return rowBtn;
			}) : [
				aui.pill(ppeAbsent ? _('PPE debugfs not found') : (st.ppeFailed ? _('Unknown') : _('Loading…')), '')
			];

			var ppeTopPill = ppeStale
				? (foSt.mismatch
					? E('div', { 'class': 'mtkw-inline mtkw-inline--tight' }, [
						aui.pill(foSt.text, 'warn'),
						aui.pill(_('Stale'), 'warn')
					])
					: aui.pill(_('Stale'), 'warn'))
				: aui.pill(foSt.text, ppePillTone);

			var ppeGaugeSub = ppeAbsent
				? _('PPE debugfs not found')
				: ppeStale
					? (app.ppeLastGoodAt
						? _('%d PPE · Stale (last %s)').format(ppes.length, fmtTimeHMS(app.ppeLastGoodAt))
						: _('%d PPE · %s').format(ppes.length, _('PPE read failed')))
					: ppeKnown
						? _('%d PPE · %s').format(ppes.length, ppeModeTxt)
						: (st.ppeFailed ? _('Unknown') : _('Loading…'));

			var c1 = E('div', { 'class': 'mtkw-gauge-card' }, [
				E('div', { 'class': 'mtkw-gauge-top' }, [
					E('div', {}, [
						E('div', { 'class': 'mtkw-gauge-title' }, _('PPE Bind Rate')),
						E('div', { 'class': 'mtkw-gauge-sub' }, ppeGaugeSub)
					]),
					ppeTopPill
				]),
				E('div', { 'class': 'mtkw-gauge-svg-wrap' }, [
					aui.arcGauge({
						pct: (!ppeAbsent && ppeKnown) ? bindPct : 0,
						tone: ppeArcTone,
						gradId: 'mtkw-g-ppe',
						valueText: ppeAbsent ? '—' : ppeKnown ? bindPct.toFixed(1) + '%' : (st.ppeFailed ? '—' : '…'),
						subText: ppeAbsent
							? _('PPE debugfs not found')
							: ppeStale
								? _('%d / %d bound (stale)').format(bnd, tot)
								: ppeKnown ? _('%d / %d bound').format(bnd, tot) : (st.ppeFailed ? _('Unknown') : _('Loading…')),
						ariaLabel: _('PPE Bind Rate') + ' ' + ((!ppeAbsent && ppeKnown) ? (bindPct.toFixed(1) + '%' + (ppeStale ? ' (' + _('Stale') + ')' : '')) : '')
					})
				]),
				E('div', { 'class': 'mtkw-gauge-footer' }, ppeFooterKids)
			]);

			/* 2. WED Wireless Acceleration */
			var wedAttached = weds.filter(function(w) { return w.attached; }).length;
			var wedVer = weds.length && weds[0].version != null ? 'v' + weds[0].version : '';
			var ws = app.statusKnown ? wedState(st) : { kind: '', code: 'unknown', text: _('Unknown') };

			var wedChips = weds.length ? E('div', { 'class': 'mtkw-chip-row' }, weds.map(function(w) {
				var tone = !w.attached ? '' : w.rx === true ? 'wed' : 'warn';
				var lbl = 'WED' + w.id + ' ' + (!w.attached ? _('Not attached') : w.rx === true ? _('TX + RX') : w.rx === false ? _('TX only') : _('TX, RX unknown'));
				return aui.badge(lbl, tone, {
					onClick: function() { handleSelectNode('wed', w.id); }
				});
			})) : aui.pill(Array.isArray(st.wed) ? _('No WED instances found') : _('Unknown'), '');

			var c2 = E('div', { 'class': 'mtkw-gauge-card' }, [
				E('div', { 'class': 'mtkw-gauge-top' }, [
					E('div', {}, [
						E('div', { 'class': 'mtkw-gauge-title' }, _('Wi-Fi Acceleration (WED)')),
						E('div', { 'class': 'mtkw-gauge-sub mtkw-mono' },
							((st.wed_param && st.wed_param.module) || '—') + (wedVer ? ' · WED ' + wedVer : ''))
					]),
					aui.pill(ws.text, ws.kind === 'ok' ? 'wed' : ws.kind)
				]),
				E('div', { 'class': 'mtkw-gauge-svg-wrap' }, [
					aui.arcGauge({
						pct: weds.length ? (wedAttached / weds.length) * 100 : 0,
						tone: ws.code === 'reboot_required' ? 'warn' : 'wed',
						gradId: 'mtkw-g-wed',
						valueText: Array.isArray(st.wed) ? (wedAttached + '/' + weds.length) : '—',
						subText: _('WED attached'),
						ariaLabel: _('Wi-Fi Acceleration (WED)') + ' ' + wedAttached + '/' + weds.length
					})
				]),
				E('div', { 'class': 'mtkw-gauge-footer' }, [
					wedChips,
					weds.length ? E('div', { 'class': 'mtkw-mono mtkw-gauge-wo' },
						'WO ' + woFirmware(wedFwSource(weds[0], st))) : null
				])
			]);

			/* 3. CPU Dual-Ring Thermal & Clock Headroom */
			var tempC = fmtTempC(cpu.temp_milli);
			var tg = tempGrade(tempC);
			var tempPct = tempC !== null ? ((tempC - 25) / 75) * 100 : 0;
			var freqPct = (cpu.cpufreq !== false && cpu.hw_max_freq > 0) ? ((cpu.cur_freq || 0) / cpu.hw_max_freq) * 100 : 0;
			var freqVals = app.cpuHistory.map(function(pt) { return pt.freq; });
			var sparkSvg = aui.sparklineSvg(freqVals, cpu.hw_max_freq || cpu.max_freq || 1800000, {
				minVal: cpu.min_freq || 400000,
				disabled: cpu.cpufreq === false,
				gradId: 'mtkw-sp-cpu'
			});

			var coreSum = summarizeCoreSamples(app.coreSamples);
			var cpuSubMeta;
			var cpuSubAlert = false;
			if (coreSum && !coreSum.pending) {
				cpuSubMeta = _('Load %s').format(Math.round(coreSum.avgUsage) + '%') + ' · ' +
					(cpu.cpufreq === false ? _('Fixed clock') : Math.round((cpu.max_freq || cpu.hw_max_freq || 0) / 1000) + 'M');
				cpuSubAlert = coreSum.avgUsage >= 60 || coreSum.avgSirq >= 25;
			} else if (cpu.cpufreq === false) {
				cpuSubMeta = _('No cpufreq OPP');
			} else {
				cpuSubMeta = _('Max %s').format(aui.fmtFreq(cpu.max_freq || cpu.hw_max_freq));
			}

			var cpuFootBtn = E('button', {
				'type': 'button',
				'class': 'mtkw-cpu-foot-btn',
				'title': _('CPU Frequency & Utilization')
			}, [
				E('div', { 'class': 'mtkw-cpu-foot-stack' }, [
					E('span', { 'class': 'mtkw-mono mtkw-cpu-foot-gov' },
						cpu.cpufreq === false ? _('Fixed clock') : (cpu.governor ? governorLabel(cpu.governor) : '—')),
					E('span', {
						'class': 'mtkw-mono mtkw-cpu-foot-sub' + (cpuSubAlert ? ' is-alert' : '')
					}, cpuSubMeta)
				]),
				sparkSvg
			]);
			cpuFootBtn.addEventListener('click', function() { navigateTo('offload', 'mtkw-sec-cpu', 'cpu'); });

			var c3 = E('div', { 'class': 'mtkw-gauge-card' }, [
				E('div', { 'class': 'mtkw-gauge-top' }, [
					E('div', {}, [
						E('div', { 'class': 'mtkw-gauge-title' }, _('CPU Temperature')),
						E('div', { 'class': 'mtkw-gauge-sub' }, [ cpu.arch || '', cpu.count ? (cpu.count + ' ' + _('cores')) : '' ].filter(Boolean).join(' · ') || '—')
					]),
					aui.pill(tg.text, tg.tone)
				]),
				E('div', { 'class': 'mtkw-gauge-svg-wrap' }, [
					aui.dualRingGauge({
						tempPct: tempPct,
						freqPct: freqPct,
						tempText: tempC !== null ? tempC.toFixed(1) + '°C' : 'N/A',
						freqText: cpu.cpufreq === false ? _('Fixed clock') : aui.fmtFreq(cpu.cur_freq),
						tempTone: tg.tone || 'wed',
						gradId: 'mtkw-g-cpu',
						ariaLabel: _('CPU Temperature') + ' ' + (tempC !== null ? tempC.toFixed(1) + ' °C' : 'N/A')
					})
				]),
				E('div', { 'class': 'mtkw-gauge-footer' }, [ cpuFootBtn ])
			]);

			/* 4. Wi-Fi Airtime Efficiency (Active Bands Only + Honest No-PHY/No-AP vs iw_missing) */
			var bands = (wf.available && Array.isArray(wf.bands)) ? wf.bands : [];
			var noWifiHw = app.lastWifi !== null && wf.has_wifi === false;
			var iwMissing = isIwMissing(wf);
			var noAp = isNoAp(wf);
			var wifiErr = app.lastWifi !== null && wf.available === false && !iwMissing && !noWifiHw;
			var sumLinks = bands.reduce(function(acc, b) { return acc + (b.stations || 0); }, 0);
			var uniqClients = typeof wf.stations === 'number' ? wf.stations : sumLinks;
			var activeEffBands = bands.filter(hasValidEff);
			var hasAvgAir = activeEffBands.length > 0;
			var avgAir = hasAvgAir
				? Math.round(activeEffBands.reduce(function(acc, b) { return acc + b.airtime_efficiency; }, 0) / activeEffBands.length)
				: null;
			var isMlo = bands.length > 0 && sumLinks > uniqClients;
			var airTone = !hasAvgAir ? 'ppe' : avgAir >= 65 ? 'wed' : avgAir >= 45 ? 'warn' : 'err';

			var wfPillTone = !app.lastWifi || noWifiHw || noAp ? ''
				: iwMissing || wifiErr || wf.complete === false ? 'warn'
					: wedAttached > 0 ? 'wed' : '';
			var wfPillTxt = !app.lastWifi ? _('Loading…')
				: noWifiHw ? _('No Wi-Fi')
					: iwMissing ? _('No iw')
						: wifiErr ? _('Unavailable')
							: noAp ? _('No active AP')
								: wf.complete === false ? _('Partial')
									: wedAttached > 0 ? 'WED' : 'DMA';

			var wfSub = !app.lastWifi ? _('Loading…')
				: noWifiHw ? _('No Wi-Fi hardware')
					: iwMissing ? _('Install iw to view Wi-Fi statistics.')
						: wifiErr ? (wf.error ? _('Cannot read the Wi-Fi statistics: %s').format(_(wf.error)) : _('Wi-Fi stats unavailable'))
							: noAp ? _('No active AP')
								: (_('%d clients').format(uniqClients) + (isMlo ? ' · MLO' : ''));

			var wifiArcSub = !bands.length
				? (noWifiHw ? _('No Wi-Fi hardware') : noAp ? _('No active AP') : (iwMissing || wifiErr) ? _('Wi-Fi stats unavailable') : _('No active bands'))
				: (hasAvgAir ? _('%d band links').format(sumLinks) : _('No clients'));

			var wifiFootNode = bands.length
				? E('div', { 'class': 'mtkw-chip-row' }, bands.map(function(b) {
					var bm = aui.BANDS[b.band] || { name: 'B' + b.band, tone: 'primary' };
					return aui.badge(bm.name + ' ' + (hasValidEff(b) ? (b.airtime_efficiency + '%') : '—'), bm.tone, {
						onClick: function() { handleSelectNode('wifi', b.band); }
					});
				}))
				: aui.pill(iwMissing ? _('Install iw') : noAp ? _('No active AP') : noWifiHw ? _('Wired offload only') : _('Unavailable'), '');

			var c4 = E('div', { 'class': 'mtkw-gauge-card' }, [
				E('div', { 'class': 'mtkw-gauge-top' }, [
					E('div', {}, [
						E('div', { 'class': 'mtkw-gauge-title' }, _('Wi-Fi Airtime Efficiency')),
						E('div', { 'class': 'mtkw-gauge-sub' }, wfSub)
					]),
					aui.pill(wfPillTxt, wfPillTone)
				]),
				E('div', { 'class': 'mtkw-gauge-svg-wrap' }, [
					aui.arcGauge({
						pct: hasAvgAir ? avgAir : 0,
						tone: airTone,
						gradId: 'mtkw-g-wifi',
						valueColor: hasAvgAir ? 'var(--mtkw-text)' : 'var(--mtkw-text-muted)',
						valueText: hasAvgAir ? (avgAir + '%') : '—',
						subText: wifiArcSub,
						ariaLabel: _('Wi-Fi Airtime Efficiency') + ' ' + (hasAvgAir ? (avgAir + '%') : '—')
					})
				]),
				E('div', { 'class': 'mtkw-gauge-footer' }, [ wifiFootNode ])
			]);

			return E('section', {
				'class': 'mtkw-gauge-grid',
				'id': 'mtkw-sec-gauges',
				'aria-label': _('Hardware Offload Gauges')
			}, [ c1, c2, c3, c4 ]);
		}

		/* ── Docked Hardware Offload Controls (Shared by Topology & Offload Tab) */

		function buildProgressiveControlsFooter(includeQuickBar) {
			var st = app.lastStatus || {};
			var ppes = Array.isArray(st.ppe) ? st.ppe : [];
			var weds = Array.isArray(st.wed) ? st.wed : [];
			var wp = st.wed_param || {};
			var foSt = app.statusKnown ? flowState(st) : { on: false, hwActive: null, cfgSw: null, cfgHw: null, liveSw: null, liveHw: null, mismatch: false, unknown: true, kind: '', text: _('Unknown'), detail: '' };
			var wedSt = app.statusKnown ? wedState(st) : { on: false, kind: '', code: 'unknown', text: _('Unknown') };
			var wedChecked = wp.configured !== null && wp.configured !== undefined ? !!wp.configured : !!wp.active;
			var out = [];

			if (includeQuickBar) {
				var allQBtn = E('button', {
					'type': 'button',
					'class': 'mtkw-qpill' + (app.flowFilter.ppe === '' ? ' is-active' : '')
				}, _('All PPEs'));
				allQBtn.addEventListener('click', function() {
					app.flowFilter.ppe = '';
					app.flowPage = 0;
					refreshFlows(true, true);
					renderNav();
					renderWorkspace();
				});

				var qBtns = [ allQBtn ].concat(ppes.map(function(e) {
					var eBound = Number(e.bound) || 0;
					var eTotal = Number(e.total) || 0;
					var r = eTotal > 0 ? Math.round((eBound / eTotal) * 100) : 0;
					var pb = E('button', {
						'type': 'button',
						'class': 'mtkw-qpill' + (app.flowFilter.ppe === String(e.id) ? ' is-active' : ''),
						'data-ppe-card': String(e.id)
					}, 'PPE' + e.id + ' · ' + r + '% (' + eBound + '/' + eTotal + ')');
					pb.addEventListener('click', function() { setFlowPpeAndJump(String(e.id), false); });
					return pb;
				}));

				var openFlowsBtn = E('button', {
					'type': 'button',
					'class': 'mtkw-btn mtkw-btn-soft mtkw-btn-sm'
				}, [ _('Open Flow Table'), aui.icon('arrow-right', 13) ]);
				openFlowsBtn.addEventListener('click', function() { navigateTo('flows', 'mtkw-sec-flows', 'flows'); });

				out.push(E('div', { 'class': 'mtkw-ppe-qbar' }, [
					E('div', { 'class': 'mtkw-ppe-qleft' }, [
						E('span', { 'class': 'mtkw-qbar-lbl' }, _('Quick filter PPE:'))
					].concat(qBtns)),
					openFlowsBtn
				]));
			}

			var hwSwitch = aui.toggleSwitch({
				id: 'mtkw-switch-hw',
				checked: foSt.on,
				disabled: readonly || !app.statusKnown,
				busy: app.hwBusy,
				ariaLabel: _('Hardware Flow Offload'),
				onChange: function(next) { handleToggleHwOffload(next); }
			});

			var hwTile = E('div', { 'class': 'mtkw-ctrl-tile' }, [
				E('div', { 'class': 'mtkw-ctrl-row' }, [
					E('div', { 'class': 'mtkw-ctrl-left' }, [
						E('div', { 'class': 'mtkw-ctrl-icon', 'data-tone': 'ppe' }, [ aui.icon('ppe', 18) ]),
						E('div', {}, [
							E('div', { 'class': 'mtkw-ctrl-title' }, [
								E('span', {}, _('Hardware Flow Offload')),
								aui.pill(foSt.text, foSt.kind === 'ok' ? 'wed' : foSt.kind === 'warn' ? 'warn' : foSt.kind === 'info' ? 'primary' : ''),
								aui.pill(_('Instant'), 'ppe')
							]),
							E('div', { 'class': 'mtkw-ctrl-desc' }, _('Offload established NAT and routed flows to PPE hardware (flow_offloading_hw).'))
						])
					]),
					E('div', { 'class': 'mtkw-inline mtkw-inline--gap7' }, [
						app.hwBusy ? E('span', { 'class': 'mtkw-mono mtkw-busy-lbl mtkw-t-primary' }, _('Saving…')) : null,
						hwSwitch
					])
				]),
				app.statusKnown ? E('div', { 'class': 'mtkw-mono mtkw-ctrl-meta' + (foSt.mismatch ? ' mtkw-t-warn' : '') }, foSt.detail) : null,
				E('div', { 'class': 'mtkw-mono mtkw-ctrl-meta' },
					_('Software offload: %s · PPE engines: %d').format(
						foSt.cfgSw === true ? _('Enabled') : foSt.cfgSw === false ? _('Disabled') : _('Unknown'),
						ppes.length))
			]);

			var wedSaving = app.wedBusy || wp.saving === true;
			var wedSwitch = aui.toggleSwitch({
				id: 'mtkw-switch-wed',
				checked: wedChecked,
				disabled: readonly || !app.statusKnown || wedSt.code === 'unloaded' || wp.saving === true,
				busy: wedSaving,
				tone: wedSt.code === 'reboot_required' ? 'warn' : '',
				ariaLabel: _('Wi-Fi Acceleration (WED)'),
				onChange: function(next) { handleToggleWed(next); }
			});

			var persistedRecPath = (wp && wp.recovery_path) ? String(wp.recovery_path) : '';
			var activeWedAlert = app.wedError ? {
				title: app.wedError.title,
				message: app.wedError.message,
				raw: app.wedError.raw,
				recoveryPath: app.wedError.recoveryPath || persistedRecPath,
				hint: app.wedError.hint,
				dismissible: true
			} : persistedRecPath ? {
				title: _('Previous WED save requires manual recovery'),
				message: _('Automatic rollback could not complete. Inspect the recovery directory above on the router before rebooting.'),
				raw: '',
				recoveryPath: persistedRecPath,
				hint: '',
				dismissible: false
			} : null;

			var wedAlertKids = null;
			if (activeWedAlert) {
				var dismissBtn = null;
				if (activeWedAlert.dismissible) {
					dismissBtn = E('button', {
						'type': 'button',
						'class': 'mtkw-btn mtkw-btn-soft mtkw-btn-xs'
					}, _('Dismiss'));
					dismissBtn.addEventListener('click', function() {
						clearWedSettleTimer();
						app.wedError = null;
						renderWorkspace();
					});
				}

				var recBlock = null;
				if (activeWedAlert.recoveryPath) {
					var copyRecBtn = E('button', {
						'type': 'button',
						'class': 'mtkw-btn mtkw-btn-soft mtkw-btn-xs'
					}, [ aui.icon('copy', 12), _('Copy path') ]);
					copyRecBtn.addEventListener('click', function() {
						copyAction(activeWedAlert.recoveryPath, _('Recovery path'), copyRecBtn);
					});
					recBlock = E('div', { 'class': 'mtkw-wed-rec-row' }, [
						E('code', { 'class': 'mtkw-cmd-box is-err' }, activeWedAlert.recoveryPath),
						copyRecBtn
					]);
				} else if (activeWedAlert.raw && activeWedAlert.raw !== activeWedAlert.message) {
					recBlock = E('div', { 'class': 'mtkw-inline-alert-code' }, activeWedAlert.raw);
				}

				wedAlertKids = [
					E('div', { 'class': 'mtkw-inline-alert-head' }, [
						E('span', { 'class': 'mtkw-inline-alert-title' }, [ aui.icon('alert', 15), activeWedAlert.title ]),
						dismissBtn
					]),
					activeWedAlert.dismissible ? E('div', { 'class': 'mtkw-wed-alert-msg' }, activeWedAlert.message) : null,
					recBlock,
					activeWedAlert.dismissible
						? (activeWedAlert.hint ? E('div', { 'class': 'mtkw-wed-alert-hint' }, activeWedAlert.hint) : null)
						: E('div', { 'class': 'mtkw-wed-alert-hint' }, activeWedAlert.message)
				];
			}

			var wedAlert = E('div', {
				'class': 'mtkw-inline-alert',
				'id': 'mtkw-wed-error',
				'role': 'alert',
				'hidden': activeWedAlert ? null : ''
			}, wedAlertKids);
			wedAlert.hidden = !activeWedAlert;

			var wedTile = E('div', { 'class': 'mtkw-ctrl-tile' }, [
				E('div', { 'class': 'mtkw-ctrl-row' }, [
					E('div', { 'class': 'mtkw-ctrl-left' }, [
						E('div', { 'class': 'mtkw-ctrl-icon', 'data-tone': 'wed' }, [ aui.icon('wed', 18) ]),
						E('div', {}, [
							E('div', { 'class': 'mtkw-ctrl-title' }, [
								E('span', {}, _('Wi-Fi Acceleration (WED)')),
								wp.module ? aui.badge(wp.module, '') : null,
								aui.pill(wedSt.text, wedSt.kind === 'ok' ? 'wed' : wedSt.kind),
								aui.pill(_('takes effect after a reboot'), 'warn')
							]),
							E('div', { 'class': 'mtkw-ctrl-desc' }, _('Offload wireless packets through WED and WO firmware to reduce CPU load.'))
						])
					]),
					E('div', { 'class': 'mtkw-inline mtkw-inline--gap7' }, [
						wedSaving ? E('span', { 'class': 'mtkw-mono mtkw-busy-lbl mtkw-t-warn' }, _('Saving…')) : null,
						wedSwitch
					])
				]),
				E('div', { 'class': 'mtkw-between mtkw-between--tight' }, [
					E('div', { 'class': 'mtkw-chip-row' }, weds.map(function(w) {
						var tone = !w.attached ? '' : w.rx === true ? 'wed' : 'warn';
						var mode = !w.attached ? _('Not attached') : w.rx === true ? _('TX + RX') : w.rx === false ? _('TX only') : _('TX, RX unknown');
						return aui.badge('WED' + w.id + (w.version != null ? ' v' + w.version : '') + ' · ' + mode, tone, {
							onClick: function() { handleSelectNode('wed', w.id); }
						});
					})),
					weds.length ? E('span', { 'class': 'mtkw-mono mtkw-ctrl-meta' },
						'WO: ' + woFirmware(wedFwSource(weds[0], st))) : null
				]),
				wedAlert
			]);

			out.push(E('div', { 'class': 'mtkw-ctrl-grid' }, [ hwTile, wedTile ]));
			return out;
		}

		/* ── Card 3: Spatial Interactive 5-Col Hardware Datapath Topology ── */

		function buildSpatialTopologyCard() {
			var st = app.lastStatus || {};
			var foTopo = app.statusKnown ? flowState(st) : { hwActive: null, cfgHw: null, liveHw: null, mismatch: false, unknown: true, kind: '', text: _('Unknown') };
			var hwOn = foTopo.hwActive === true;
			var ppeNum = effectivePpeNum();
			var ppes = Array.isArray(st.ppe) ? st.ppe : [];
			var weds = Array.isArray(st.wed) ? st.wed : [];
			var ports = naturalSortPorts(app.lastPorts && app.lastPorts.ports);
			var ms = app.lastMac || {};
			var macs = ms.available ? (ms.macs || []) : [];
			var wf = app.lastWifi || {};
			var bands = (wf.available && Array.isArray(wf.bands)) ? wf.bands : [];

			var topoBadgeTxt = foTopo.mismatch ? foTopo.text
				: foTopo.hwActive === true ? _('Hardware offload active')
					: foTopo.hwActive === false ? _('Software forwarding · PPE bypassed')
						: foTopo.cfgHw !== null ? foTopo.text
							: _('Offload status unknown');
			var topoBadgeTone = foTopo.mismatch ? 'warn'
				: foTopo.hwActive === true ? 'ppe'
					: foTopo.hwActive === false ? 'warn'
						: '';
			var badges = [ aui.pill(topoBadgeTxt, topoBadgeTone) ];
			if (app.selectedTopo) {
				badges.push(aui.pill(_('Clear highlight'), 'primary', { icon: 'close', iconSize: 11, onClick: clearTopoSelection }));
			}

			var legend = E('div', { 'class': 'mtkw-fp-legend' }, [
				E('span', { 'class': 'mtkw-fp-leg-item' }, [ E('span', { 'class': 'mtkw-dot', 'data-tone': 'ppe' }), 'PPE' ]),
				E('span', { 'class': 'mtkw-fp-leg-item' }, [ E('span', { 'class': 'mtkw-dot', 'data-tone': 'wed' }), 'WED' ]),
				E('span', { 'class': 'mtkw-fp-leg-item' }, [ E('span', { 'class': 'mtkw-dot', 'data-tone': 'err' }), _('Error') ]),
				E('span', { 'class': 'mtkw-fp-leg-item' }, [ E('span', { 'class': 'mtkw-dot' }), _('Bypass / Down') ])
			]);

			if (app.statusKnown && Array.isArray(st.ppe) && !ppes.length && !weds.length) {
				return makeSpatialCard({
					id: 'mtkw-sec-datapath',
					foldKey: 'datapath',
					title: _('Hardware Datapath Topology & Controls'),
					badges: badges,
					body: [
						E('div', { 'class': 'mtkw-empty-card' }, [
							E('strong', {}, _('No PPE or WED debugfs entries were found. Is debugfs mounted?'))
						])
					].concat(buildProgressiveControlsFooter(false))
				});
			}

			var gdmOrder = [];
			ports.forEach(function(p) { if (hasGdm(p) && gdmOrder.indexOf(Number(p.gdm)) < 0) gdmOrder.push(Number(p.gdm)); });
			macs.forEach(function(m) { if (gdmOrder.indexOf(Number(m.gdm)) < 0) gdmOrder.push(Number(m.gdm)); });

			var macByGdm = {};
			macs.forEach(function(m) { macByGdm[m.gdm] = m; });

			var ppeOrder = [];
			gdmOrder.forEach(function(g) {
				var pid = gdmPpeId(g, ppeNum);
				var found = ppes.filter(function(e) { return Number(e.id) === pid; })[0];
				if (found && ppeOrder.indexOf(found) < 0) ppeOrder.push(found);
			});
			ppes.forEach(function(e) { if (ppeOrder.indexOf(e) < 0) ppeOrder.push(e); });

			var topoPorts = ports.map(function(p) {
				var spd = portSpeedBadge(p);
				var errCnt = portFaultCount(p);
				var isUp = p.carrier === 1;
				var tag = speedTag(p.max_mbps || p.speed_mbps);
				var rate = app.portRates[p.netdev] || { rx_mbps: 0, tx_mbps: 0 };
				var sumM = (rate.rx_mbps || 0) + (rate.tx_mbps || 0);
				var titleTxt = (tag ? tag + ' ' : '') + (p.role === 'wan' ? 'WAN' : 'LAN');
				var linkTag = speedTag(p.speed_mbps);
				var kindLbl = p.kind === 'gsw' ? _('Switch') : _('Direct');
				var subL = isUp ? (linkTag ? (linkTag + ' · ' + kindLbl) : kindLbl) : _('Link down');
				var subR = errCnt > 0 ? ('!' + fmtCount(errCnt))
					: isUp ? (sumM >= 1000 ? (sumM / 1000).toFixed(2) + 'G' : Math.round(sumM) + 'M') : '—';
				return Object.assign({}, p, {
					faults: errCnt,
					media: portMedia(p),
					title: titleTxt,
					subLeft: subL,
					subRight: subR,
					mobileTitle: portName(p),
					mobileSub: isUp ? (spd.label + ' → ' + gdmLabel(p.gdm)) : _('Link down'),
					ariaLabel: portName(p) + ' ' + subL
				});
			});

			var topoGdms = gdmOrder.map(function(g) {
				var mac = macByGdm[g];
				var macOk = ms.available && isMacStatOk(mac);
				var errCnt = macOk ? gdmErrorSum(mac) : 0;
				var ppeLbl = gdmPpe(g, ppeNum);
				var pid = gdmPpeId(g, ppeNum);
				var netdevLbl = mac ? mac.netdev : ('eth' + g);
				var statTxt = !ms.available
					? (ms.reason === 'ethtool_missing' ? _('No ethtool') : _('MIB N/A'))
					: !macOk ? _('MIB N/A')
						: errCnt > 0 ? _('%d err').format(errCnt) : _('MIB OK');
				var statTone = !macOk ? 'warn' : errCnt > 0 ? 'err' : 'wed';
				var pktTxt = macOk ? ('RX ' + aui.fmtK(mac.rx_packets) + ' · TX ' + aui.fmtK(mac.tx_packets)) : _('Port counters only');
				return {
					gdm: g,
					ppeId: pid !== null ? pid : 0,
					label: gdmLabel(g),
					netdev: netdevLbl,
					ppeLabel: ppeLbl,
					errCount: errCnt,
					statText: statTxt,
					statTone: statTone,
					pktText: pktTxt,
					mobileTitle: gdmLabel(g) + ' (' + netdevLbl + ')',
					mobileSub: '→ ' + ppeLbl,
					ariaLabel: gdmLabel(g) + ' ' + netdevLbl
				};
			});

			var ppeIsStale = !!st.ppeFailed;
			var topoPpes = ppeOrder.map(function(e) {
				var eBound = Number(e.bound) || 0;
				var eTotal = Number(e.total) || 0;
				var rate = eTotal > 0 ? (eBound / eTotal) * 100 : 0;
				var bndBase = 'BND ' + eBound + '/' + eTotal;
				return Object.assign({}, e, {
					stale: ppeIsStale,
					staleLabel: _('Stale'),
					bound: eBound,
					total: eTotal,
					title: 'PPE' + e.id,
					pctText: rate.toFixed(1) + '%',
					bndText: ppeIsStale ? (bndBase + ' · ' + _('Stale')) : bndBase,
					protoText: 'v4:' + (Number(e.ipv4) || 0) + ' v6:' + (Number(e.ipv6) || 0),
					mobileTitle: 'PPE' + e.id + ' · ' + rate.toFixed(0) + '%',
					mobileSub: ppeIsStale ? (bndBase + ' · ' + _('Stale')) : bndBase,
					ariaLabel: 'PPE' + e.id + ' ' + _('Bind rate') + ' ' + rate.toFixed(0) + '%' + (ppeIsStale ? ' (' + _('Stale') + ')' : '')
				});
			});

			var topoWeds = weds.map(function(w) {
				var modeTxt = !w.attached ? _('Not attached') : w.rx === true ? _('TX + RX') : w.rx === false ? _('TX only') : _('TX, RX unknown');
				return Object.assign({}, w, {
					title: 'WED' + w.id,
					verText: w.version != null ? 'v' + w.version : '',
					modeText: modeTxt,
					buildText: woShortBuild(wedFwSource(w, st)),
					mobileTitle: 'WED' + w.id + (w.version != null ? ' v' + w.version : ''),
					mobileSub: modeTxt,
					ariaLabel: 'WED' + w.id + ' ' + modeTxt
				});
			});

			var wedMapTopo = resolveWedBandMap(weds, bands);
			var topoBands = bands.map(function(b) {
				var info = aui.BANDS[b.band] || { full: _('Band') + ' ' + b.band };
				var q = wifiBandQuality(b);
				var avgSig = bandAvgSig(b);
				var effTxt = hasValidEff(b) ? (b.airtime_efficiency + '%') : '—';
				var mappedWed = wedMapTopo.bandToWed[b.band];
				return Object.assign({}, b, {
					wedId: (mappedWed === undefined || mappedWed === null) ? null : mappedWed,
					label: info.full,
					linksText: _('%d links').format(b.stations || 0),
					airtimeText: _('Airtime') + ' ' + effTxt,
					qualityText: wf.complete === false ? ('⚠ ' + q.label) : q.label,
					qualityTone: q.tone,
					txText: 'TX ' + aui.fmtMbps(b.tx_mbps) + ' Mbps',
					sigText: avgSig !== null ? (avgSig + ' dBm') : '—',
					mobileSub: _('%d links').format(b.stations || 0) + ' · ' + effTxt,
					ariaLabel: info.full + ' ' + (b.stations || 0) + ' STA'
				});
			});

			var topoNoWifiHw = app.lastWifi !== null && wf.has_wifi === false;
			var topoIwMissing = isIwMissing(wf);
			var topoNoAp = isNoAp(wf);
			var topoEmptyWifiTitle = topoNoWifiHw ? _('No Wi-Fi hardware')
				: topoNoAp ? _('No active AP')
					: topoIwMissing ? _('Wi-Fi stats unavailable')
						: wf.available === false ? _('Wi-Fi stats unavailable')
							: _('No active AP');
			var topoEmptyWifiSub = topoNoWifiHw ? _('Wired offload only')
				: topoIwMissing ? _('Install iw')
					: topoNoAp ? _('Wired offload only')
						: wf.error ? _(wf.error) : _('Wired offload only');

			var topoStage = aui.topologySvg({
				ports: topoPorts,
				gdmStats: topoGdms,
				ppeList: topoPpes,
				wedList: topoWeds,
				wifiBands: topoBands,
				hwOffload: hwOn,
				selectedKey: app.selectedTopo,
				labels: {
					ariaLabel: _('Hardware Datapath Topology'),
					colPorts: _('PORTS'),
					colGdm: 'GDM · GMAC',
					colPpe: _('PPE Engines'),
					colWed: _('WED WIRELESS'),
					colWifi: _('WI-FI BANDS'),
					swForwardBadge: foTopo.hwActive === false ? _('SW Forward') : '',
					busLabel: 'MTK FE ↔ WED',
					mBusLabel: '↕ MTK FE ↔ WED',
					mColPorts: '01 ' + _('PORTS'),
					mColGdm: '02 GDM · GMAC',
					mColPpe: '03 ' + _('PPE Engines'),
					mColWedWifi: '04 WED & 05 Wi-Fi',
					emptyWifiTitle: topoEmptyWifiTitle,
					emptyWifiSub: topoEmptyWifiSub
				},
				onSelectNode: function(kind, id) { handleSelectNode(kind, id); }
			});

			return makeSpatialCard({
				id: 'mtkw-sec-datapath',
				foldKey: 'datapath',
				title: _('Hardware Datapath Topology & Controls'),
				badges: badges,
				actions: [ legend ],
				body: [ topoStage ].concat(buildProgressiveControlsFooter(true))
			});
		}

		/* ── Per-Core CPU Utilization Panel (/proc/stat) ──────────────────── */

		function buildPerCorePanel(hwActive) {
			var sum = summarizeCoreSamples(app.coreSamples);
			if (!sum) return null;

			var badges = [
				aui.badge(sum.count + ' ' + _('cores') + ' · /proc/stat', '')
			];

			if (sum.pending) {
				badges.push(aui.pill(_('Sampling…'), ''));
			} else {
				var avgTone = sum.avgUsage >= 80 ? 'err' : sum.avgUsage >= 60 ? 'warn' : 'ppe';
				var highSirq = sum.avgSirq >= 10 || sum.maxSirq >= 20;
				var sirqTone = sum.avgSirq >= 25 || sum.maxSirq >= 40 ? 'err' : highSirq ? 'warn' : 'wed';
				var offloadTone, offloadText, offloadIcon;
				if (hwActive === true && !highSirq) {
					offloadTone = 'wed';
					offloadText = _('HW offload active · Low SoftIRQ');
					offloadIcon = 'check';
				} else if (hwActive === true && highSirq) {
					offloadTone = 'warn';
					offloadText = _('HW offload active · Elevated SoftIRQ');
					offloadIcon = 'alert';
				} else if (hwActive === false && !highSirq) {
					offloadTone = 'warn';
					offloadText = _('Software forwarding · Low SoftIRQ');
					offloadIcon = 'check';
				} else if (hwActive === false) {
					offloadTone = 'err';
					offloadText = _('Software forwarding · Elevated SoftIRQ');
					offloadIcon = 'alert';
				} else if (!highSirq) {
					offloadTone = '';
					offloadText = _('Low SoftIRQ');
					offloadIcon = 'check';
				} else {
					offloadTone = 'warn';
					offloadText = _('Elevated SoftIRQ');
					offloadIcon = 'alert';
				}

				badges.push(aui.badge(_('Avg %s').format(sum.avgUsage.toFixed(1) + '%'), avgTone, { id: 'mtkw-cores-avg' }));
				badges.push(aui.badge('SoftIRQ ' + sum.avgSirq.toFixed(1) + '%', sirqTone, { id: 'mtkw-cores-sirq' }));
				badges.push(aui.pill(offloadText, offloadTone, { id: 'mtkw-cores-offload', icon: offloadIcon, iconSize: 12 }));
			}

			var grid = aui.coreGrid({
				cores: app.coreSamples,
				labels: {
					corePrefix: 'CPU',
					userLabel: _('User/Sys'),
					sirqLabel: 'SoftIRQ',
					barAria: function(c) {
						if (c.pending) return _('CPU%d sampling').format(c.id);
						return _('CPU%d total %s, User/Sys %s, SoftIRQ %s').format(
							c.id, c.usage.toFixed(1) + '%', c.userSys.toFixed(1) + '%', c.sirq.toFixed(1) + '%');
					}
				}
			});

			return E('div', { 'class': 'mtkw-cores-wrap', 'id': 'mtkw-cpu-cores', 'aria-label': _('Per-Core CPU Utilization') }, [
				E('div', { 'class': 'mtkw-cores-head' }, [
					E('div', { 'class': 'mtkw-cores-title-group' }, [
						E('span', { 'class': 'mtkw-cores-title' }, _('Per-Core CPU Utilization'))
					].concat(badges)),
					E('div', { 'class': 'mtkw-cores-legend' }, [
						E('span', { 'class': 'mtkw-cores-leg-item' }, [ E('span', { 'class': 'mtkw-cores-swatch is-user' }), _('User/Sys') ]),
						E('span', { 'class': 'mtkw-cores-leg-item' }, [ E('span', { 'class': 'mtkw-cores-swatch is-sirq' }), 'SoftIRQ' ])
					])
				]),
				grid
			]);
		}

		/* ── CPU Studio Card: Dual-Layer Chart + Controls + Per-Core Panel ─ */

		function buildCpuStudioCard() {
			var st = app.lastStatus || {};
			var cpu = st.cpu || {};
			var tempC = fmtTempC(cpu.temp_milli);
			var tg = tempGrade(tempC);
			var foCpu = app.statusKnown ? flowState(st) : { hwActive: null };
			var coresPanel = buildPerCorePanel(foCpu.hwActive);

			var tempPill = aui.badge(tempC !== null ? (tempC.toFixed(1) + ' °C · ' + tg.text) : 'N/A', tg.tone);

			/* Boards without OPP tables: keep per-core /proc/stat panel visible! */
			if (cpu.cpufreq === false) {
				return makeSpatialCard({
					id: 'mtkw-sec-cpu',
					foldKey: 'cpu',
					title: _('CPU Frequency & Utilization'),
					badges: [ tempPill ],
					body: [
						E('div', { 'class': 'mtkw-empty-card', 'id': 'mtkw-no-cpufreq' }, [
							E('strong', { 'class': 'mtkw-t-text' }, _('CPU frequency scaling is not available on this board')),
							E('div', {}, [ socName(st.soc) || st.compatible || '—', cpu.arch || '', cpu.count ? (cpu.count + ' ' + _('cores')) : '' ].filter(Boolean).join(' · '))
						]),
						coresPanel
					]
				});
			}

			var hwMax = (Number(cpu.hw_max_freq) > 0 ? Number(cpu.hw_max_freq) : 0) ||
				(Number(cpu.max_freq) > 0 ? Number(cpu.max_freq) : 0) || 1800000;
			var curMax = (Number(cpu.max_freq) > 0 ? Number(cpu.max_freq) : 0) || hwMax;
			var curFreqVal = Number(cpu.cur_freq) || 0;
			var curFreqPill = curFreqVal > 0
				? aui.badge((curMax > 0 && curMax < hwMax)
					? (aui.fmtFreq(curFreqVal) + ' / ' + aui.fmtFreq(curMax))
					: aui.fmtFreq(curFreqVal), 'primary')
				: null;

			var chartEl = aui.cpuChartSvg({
				history: app.cpuHistory,
				hwMaxFreq: hwMax,
				maxFreq: curMax,
				minFreq: cpu.min_freq || 400000,
				labels: {
					ariaLabel: _('Frequency History'),
					nowLabel: _('Now'),
					axisHint: _('Live (Left: MHz · Right: °C)'),
					unitTemp: '°C',
					tickSec: 5
				}
			});

			/* Governor & Max Freq Form with exact V1 validation & unknown-value guards */
			var govs = String(cpu.governors || '').split(/\s+/).filter(Boolean);
			var freqs = String(cpu.frequencies || '').split(/\s+/).filter(Boolean);
			var curGov = app.cpuDirty && app.cpuDraftGov !== null ? app.cpuDraftGov : cpu.governor;
			var curFreq = app.cpuDirty && app.cpuDraftFreq !== null ? app.cpuDraftFreq : String(cpu.max_freq || '');

			function buildSelect(id, cls, values, current, labelFn, onPick) {
				var opts = values.map(function(v) {
					var o = E('option', { 'value': String(v) }, labelFn(v));
					if (String(v) === String(current)) o.selected = true;
					return o;
				});
				if (!values.length) {
					opts = [ E('option', { 'value': '' }, 'N/A') ];
				} else if (values.map(String).indexOf(String(current)) < 0) {
					var unk = E('option', { 'value': '' }, '—');
					unk.selected = true;
					opts.unshift(unk);
				}
				var sel = E('select', { 'id': id, 'class': cls }, opts);
				sel.disabled = !values.length || readonly || app.cpuSaving;
				sel.addEventListener('change', function(ev) {
					app.cpuDirty = true;
					onPick(ev.target.value);
					updateSaveDisabled();
				});
				return sel;
			}

			var govSel = buildSelect('mtkw-cpu-gov', 'mtkw-select', govs, curGov, governorLabel, function(v) { app.cpuDraftGov = v; });
			var freqSel = buildSelect('mtkw-cpu-maxf', 'mtkw-select mtkw-mono', freqs, curFreq, function(f) { return Math.round(Number(f) / 1000) + ' MHz'; }, function(v) { app.cpuDraftFreq = v; });

			var saveBtn = E('button', {
				'type': 'submit',
				'id': 'mtkw-btn-cpu-save',
				'class': 'mtkw-btn mtkw-btn-primary'
			}, app.cpuSaving ? _('Saving…') : _('Save'));

			function formValid() {
				return !!cpu.cpufreq && !readonly && govs.indexOf(govSel.value) >= 0 &&
					freqs.indexOf(freqSel.value) >= 0 && /^[0-9]+$/.test(freqSel.value) &&
					Number.isSafeInteger(Number(freqSel.value)) && Number(freqSel.value) > 0;
			}

			function updateSaveDisabled() {
				saveBtn.disabled = app.cpuSaving || !formValid();
			}
			updateSaveDisabled();

			var form = E('form', { 'class': 'mtkw-cpu-panel' }, [
				E('div', { 'class': 'mtkw-cpu-mini-stats' }, [
					E('div', { 'class': 'mtkw-mib-tile' }, [
						E('div', { 'class': 'mtkw-mib-lbl' }, _('Architecture') + ' / ' + _('Core Count')),
						E('div', { 'class': 'mtkw-mib-val' }, (cpu.arch || '—') + (cpu.count ? ' · ' + cpu.count + 'C' : ''))
					]),
					E('div', { 'class': 'mtkw-mib-tile' + (tg.tone === 'err' ? ' is-err' : '') }, [
						E('div', { 'class': 'mtkw-mib-lbl' }, _('Clock / Temperature')),
						E('div', { 'class': 'mtkw-mib-val' }, (cpu.cur_freq ? Math.round(cpu.cur_freq / 1000) + 'M' : '—') + ' · ' + (tempC !== null ? tempC.toFixed(1) + '°C' : 'N/A'))
					])
				]),
				E('div', { 'class': 'mtkw-field' }, [
					E('label', { 'for': 'mtkw-cpu-gov' }, _('Governor')),
					govSel
				]),
				E('div', { 'class': 'mtkw-field' }, [
					E('label', { 'for': 'mtkw-cpu-maxf' }, _('Max Freq')),
					freqSel
				]),
				E('div', { 'class': 'mtkw-between' }, [
					E('span', {
						'class': 'mtkw-cpu-save-status' + (app.cpuSavedMsg ? (app.cpuSavedErr ? ' is-err' : ' is-ok') : '')
					}, app.cpuSavedMsg || _('Changes apply immediately and persist after reboot')),
					saveBtn
				])
			]);
			form.addEventListener('submit', function(ev) {
				ev.preventDefault();
				handleApplyCpu(govSel.value, freqSel.value);
			});

			var headLegend = E('div', { 'class': 'mtkw-fp-legend mtkw-mono' }, [
				E('span', { 'class': 'mtkw-t-primary mtkw-fw-700' }, '● MHz'),
				E('span', { 'class': 'mtkw-t-b24 mtkw-fw-700' }, '● °C'),
				aui.badge('--- ' + _('Max') + ' ' + Math.round(curMax / 1000) + ' MHz', 'warn')
			]);

			return makeSpatialCard({
				id: 'mtkw-sec-cpu',
				foldKey: 'cpu',
				title: _('CPU Frequency & Utilization'),
				badges: [ tempPill, curFreqPill ],
				actions: [ headLegend ],
				body: [
					E('div', { 'class': 'mtkw-cpu-studio' }, [
						E('div', { 'class': 'mtkw-chart-box' }, [
							E('div', { 'class': 'mtkw-chart-legend' }, [
								E('span', {}, _('Frequency History') + ' · ' + _('Hover to inspect')),
								E('span', { 'class': 'mtkw-mono mtkw-fw-650' }, aui.fmtFreq(cpu.cur_freq))
							]),
							chartEl
						]),
						form
					]),
					coresPanel
				]
			});
		}

		/* ── Ethernet Ports & 12-Counter GDM MAC MIB Studio Card ─────────── */

		function buildPortsStudioCard() {
			var ports = naturalSortPorts(app.lastPorts && app.lastPorts.ports);
			var ppeNum = effectivePpeNum();
			var upPorts = ports.filter(function(p) { return p.carrier === 1; }).length;
			var ms = app.lastMac || {};
			var macs = ms.available ? (ms.macs || []) : [];
			var portErr = ports.reduce(function(a, p) { return a + portFaultCount(p); }, 0);
			var gdmErr = macs.reduce(function(a, m) { return a + gdmErrorSum(m); }, 0);

			var pTabBtn = E('button', {
				'type': 'button', 'role': 'tab', 'class': 'mtkw-sub-tab',
				'aria-selected': String(app.portsSubTab === 'ports')
			}, [ _('Port Statistics'), portErr > 0 ? E('span', { 'class': 'mtkw-dot', 'data-tone': 'err' }) : null ]);
			pTabBtn.addEventListener('click', function() { app.portsSubTab = 'ports'; renderWorkspace(); });

			var gTabBtn = E('button', {
				'type': 'button', 'role': 'tab', 'class': 'mtkw-sub-tab',
				'aria-selected': String(app.portsSubTab === 'gdm')
			}, [ _('MAC Counters (GDM)'), gdmErr > 0 ? E('span', { 'class': 'mtkw-dot', 'data-tone': 'err' }) : null ]);
			gTabBtn.addEventListener('click', function() { app.portsSubTab = 'gdm'; renderWorkspace(); });

			var switcher = E('div', { 'class': 'mtkw-sub-tabs', 'role': 'tablist', 'aria-label': _('Port and GDM views') }, [ pTabBtn, gTabBtn ]);
			var bodyNodes = [];

			if (app.portsSubTab === 'ports') {
				if (!ports.length) {
					bodyNodes.push(E('div', { 'class': 'mtkw-empty-card' }, app.statusKnown ? _('Port data unavailable') : _('Loading…')));
				} else {
					var maxB = 1;
					ports.forEach(function(p) { maxB = Math.max(maxB, Number(p.rx_bytes) || 0, Number(p.tx_bytes) || 0); });

					var tRows = ports.map(function(p) {
						var isUp = p.carrier === 1;
						var spd = portSpeedBadge(p);
						var errs = (Number(p.rx_errors) || 0) + (Number(p.tx_errors) || 0);
						var drops = (Number(p.rx_dropped) || 0) + (Number(p.tx_dropped) || 0);
						var hasFault = errs > 0 || drops > 0;
						var rxB = Number(p.rx_bytes) || 0;
						var txB = Number(p.tx_bytes) || 0;
						var rxW = rxB > 0 ? Math.max(3, Math.round((rxB / maxB) * 100)) : 0;
						var txW = txB > 0 ? Math.max(3, Math.round((txB / maxB) * 100)) : 0;
						var tag = speedTag(p.max_mbps || p.speed_mbps);

						var linkTag = speedTag(p.speed_mbps);
						var tr = E('tr', {
							'class': (app.selectedPortInline === p.netdev ? 'is-selected ' : '') + (hasFault ? 'is-err-row' : ''),
							'tabindex': '0'
						}, [
							E('td', {}, [
								E('div', { 'class': 'mtkw-row mtkw-row--nowrap' }, [
									E('span', { 'class': 'mtkw-ico-wrap mtkw-tone', 'data-tone': (isUp || hasFault) ? (spd.tone || 'muted') : 'muted' }, [
										aui.icon(portIconName(p), 16)
									]),
									E('span', { 'class': 'mtkw-role-tag' + (p.role === 'wan' ? ' is-wan' : '') },
										(tag ? tag + ' ' : '') + (p.role === 'wan' ? 'WAN' : 'LAN')),
									E('strong', { 'class': 'mtkw-mono' }, p.netdev)
								])
							]),
							E('td', {}, [
								aui.badge(!isUp
									? _('Link down')
									: p.speed_mbps > 0
										? ((linkTag || (p.speed_mbps + 'M')) + (p.duplex ? ' · ' + duplexText(p.duplex) : ''))
										: (_('Link up') + (p.duplex ? ' · ' + duplexText(p.duplex) : '')),
									isUp ? spd.tone : '',
									{ title: isUp ? (p.speed_mbps > 0 ? (p.speed_mbps + ' Mbps') : _('Unknown speed')) : '' })
							]),
							E('td', { 'class': 'mtkw-mono mtkw-path-cell' }, portPathText(p, ppeNum)),
							E('td', {}, [
								E('div', { 'class': 'mtkw-bidir-box' }, [
									E('div', { 'class': 'mtkw-bidir-row' }, [
										E('span', { 'class': 'mtkw-bidir-rx' }, '↓ ' + fmtBytes(p.rx_bytes)),
										E('div', { 'class': 'mtkw-cap-track' }, [ aui.barFill('mtkw-cap-rx', rxW) ]),
										E('span', { 'class': 'mtkw-bidir-pkt' }, aui.fmtK(p.rx_packets))
									]),
									E('div', { 'class': 'mtkw-bidir-row' }, [
										E('span', { 'class': 'mtkw-bidir-tx' }, '↑ ' + fmtBytes(p.tx_bytes)),
										E('div', { 'class': 'mtkw-cap-track' }, [ aui.barFill('mtkw-cap-tx', txW) ]),
										E('span', { 'class': 'mtkw-bidir-pkt' }, aui.fmtK(p.tx_packets))
									])
								])
							]),
							E('td', { 'class': 'is-right' }, hasFault
								? aui.badge(fmtCount(errs) + ' / ' + fmtCount(drops), 'err', { icon: 'alert', iconSize: 12 })
								: E('span', { 'class': 'mtkw-mono mtkw-t-muted' }, '0 / 0'))
						]);
						tr.addEventListener('click', function() { openInspector('port', p.netdev); });
						tr.addEventListener('keydown', function(ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openInspector('port', p.netdev); } });
						return tr;
					});

					bodyNodes.push(E('div', { 'class': 'mtkw-table-wrap mtkw-ports-table-wrap' }, [
						E('table', { 'class': 'mtkw-table' }, [
							E('thead', {}, [
								E('tr', {}, [
									E('th', { 'scope': 'col' }, _('Port')),
									E('th', { 'scope': 'col' }, _('Speed / Duplex')),
									E('th', { 'scope': 'col' }, _('Path')),
									E('th', { 'scope': 'col' }, _('RX / TX bytes') + ' · ' + _('Packets')),
									E('th', { 'scope': 'col', 'class': 'is-right' }, _('Errors / Dropped'))
								])
							]),
							E('tbody', {}, tRows)
						])
					]));

					bodyNodes.push(E('div', { 'class': 'mtkw-mobile-ports' }, ports.map(function(p) {
						var isUp = p.carrier === 1, spd = portSpeedBadge(p);
						var errs = (p.rx_errors || 0) + (p.tx_errors || 0), drops = (p.rx_dropped || 0) + (p.tx_dropped || 0);
						var fault = errs > 0 || drops > 0;
						var spdLabel = !isUp
							? _('Link down')
							: p.speed_mbps > 0
								? (speedTag(p.speed_mbps) || spd.label)
								: _('Link up');
						var card = E('div', {
							'class': 'mtkw-mcard' + (fault ? ' is-err-row' : ''),
							'tabindex': '0',
							'role': 'button',
							'aria-label': portName(p) + ' · ' + spdLabel
						}, [
							E('div', { 'class': 'mtkw-mcard-top' }, [
								E('div', { 'class': 'mtkw-row mtkw-row--gap6' }, [
									E('span', { 'class': 'mtkw-ico-wrap mtkw-tone', 'data-tone': spd.tone || 'muted' }, [ aui.icon(portIconName(p), 15) ]),
									E('strong', {}, portName(p))
								]),
								E('span', { 'class': 'mtkw-speed-pill', 'data-spd': spd.code }, spdLabel)
							]),
							E('div', { 'class': 'mtkw-mcard-grid' }, [
								E('div', {}, [ E('div', { 'class': 'mtkw-t-muted' }, _('Path')), E('div', { 'class': 'mtkw-mono' }, portPathText(p, ppeNum)) ]),
								E('div', {}, [ E('div', { 'class': 'mtkw-t-muted' }, _('Errors / Dropped')), E('div', { 'class': 'mtkw-mono ' + (fault ? 'mtkw-t-err mtkw-fw-700' : 'mtkw-t-muted') }, fmtCount(errs) + ' / ' + fmtCount(drops)) ]),
								E('div', {}, [ E('div', { 'class': 'mtkw-t-muted' }, 'RX'), E('div', { 'class': 'mtkw-mono mtkw-t-primary' }, fmtBytes(p.rx_bytes)) ]),
								E('div', {}, [ E('div', { 'class': 'mtkw-t-muted' }, 'TX'), E('div', { 'class': 'mtkw-mono mtkw-t-wed' }, fmtBytes(p.tx_bytes)) ])
							])
						]);
						card.addEventListener('click', function() { openInspector('port', p.netdev); });
						card.addEventListener('keydown', function(ev) {
							if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openInspector('port', p.netdev); }
						});
						return card;
					})));

					if (!ms.available && ms.reason === 'ethtool_missing') {
						bodyNodes.push(E('div', { 'class': 'mtkw-fp-hint' }, _('Install the ethtool package to show the hardware MAC counters.')));
					}
				}
			} else {
				if (!ms.available) {
					bodyNodes.push(buildMibTilesGrid(0, 'is-4col', 'mtkw-ethtool-missing'));
				} else {
					bodyNodes.push(E('p', { 'class': 'mtkw-card-sub mtkw-card-sub--mb' }, _('Hardware MIB counters of each GDM, read with ethtool -S.')));
					bodyNodes.push(E('div', { 'class': 'mtkw-gdm-cards' }, macs.map(function(mac) {
						var macOk = isMacStatOk(mac);
						var errSum = macOk ? gdmErrorSum(mac) : 0;
						var ppeLbl = gdmPpe(mac.gdm, ppeNum);
						var mapped = ports.filter(function(p) { return hasGdm(p) && Number(p.gdm) === Number(mac.gdm); });
						var card = E('div', { 'class': 'mtkw-gdm-card', 'tabindex': '0' }, [
							E('div', { 'class': 'mtkw-gdm-head' }, [
								E('div', { 'class': 'mtkw-row' }, [
									E('span', { 'class': 'mtkw-ico-wrap mtkw-tone', 'data-tone': !macOk ? 'warn' : errSum > 0 ? 'err' : 'ppe' }, [ aui.icon('gmac', 16) ]),
									E('strong', { 'class': 'mtkw-mono' }, gdmLabel(mac.gdm) + ' (' + mac.netdev + ')'),
									aui.badge(ppeLbl, 'ppe')
								].concat(mapped.map(function(mp) { return aui.badge(mp.netdev, ''); }))),
								!macOk
									? aui.pill(_('MIB unavailable'), 'warn')
									: aui.badge(errSum > 0 ? _('%s errors').format(fmtCount(errSum)) : _('0 errors'), errSum > 0 ? 'err' : 'wed')
							]),
							buildMibTilesGrid(mac.gdm, 'is-4col')
						]);
						card.addEventListener('click', function() { openInspector('gdm', mac.gdm); });
						card.addEventListener('keydown', function(ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openInspector('gdm', mac.gdm); } });
						return card;
					})));
				}
			}

			return makeSpatialCard({
				id: 'mtkw-sec-ports',
				foldKey: 'ports',
				title: _('Ethernet Ports & GDM MAC Counters'),
				badges: [ ports.length ? aui.badge(_('%d / %d up').format(upPorts, ports.length), '') : null ],
				actions: [ switcher ],
				body: bodyNodes
			});
		}

		/* ── Wi-Fi Band & MLO Studio Card ─────────────────────────────────── */

		function buildWifiStudioCard() {
			if (!showWifiSection()) return null;
			var wf = app.lastWifi || {};
			var bands = Array.isArray(wf.bands) ? wf.bands : [];
			var weds = Array.isArray(app.lastStatus.wed) ? app.lastStatus.wed : [];
			var wedAttached = weds.some(function(w) { return w.attached; });
			var bandSum = bands.reduce(function(acc, b) { return acc + (b.stations || 0); }, 0);
			var uniqClients = typeof wf.stations === 'number' ? wf.stations : bandSum;
			var isMlo = wf.available && bandSum > uniqClients;

			var headActions = [];
			if (wf.available) {
				headActions.push(aui.badge(_('%d clients').format(uniqClients), 'primary'));
				headActions.push(aui.pill(wedAttached ? 'WED' : 'DMA', wedAttached ? 'wed' : ''));
				if (isMlo) headActions.push(aui.pill(_('MLO · %d links').format(bandSum), 'b6'));
				if (wf.complete === false) {
					headActions.push(aui.pill(_('Partial sampling · MLO incomplete'), 'warn', {
						id: 'mtkw-btn-mlo-incomplete',
						icon: 'alert',
						iconSize: 12,
						ariaExpanded: app.mloPopoverOpen,
						onClick: function() { app.mloPopoverOpen = !app.mloPopoverOpen; renderWorkspace(); }
					}));
				}
			}

			var body = [];
			if (wf.available === false) {
				var iwMissing = isIwMissing(wf);
				var retryBtn = E('button', { 'type': 'button', 'class': 'mtkw-btn' }, _('Try again'));
				retryBtn.addEventListener('click', function() { refresh(true); });
				body.push(E('div', { 'class': 'mtkw-empty-card' }, [
					E('strong', {}, iwMissing
						? _('Install iw to view Wi-Fi statistics.')
						: wf.error
							? _('Cannot read the Wi-Fi statistics: %s').format(_(wf.error))
							: _('Wi-Fi stats unavailable')),
					iwMissing ? E('div', { 'class': 'mtkw-row mtkw-row--gap8' }, [
						E('code', { 'class': 'mtkw-cmd-box' }, 'opkg install iw'),
						E('code', { 'class': 'mtkw-cmd-box' }, 'apk add iw'),
						retryBtn
					]) : E('div', {}, [ retryBtn ])
				]));
			} else {
				if (wf.complete === false) {
					var collapsePopBtn = E('button', {
						'type': 'button', 'class': 'mtkw-btn mtkw-btn-soft mtkw-btn-xs'
					}, _('Hide'));
					collapsePopBtn.addEventListener('click', function() { app.mloPopoverOpen = false; renderWorkspace(); });

					var pop = E('div', {
						'class': 'mtkw-mlo-popover',
						'id': 'mtkw-mlo-popover',
						'role': 'note',
						'hidden': app.mloPopoverOpen ? null : ''
					}, [
						E('div', { 'class': 'mtkw-between mtkw-mb-4' }, [
							E('strong', { 'class': 'mtkw-t-warn' }, _('Partial sampling · MLO incomplete')),
							collapsePopBtn
						]),
						E('div', {}, _('Some Wi-Fi data could not be read or saved; the rates may be incomplete.')),
						E('div', { 'class': 'mtkw-mlo-popover-sub' }, _('Last complete per-band TX rates are preserved.'))
					]);
					pop.hidden = !app.mloPopoverOpen;
					body.push(pop);
				}

				if (isMlo) {
					body.push(E('div', { 'class': 'mtkw-info-banner' }, [
						aui.icon('wifi', 15),
						E('span', {}, _('MLO devices connect across multiple bands simultaneously, so summed band links (%d) exceed unique stations (%d).').format(bandSum, uniqClients))
					]));
				}

				var wedMapCards = resolveWedBandMap(weds, bands);
				body.push(E('div', { 'class': 'mtkw-wifi-grid' }, bands.map(function(band) {
					var meta = aui.BANDS[band.band] || { full: _('Band') + ' ' + band.band, tone: 'primary', varName: '--mtkw-primary' };
					var col = 'var(' + meta.varName + ')';
					var q = wifiBandQuality(band);
					var wid = wedMapCards.bandToWed[band.band];
					var wedInst = (wid !== null && wid !== undefined)
						? weds.filter(function(w) { return Number(w.id) === Number(wid); })[0]
						: null;
					var wedPrefix = wedInst ? ((wedMapCards.estimated ? '~' : '') + 'WED' + wedInst.id) : '';
					var pathLbl = wedInst && wedInst.attached
						? (wedPrefix + ' ' + (wedInst.rx === true ? _('TX + RX') : wedInst.rx === false ? _('TX only') : _('TX, RX unknown')))
						: 'DMA';
					var pathTone = wedInst && wedInst.attached ? (wedInst.rx === true ? 'wed' : 'warn') : '';
					var expanded = !!app.expandedWifiBands[band.band];
					var avgSig = bandAvgSig(band);
					var minSig = bandMinSig(band);
					var sigText = avgSig !== null
						? (minSig !== null ? (avgSig + ' / ' + minSig + ' dBm') : (avgSig + ' dBm'))
						: '—';
					var effOk = hasValidEff(band);

					var toggleBtn = E('button', {
						'type': 'button',
						'class': 'mtkw-btn mtkw-btn-soft mtkw-btn-sm',
						'aria-expanded': String(expanded)
					}, [
						expanded ? _('Hide link details') : _('Show link details'),
						E('span', { 'class': 'mtkw-ico-rot' + (expanded ? ' is-open' : '') }, [
							aui.icon('chevron-down', 13)
						])
					]);
					toggleBtn.addEventListener('click', function() {
						app.expandedWifiBands[band.band] = !expanded;
						renderWorkspace();
					});

					var inspBtn = E('button', {
						'type': 'button',
						'class': 'mtkw-btn mtkw-btn-soft mtkw-btn-sm'
					}, [ aui.icon('inspect', 13), _('Inspector') ]);
					inspBtn.addEventListener('click', function() { openInspector('wifi', band.band); });

					return E('div', { 'class': 'mtkw-wifi-card' }, [
						E('div', { 'class': 'mtkw-between' }, [
							E('div', { 'class': 'mtkw-row' }, [
								aui.badge(meta.full, meta.tone),
								aui.badge(pathLbl, pathTone)
							]),
							aui.pill(q.label + ' · ' + _('%d links').format(band.stations || 0), q.tone)
						]),
						E('div', { 'class': 'mtkw-wifi-hero' }, [
							aui.wifiRingSvg(effOk ? band.airtime_efficiency : null, band.band, {
								subLabel: _('Airtime'),
								emptyText: '—',
								color: effOk ? col : 'var(--mtkw-border-strong)',
								ariaLabel: meta.full + ' ' + _('Airtime') + ' ' + (effOk ? (band.airtime_efficiency + '%') : '—')
							}),
							E('div', { 'class': 'mtkw-col-grow' }, [
								E('div', { 'class': 'mtkw-between mtkw-between--base' }, [
									E('span', { 'class': 'mtkw-wifi-k' }, _('TX')),
									E('strong', { 'class': 'mtkw-mono mtkw-wifi-tx mtkw-tone', 'data-tone': meta.tone || 'primary' },
										aui.fmtMbps(band.tx_mbps) + ' Mbps' + (wf.complete === false ? ' ⚠' : ''))
								]),
								E('div', { 'class': 'mtkw-between mtkw-between--base' }, [
									E('span', { 'class': 'mtkw-wifi-k' }, _('PHY / Expected')),
									E('span', { 'class': 'mtkw-mono mtkw-wifi-phy' },
										aui.fmtMbps(band.avg_phy_rate) + ' / ' + aui.fmtMbps(band.avg_exp_throughput) + ' M')
								]),
								E('div', {}, [
									E('div', { 'class': 'mtkw-wifi-sig-head' }, [
										E('span', {}, _('Signal')),
										E('span', { 'class': 'mtkw-mono mtkw-wifi-sig-val' },
											[ aui.signalBarsSvg(avgSig), sigText ])
									]),
									aui.signalBar(avgSig, minSig, { tone: meta.tone || 'primary' })
								])
							])
						]),
						E('div', { 'class': 'mtkw-wifi-disclosure' }, [
							E('div', { 'class': 'mtkw-between' }, [ toggleBtn, inspBtn ]),
							expanded ? E('div', { 'class': 'mtkw-mib-grid is-2col' }, [
								E('div', { 'class': 'mtkw-mib-tile' }, [ E('div', { 'class': 'mtkw-mib-lbl' }, _('Interfaces')), E('div', { 'class': 'mtkw-mib-val' }, band.interfaces || '—') ]),
								E('div', { 'class': 'mtkw-mib-tile' }, [ E('div', { 'class': 'mtkw-mib-lbl' }, _('TX packets')), E('div', { 'class': 'mtkw-mib-val' }, fmtCount(band.tx_packets)) ]),
								E('div', { 'class': 'mtkw-mib-tile' + (q.retryPct > 50 ? ' is-err' : '') }, [ E('div', { 'class': 'mtkw-mib-lbl' }, _('Retry')), E('div', { 'class': 'mtkw-mib-val' }, q.retryPct.toFixed(1) + '% (' + aui.fmtK(Number(band.tx_retries) || 0) + ')') ]),
								E('div', { 'class': 'mtkw-mib-tile' + ((Number(band.tx_failed) || 0) > 500 ? ' is-err' : '') }, [ E('div', { 'class': 'mtkw-mib-lbl' }, _('Failed')), E('div', { 'class': 'mtkw-mib-val' }, fmtCount(band.tx_failed)) ])
							]) : null
						])
					]);
				})));
			}

			return makeSpatialCard({
				id: 'mtkw-sec-wifi',
				foldKey: 'wifi',
				title: _('Wi-Fi Band Details'),
				actions: headActions,
				body: body
			});
		}

		/* ── PPE Flow Table Workbench (Backend Paging + Client Search/Sort) */

		function currentFlowAgeText() {
			var d = app.flowData || {};
			var st = app.lastStatus || {};
			if (st.ppeFailed || d.available === false || d.error) {
				if (app.ppeLastGoodAt !== null) {
					return _('Stale · %s ago').format(fmtAgeShort(ppeStaleAgeSec()));
				}
				return _('PPE table unavailable');
			}
			if (app.flowFetchedAt === null) return _('Loading…');
			var sec = app.flowBaseAge + Math.max(0, Math.floor((Date.now() - app.flowFetchedAt) / 1000));
			return (app.flowFrozen ? _('Frozen') + ' · ' : '') + _('Snapshot %ds ago').format(sec);
		}

		function isFlowAgeWarn() {
			var d = app.flowData || {};
			var st = app.lastStatus || {};
			return !!(app.flowFrozen || st.ppeFailed || d.available === false || d.error);
		}

		function syncFlowAgeBadge(el) {
			if (!el) return;
			el.textContent = currentFlowAgeText();
			if (isFlowAgeWarn()) el.setAttribute('data-tone', 'warn');
			else el.removeAttribute('data-tone');
		}

		function flowMatchedTotal() {
			var d = app.flowData || {};
			if (d.available === false) return 0;
			if (d.page >= 0) return d.matched || 0;
			return (d.entries || []).filter(function(e) {
				return (!app.flowFilter.state || e.state === app.flowFilter.state) &&
					(!app.flowFilter.type || String(e.type).indexOf(app.flowFilter.type) === 0) &&
					(app.flowFilter.ppe === '' || String(e.ppe) === app.flowFilter.ppe);
			}).length;
		}

		function flowPagesTotal() {
			return Math.max(1, Math.ceil(flowMatchedTotal() / PAGE_SIZE));
		}

		function currentPageRows() {
			var d = app.flowData || {};
			var paged = d.page >= 0;
			var rows = paged ? (d.entries || []) : (d.entries || []).filter(function(e) {
				return (!app.flowFilter.state || e.state === app.flowFilter.state) &&
					(!app.flowFilter.type || String(e.type).indexOf(app.flowFilter.type) === 0) &&
					(app.flowFilter.ppe === '' || String(e.ppe) === app.flowFilter.ppe);
			}).slice(app.flowPage * PAGE_SIZE, (app.flowPage + 1) * PAGE_SIZE);

			var q = app.flowSearch.trim().toLowerCase();
			if (q) {
				rows = rows.filter(function(fl) {
					var hay = [
						'ppe' + fl.ppe,
						hexIndex(fl.index),
						fl.state,
						fl.type,
						formatVlanCell(fl.vlan),
						fl.orig,
						prettyFlow(fl.orig),
						fl['new'],
						fl['new'] ? prettyFlow(fl['new']) : '',
						fl.eth
					].join(' ').toLowerCase();
					return hay.indexOf(q) >= 0;
				});
			}

			if (app.flowSortBy) {
				var k = app.flowSortBy, dir = app.flowSortDir === 'asc' ? 1 : -1;
				rows = rows.slice().sort(function(a, b) {
					var va = k === 'index' ? parseInt(a.index, 16) : (Number(a[k]) || 0);
					var vb = k === 'index' ? parseInt(b.index, 16) : (Number(b[k]) || 0);
					if (va === vb) return 0;
					return va > vb ? dir : -dir;
				});
			}
			return rows;
		}

		function buildFlowsDynamicNodes() {
			var d = app.flowData || {};
			var rows = currentPageRows();
			var pages = flowPagesTotal();
			var matched = flowMatchedTotal();

			function sortCol(k, refocus) {
				if (app.flowSortBy === k) app.flowSortDir = app.flowSortDir === 'desc' ? 'asc' : 'desc';
				else { app.flowSortBy = k; app.flowSortDir = 'desc'; }
				renderFlowsDynamic();
				if (refocus) {
					var sb = page.querySelector('.mtkw-sort-btn[data-sort-col="' + k + '"]');
					if (sb && typeof sb.focus === 'function') sb.focus();
				}
			}
			function sortMark(k) {
				return app.flowSortBy !== k ? '' : (app.flowSortDir === 'asc' ? ' ▲' : ' ▼');
			}
			function sortAria(k) {
				return app.flowSortBy !== k ? 'none' : (app.flowSortDir === 'asc' ? 'ascending' : 'descending');
			}
			function makeSortTh(k, label, isRight) {
				var btn = E('button', {
					'type': 'button',
					'class': 'mtkw-sort-btn',
					'data-sort-col': k
				}, label + sortMark(k));
				btn.addEventListener('click', function(ev) { ev.stopPropagation(); sortCol(k, true); });
				var thAttrs = { 'scope': 'col', 'class': isRight ? 'mtkw-th-sort is-right' : 'mtkw-th-sort', 'aria-sort': sortAria(k) };
				var th = E('th', thAttrs, [ btn ]);
				th.addEventListener('click', function() { sortCol(k, false); });
				return th;
			}

			var nodes = [];
			if (d.available === false) {
				nodes.push(E('div', { 'class': 'mtkw-empty-card' }, [
					E('strong', {}, _('PPE table unavailable')),
					d.error ? E('div', {}, d.error) : null
				]));
			} else if (!rows.length) {
				nodes.push(E('div', { 'class': 'mtkw-empty-card' }, [
					E('strong', {}, Array.isArray(d.ppe) ? _('No matching flows') : _('Loading…'))
				]));
			} else {
				var tRows = rows.map(function(fl) {
					var stTone = fl.state === 'BND' ? 'ppe' : fl.state === 'UNB' ? 'warn' : '';
					var key = fl.ppe + ':' + fl.index;
					var isSel = app.drawerCtx && app.drawerCtx.kind === 'flow' && app.drawerCtx.id === key;
					var origTxt = prettyFlow(fl.orig);
					var newTxt = fl['new'] ? prettyFlow(fl['new']) : '—';

					var cpOrig = E('button', {
						'type': 'button', 'class': 'mtkw-copy-mini', 'aria-label': _('Copy Original Flow')
					}, [ aui.icon('copy', 13) ]);
					cpOrig.addEventListener('click', function(ev) {
						ev.stopPropagation();
						copyAction(origTxt, _('Original Flow'), cpOrig);
					});

					var cpNew = null;
					if (fl['new']) {
						cpNew = E('button', {
							'type': 'button', 'class': 'mtkw-copy-mini', 'aria-label': _('Copy New Flow')
						}, [ aui.icon('copy', 13) ]);
						cpNew.addEventListener('click', function(ev) {
							ev.stopPropagation();
							copyAction(newTxt, _('New Flow'), cpNew);
						});
					}

					var tr = E('tr', {
						'class': isSel ? 'is-selected' : '',
						'tabindex': '0',
						'data-flow-row': key
					}, [
						E('td', {}, [ aui.badge('PPE' + fl.ppe, 'ppe') ]),
						E('td', { 'class': 'mtkw-mono mtkw-t-muted' }, hexIndex(fl.index)),
						E('td', {}, [ aui.badge(fl.state, stTone) ]),
						E('td', {}, [ aui.badge(fl.type, '') ]),
						E('td', { 'class': 'mtkw-mono mtkw-t-muted' }, formatVlanCell(fl.vlan)),
						E('td', {}, [
							E('div', { 'class': 'mtkw-tuple-cell' }, [
								E('span', { 'class': 'mtkw-flow-tuple' }, origTxt),
								cpOrig
							])
						]),
						E('td', {}, [
							E('div', { 'class': 'mtkw-tuple-cell' }, [
								E('span', { 'class': 'mtkw-flow-tuple ' + (fl['new'] ? 'mtkw-t-text' : 'mtkw-t-muted') }, newTxt),
								cpNew
							])
						]),
						E('td', { 'class': 'is-right mtkw-mono' }, fmtCount(fl.packets)),
						E('td', { 'class': 'is-right mtkw-mono' }, fmtBytes(fl.bytes))
					]);
					tr.addEventListener('click', function() { openInspector('flow', key, fl); syncFlowRowSelection(); });
					tr.addEventListener('keydown', function(ev) {
						if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openInspector('flow', key, fl); syncFlowRowSelection(); }
					});
					return tr;
				});

				var thIdx = makeSortTh('index', _('Index'), false);
				var thPkt = makeSortTh('packets', _('Packets'), true);
				var thByt = makeSortTh('bytes', _('Bytes'), true);

				nodes.push(E('div', { 'class': 'mtkw-table-wrap mtkw-flows-table-wrap mtkw-flows-scroll' }, [
					E('table', { 'class': 'mtkw-table', 'id': 'mtkw-flows' }, [
						E('thead', {}, [
							E('tr', {}, [
								E('th', { 'scope': 'col' }, 'PPE'),
								thIdx,
								E('th', { 'scope': 'col' }, _('State')),
								E('th', { 'scope': 'col' }, _('Type')),
								E('th', { 'scope': 'col' }, 'VLAN'),
								E('th', { 'scope': 'col' }, _('Original Flow')),
								E('th', { 'scope': 'col' }, _('New Flow')),
								thPkt,
								thByt
							])
						]),
						E('tbody', {}, tRows)
					])
				]));

				nodes.push(E('div', { 'class': 'mtkw-mobile-flows' }, rows.map(function(fl) {
					var stTone = fl.state === 'BND' ? 'ppe' : fl.state === 'UNB' ? 'warn' : '';
					var key = fl.ppe + ':' + fl.index;
					var mVlan = parseVlanTags(fl.vlan);
					var mVlanBadge = mVlan.length >= 2
						? aui.badge('QinQ ' + mVlan[0] + '/' + mVlan[1], 'primary')
						: mVlan.length === 1 ? aui.badge('VLAN ' + mVlan[0], '') : null;
					var mCard = E('div', {
						'class': 'mtkw-mcard',
						'tabindex': '0',
						'role': 'button',
						'aria-label': 'PPE' + fl.ppe + ' ' + hexIndex(fl.index) + ' ' + fl.state + ' ' + fl.type
					}, [
						E('div', { 'class': 'mtkw-mcard-top' }, [
							E('div', { 'class': 'mtkw-row mtkw-row--tight' }, [
								E('strong', { 'class': 'mtkw-mono' }, 'PPE' + fl.ppe + ' ' + hexIndex(fl.index)),
								aui.badge(fl.state, stTone),
								aui.badge(fl.type, '')
							]),
							mVlanBadge
						]),
						E('div', { 'class': 'mtkw-mflow-route' }, [
							E('div', {}, _('Original Flow') + ': ' + prettyFlow(fl.orig)),
							E('div', { 'class': 'mtkw-mcard-new' }, _('New Flow') + ': ' + (fl['new'] ? prettyFlow(fl['new']) : '—'))
						]),
						E('div', { 'class': 'mtkw-mcard-top mtkw-mcard-sub' }, [
							E('span', { 'class': 'mtkw-mono' }, fmtCount(fl.packets) + ' pkt · ' + fmtBytes(fl.bytes)),
							E('span', { 'class': 'mtkw-mcard-cta' }, _('Inspect L2 MAC →'))
						])
					]);
					mCard.addEventListener('click', function() { openInspector('flow', key, fl); });
					mCard.addEventListener('keydown', function(ev) {
						if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openInspector('flow', key, fl); }
					});
					return mCard;
				})));
			}

			var isUnavail = d.available === false;
			var displayPages = isUnavail ? 1 : pages;
			var displayPage = isUnavail ? 0 : Math.min(app.flowPage, displayPages - 1);
			var rangeTxt = isUnavail
				? _('PPE table unavailable')
				: matched > 0
					? _('%d–%d of %d').format(displayPage * PAGE_SIZE + 1, Math.min((displayPage + 1) * PAGE_SIZE, matched), matched)
					: _('No matching flows');
			if (!isUnavail && app.flowSearch.trim()) {
				rangeTxt += ' · ' + _('%d visible on page').format(rows.length);
			}

			var prevBtn = E('button', { 'type': 'button', 'id': 'mtkw-prev', 'class': 'mtkw-btn', 'aria-label': _('Previous page') }, _('Previous page'));
			prevBtn.disabled = isUnavail || displayPage <= 0;
			prevBtn.addEventListener('click', function() {
				if (!isUnavail && app.flowPage > 0) { app.flowPage--; renderFlowsDynamic(); refreshFlows(true, true); }
			});

			var nextBtn = E('button', { 'type': 'button', 'id': 'mtkw-next', 'class': 'mtkw-btn', 'aria-label': _('Next page') }, _('Next page'));
			nextBtn.disabled = isUnavail || displayPage + 1 >= displayPages;
			nextBtn.addEventListener('click', function() {
				if (!isUnavail && app.flowPage + 1 < pages) { app.flowPage++; renderFlowsDynamic(); refreshFlows(true, true); }
			});

			var rangeFullTxt = isUnavail ? rangeTxt : (rangeTxt + ' · ' + _('Click any row to inspect L2 MAC and NAT details'));
			nodes.push(E('div', { 'class': 'mtkw-pager' }, [
				E('span', { 'class': 'mtkw-mono', 'id': 'mtkw-range' }, rangeFullTxt),
				E('div', { 'class': 'mtkw-inline' }, [
					prevBtn,
					E('span', { 'class': 'mtkw-mono mtkw-page-num', 'id': 'mtkw-page' }, (displayPage + 1) + ' / ' + displayPages),
					nextBtn
				])
			]));

			return nodes;
		}

		function flowSummaryText() {
			var d = app.flowData || {};
			var finCnt = flowFinCount(d);
			if (d.available === false) return _('PPE table unavailable');
			if (!Array.isArray(d.ppe)) return _('Loading…');
			return (d.total || 0) + ' ' + _('flows') + ' · BND ' + (d.bound || 0) + ' / UNB ' + (d.unbound || 0) +
				' / FIN ' + finCnt + ' · IPv4 ' + (d.ipv4 || 0) + ' / IPv6 ' + (d.ipv6 || 0);
		}

		function syncFlowRowSelection() {
			if (!isLive()) return;
			var tbl = byId('mtkw-flows');
			if (!tbl || typeof tbl.querySelectorAll !== 'function') return;
			var selKey = (app.drawerCtx && app.drawerCtx.kind === 'flow') ? app.drawerCtx.id : null;
			var trs = tbl.querySelectorAll('tbody tr[data-flow-row]');
			for (var i = 0; i < trs.length; i++) {
				var match = selKey !== null && trs[i].getAttribute('data-flow-row') === selKey;
				if (match) trs[i].classList.add('is-selected');
				else trs[i].classList.remove('is-selected');
			}
		}

		function buildFlowFilterNodes() {
			var d = app.flowData || {};
			var ppes = Array.isArray(d.ppe) ? d.ppe : (Array.isArray(app.lastStatus.ppe) ? app.lastStatus.ppe : []);
			var finCnt = flowFinCount(d);
			var hasFilter = !!(app.flowFilter.state || app.flowFilter.type || app.flowFilter.ppe !== '' || app.flowSearch);

			function chipGroup(ariaLabel, items, curVal, onPick) {
				return E('div', { 'class': 'mtkw-pill-group', 'role': 'group', 'aria-label': ariaLabel }, items.map(function(it) {
					var btn = E('button', {
						'type': 'button',
						'class': 'mtkw-fchip',
						'aria-pressed': String(String(curVal) === String(it.val))
					}, it.label);
					btn.addEventListener('click', function() { onPick(it.val); });
					return btn;
				}));
			}

			var clearFiltersBtn = E('button', {
				'type': 'button',
				'id': 'mtkw-btn-clear-filters',
				'class': 'mtkw-btn mtkw-btn-soft',
				'hidden': hasFilter ? null : ''
			}, [ aui.icon('close', 12), _('Clear filters') ]);
			clearFiltersBtn.hidden = !hasFilter;
			clearFiltersBtn.addEventListener('click', function() {
				app.flowFilter = { state: '', type: '', ppe: '' };
				app.flowSearch = '';
				app.flowPage = 0;
				renderWorkspace();
				refreshFlows(true, true);
			});

			return [
				chipGroup(_('State'), [
					{ val: '', label: _('All states') },
					{ val: 'BND', label: 'BND (' + (Number(d.bound) || 0) + ')' },
					{ val: 'UNB', label: 'UNB (' + (Number(d.unbound) || 0) + ')' },
					{ val: 'FIN', label: 'FIN (' + finCnt + ')' }
				], app.flowFilter.state, function(v) {
					app.flowFilter.state = v;
					app.flowPage = 0;
					renderWorkspace();
					refreshFlows(true, true);
				}),
				chipGroup(_('Type'), [
					{ val: '', label: _('All types') },
					{ val: 'IPv4', label: 'IPv4' },
					{ val: 'IPv6', label: 'IPv6' },
					{ val: 'DS-LITE', label: 'DS-LITE' },
					{ val: '6RD', label: '6RD' }
				], app.flowFilter.type, function(v) {
					app.flowFilter.type = v;
					app.flowPage = 0;
					renderWorkspace();
					refreshFlows(true, true);
				}),
				chipGroup('PPE', [ { val: '', label: _('All PPEs') } ].concat(ppes.map(function(p) {
					return { val: String(p.id), label: 'PPE' + p.id + ' (' + (Number(p.total) || 0) + ')' };
				})), app.flowFilter.ppe, function(v) {
					app.flowFilter.ppe = v;
					app.flowPage = 0;
					renderWorkspace();
					refreshFlows(true, true);
				}),
				clearFiltersBtn
			];
		}

		function renderFlowsDynamic() {
			if (!isLive()) return;
			var host = byId('mtkw-flows-content');
			if (host) setChildren(host, buildFlowsDynamicNodes());
			var filterHost = byId('mtkw-flow-filters');
			if (filterHost && (!filterHost.contains || !filterHost.contains(document.activeElement))) {
				setChildren(filterHost, buildFlowFilterNodes());
			}
			var countEl = byId('mtkw-flow-count');
			if (countEl) countEl.textContent = flowSummaryText();
			syncFlowAgeBadge(byId('mtkw-flow-age'));
			var clrSearch = byId('mtkw-flow-search-clr');
			if (clrSearch) clrSearch.hidden = !app.flowSearch;
			var clrFilters = byId('mtkw-btn-clear-filters');
			if (clrFilters) {
				clrFilters.hidden = !app.flowFilter.state && !app.flowFilter.type && app.flowFilter.ppe === '' && !app.flowSearch;
			}
			renderNav();
		}

		function buildFlowsCard() {
			var summaryTxt = flowSummaryText();

			var intSel = E('select', {
				'id': 'mtkw-ppe-interval',
				'class': 'mtkw-select mtkw-select-pill mtkw-mono',
				'aria-label': _('Refresh interval'),
				'title': _('Refresh interval')
			}, PPE_INTERVALS.map(function(n) {
				var o = E('option', { 'value': String(n) }, _('Every %d s').format(n));
				if (n === app.flowInterval) o.selected = true;
				return o;
			}));
			intSel.addEventListener('change', function(ev) {
				setPpeInterval(Number(ev.target.value));
				if (ev.target && typeof ev.target.blur === 'function') ev.target.blur();
			});

			var freezeBtn = E('button', {
				'type': 'button',
				'id': 'mtkw-btn-flow-freeze',
				'class': app.flowFrozen ? 'mtkw-btn mtkw-btn-warn' : 'mtkw-btn',
				'aria-pressed': String(app.flowFrozen)
			}, [ aui.icon('snowflake', 14), app.flowFrozen ? _('Unfreeze') : _('Freeze') ]);
			freezeBtn.addEventListener('click', function() {
				app.flowFrozen = !app.flowFrozen;
				renderWorkspace();
				if (!app.flowFrozen) refreshFlows(true, true);
			});

			var searchInput = E('input', {
				'type': 'search',
				'id': 'mtkw-flow-search',
				'class': 'mtkw-input',
				'placeholder': _('Search IP, port, MAC, VLAN, index…'),
				'value': app.flowSearch,
				'aria-label': _('Filter flows on page')
			});
			searchInput.value = app.flowSearch;
			searchInput.addEventListener('input', function(ev) {
				if (ev.isComposing) return;
				app.flowSearch = ev.target.value;
				renderFlowsDynamic();
			});
			searchInput.addEventListener('compositionend', function(ev) {
				app.flowSearch = ev.target.value;
				renderFlowsDynamic();
			});

			var clearSearchBtn = E('button', {
				'type': 'button',
				'id': 'mtkw-flow-search-clr',
				'class': 'mtkw-search-clr',
				'aria-label': _('Clear search'),
				'hidden': app.flowSearch ? null : ''
			}, [ aui.icon('close', 13) ]);
			clearSearchBtn.hidden = !app.flowSearch;
			clearSearchBtn.addEventListener('click', function() {
				app.flowSearch = '';
				searchInput.value = '';
				renderFlowsDynamic();
				searchInput.focus();
			});

			var toolbar = E('div', { 'class': 'mtkw-flow-toolbar' }, [
				E('div', { 'class': 'mtkw-filter-groups', 'id': 'mtkw-flow-filters' }, buildFlowFilterNodes()),
				E('div', { 'class': 'mtkw-search-wrap' }, [
					E('span', { 'class': 'mtkw-search-ico' }, [ aui.icon('search', 14) ]),
					searchInput,
					clearSearchBtn
				])
			]);

			var contentHost = E('div', { 'id': 'mtkw-flows-content' }, buildFlowsDynamicNodes());

			return makeSpatialCard({
				id: 'mtkw-sec-flows',
				foldKey: 'flows',
				frozen: app.flowFrozen,
				title: _('PPE Flow Offload Entries'),
				badges: [ aui.badge(summaryTxt, '', { id: 'mtkw-flow-count', className: 'mtkw-pill--wrap' }) ],
				actions: [
					aui.badge(currentFlowAgeText(), isFlowAgeWarn() ? 'warn' : '', { id: 'mtkw-flow-age' }),
					freezeBtn,
					intSel
				],
				body: [ toolbar, contentHost ]
			});
		}

		/* ── Workspace Composer (B-Primary Tabbed + Zero-Dup All-in-One) ─── */

		function buildOffloadCtrlCard() {
			var foTab = app.statusKnown ? flowState(app.lastStatus) : { on: false, kind: '', text: _('Unknown') };
			return makeSpatialCard({
				id: 'mtkw-sec-offload-ctrl',
				foldKey: 'offload-ctrl',
				title: _('Hardware Offload'),
				badges: [ aui.pill(foTab.text, foTab.kind === 'ok' ? 'ppe' : (foTab.kind === 'warn' || foTab.kind === 'info') ? 'warn' : '') ],
				body: [
					E('p', { 'class': 'mtkw-card-sub mtkw-card-sub--mb' }, _('Switches here apply the hardware offload settings for this device.'))
				].concat(buildProgressiveControlsFooter(true))
			});
		}

		function replaceCardById(id, nextNode) {
			var cur = byId(id);
			if (cur && cur.parentNode && nextNode && typeof cur.parentNode.replaceChild === 'function') {
				cur.parentNode.replaceChild(nextNode, cur);
			}
		}

		function renderWorkspacePreservingForm() {
			var keepId = activeFormCardId();
			if (!keepId || !byId(keepId)) {
				renderWorkspace();
				return;
			}
			if (keepId !== 'mtkw-sec-faceplate' && byId('mtkw-sec-faceplate')) replaceCardById('mtkw-sec-faceplate', buildFaceplateCard());
			if (keepId !== 'mtkw-sec-gauges' && byId('mtkw-sec-gauges')) replaceCardById('mtkw-sec-gauges', buildArcGaugesGrid());
			if (keepId !== 'mtkw-sec-datapath' && byId('mtkw-sec-datapath')) replaceCardById('mtkw-sec-datapath', buildSpatialTopologyCard());
			if (keepId !== 'mtkw-sec-cpu' && byId('mtkw-sec-cpu')) replaceCardById('mtkw-sec-cpu', buildCpuStudioCard());
			if (keepId !== 'mtkw-sec-ports' && byId('mtkw-sec-ports')) replaceCardById('mtkw-sec-ports', buildPortsStudioCard());
			if (keepId !== 'mtkw-sec-wifi' && byId('mtkw-sec-wifi')) {
				var wfNext = buildWifiStudioCard();
				if (wfNext) replaceCardById('mtkw-sec-wifi', wfNext);
			}
			if (keepId !== 'mtkw-sec-offload-ctrl' && byId('mtkw-sec-offload-ctrl')) {
				replaceCardById('mtkw-sec-offload-ctrl', buildOffloadCtrlCard());
			}
			if (keepId === 'mtkw-sec-flows') {
				if (byId('mtkw-flows-content')) renderFlowsDynamic();
			} else if (byId('mtkw-sec-flows')) {
				replaceCardById('mtkw-sec-flows', buildFlowsCard());
			}
		}

		function renderWorkspace() {
			if (!app.allInOne && app.activeTab === 'wifi' && !showWifiSection() && app.lastWifi !== null) {
				app.activeTab = 'overview';
				lsSet(VIEW_KEY, 'overview');
				renderNav();
			}

			if (app.allInOne) {
				var wifiAll = buildWifiStudioCard();
				setChildren(workspaceEl, [
					buildFaceplateCard(),
					buildArcGaugesGrid(),
					E('div', { 'class': 'mtkw-sec-divider' }, _('Hardware Datapath & Controls')),
					buildSpatialTopologyCard(),
					E('div', { 'class': 'mtkw-sec-divider' }, _('CPU Frequency & Utilization')),
					buildCpuStudioCard(),
					E('div', { 'class': 'mtkw-sec-divider' }, _('Ethernet Ports & GDM MAC Counters')),
					buildPortsStudioCard(),
					wifiAll ? E('div', { 'class': 'mtkw-sec-divider' }, _('Wi-Fi Band Details')) : null,
					wifiAll,
					E('div', { 'class': 'mtkw-sec-divider' }, _('PPE Flow Offload Entries')),
					buildFlowsCard()
				]);
				return;
			}

			if (app.activeTab === 'overview') {
				setChildren(workspaceEl, [
					buildFaceplateCard(),
					buildArcGaugesGrid(),
					buildSpatialTopologyCard()
				]);
			} else if (app.activeTab === 'ports') {
				setChildren(workspaceEl, [
					buildFaceplateCard(),
					buildPortsStudioCard()
				]);
			} else if (app.activeTab === 'offload') {
				setChildren(workspaceEl, [ buildCpuStudioCard(), buildOffloadCtrlCard() ]);
			} else if (app.activeTab === 'wifi') {
				var wfCard = buildWifiStudioCard();
				if (wfCard) setChildren(workspaceEl, [ wfCard ]);
				else setChildren(workspaceEl, [ E('div', { 'class': 'mtkw-card' }, [ E('div', { 'class': 'mtkw-empty-card' }, _('Loading…')) ]) ]);
			} else if (app.activeTab === 'flows') {
				setChildren(workspaceEl, [ buildFlowsCard() ]);
			}
		}

		function renderAll() {
			renderHead();
			renderNav();
			renderRebootBanner();
			renderWorkspace();
			if (app.drawerCtx) renderDrawerContent(true);
		}

		/* ── Real RPCD Polling & Coalescing Engine ───────────────────────── */

		function flowQuery() {
			return [ app.flowPage, app.flowFilter.state, app.flowFilter.type, app.flowFilter.ppe ];
		}

		function refreshFlows(live, force) {
			if (!statusReady || stopDetached()) return Promise.resolve();
			if (document.hidden) return Promise.resolve();
			if (live === true && !force && (app.paused || app.flowFrozen)) return Promise.resolve();
			var rpcRefresh = live === true && !app.flowFrozen;
			if (ppePending) {
				if (rpcRefresh && !ppePendingLive) ppeNeedLive = true;
				return ppePending;
			}

			var query = flowQuery();
			var key = JSON.stringify(query);
			ppePendingLive = rpcRefresh;
			if (rpcRefresh) ppeNeedLive = false;
			ppePending = callPpeEntries.apply(null, query.concat([ rpcRefresh, app.flowInterval ])).then(function(data) {
				if (!isLive() || key !== JSON.stringify(flowQuery())) return;
				if (ppeNeedLive && !app.flowFrozen && !rpcRefresh) return;
				if (!data || data.error) throw new Error(data && data.error ? _(data.error) : _('PPE table unavailable'));

				if (data.available === false) {
					var prevUnavail = app.flowData || {};
					var hadPpe = Array.isArray(prevUnavail.ppe) && prevUnavail.ppe.length > 0;
					var respPpe = Array.isArray(data.ppe) ? data.ppe : null;
					if (respPpe && respPpe.length) {
						app.ppeLastGoodAt = Date.now();
						app.ppeLastGoodBaseAge = Number(data.sample_age) || 0;
					}
					app.flowData = Object.assign({}, data, {
						available: false,
						entries: [],
						ppe: (respPpe && respPpe.length) ? respPpe : (hadPpe ? prevUnavail.ppe : (respPpe || prevUnavail.ppe))
					});
					app.flowFetchedAt = null;
					app.lastStatus.ppe = app.flowData.ppe;
					app.lastStatus.ppeFailed = true;
					app.lastStatus.ppeAbsent = !hadPpe && (!respPpe || !respPpe.length);
					if (app.lastStatus.ppeAbsent) {
						app.ppeLastGoodAt = null;
						app.ppeLastGoodBaseAge = 0;
					}
					renderHead();
					renderNav();
					renderWorkspacePreservingForm();
					if (app.drawerCtx && app.drawerCtx.kind === 'ppe') renderDrawerContent(true);
					return;
				}

				/* Flows can disappear while viewing a later page: snap back to last valid page. */
				if (data.page >= 0 && app.flowPage > 0 && app.flowPage * PAGE_SIZE >= data.matched) {
					app.flowPage = Math.max(0, Math.ceil(data.matched / PAGE_SIZE) - 1);
					return;
				}

				var okTs = Date.now();
				app.flowData = data;
				app.flowBaseAge = Number(data.sample_age) || 0;
				app.flowFetchedAt = okTs;
				app.ppeLastGoodAt = okTs;
				app.ppeLastGoodBaseAge = app.flowBaseAge;
				app.lastStatus.ppe = data.ppe;
				app.lastStatus.ppeFailed = false;
				app.lastStatus.ppeAbsent = false;

				/* Drop PPE filter if that engine no longer exists */
				if (app.flowFilter.ppe !== '' && Array.isArray(data.ppe)) {
					var ids = data.ppe.map(function(p) { return String(p.id); });
					if (ids.indexOf(app.flowFilter.ppe) < 0) app.flowFilter.ppe = '';
				}

				renderHead();
				renderNav();
				renderWorkspacePreservingForm();
				if (app.drawerCtx && app.drawerCtx.kind === 'ppe') renderDrawerContent(true);
			}).catch(function(e) {
				if (!isLive() || key !== JSON.stringify(flowQuery())) return;
				if (ppeNeedLive && !app.flowFrozen && !rpcRefresh) return;
				/* Preserve last known PPE engines, filters and page on transient failure */
				var prevFd = app.flowData || {};
				app.flowData = {
					available: false,
					entries: [],
					ppe: prevFd.ppe,
					total: prevFd.total,
					page: app.flowPage,
					matched: prevFd.page >= 0 ? prevFd.matched : 0,
					error: errText(e)
				};
				app.flowFetchedAt = null;
				app.lastStatus.ppe = app.flowData.ppe;
				app.lastStatus.ppeFailed = true;
				app.lastStatus.ppeAbsent = false;
				renderHead();
				renderNav();
				renderWorkspacePreservingForm();
				if (app.drawerCtx && app.drawerCtx.kind === 'ppe') renderDrawerContent(true);
			}).finally(function() {
				var needRescan = ppeNeedLive && !app.flowFrozen;
				ppePending = null;
				ppePendingLive = false;
				ppeNeedLive = false;
				if (isLive() && (key !== JSON.stringify(flowQuery()) || needRescan)) {
					refreshFlows(true, true);
				}
			});

			return ppePending;
		}

		function scheduleFastCoreSample() {
			if (app.coreFastScheduled || coreFastTimer) return;
			app.coreFastScheduled = true;
			coreFastTimer = setTimeout(function() {
				coreFastTimer = null;
				if (!isLive() || stopDetached() || app.paused || document.hidden) return;
				callStatus(true).then(function(st2) {
					if (!isLive() || !st2 || !st2.cpu) return;
					ingestCores(st2.cpu.cores);
					if (app.lastStatus && app.lastStatus.cpu) app.lastStatus.cpu.cores = st2.cpu.cores;
					renderWorkspacePreservingForm();
				}).catch(function() {});
			}, 700);
		}

		function refresh(force) {
			if (!started || stopDetached()) return Promise.resolve();
			if (document.hidden) return Promise.resolve();
			if (app.paused && !force) return Promise.resolve();
			if (pending) return pending;

			var stErr = null, ptErr = null, msErr = null;
			var gen = app.settingsGen;

			pending = Promise.all([
				callStatus(true).catch(function(e) { stErr = e; return {}; }),
				callPorts().catch(function(e) { ptErr = e; return {}; }),
				callMacStats().catch(function(e) { msErr = e; return { available: false }; }),
				callWifiStats().catch(function(e) { return { available: false, has_wifi: true, error: errText(e) }; })
			]).then(function(d) {
				if (!isLive()) return;

				var prevStatus = app.lastStatus || {};
				var st = stErr ? Object.assign({}, app.lastGood || {}) : Object.assign({}, d[0] || {});
				var pt = ptErr ? (app.lastPortsGood || {}) : (d[1] || {});
				var ms = msErr ? (app.lastMacGood || d[2]) : d[2];
				var wf = applyWifiRateHold(d[3]);

				var fresh = gen === app.settingsGen;

				/* Never let a poll overlapping an in-flight/just-finished save revert settings */
				if (!fresh && app.statusKnown) {
					if (prevStatus.flow_offload) st.flow_offload = prevStatus.flow_offload;
					if (prevStatus.wed_param) st.wed_param = prevStatus.wed_param;
					if (prevStatus.cpu && st.cpu) {
						st.cpu = Object.assign({}, st.cpu, {
							governor: prevStatus.cpu.governor,
							max_freq: prevStatus.cpu.max_freq
						});
					}
				}

				if (!stErr) {
					app.lastGood = st;
					app.statusKnown = true;
					if (fresh && app.wedError && app.wedError.pendingSave && app.wedError.wedGen === app.wedGen && st.wed_param && st.wed_param.saving !== true) {
						clearWedSettleTimer();
						applyWedRereadOutcome(app.wedError, st.wed_param, app.wedError.prevConfigured);
					}
					var c = st.cpu || {};
					if (c.cur_freq > 0) {
						var tDeg = (typeof c.temp_milli === 'number' && isFinite(c.temp_milli) && c.temp_milli > 0)
							? (c.temp_milli / 1000) : null;
						app.cpuHistory.push({ ts: Date.now(), freq: c.cur_freq, temp: tDeg });
						if (app.cpuHistory.length > FREQ_HISTORY_MAX) app.cpuHistory.shift();
					}
					var needsFastCore = ingestCores(c.cores);
					if (needsFastCore) scheduleFastCoreSample();
				}

				if (!ptErr) {
					app.lastPortsGood = pt;
					ingestPortRates(pt.ports);
				}

				if (!msErr) app.lastMacGood = ms;

				var err = stErr || ptErr || msErr;
				app.stale = !!err;
				app.lastErr = err || null;
				if (!err) app.lastUpdated = Date.now();

				st.ppe = app.flowData.ppe;
				st.ppeFailed = !!(app.flowData.error || app.flowData.available === false);
				st.ppeAbsent = !!(app.flowData.available === false && !app.flowData.error && (!Array.isArray(app.flowData.ppe) || !app.flowData.ppe.length));
				app.lastStatus = st;
				app.lastPorts = pt;
				app.lastMac = ms;
				app.lastWifi = wf;

				renderHead();
				renderNav();
				renderRebootBanner();
				renderWorkspacePreservingForm();
				if (app.drawerCtx && app.drawerCtx.kind !== 'flow') renderDrawerContent(true);
			}).finally(function() {
				pending = null;
			});

			return pending;
		}

		function statusRefresh() {
			var p = pending;
			return p ? p.then(function() { return refresh(true); }, function() { return refresh(true); }) : refresh(true);
		}

		function pollPpe() {
			return refreshFlows(true);
		}

		function setPpeInterval(n) {
			if (PPE_INTERVALS.indexOf(n) < 0 || !started || stopDetached()) return;
			app.flowInterval = n;
			lsSet(PPE_INTERVAL_KEY, String(n));
			poll.remove(pollPpe);
			poll.add(pollPpe, n);
			if (!app.flowFrozen) refreshFlows(true, true);
		}

		/* ── Lifecycle & Document Listeners Cleanup ──────────────────────── */

		function bootInitialFetch() {
			if (statusReady || initialBootStarted || document.hidden || !started || stopDetached()) return Promise.resolve();
			initialBootStarted = true;
			return refresh(true).then(function() {
				if (stopDetached()) return;
				if (document.hidden) {
					initialBootStarted = false;
					return;
				}
				statusReady = true;
				return refreshFlows(true, true);
			}).catch(function() {
				initialBootStarted = false;
			});
		}

		function onVisibility() {
			if (!started || stopDetached()) return;
			app.bgPaused = !!document.hidden;
			renderHead();
			if (!document.hidden && !app.paused) {
				if (!statusReady) {
					bootInitialFetch();
				} else {
					refresh();
					if (!app.flowFrozen) refreshFlows(true);
				}
			}
		}

		function onKeyDown(ev) {
			if (!isLive()) { stopDetached(); return; }
			if (ev.key === 'Escape' && !drawer.isOpen() && (Date.now() - drawerClosedAt > 50) && (app.selectedTopo || app.selectedPortInline)) {
				clearTopoSelection();
			}
		}

		function teardown() {
			if (destroyed) return;
			destroyed = true;
			if (activeCleanup === teardown) activeCleanup = null;
			document.removeEventListener('visibilitychange', onVisibility);
			document.removeEventListener('keydown', onKeyDown);
			if (bootTimer) { clearTimeout(bootTimer); bootTimer = null; }
			if (coreFastTimer) { clearTimeout(coreFastTimer); coreFastTimer = null; }
			clearWedSettleTimer();
			if (ageTimer) { clearInterval(ageTimer); ageTimer = null; }
			poll.remove(refresh);
			poll.remove(pollPpe);
			drawer.destroy();
			toast.destroy();
		}

		function stopDetached() {
			if (destroyed) return true;
			if (activePage === page && page.isConnected) return false;
			teardown();
			return true;
		}

		activeCleanup = teardown;

		document.addEventListener('visibilitychange', onVisibility);
		document.addEventListener('keydown', onKeyDown);

		ageTimer = setInterval(function() {
			if (started && stopDetached()) return;
			syncFlowAgeBadge(byId('mtkw-flow-age'));
		}, 1000);

		/* Paint initial shell immediately so layout renders cleanly while RPC loads */
		renderAll();

		/* Start polling after LuCI mounts the returned page node into the DOM */
		bootTimer = setTimeout(function() {
			bootTimer = null;
			started = true;
			if (stopDetached()) return;
			if (!document.hidden) bootInitialFetch();
		}, 0);

		poll.add(refresh, 5);
		poll.add(pollPpe, app.flowInterval);

		return page;
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
