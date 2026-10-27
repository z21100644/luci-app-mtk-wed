# luci-app-mtk-wed

A LuCI hardware offload status page for MediaTek Filogic (MT798x) on mainline OpenWrt.
The interface follows `luci-app-airoha-npu` from
[luci-app-airoha](https://github.com/naoki66/luci-app-airoha) (Apache-2.0); the backend
reads the PPE, WED and mt76 interfaces of the mainline kernel instead.

Supports MT7981, MT7986, MT7987 and MT7988. The PPEs, WEDs, ports and Wi-Fi driver are
detected from the system, so no per-board configuration is needed:

| SoC | PPE | WED | Wi-Fi driver |
| --- | --- | --- | --- |
| MT7981 | 2 | 1 (v2) | mt7915e (built-in WMAC) |
| MT7986 | 2 | 2 (v2) | mt7915e (built-in WMAC) |
| MT7987 | 2 | 1 (v3) | mt7996e (PCIe) |
| MT7988 | 3 | 3 (v3) | mt7996e (PCIe) |

## Features

- Ethernet ports: link state, speed, traffic and error counters, and the GDM each port
  goes through. Each port is labelled with the highest speed it supports (read with
  `ethtool`, or worked out from the DT `phy-mode` when it is not installed).
- CPU: model, temperature, governor and maximum frequency (the settings persist across
  reboots), and the frequency history.
- Hardware offload:
  - Bound flows and bind rate over all PPEs; each GDM shows the PPE it uses.
  - WED version and attachments, whether each WED offloads TX and RX or TX only, and the
    build time of the WO firmware it loaded (the WO firmware itself has no version number).
  - Hardware flow offload switch (`firewall.@defaults[0].flow_offloading_hw`).
  - Wi-Fi acceleration switch: writes `options <driver> wed_enable=Y` to
    `/etc/modules.conf` and removes conflicting WED parameters for that driver from
    `/etc/modules-boot.d/` and `/etc/modules.d/`, applied after a reboot. Other module
    options, comments, file permissions and symlinks are preserved. The driver is the mt76 module actually
    bound to the wireless card (`mt7915e` or `mt7996e`); mainline OpenWrt does not enable
    WED by default.
    Parameter values with quotes spanning lines or files are read correctly, but
    saving is rejected before changing the configuration; keep each quoted value
    on one line to use the switch.
  - Hardware MAC counters of each GDM (needs `ethtool`).
- Wi-Fi per band: interfaces, clients, retry rate, PHY and expected rates, signal. Hidden
  when there is no wireless card or no AP is enabled. MLO statistics are assigned by
  link frequency without adding the station-level counters twice, and each station
  is counted once in the client summary. Ambiguous or incomplete link data is marked
  incomplete and does not replace the last complete rate sample.
- PPE flow table (at the bottom of the page): the full flow table from
  `/sys/kernel/debug/ppeN`, filtered by state, type and PPE, 50 entries per page. It is
  read every 10 seconds by default; the interval can be set from 5 to 60 seconds in the
  table's head (kept in the browser). Filtering and paging happen in the backend.
- Everything else refreshes every 5 seconds and pauses while the page is in the
  background. Every section folds from its title; a folded section shows a summary in its
  head (ports up, CPU frequency and temperature, bound flows, clients), and the fold
  state is kept in the browser.

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
