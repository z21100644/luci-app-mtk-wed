# luci-app-mtk-wed

A LuCI hardware offload status page for MediaTek Filogic (MT798x) on mainline OpenWrt.
The backend reads the PPE, WED, and mt76 interfaces of the mainline kernel (with per-band
`iw` client-health computation following `luci-app-airoha-npu` from
[luci-app-airoha](https://github.com/naoki66/luci-app-airoha), Apache-2.0), paired with a
ground-up V2 Spatial Hardware Studio frontend.

Supports MT7981, MT7986, MT7987, and MT7988. The PPEs, WEDs, ports, and Wi-Fi driver are
detected automatically from the system, so no per-board configuration is needed:

| SoC | PPE | WED | Wi-Fi driver |
| --- | --- | --- | --- |
| MT7981 | 2 | 1 (v2) | mt7915e (built-in WMAC) |
| MT7986 | 2 | 2 (v2) | mt7915e (built-in WMAC) |
| MT7987 | 2 | 1 (v3) | mt7996e (PCIe) |
| MT7988 | 3 | 3 (v3) | mt7996e (PCIe) |

## Features

- **Workspace & theming**:
  - Five focused workspace tabs (**Overview**, **Ports & GDM**, **Hardware Offload**,
    **Wi-Fi & MLO**, and **PPE Flows**) plus an **All-in-One** view toggle.
  - Section cards fold from their headers (keeping the top Arc Gauges and any active
    Reboot Banner visible); active view, fold state, and PPE polling interval persist in
    browser `localStorage`.
  - Adaptive Light/Dark styling automatically follows LuCI host themes (Argon, Bootstrap,
    Material, Aurora, OpenWrt 2020) via a strict-CSP static stylesheet (`mtk-wed.css`)
    with no inline `<style>` injection.
  - Includes live **Pause/Resume**, automatic background-tab pause, **PPE Flow Table
    Freeze**, and **Read-Only** ACL gating when the logged-in user lacks write permission.
- **Overview & interactive datapath**:
  - Four radial **Arc Gauges** summarizing PPE bind rate, WED offload state, CPU thermal
    and clock state, and active Wi-Fi airtime efficiency.
  - Five-column interactive **Datapath Topology** (`Ports -> GDM -> PPE -> WED -> Wi-Fi`,
    with a responsive stacked pipeline on mobile) linked to a slide-over **Frosted
    Inspector Drawer** displaying flow details (including L2 Ethernet MAC and copyable
    5-tuples), port/GDM counters, PPE summary, WED status, and band metrics.
- **Ethernet ports & GDM MACs**:
  - **Physical Faceplate** view with `ethtool`-detected connector media (`RJ45` / `SFP+`
    / neutral fallback), negotiated speeds from `10M` to `10G`, link state, live RX/TX
    throughput deltas, and traffic/error counters. Max supported speed falls back to DT
    `phy-mode` when `ethtool` is not installed.
  - Inline 12-counter hardware MAC diagnostics per GDM (requires `ethtool`), reporting
    explicit per-GDM read failures rather than zeroed counters.
- **CPU telemetry & scaling**:
  - Architecture, temperature, governor, and maximum frequency controls with per-policy
    validation, atomic sysfs/UCI rollback on failure, and reboot persistence via
    `/etc/config/mtk_wed` and `/etc/init.d/mtk-wed`.
  - Dual-layer CPU frequency and temperature history chart alongside live per-core
    `/proc/stat` utilization and pure `SoftIRQ` bars.
- **Hardware offload controls**:
  - Bound flows and bind rate across all PPE engines; GDM-to-PPE mapping.
  - WED version, attachment state, TX/RX vs TX-only capability, and WO firmware build
    time (the WO firmware itself carries no separate version number).
  - **Hardware flow offload** switch (`firewall.@defaults[0].flow_offloading_hw`): on live
    routers (`MTKW_ROOT` empty), always commits through OpenWrt's `rpcd`/`uci` channel via
    a short-lived private session (`timeout: 120`, minimal `firewall` `read`/`write` grant,
    requiring no `uci` grant in the plugin's user `acl.d`) using transactional `uci apply`
    (`rollback: true`, `timeout: 60`) → on-disk and live `fw4`/`nft` verification →
    `uci confirm`, or automatic/explicit `uci rollback` on failure. Holding `apply_sid`
    across the transaction prevents concurrent LuCI commits from interleaving before
    rollback completes and honors any active external `apply_sid` confirmation window;
    live routers never silently fall back to direct file writes when `rpcd` is unavailable
    or `apply_sid` is locked (file-level locked CAS `uci_pkg_apply` is used only under
    `$MTKW_ROOT` offline test roots). Reload ownership stays single-shot: when `procd`
    registers a `firewall` `config.change` trigger and `fw4` is present, `rpcd`'s trigger
    drives the reload while the backend verifies `/var/run/fw4.state`, `/var/run/fw4.lock`,
    and `nft -t list table inet fw4` (running a single `/etc/init.d/firewall reload`
    otherwise). Note two upstream OpenWrt behaviors: `fw4 reload` reads
    `/tmp/.uci/firewall` during reload, so uncommitted firewall rules already staged in
    shared `/tmp/.uci` may take effect early in `fw4` while remaining uncommitted on disk;
    and direct SSH `uci commit firewall` still carries upstream `openwrt/uci/file.c`'s
    unlock-before-`rename()` race window, matching native LuCI.
  - **Wi-Fi acceleration** switch (`wed_enable`): writes `options <driver> wed_enable=Y`
    to `/etc/modules.conf` and removes conflicting WED parameters for that driver from
    `/etc/modules-boot.d/` and `/etc/modules.d/`, preserving unrelated options, comments,
    file permissions, and symlinks. Parameter values with quotes spanning lines or files
    are read accurately, while saving is rejected cleanly before modifying files; if a
    rollback fails, an inline recovery alert displays the copyable recovery directory path.
    An uncollapsible top-level **Reboot Banner** with one-click **Revert** appears whenever
    configured and active WED states differ.
- **Wi-Fi & MLO**:
  - Per-band interfaces, unique stations, retry rate, paired airtime efficiency, PHY and
    expected rates, and signal (`signal avg:` with `signal:` fallback). Hidden when no
    wireless PHY is present; shows neutral status when no AP is active.
  - MLO links are attributed by link frequency without double-counting clients; incomplete
    samples are flagged and hold the last complete rate baseline.
- **PPE flow table**:
  - Shown in the dedicated **PPE Flows** tab by default (or at the bottom of the page in
    **All-in-One** mode).
  - Backend-filtered (state, type, PPE) and backend-paged (50 entries/page) from
    `/sys/kernel/debug/ppeN` via a locked shared snapshot, refreshing every 10 seconds by
    default (configurable 5–60s) with **Freeze** support.

## Building

This is an ordinary LuCI feed, and the package is architecture-independent. Add the feed
to an OpenWrt SDK or source tree:

```text
src-git mtkwed https://github.com/z21100644/luci-app-mtk-wed.git
```

```sh
./scripts/feeds update mtkwed
./scripts/feeds install luci-app-mtk-wed
make package/luci-app-mtk-wed/compile
```
