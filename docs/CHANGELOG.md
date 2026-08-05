# 開發歷程 / Changelog

版本語意（patch / minor / major）見根目錄 **`AGENTS.md`**。  
**目前版本以 `manifest.json` 的 `version` 為準。**

分享安裝請用 `./scripts/pack.sh` 產出的 clean zip（`dist/TabWall-<version>.zip`），勿整包 git 目錄。

---

## 2.13.2 — 2026-08-05

- 修正 group 還原後重新儲存時，原 group 的 note／tag 未被保留。

## 2.13.1 — 2026-08-05

- 修正還原分頁後重新儲存時，原卡片的 note／tag 遺失；同一瀏覽器工作階段內以相同完整 URL 再次儲存時會保留原 metadata。

## 2.13.0 — 2026-08-05

- 移除 TabWall 內的快捷鍵錄製、重設與頁內 hotkey 注入。
- 三個操作快捷鍵改由 Chrome `commands` 管理；`manifest.json` 的 `suggested_key` 僅提供安裝時預設值。
- 快捷鍵設定區改為唯讀顯示 Chrome 綁定狀態，並保留開啟 `chrome://extensions/shortcuts` 的入口。

## 2.12.0 — 2026-08-05

- 快捷鍵設定新增 Chrome 引導式套用流程：開啟 `chrome://extensions/shortcuts`，由使用者逐項設定相同組合鍵。
- 返回 TabWall 後自動重新整理 Chrome command 綁定狀態，並明確區分頁內快捷鍵與 Chrome 快捷鍵。

## 2.11.4 — 2026-08-05

- 修正大型 full ZIP 匯入超過 Chrome `runtime.sendMessage` 64 MiB 限制的問題。
- 圖片改先寫入共享 IndexedDB import staging，service worker 僅接收 metadata 與短暫 import ID。
- 補強 replace／append 媒體提交、暫存清理與重新配置 ID 的整合測試。

## 2.11.3 — 2026-08-05

- 相容舊版 v3 full ZIP：支援帶 MIME parameters 的 data URL、舊版 `orange` 群組色與缺少 `mediaMimes` 的 JPG 媒體。
- 保留合法 `file:` URL 為不可直接還原的項目；匯入預覽、卡片與成員清單會標記，群組還原會回報略過數量。
- 匯入錯誤改顯示具體原因，並增加實際舊版備份 ZIP、部分群組還原與 URL／MIME 回歸測試。

## 2.11.2 — 2026-08-05

- 強化自動備份清理、匯入驗證、IndexedDB orphan cleanup 與還原／Stack rollback。
- 串行化 service-worker mutation，避免並行 read-modify-write 覆蓋資料。
- 限制 ZIP、圖片、文字與 ID 資料邊界，並保留完整 backup MIME metadata。
- 改善訊息來源驗證、錯誤畫面、busy lock 與 full backup 媒體 hydrate 效能。

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
