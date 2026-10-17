# luci-app-mtk-wed

[English](README.md) | 繁體中文

MediaTek Filogic（MT798x）的 LuCI 硬體加速狀態頁，適用主線 OpenWrt。
介面沿用 [luci-app-airoha](https://github.com/naoki66/luci-app-airoha) 的
`luci-app-airoha-npu`（Apache-2.0），後端改讀主線 kernel 的 PPE、WED 與 mt76 介面。

適用 MT7981、MT7986、MT7987、MT7988。PPE、WED、連接埠與 Wi-Fi 驅動都從系統自動偵測，
不需要針對機型設定：

| SoC | PPE | WED | Wi-Fi 驅動 |
| --- | --- | --- | --- |
| MT7981 | 2 | 1（v2） | mt7915e（內建 WMAC） |
| MT7986 | 2 | 2（v2） | mt7915e（內建 WMAC） |
| MT7987 | 2 | 1（v3） | mt7996e（PCIe） |
| MT7988 | 3 | 3（v3） | mt7996e（PCIe） |

## 功能

- 乙太網路連接埠：連線狀態、速率、流量與錯誤計數，標示每個埠走哪個 GDM。
  埠名稱以該埠支援的最高速率標示（讀取 `ethtool`，未安裝時依 DT 的 `phy-mode` 推算）。
- CPU：型號、溫度、調速器與最高頻率（設定會在重新開機後保留）、頻率歷史。
- 硬體加速：
  - 所有 PPE 合計的綁定狀態與綁定率；各 GDM 標示所用的 PPE。
  - WED 版本與連接數，每個 WED 是收發或僅發送卸載，以及它所載入 WO 韌體的建置時間
    （WO 韌體本身沒有版本號）。
  - 硬體流量卸載開關（`firewall.@defaults[0].flow_offloading_hw`）。
  - Wi-Fi 加速開關：在 `/etc/modules.conf` 寫入 `options <驅動> wed_enable=Y`，
    重新開機後生效。驅動依實際綁定無線網卡的 mt76 模組決定（`mt7915e` 或 `mt7996e`）；
    主線 OpenWrt 預設沒有開啟 WED。
  - GDM 的硬體 MAC 計數（需安裝 `ethtool`）。
- Wi-Fi 各頻段的介面、用戶端數、重傳率、PHY 與預期速率、訊號；沒有無線網卡或沒有啟用的 AP 時不顯示。
- PPE 流量表（頁面最下方）：`/sys/kernel/debug/ppeN` 的完整流量表，可依狀態、類型與 PPE 篩選，每頁 50 筆。
  預設每 10 秒讀取一次，可在表格標題列改為 5～60 秒（存在瀏覽器中）；篩選與分頁在後端進行。
- 其他狀態每 5 秒更新，頁面在背景時暫停。每個區塊都能點標題折疊，折疊後標題列顯示摘要
  （已連線的埠數、CPU 頻率與溫度、已綁定的流量數、用戶端數），折疊狀態存在瀏覽器中。

## 編譯

這是一般的 LuCI feed，套件不分 CPU 架構。在 OpenWrt SDK 或原始碼樹加入 feed：

```text
src-git mtkwed https://github.com/z21100644/luci-app-mtk-wed.git
```

```sh
./scripts/feeds update mtkwed
./scripts/feeds install luci-app-mtk-wed
make package/luci-app-mtk-wed/compile
```
