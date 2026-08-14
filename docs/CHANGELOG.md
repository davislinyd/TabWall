---
layout: default
title: "TabWall Changelog"
permalink: /CHANGELOG.html
---

# 開發歷程 / Changelog

版本語意（patch / minor / major）見根目錄 **`AGENTS.md`**。  
**目前版本以 `manifest.json` 的 `version` 為準。**

分享安裝請用 `./scripts/pack.sh` 產出的 clean zip（`dist/TabWall-<version>.zip`），勿整包 git 目錄。

## 2.40.2 — 2026-08-15

- 修正 Canvas 搜尋暫態視角造成的重複重繪、forced reflow 與非必要布局同步。

## 2.40.1 — 2026-08-15

- Canvas 與卡片網格的 hover 卡片放大約 1.30 倍；拖曳、Stack hover、Quiet 與 reduced-motion 優先規則維持不變。
- GitHub Pages 使用者手冊同步說明新的卡片 hover 與 Canvas 搜尋視角行為。

## 2.40.0 — 2026-08-15

- Canvas 搜尋結果與直接關聯卡片會暫時重排、置中並自動調整視角；結果多時依寬高 fitting，結果少時放大但受 1.8 倍上限限制。
- 搜尋預覽位置不寫入永久布局；清除搜尋、離開 Canvas 或 fallback 時還原搜尋前視角。

## 2.39.0 — 2026-08-14

- 卡片提醒：頂層分頁、Tab Group、圖片卡與 Sticker Note 可各自設定一次性或 Interval 提醒；可指定本機日期時間、分鐘／小時／天間隔與通知文字。空白文字會使用卡片標題。
- 使用 chrome.alarms 排程與 browser notification 發送；一次性提醒成功發送後自動清除，Interval 會依實際發送時間重排下一次提醒。通知點擊會開啟或聚焦 TabWall 並定位卡片。
- Header 新增提醒查詢面板，依下一次觸發時間列出所有有效提醒；卡片、列表列與 Canvas 節點新增提醒操作與狀態標記。群組成員不支援提醒。
- 搜尋新增 nn／noti + Tab 的 Reminder scope；空查詢列出所有有效提醒，文字比對提醒內容、卡片標題與 URL；n／note 維持 Note scope。
- 提醒欄位納入 lite JSON 與 full ZIP 備份。Stack 若選取超過一個提醒會阻止操作；只有一個時轉移至新的 Stack 卡片。
- Manifest 新增 notifications permission；提醒儲存失敗或通知 API 失敗時保留資料並記錄錯誤。

## 2.38.1 — 2026-08-14

- 說明面板新增 GitHub repository 與 GitHub Pages 使用說明連結。
- 修正 Tag 管理面板的名稱、數量與操作欄位對齊。

## 2.38.0 — 2026-08-14

- **卡片上鎖（可選密碼）**：支援分頁卡、Tab Group、圖片卡、Sticker Note 與 Group 成員獨立上鎖；上鎖後自動隱藏縮圖、快照與圖片附件，還原分頁與備註編輯不受阻。解鎖只存於記憶體 session，關閉分頁自動重新上鎖。支援免密碼點擊解鎖或 SHA-256 加鹽密碼保護。
- **自訂顯示標題（Display Title）**：編輯盒可自訂卡片名稱，主標題顯示自訂標題，下方保留小字顯示原始標題；搜尋引擎與 Option+/ 全域搜尋同時支援搜尋顯示標題與原始標題。
- **網頁浮層與啟動修正**：補齊 Manifest `web_accessible_resources` 白名單，修復在一般網頁按下 Option+O 浮層載入問題，並增強頁面載入鏈容錯。

## 2.37.2 — 2026-08-14

- 應用內說明新增「硬碟用量」：中繼資料在 `chrome.storage`、截圖／附件／背景在 IndexedDB；自動備份在下載目錄、不算擴充儲存。可用 `chrome://settings/content/all` 或 `navigator.storage.estimate().usage` 查看。

## 2.37.1 — 2026-08-13

- 修正未排程的自動備份：開新分頁只在間隔已到期才補跑；更新設定不會清掉上次成功時間。

## 2.37.0 — 2026-08-13

- 複選可批次附加 note／tags，不覆蓋既有內容。
- 搜尋預覽中可對命中卡片做連線操作。

## 2.36.1 — 2026-08-13

- 圖片卡以 contain 填滿節點；預設縮放顯示完整快照。

## 2.36.0 — 2026-08-13

- 新增圖片卡：上傳、貼上或拖放 JPEG／PNG／WEBP／GIF／SVG／HEIC，壓縮為縮圖與快照。

## 2.35.1 — 2026-08-13

- 預設視野可放下 6 張卡片；排列間距改 128px；群組卡片加上色條與淡色。

## 2.35.0 — 2026-08-13

- 畫布內 `⌘Z`／`Ctrl+Z` 可復原誤 Stack 與誤連線（新增、改端點、曲線、刪線）；`⌘⇧Z`／`Ctrl+⇧Z`／`Ctrl+Y` 重做。
- 最多記住 20 步，僅限本次開啟 TabWall；輸入框內不攔截。刪除、編輯、匯入等未納入 undo 的項目變更會清空這段歷史。
- 還原 Stack 時縮圖仍在；其他卡片後來的移動會保留。

## 2.34.0 — 2026-08-13

- 設定 → 顯示可上傳自訂靜態背景：置中／符合寬度／符合高度／原始大小；模糊 0–32px（預設 16）、濃度 15–70%（預設 40）。圖片經 note 附件同一套壓縮，存在 IndexedDB；不支援影片。
- 完整 ZIP 備份含背景圖；精簡 JSON 只保留背景設定。覆蓋還原會套用背景，附加匯入不會覆寫現有背景。
- 網頁浮層改為佔視窗 98%，其餘 2% 為原頁模糊框。

## 2.33.2 — 2026-08-13

- Option+/ 快速搜尋改為分割預覽，並支援 tag／group／note／domain 欄位範圍。

## 2.33.0 — 2026-08-13

- 卡片改新聞紙風格；新增 Option+/ 全域快速搜尋；應用內說明改居中。

## 2.32.0 — 2026-08-13

- 群組卡片可展開成員；設定新增視覺效果等級（安靜／標準／電影感）。

## 2.29.0 — 2026-08-12

- 搜尋新增 domain scope：`d`／`domain` + Tab，只比對分頁與群組成員的 hostname；獨立 Sticker Note 不參與。

## 2.28.0 — 2026-08-12

- 畫布空白處與卡片右鍵自訂選單：空白處可排序／對齊／精簡備份／新增 Note；卡片動作與左鍵工具列一致。

## 2.26.0 — 2026-08-10

- Canvas 排序／排列移至 top bar 的「畫布整理」面板；手動新增卡片移至常駐的「新增卡片」面板，設定面板不再承載這些操作。
- Canvas 的 `−／＋` 與縮放滑桿改以畫面中心縮放；滾輪仍以游標位置為錨點。

---

## 2.25.4 — 2026-08-10

- 修正新儲存分頁落在畫布固定原點、遠離既有卡片的問題；新項目會靠近既有卡片群配置到下一個不重疊格位。

## 2.25.3 — 2026-08-10

- 修正完整 ZIP 備份遇到既有 `file:` URL 時誤報 `invalid_url`；合法 stored-only URL 會保留並可重新匯入。

## 2.25.2 — 2026-08-10

- 修正新儲存分頁缺少 Canvas 座標時重疊在既有卡片上的問題；新項目會配置到下一個不重疊格位。
- Canvas 版本號移至左側 rail 底部，避免遮住索引資訊。

## 2.25.1 — 2026-08-10

- 目前分頁若已保存於 TabWall 的獨立項目或 Group 成員，extension icon 右下角顯示綠色勾勾 badge。

## 2.25.0 — 2026-08-10

- 新增可在設定中管理的自動 Note／Tag 儲存規則；支援 domain／FQDN、page title、match／contains／starts with／ends with／regex、not，以及每條規則的 AND／OR。
- 儲存 Tab Group 時會逐一判斷成員；命中後 note 逐行附加去重、tag 合併去重，並同步 tag catalog。

## 2.24.1 — 2026-08-10

- 修正 Chrome `commands` 超過最多 4 個導致 extension 無法 reload 的問題。
- keep 快捷鍵合併為 `Alt+Shift+S`，依目前分頁是否屬於 Tab Group 自動儲存分頁或整組，且不關閉。

---

## 2.24.0 — 2026-08-10

- 新增 Chrome 層級 keep 快捷鍵；Popup 仍保留分頁與 Tab Group 的分開操作按鈕。
- TabWall 設定中的 Chrome 快捷鍵清單同步顯示 keep command。

---

## 2.23.0 — 2026-08-10

- extension icon 改為操作選單，可分別選擇儲存目前分頁／Tab Group 並保留或關閉分頁。
- 非 Tab Group 分頁會停用 Group 操作；新增「打開 TabWall 面板」並保留既有 Chrome 快捷鍵行為。

---

## 2.22.0 — 2026-08-10

- Canvas 搜尋結果改以暫時棋盤排列；直接命中與一層關聯卡片會同步更新連線與 minimap，清空搜尋後恢復原本布局。
- 搜尋期間的卡片拖曳、方向鍵移動與棋盤／對齊排列只作用於搜尋預覽，不保存位置，也不會因拖放建立 Stack。

---

## 2.21.4 — 2026-08-09

- 將 Canvas 同步狀態移至縮放面板左側外部，避免「未同步」等文字改變縮放控制列的尺寸與位置。

---

## 2.21.3 — 2026-08-09

- 移除選取 Canvas 線段時畫布四周的焦點紅框。
- 點擊空白畫布或其他卡片時可取消線段選取；Escape 取消行為維持不變。

---

## 2.21.2 — 2026-08-09

- 修正 Canvas 線段單擊放開後無法保持選取的問題；拖曳重連、曲線調整與雙擊重設維持不變。
- Select 工具整合空白畫布平移，移除重複的 Pan 工具；框選、連結與 Sticker Note 工具保留。
- 縮放滑桿會在滑鼠離開整個控制區後自動隱藏，並維持 hover bridge、垂直方向與水平置中。
- Canvas 版本號改置於左側 rail 右方，避免遮住群組索引。

---

## 2.21.1 — 2026-08-09

- 空白 Canvas 左鍵雙擊會在框選與平移工具間切換，保留卡片雙擊還原與連線雙擊重設。
- 縮放滑桿的透明 hover bridge 擴大為連續控制區，並將垂直滑桿水平置中。
- 選取 Canvas 線段後可由 context bar 或 `Delete`／`Backspace` 刪除，並同步保存連線狀態。

---

## 2.21.0 — 2026-08-09

- 空白 Canvas 左鍵雙擊可直接切換至框選工具；卡片雙擊還原與連線雙擊重設維持不變。
- Canvas 縮放滑桿改為垂直面板，並補上 hover bridge，避免滑鼠慢速移入時面板消失。
- 重設視角維持 100% 縮放，改為將所有頂層卡片的水平／垂直 bounds 中心置於畫面中心。

---

## 2.20.1 — 2026-08-09

- Sticker Note 新上傳與完整 backup 匯入會先正規化圖片：長邊最多 4096px、總像素最多 16MP，原始檔與儲存檔各最多 24 MiB；統一輸出 WebP，必要時退回 PNG，GIF／SVG 轉為靜態圖片。
- 附件容量上限為單一 note 96 MiB、全 extension 512 MiB；超限會拒絕操作並回傳目前使用量，既有附件不自動重編碼或遷移。
- Canvas note 圖片改為 lazy load，附件 Object URL 使用最多 8 項 LRU 快取並在刪除、更新、匯入與重新載入時清理。
- Full ZIP 匯入採整批正規化與驗證；full backup 預估超過 256 MiB 時提示改用 Lite 或分批匯出。Lite backup 仍保留文字與附件 metadata，不含圖片二進位。

---

## 2.20.0 — 2026-08-09

- 新增 Canvas Sticker Note：支援標題、tags、群組分組、安全 Markdown 原文／預覽，以及檔案、剪貼簿與拖曳插入的本機圖片附件。
- Note 圖片以 IndexedDB 媒體鍵保存，限制最多 12 張、單檔 24 MiB；note 可加入混合 Stack，但不會還原成瀏覽器分頁。
- 搜尋、列表、tag catalog、Canvas 成員、lite JSON 與 full ZIP 備份均納入 note；backup format version 升至 5，加入 note／附件驗證與 Markdown XSS 防護。

## 2.19.5 — 2026-08-09

- Canvas 縮放比例欄位 hover 或 focus 時顯示原生 range slider；點擊百分比可使用 Fit to width、Fit to screen 與 Reset，並依目前可見卡片計算視角。

## 2.19.4 — 2026-08-09

- Canvas zoom 改用內層 CSS layout zoom，外層只負責平移；卡片、文字、favicon、SVG 圖示與操作按鈕不再因放大合成層而模糊，快照仍受原始解析度限制。

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
