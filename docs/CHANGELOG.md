# 開發歷程 / Changelog

版本語意（patch / minor / major）見根目錄 **`AGENTS.md`**。  
**目前版本以 `manifest.json` 的 `version` 為準。**

分享安裝請用 `./scripts/pack.sh` 產出的 clean zip（`dist/TabWall-<version>.zip`），勿整包 git 目錄。

---

## 2.11.1 — 2026-08-05

### 還原挑選預覽
- 匯入後勾選面板：每列可 **預覽**
- **Tab**：完整 ZIP 顯示 snapshot／thumbnail；精簡 JSON 僅文字提示
- **Group**：列出成員；成員可再預覽其截圖（若有）
- Esc／點遮罩關閉預覽，不關閉挑選面板

### 堆疊熱區
- 堆疊目標改為另一張卡片的 **標題／meta**（不再用卡片中央大熱區）
- 綠色 **+** 指示固定在標題區
- 強化 `dragstart` 攔截與 `draggable=false`，減少 macOS 原生游標綠 +

---

## 2.11.0 — 2026-08-05

### 備份與還原
- **選擇性還原**：載入備份後勾選要寫入的 tab／group（預設全選）；支援覆蓋／附加
- **多選匯出**：批次列可只匯出選取項目（`*-partial-*` 檔名）
- **檔名時戳**：本機牆鐘 + 時區 offset，例如 `2026-08-04T13-00-00+0800`（避免 `:` 以利 Windows）
- **完整 ZIP**：媒體在 park 端從 IndexedDB hydrate 再打包，避免 service worker 訊息過大失敗
- 自動備份 full 仍可在 SW 內 hydrate 後寫入 Downloads
- ZIP 內媒體副檔名依 data-URL MIME（png／webp／jpg…）

### 診斷
- Settings → **診斷日誌**：export／import／auto-backup 等事件；可複製／清除（ring buffer）

---

## 2.10.2 — 2026-08-05

- 自動備份改以 data URL 走 `chrome.downloads`，修正 MV3 寫入失敗
- 備份位置說明對齊 Chrome **下載設定**（非固定 `~/Downloads`）
- 搜尋：`g`／`group` + Tab 只搜 group；輸入 debounce、縮圖 lazy／cache、chip 動態 padding

---

## 2.9.1 — 2026-08-05

- 還原 **附加（append）** 模式（不刪既有卡片）
- **手動新増**：貼多行 URL；`#GROUP:Name` … `#GROUP:Name` 包成 group；手動項有佔位縮圖
- 還原 **整個 group** 前確認

---

## 2.8.0 — 2026-08-05

- **自動備份**：Chrome 下載位置下之子資料夾（預設 `TabWall-Backups`）
- 排程與／或資料變更後備份；保留份數；立即備份、開啟下載資料夾

---

## 2.6.x — 2026-08-04

- **2.6.3**：group 封面固定 16:10，卡片高度一致
- **2.6.2**：拖曳重排、堆疊合併、標題複製 URL 修正
- **2.6.x 功能面**：快捷鍵可自訂、人為決策去重、搜尋 regex／欄位 scope（`||`／`&&`）、卡片 UX

---

## 2.6 前後主軸（摘要）

| 階段 | 重點 |
|------|------|
| 初版 | MV3 擴充骨架 |
| 牆面 UI | 頁內大尺寸照片牆、列表、搜尋、備註、亮色 |
| 媒體 | 縮圖／快照進 **IndexedDB**，開啟牆只載 meta |
| Group | Tab Group 暫存／還原、多選批次、精簡／完整備份 |
| 搜尋 | 正則、tag／note／group scope、命中成員列 |

---

## 文件與包裝

| 檔案 | 用途 |
|------|------|
| `README.md` | 功能、快捷鍵、安裝與開發注意 |
| `AGENTS.md` | 版號規則、clean zip 白名單、驗證 |
| `docs/privacy.md` | Chrome Web Store 隱私政策（可公開） |
| `docs/CHANGELOG.md` | 本檔：開發歷程 |
| `scripts/pack.sh` | 產出 `dist/TabWall-<version>.zip` |

商店文案草稿僅放本機 `private/`（已 gitignore，不入庫）。
