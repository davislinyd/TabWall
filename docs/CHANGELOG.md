---
layout: default
title: "TabWall Changelog"
permalink: /CHANGELOG.html
---

# 開發歷程 / Changelog

版本語意（patch / minor / major）見根目錄 **`AGENTS.md`**。  
**目前版本以 `manifest.json` 的 `version` 為準。**

分享安裝請用 `./scripts/pack.sh` 產出的 clean zip（`dist/TabWall-<version>.zip`），勿整包 git 目錄。

---

## 2.19.3 — 2026-08-08

- Canvas 連線端點改為貼齊卡片四側 `+` handle 中心，依兩張卡片相對方向動態選擇上、右、下或左側，並優先使用實際卡片矩形避免端點偏移。
- 100% 顯示時卡片視覺尺寸放大 10%；預設網格與棋盤／對齊排列的卡片間距統一為 96px，既有儲存的 position 尺寸與 layout schema 不變。
- 擴大四側 `+` handle 的視覺與滑鼠命中範圍，保留端點重接、中段曲線拖曳與雙擊重置功能。

## 2.19.2 — 2026-08-08

- 線段前／中／後三段新增 hover highlight，讓目前可重接或調整曲線的區域清楚可見。
- 修正實際雙擊線段時因 SVG hit path 重建而無法重設曲線的問題；pointerdown fallback 會可靠清除自訂曲線與選取狀態。
- 卡片 hover、focus 或選取時顯示四側 `+` handle，且不必先切換連結工具即可拖曳建立連線。

## 2.19.1 — 2026-08-08

- Canvas 連線依實際 Bézier 弧長分成前／中／後三段：前後段重接端點，中段可拖曳調整曲線偏移並保存於既有 layout；端點重接會重設曲線。
- 每段提供固定螢幕 16px 的透明命中範圍，靠近線段即可操作；雙擊任一段會恢復預設曲線並清除選取狀態。
- 備份、CAS 衝突重播、Stack remap、刪除與 append import 均保留或正確清除曲線偏移。

## 2.19.0 — 2026-08-08

- 搜尋命中卡片會顯示直接相連的一層關聯卡片；關聯卡片與相關線段以低透明度呈現，hover、focus 或選取時恢復完整樣式。
- Canvas 連結工具新增卡片四側 handle 拖曳建立連線；既有線段可拖曳重接端點，雙擊線段可清除選取並恢復預設路徑。
- Command／Control／Shift 多選不再觸發卡片快照預覽；原本點兩張卡片建立連線的流程仍保留。

## 2.18.0 — 2026-08-08

- 設定面板將排序與排列分成獨立區塊；排序保留日期、FQDN、Group，排列提供棋盤與對齊格式，移除圓形與右側整理入口。
- Minimap viewport 框支援拖曳平移，拖曳期間即時預覽，放開後提交單一視角變更，取消或失焦會還原。
- Canvas 連結工具可在卡片與 Group 之間建立無方向持久連線；連線支援篩選渲染、選取、刪除、Stack 合併重映射與備份／匯入保存。

## 2.17.4 — 2026-08-08

- 修正 Canvas 側邊欄拖曳時沒有即時寬度預覽的問題；拖曳期間改為逐 frame 更新，放開後才保存設定。
- 提升 macOS trackpad pinch 縮放速度，合併高頻縮放事件並避免產生大量重複 viewport operation。
- 修正放大畫布時快照 URL 快取競態與部分卡片破圖；快照先解碼確認，失敗時逐卡退回 thumbnail。

## 2.17.3 — 2026-08-08

- Canvas 左側欄支援拖曳調整寬度；低於 120px 時收合為 34px，並可透過箭頭重新展開，寬度與狀態會保存。
- Header logo 改為三片錯位堆疊面板的 inline SVG，移除舊的文件外框圖示。

## 2.17.2 — 2026-08-08

- 修正 Overlay 內儲存目前分頁時，快照會包含 TabWall 覆蓋畫面的問題；擷取前暫時隱藏 Overlay，完成後恢復。
- 點擊左側群組索引後，畫布會置中至對應群組卡片。
- 整理畫布面板改置於右上角縮放控制下方。

---

## 2.17.1 — 2026-08-08

- 將 Light／Dark 切換移到 Header 外層，保留既有主題偏好與動態文案。
- Canvas viewport 新增 300ms 內中鍵連點兩次重設視角；既有 minimap 與設定入口共用同一重設流程。
- 儲存目前分頁按鈕改為一般中性色，移除珊瑚色特殊底色與邊框。

---

## 2.17.0 — 2026-08-08

- 將 TabWall 重整為高密度、低框線的 Editorial Workbench，Light／Dark 使用同一套暖象牙／石墨視覺系統；新安裝預設深色。
- 移除手機／平板重新排版，固定 1200px 桌面幾何；窄視窗保留完整桌面版並使用水平捲動。

---

## 2.16.8 — 2026-08-07

- 將新增、列表／畫布、Tags 與設定入口集中到右上角，移除畫布左下角的重複按鈕。
- 新增按鈕改用主色淡背景與主色文字，改善淺色與深色主題下的可讀性。

---

## 2.16.7 — 2026-08-07

- Canvas 卡片單擊改為預覽快照，雙擊才還原；卡片內容區可按住拖曳，操作按鈕維持獨立功能。
- Group 卡片新增放大 mosaic 預覽，整理畫布新增棋盤與圓形排列模式。
- 修正 Canvas header-primary 背景與外層 header 不一致及高度覆寫問題。

---

## 2.16.6 — 2026-08-06

- 一般滑鼠／Trackpad 滾輪改為畫布平移；Ctrl／Command 加垂直滾輪與 Trackpad pinch 用於縮放。
- 預設畫布首次依卡片範圍置中，右下角 minimap 改以實際卡片尺寸與 viewport frame 映射。
- 左側欄取消整體 scrollbar，僅 Group 清單獨立捲動。

---

## 2.16.5 — 2026-08-06

- 以單一 Canvas Store、增量 keyed renderer 與 RAF pointer pipeline 重整 Spatial Canvas，避免互動期間整頁重繪與 stuck pointer state。
- 新增 `canvasLayoutRevision` CAS 儲存、衝突重播與 bounded retry；堆疊／匯入的 items 與 layout 改為單次 metadata commit，保留既有 `canvasLayout` v1 與備份格式。
- Canvas hydrate／sync 失敗時僅於目前 session 切換列表 fallback，不改寫使用者的 view preference。

---

## 2.16.4 — 2026-08-06

- 畫布空白區在 `select` 工具下可用滑鼠左鍵拖曳平移，節點拖曳與 `area` 框選維持獨立操作。
- 畫布預設視角改為 100%；舊版 76% 預設只 migration 一次，自訂視角不受影響。
- 畫布放大時改載入高解析度 snapshot，無 snapshot 時退回 thumbnail，降低放大預覽模糊。

---

## 2.16.3 — 2026-08-06

- 修正設定面板 open state 被舊版抽屜 transform 覆蓋，導致面板從 viewport 中央向右下溢出。

---

## 2.16.2 — 2026-08-06

- 修正設定面板 footer 仍嵌在兩欄 layout 內造成的下方裁切；完成按鈕與自動儲存狀態固定在面板底部。
- 清除設定面板遺留的右側／底部定位約束，補上 `100vh` fallback，確保桌面與窄視窗都完整落在 viewport 內。

---

## 2.16.1 — 2026-08-06

- 修復 Spatial Canvas 控制項誤觸發框選／平移、節點拖曳重繪、節點操作、鍵盤焦點與堆疊命中區域。
- 畫布篩選／總數與 header count 統一，吸附格線同步設定，layout 儲存改用快照 debounce；多選 CREATE_STACK 失敗時回復原狀。
- 重整設定面板為固定 header／側邊分類／可滾動內容／固定 footer，窄螢幕改用水平分類列並加入 `100dvh` 與安全邊距。

---

## 2.16.0 — 2026-08-06

- 主畫面改為 Spatial Canvas：支援平移、縮放、框選、多選、自由拖曳、吸附格線、minimap 與依 Stack／日期整理。
- 新增左側工具／索引 rail、選取後上下文工具帶、空白區建立 Stack，以及列表模式作為大量資料與無障礙 fallback。
- 新增獨立 `canvasLayout` 儲存資料；位置、尺寸與 viewport 會納入精簡／完整備份，舊備份缺少欄位時自動產生預設版。
- 新增 `GET_CANVAS_LAYOUT`、`PATCH_CANVAS_LAYOUT`、`CREATE_STACK` 內部路由；附加匯入保留目前視角並為新項目套用匯入位置。
- 設定、Tags、編輯、匯入與診斷浮層統一為居中 dialog；Overlay 改為全視窗畫布容器。
- 新安裝預設淺色與 canvas；舊 `cards` view preference 遷移為 `canvas`，明確使用 `list` 者保留。

---

## 2.15.1 — 2026-08-06

- 將主畫面、卡片、列表、工具列與 Overlay 改為 Quiet Archive 視覺：暖紙張預設主題、暖深色主題、低對比 hairline 與開放式目錄布局。
- 移除不必要的 cobalt、漸層、blur、發光邊框、厚重陰影與大圓角；保留既有功能、資料格式與訊息路由。
- 設定、Tags、Lightbox、批次列、錯誤／toast 與窄視窗 sheet 統一為低刺激、長時間可讀的樣式。

---

## 2.15.0 — 2026-08-05

- 主照片牆改為深色 graphite＋cobalt 編輯式檔案庫視覺：兩層工具列、16:10 卡片、Group mosaic、卡片／列表操作列、focus／selected／danger 狀態與 reduced-motion 支援。
- 新增快速新增選單：Overlay 可儲存目前分頁／Group；New Tab 與獨立 Tab 停用無目標操作，但保留貼上 URL。
- 頂層分頁與群組新增 `pinned` 狀態，支援固定／取消固定與「已固定」篩選；舊資料與舊備份缺少欄位時預設為 `false`，不改變排序、拖曳順序或備份篩選狀態。
- 設定改為桌面右側抽屜、窄視窗全螢幕 sheet，分為一般、顯示、整理、備份、快捷鍵與診斷；維持變更即自動儲存。Tags 改為獨立管理抽屜。
- 新增 `SAVE_TAB_FROM_CONTENT`、`SAVE_ACTIVE_TAB` 與 `UPDATE_ITEM.pinned` 路由，補上 Overlay／Standalone 防誤存與受限 URL 回報。
- 更新 README、文件、整合測試與 clean ZIP 打包流程。

## 2.14.0 — 2026-08-05

- New Tab 直接顯示 TabWall；一般網頁維持 overlay。
- Chrome 受限頁面無法注入時，改開啟或聚焦獨立 TabWall 分頁。
- 移除影片背景與使用者匯入影片範圍，維持現有靜態主題。

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
| `docs/privacy.md` | 公開隱私政策 |
| `docs/CHANGELOG.md` | 本檔：開發歷程 |
| `scripts/pack.sh` | 產出 `dist/TabWall-<version>.zip` |
