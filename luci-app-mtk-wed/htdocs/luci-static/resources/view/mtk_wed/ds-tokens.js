'use strict';
'require baseclass';

/*
 * SPDX-License-Identifier: Apache-2.0
 *
 * V2 Spatial Hardware Studio design tokens for luci-app-mtk-wed.
 *
 * Scoped strictly under `.mtkw-page` (`--mtkw-*`) so styles never leak into
 * host LuCI themes (Argon, Bootstrap, Aurora, Material, Glass).
 *
 * Theme safety notes:
 * - `--background-color` is deliberately NOT referenced: Argon dark.css never
 *   re-assigns it (it stays #f4f5f7 in dark mode), which would paint light boxes
 *   on a #1e1e1e dark canvas.
 * - `tokens` provides the Light (default — Spatial Alabaster Studio) palette.
 * - `dark` provides the Luminous Midnight-Slate Dark palette, calibrated to
 *   elevate cleanly above Argon Dark (#1e1e1e), Bootstrap Dark (#18181b), and
 *   Aurora Dark (#0b1018) with WCAG AA/AAA text contrast.
 * - `cssPath` points to the static external stylesheet (`mtk-wed.css`) loaded
 *   via `<link id="mtkw-ds-css" rel="stylesheet">` for strict CSP compliance
 *   (`style-src 'self'` without `'unsafe-inline'`).
 * - `tokens` and `dark` mirror the Light & Dark token definitions as metadata
 *   for palette inspection and backwards compatibility; they are never
 *   injected via `<style>` elements.
 */

return baseclass.extend({
	cssPath: 'view/mtk_wed/mtk-wed.css',

	tokens: [
		/* Light Mode (Default — Spatial Alabaster Studio) */
		'--mtkw-bg:#f2f5f9',
		'--mtkw-surface:#ffffff',
		'--mtkw-surface-2:#f6f8fb',
		'--mtkw-surface-hover:#edf2f8',
		'--mtkw-stage-bg:#eef3f9',
		'--mtkw-chassis-top:#edf1f7',
		'--mtkw-chassis-bot:#e2e8f2',
		'--mtkw-chassis-slot:#dce4f0',
		'--mtkw-chassis-shadow:inset 0 1px 0 rgba(255,255,255,.55),inset 0 -1px 0 rgba(15,23,42,.06)',
		'--mtkw-cage-bg:#ffffff',
		'--mtkw-cage-inner:#182232',
		'--mtkw-cage-down:#334155',
		'--mtkw-border:rgba(15,23,42,.09)',
		'--mtkw-border-mid:rgba(15,23,42,.15)',
		'--mtkw-border-strong:rgba(15,23,42,.24)',
		'--mtkw-text:#0f172a',
		'--mtkw-text-sec:#334155',
		'--mtkw-text-muted:#475569',
		'--mtkw-track:rgba(15,23,42,.08)',

		/* Soft-Gradient Semantic Palette (WCAG 2.1 AA calibrated) */
		'--mtkw-ppe:#075985',
		'--mtkw-ppe-start:#0ea5e9',
		'--mtkw-ppe-end:#0284c7',
		'--mtkw-ppe-tint:rgba(2,132,199,.10)',
		'--mtkw-wed:#065f46',
		'--mtkw-wed-start:#10b981',
		'--mtkw-wed-end:#059669',
		'--mtkw-wed-tint:rgba(5,150,105,.10)',
		'--mtkw-primary:#1d4ed8',
		'--mtkw-primary-tint:rgba(0,111,255,.10)',
		'--mtkw-spd-5g:#115e59',
		'--mtkw-spd-5g-tint:rgba(8,145,178,.11)',
		'--mtkw-spd-10m:#9a3412',
		'--mtkw-spd-10m-tint:rgba(194,65,12,.11)',
		'--mtkw-warn:#92400e',
		'--mtkw-warn-start:#f59e0b',
		'--mtkw-warn-end:#d97706',
		'--mtkw-warn-tint:rgba(217,119,6,.11)',
		'--mtkw-warn-line:rgba(217,119,6,.36)',
		'--mtkw-err:#9f1239',
		'--mtkw-err-start:#f43f5e',
		'--mtkw-err-end:#e11d48',
		'--mtkw-err-tint:rgba(225,29,72,.10)',
		'--mtkw-err-line:rgba(225,29,72,.34)',
		'--mtkw-band-24:#9a3412',
		'--mtkw-band-24-tint:rgba(234,88,12,.11)',
		'--mtkw-band-5:#1d4ed8',
		'--mtkw-band-5-tint:rgba(37,99,235,.11)',
		'--mtkw-band-6:#6d28d9',
		'--mtkw-band-6-tint:rgba(124,58,237,.11)',

		/* Solid Action, Active Chip & Error Surface Foregrounds */
		'--mtkw-btn-pri-1:#0369a1',
		'--mtkw-btn-pri-2:#1d4ed8',
		'--mtkw-btn-pri-fg:#ffffff',
		'--mtkw-btn-warn-1:#fbbf24',
		'--mtkw-btn-warn-2:#f59e0b',
		'--mtkw-btn-warn-fg:#0f172a',
		'--mtkw-chip-active-bg:#1d4ed8',
		'--mtkw-chip-active-fg:#ffffff',
		'--mtkw-err-solid-bg:#be123c',
		'--mtkw-err-solid-fg:#ffffff',
		'--mtkw-err-lbl:#334155',

		/* Ambient Layered Elevation & Frosted Surfaces */
		'--mtkw-shadow-card:0 1px 3px rgba(15,23,42,.05),0 8px 24px -6px rgba(15,23,42,.07)',
		'--mtkw-shadow-hover:0 4px 12px rgba(15,23,42,.07),0 12px 28px -8px rgba(15,23,42,.11)',
		'--mtkw-shadow-soft:0 1px 3px rgba(15,23,42,.06)',
		'--mtkw-drawer-bg:rgba(255,255,255,.92)',
		'--mtkw-shadow-drawer:-10px 0 38px rgba(15,23,42,.15),0 4px 16px rgba(15,23,42,.06)',
		'--mtkw-backdrop:rgba(15,23,42,.26)',
		'--mtkw-glass-tip:rgba(255,255,255,.94)',
		'--mtkw-stage-glow:radial-gradient(ellipse at 50% 45%,rgba(2,132,199,.06),transparent 72%)',
		'--mtkw-arc-filter:none',
		'--mtkw-toast-bg:#0f172a',
		'--mtkw-toast-fg:#f8fafc',

		/* Spatial Geometry & Typography Scale */
		'--mtkw-r-card:18px',
		'--mtkw-r-panel:14px',
		'--mtkw-r-node:12px',
		'--mtkw-r-ctrl:10px',
		'--mtkw-r-pill:999px',
		'--mtkw-font-sans:system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif',
		'--mtkw-font-mono:ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",Menlo,monospace'
	].join(';'),

	dark: ':root .mtkw-page{' + [
		/* Dark Mode (Luminous Midnight-Slate — elevated above Argon #1e1e1e & Aurora #0b1018) */
		'--mtkw-bg:#141a24',
		'--mtkw-surface:#222a38',
		'--mtkw-surface-2:#293344',
		'--mtkw-surface-hover:#313d52',
		'--mtkw-stage-bg:#171e2b',
		'--mtkw-chassis-top:#263042',
		'--mtkw-chassis-bot:#1c2433',
		'--mtkw-chassis-slot:#141b27',
		'--mtkw-chassis-shadow:inset 0 1px 0 rgba(255,255,255,.07),inset 0 -1px 0 rgba(0,0,0,.45)',
		'--mtkw-cage-bg:#232d40',
		'--mtkw-cage-inner:#0a0f18',
		'--mtkw-cage-down:#172030',
		'--mtkw-border:rgba(226,238,255,.11)',
		'--mtkw-border-mid:rgba(226,238,255,.17)',
		'--mtkw-border-strong:rgba(226,238,255,.28)',
		'--mtkw-text:#f1f5f9',
		'--mtkw-text-sec:#d4deea',
		'--mtkw-text-muted:#b9c7d9',
		'--mtkw-track:rgba(226,238,255,.12)',

		'--mtkw-ppe:#7dd3fc',
		'--mtkw-ppe-start:#38bdf8',
		'--mtkw-ppe-end:#3b82f6',
		'--mtkw-ppe-tint:rgba(56,189,248,.16)',
		'--mtkw-wed:#6ee7b7',
		'--mtkw-wed-start:#34d399',
		'--mtkw-wed-end:#14b8a6',
		'--mtkw-wed-tint:rgba(52,211,153,.17)',
		'--mtkw-primary:#bfdbfe',
		'--mtkw-primary-tint:rgba(75,166,255,.18)',
		'--mtkw-spd-5g:#67e8f9',
		'--mtkw-spd-5g-tint:rgba(34,211,238,.17)',
		'--mtkw-spd-10m:#fdba74',
		'--mtkw-spd-10m-tint:rgba(251,146,60,.18)',
		'--mtkw-warn:#fde68a',
		'--mtkw-warn-start:#fbbf24',
		'--mtkw-warn-end:#f59e0b',
		'--mtkw-warn-tint:rgba(251,191,36,.17)',
		'--mtkw-warn-line:rgba(251,191,36,.42)',
		'--mtkw-err:#fecdd3',
		'--mtkw-err-start:#fb7185',
		'--mtkw-err-end:#f43f5e',
		'--mtkw-err-tint:rgba(251,113,133,.18)',
		'--mtkw-err-line:rgba(251,113,133,.44)',
		'--mtkw-band-24:#fdba74',
		'--mtkw-band-24-tint:rgba(251,146,60,.18)',
		'--mtkw-band-5:#93c5fd',
		'--mtkw-band-5-tint:rgba(96,165,250,.18)',
		'--mtkw-band-6:#ddd6fe',
		'--mtkw-band-6-tint:rgba(167,139,250,.18)',

		'--mtkw-btn-pri-1:#38bdf8',
		'--mtkw-btn-pri-2:#60a5fa',
		'--mtkw-btn-pri-fg:#09111d',
		'--mtkw-btn-warn-1:#fbbf24',
		'--mtkw-btn-warn-2:#f59e0b',
		'--mtkw-btn-warn-fg:#0f172a',
		'--mtkw-chip-active-bg:#60a5fa',
		'--mtkw-chip-active-fg:#09111d',
		'--mtkw-err-solid-bg:#fb7185',
		'--mtkw-err-solid-fg:#0f172a',
		'--mtkw-err-lbl:#e2e8f0',

		'--mtkw-shadow-card:inset 0 1px 0 rgba(255,255,255,.08),0 6px 22px -4px rgba(0,0,0,.44)',
		'--mtkw-shadow-hover:inset 0 1px 0 rgba(255,255,255,.11),0 10px 28px -4px rgba(0,0,0,.55)',
		'--mtkw-shadow-soft:0 2px 8px rgba(0,0,0,.32)',
		'--mtkw-drawer-bg:rgba(26,34,48,.94)',
		'--mtkw-shadow-drawer:inset 0 1px 0 rgba(255,255,255,.09),-14px 0 44px rgba(0,0,0,.62)',
		'--mtkw-backdrop:rgba(4,8,15,.58)',
		'--mtkw-glass-tip:rgba(22,29,41,.94)',
		'--mtkw-stage-glow:radial-gradient(ellipse at 50% 45%,rgba(56,189,248,.09),transparent 72%)',
		'--mtkw-arc-filter:drop-shadow(0 0 6px rgba(56,189,248,.24))',
		'--mtkw-toast-bg:#f1f5f9',
		'--mtkw-toast-fg:#0f172a'
	].join(';') + '}'
});
