# TabWall

## English

[中文](#中文)

TabWall is a Manifest V3 Chromium extension that parks tabs and Tab Groups on a spatial canvas. Data stays on the device.

**Current version:** See `manifest.json`.

**Release history:** [docs/CHANGELOG.md](docs/CHANGELOG.md)

**Privacy policy:** [docs/privacy.md](docs/privacy.md)

**License:** [MIT License](LICENSE)

### Architecture

- Metadata such as URLs, titles, notes, tags, and order is stored in `chrome.storage.local`.
- Thumbnails and full snapshots are stored as `IndexedDB` blobs.
- Opening the wall loads metadata first; thumbnails load lazily inside the wall frame.
- The first launch migrates legacy inline `Base64` media into `IndexedDB`.
- Canvas nodes use a fixed `16:10` preview ratio; positions and viewport are stored separately from item metadata.

### Shortcuts

Chrome command defaults are declared in `manifest.json` and managed in `chrome://extensions/shortcuts`.

| Shortcut | Action |
|----------|--------|
| `Option/Alt+S` | Park the current tab (uses the configured after-save behavior) |
| `Option/Alt+Shift+S` | Park the current tab or Tab Group and keep it open |
| `Option/Alt+Shift+G` | Park the current Tab Group (uses the configured after-save behavior) |
| `Option/Alt+O` | Toggle the TabWall canvas |
| `/` | Focus search |
| `⌥⌘S` on Mac / `Alt+Win+S` on Windows | Open or close settings in the wall |
| Plain search | `||` means OR; spaces and `&&` mean AND |
| `t` or `tag` + Tab | Search tags only |
| `n` or `note` + Tab | Search notes only |
| `g` or `group` + Tab | Search groups only |
| `re` or `regex` + Tab | Enable regular-expression search |
| `all` + Tab | Reset the search field scope |
| Empty search + Backspace, Delete, or Esc | Leave tag, note, group, or regular-expression mode |
| `.*` in the toolbar | Toggle regular-expression search; `/pattern/flags` is supported |
| `Esc` | Close panels or the TabWall wall |
| `←` / `→` | Show the previous or next snapshot |

The first four actions are Chrome commands. Their `suggested_key` values provide install-time defaults. Existing Chrome assignments, shortcut conflicts, and platform rules can leave a command unbound. Manage the commands in Chrome shortcut settings; TabWall only displays the current bindings and opens the settings page.

Clicking the extension icon opens an action menu for saving the current tab or Tab Group with or without closing it, or opening the TabWall panel. Group actions are disabled when the current tab is not in a Tab Group.

The other shortcuts are built-in wall-navigation behavior and cannot be customized in TabWall.

After an extension reload or update, reopen or refresh existing tabs when a page still has an older injected overlay.

### Canvas interaction

| Action | Result |
|--------|--------|
| Sticker Note tool / empty canvas click | Create a Canvas-only note and open the split editor |
| Click a thumbnail | Restore a tab or group; groups ask for confirmation first |
| Click a note title or Edit | Edit title, tags, safe Markdown, and local image attachments |
| Click a title or metadata area | Copy the saved URL or the member URLs |
| Click the pin control | Pin or unpin the top-level item; use the toolbar filter to show pinned items |
| Select a node | Show the contextual actions; hold `Shift` / `Control` for multi-select |
| Drag a node | Move it on the canvas; positions are saved automatically |
| Drag one node onto another | Stack the items into a group |
| Select tool / drag on empty canvas | Select and move nodes, or move the canvas; wheel controls zoom |
| Frame-select tool | Select nodes in a rectangular area |
| Drag the minimap viewport frame | Pan the current canvas view; release commits one pan operation |
| Link tool | Hover a node to reveal four `+` handles, then drag from any side; connections snap to the nearest side handle, and clicking two nodes or groups remains available as a fallback |
| Drag a connection line | The first and last thirds reconnect an endpoint; the middle third bends or lengthens the curve. The line uses a 16px near-hit area, and double-click resets its custom curve |
| Restore a stack or group | Recreate its tabs as a Chrome Tab Group; notes remain Canvas-only |

List view remains available as a dense and accessible fallback; canvas layout is independent from list ordering.

### Search

- Plain search: `grafana zabbix` means AND; `grafana||zabbix` means OR.
- Regular expressions: use the `.*` toolbar control or `re` / `regex` followed by Tab.
- Field scope: use `tag`, `note`, or `group` followed by Tab.
- When a group matches, the card lists matching member tabs and notes.
- When a search hit has a direct Canvas connection, the connected card is also shown one level deep with reduced opacity; hover or focus restores its full appearance.
- Search input is debounced, and thumbnails load near the visible area.

### Features

- **New Tab and restricted pages:** New Tab opens TabWall directly; browser-restricted pages use a standalone TabWall tab when an overlay cannot be injected.
- **Static themes:** Backgrounds use static themes; video backgrounds and user-imported videos are not supported.
- Park and restore groups, with member notes and tags.
- **Sticker Notes:** create Canvas-only notes with title, tags, safe Markdown preview, and up to 12 local image attachments. New images are normalized to WebP (PNG fallback), capped at 4096px on the long edge, 16MP, and 24 MiB per source/output file; GIF and SVG become static images. Notes can join Stacks but are never restored as browser tabs.
- Multi-selection and batch operations.
- **Spatial Canvas:** arrange nodes freely with pan, zoom, lasso selection, snap-to-grid, minimap viewport dragging, persistent undirected connections, four-sided connection handles, and three-zone line editing with saved curve offsets. At 100%, cards render 10% larger while stored positions remain compatible.
- **Canvas settings:** sort by date, FQDN, or Group; arrange with Grid or Aligned Rows using a 96px card gap while preserving stored node sizes.
- **Stack:** select two or more items or drop one node onto another to create a Stack; tab members restore as a Chrome Tab Group while note members remain on the Canvas.
- New installations default to the dark Editorial Workbench; Light/Dark preferences remain available, and existing explicit theme and list preferences are preserved while legacy `cards` preferences migrate to `canvas`.
- Quick Add saves the current tab or Group from the overlay, or opens URL paste on New Tab/standalone surfaces.
- Top-level tabs and groups can be pinned; the pinned-only filter does not change manual order or backup state.
- Settings, Tags, edit, import and diagnostic panels use centered dialogs; changes save automatically.
- **Backup export:** lite JSON keeps note text, tags, and attachment metadata without image binaries; a full ZIP includes local note images. Full export is refused when its estimated ZIP exceeds 256 MiB. Note attachments are capped at 96 MiB per note and 512 MiB across the extension. Existing attachments are not migrated automatically; the limits apply to new uploads and imports. Filenames use local time and the UTC offset, for example `2026-08-04T13-00-00+0800`.
- **Multi-selection export:** export only selected cards as lite JSON or full ZIP.
- **Restore modes:** replace or append. After selecting a backup, choose which tabs and groups to write; full ZIP previews show images, while lite previews show text and members.
- **Manual add:** paste one URL per line. Wrap URLs between `#GROUP:Name` markers to create a group.
- **Group restore:** ask for confirmation before restoring a complete group; note members remain in the Canvas-only group.
- **Metadata continuity:** notes and tags are retained when a restored tab or group is saved again in the same browser session.
- **Automatic backup:** write under Chrome's configured download directory, in a configurable subfolder. Backups can run on a schedule or after data changes, and 1–99 copies can be retained.
- **Deduplication:** when an exact URL already exists, choose whether to keep both, replace the old item, or cancel. The toolbar can scan for duplicates.
- **Diagnostic log:** inspect, copy, or clear export, import, and automatic-backup events from Settings.
- **Desktop workbench:** the interface uses a fixed 1200px desktop layout. Narrow windows keep the full desktop geometry and expose horizontal scrolling; there is no mobile reflow or touch toolbar.

### Installation

#### From this repository

1. Open `chrome://extensions` and enable Developer mode.
2. Choose Load unpacked and select this folder.
3. After code changes, use Chrome's Reload action for the extension.
4. If a command is unbound or conflicts with another command, open `chrome://extensions/shortcuts` and assign a different combination.

#### Sharing with others

1. Build a clean ZIP with `./scripts/pack.sh`; the output is `dist/TabWall-<version>.zip`.
2. Share only the ZIP, not the Git repository.
3. The recipient should unzip it, enable Developer mode, choose Load unpacked, and select the unzipped folder.
4. Rebuild the ZIP after every behavior or resource change. See `AGENTS.md` for the packaging rules.

### Development

- Use Chrome's native Reload action after a coherent set of edits.
- UI-only changes to `park.html` or `park.js` still require an extension reload or reopening the wall.
- Follow the versioning and packaging rules in `AGENTS.md`.
- See [docs/CHANGELOG.md](docs/CHANGELOG.md) for release notes.

### Files

```text
manifest.json   background.js   mediaDb.js   noteMedia.js   backupBuild.js
content.js      park.html       park.js
icons/          scripts/pack.sh
AGENTS.md       README.md
docs/privacy.md docs/CHANGELOG.md
```

## 中文

[English](#english)

TabWall 是一個 Manifest V3 Chromium 擴充功能，可將分頁與 Tab Group 暫存到空間畫布，資料留在本機裝置。

**目前版本：** 請查看 `manifest.json`。

**開發歷程：** [docs/CHANGELOG.md](docs/CHANGELOG.md)

**隱私政策：** [docs/privacy.md](docs/privacy.md)

**授權：** [MIT License](LICENSE)

### 架構

- 網址、標題、備註、標籤與排序等中繼資料儲存在 `chrome.storage.local`。
- 縮圖與完整快照以 `IndexedDB` 二進位資料儲存。
- 開啟畫布時先載入中繼資料，縮圖再於節點中延遲載入。
- 第一次啟動時，會將舊版的內嵌 `Base64` 媒體遷移至 `IndexedDB`。
- 畫布節點預覽固定使用 `16:10` 比例；座標與視角獨立儲存。

### 快捷鍵

Chrome 快捷鍵預設值宣告於 `manifest.json`，並在 `chrome://extensions/shortcuts` 管理。

| 快捷鍵 | 動作 |
|--------|------|
| `Option/Alt+S` | 暫存目前分頁（依「儲存後行為」設定） |
| `Option/Alt+Shift+S` | 暫存目前分頁或目前 Tab Group 但不關閉 |
| `Option/Alt+Shift+G` | 暫存目前 Tab Group（依「儲存後行為」設定） |
| `Option/Alt+O` | 開關 TabWall 空間畫布 |
| `/` | 聚焦搜尋框 |
| Mac 使用 `⌥⌘S`／Windows 使用 `Alt+Win+S` | 開啟或關閉畫布設定 |
| 一般搜尋 | `||` 表示或；空格與 `&&` 表示且 |
| `t` 或 `tag` 加 Tab | 只搜尋標籤 |
| `n` 或 `note` 加 Tab | 只搜尋備註 |
| `g` 或 `group` 加 Tab | 只搜尋群組 |
| `re` 或 `regex` 加 Tab | 啟用正規表示式搜尋 |
| `all` 加 Tab | 重設搜尋欄位範圍 |
| 空白搜尋加 Backspace、Delete 或 Esc | 離開標籤、備註、群組或正規表示式模式 |
| 工具列中的 `.*` | 開關正規表示式搜尋，支援 `/pattern/flags` |
| `Esc` | 關閉面板或空間畫布 |
| `←`／`→` | 顯示上一張或下一張快照 |

前四項是 Chrome commands。其 `suggested_key` 只提供安裝時的預設值；既有 Chrome 設定、快捷鍵衝突與平台規則都可能使命令保持未綁定。請在 Chrome 快捷鍵設定頁管理，TabWall 只顯示目前綁定並提供開啟設定頁的按鈕。

點擊 extension icon 會開啟操作選單，可選擇儲存目前分頁或 Tab Group 並保留／關閉分頁，或打開 TabWall 面板。目前分頁不在 Tab Group 時，Group 操作會停用。

其餘快捷鍵是畫布內建的操作，不可在 TabWall 中自訂。

擴充功能重新載入或更新後，若頁面仍保留舊版浮層，請重新開啟或重新整理該分頁。

### 畫布操作

| 操作 | 結果 |
|------|------|
| Sticker Note 工具／點擊空白畫布 | 建立僅存在於 Canvas 的 note，並開啟左右分割編輯器 |
| 點擊縮圖 | 還原分頁或群組；群組會先要求確認 |
| 點擊 note 標題或編輯 | 編輯標題、標籤、安全 Markdown 與本機圖片附件 |
| 點擊標題或中繼資料區 | 複製已儲存網址或群組成員網址 |
| 點擊固定控制項 | 固定／取消固定頂層項目；可用工具列篩選已固定項目 |
| 選取節點 | 顯示上下文操作；按住 `Shift`／`Control` 可多選 |
| 拖曳節點 | 在畫布上移動；位置會自動儲存 |
| 將節點拖到另一節點 | 將項目堆疊成群組 |
| 使用平移／框選工具 | 平移畫布或框選多個節點 |
| 拖曳 minimap 視角框 | 平移目前畫布；放開後提交單次視角操作 |
| 連結工具 | 將滑鼠移到卡片即可顯示四側 `+` handle，從任一側拖曳；連線會貼齊相對方向的側邊 handle，也可點擊兩張卡片或群組建立無方向持久連線 |
| 拖曳連線線段 | 前／後三分之一可重接端點，中間三分之一可彎曲或拉長線段；線段提供 16px 近距離命中範圍，雙擊可重設自訂曲線 |
| 還原堆疊或群組 | 分頁成員重新建立 Chrome Tab Group；note 保留在僅限 Canvas 的群組 |

列表檢視仍保留作為大量資料與無障礙 fallback；畫布座標不會改變列表順序。

### 搜尋

- 一般搜尋：`grafana zabbix` 表示且；`grafana||zabbix` 表示或。
- 正規表示式：使用工具列的 `.*` 控制項，或輸入 `re`／`regex` 後按 Tab。
- 欄位範圍：輸入 `tag`、`note` 或 `group` 後按 Tab。
- 群組命中時，卡片會列出符合條件的成員分頁與 note。
- 搜尋命中卡片若有直接 Canvas 連線，會額外顯示一層關聯卡片；關聯卡片以低透明度呈現，hover 或 focus 時恢復完整樣式。
- 搜尋輸入採用延遲處理，縮圖會在接近可視範圍時載入。

### 功能

- **New Tab 與受限頁面：** New Tab 直接顯示 TabWall；瀏覽器受限頁面無法注入浮層時，會改開啟或聚焦獨立 TabWall 分頁。
- **靜態主題：** 背景使用靜態主題，不支援影片背景或使用者匯入影片。
- 暫存與還原群組，支援成員備註與標籤。
- **Sticker Note：** 建立僅限 Canvas 的 note，支援標題、標籤、安全 Markdown 預覽，以及最多 12 張本機圖片附件。新圖片會自動正規化為 WebP（不可用時退回 PNG），長邊上限 4096px、總像素 16MP，原始檔與儲存檔各不得超過 24 MiB；GIF／SVG 會靜態化。note 可加入 Stack，但不會還原成瀏覽器分頁。
- 多選與批次操作。
- **空間畫布：** 支援自由排列、平移、縮放、框選、吸附格線、可拖曳 minimap 視角、無方向的持久連線、卡片四側連線 handle，以及保存曲線偏移的三段式線段編輯；100% 時卡片視覺尺寸放大 10%，儲存位置格式不變。
- **畫布設定：** 可依日期、FQDN 或 Group 排序；排列提供棋盤與對齊格式，使用 96px 卡片間距並保留儲存的卡片尺寸。
- **堆疊：** 選取兩個以上項目建立 Stack，或將節點拖到另一節點合併；分頁成員可還原為 Chrome Tab Group，note 成員留在 Canvas。
- 新安裝預設深色畫布；既有明確主題與列表偏好會保留，舊 `cards` 偏好會遷移為 `canvas`。
- 快速新增可在 Overlay 儲存目前分頁或 Group；New Tab／獨立頁面仍可開啟貼上 URL。
- 頂層分頁與群組可固定；已固定篩選不改變手動排序，也不寫入備份的篩選狀態。
- 設定、標籤、編輯、匯入與診斷面板使用居中 dialog；變更會自動儲存。
- **備份匯出：** 精簡 JSON 保留 note 文字、標籤與附件 metadata，不含圖片二進位；完整 ZIP 會包含本機 note 圖片，預估超過 256 MiB 時會拒絕並提示改用精簡備份或分批匯出。附件容量上限為單一 note 96 MiB、全 extension 512 MiB；既有附件不會自動遷移，新上傳與匯入才套用圖片限制。檔名使用本機時間與 UTC 時差，例如 `2026-08-04T13-00-00+0800`。
- **多選匯出：** 只匯出選取的卡片，可選精簡 JSON 或完整 ZIP。
- **還原模式：** 支援覆蓋或附加；選取備份後可決定要寫入哪些分頁與群組，完整 ZIP 可預覽圖片，精簡備份可預覽文字與成員。
- **手動新增：** 每行貼上一個網址；以 `#GROUP:Name` 標記包住網址即可建立群組。
- **群組還原：** 還原完整群組前會要求確認；note 成員會保留在僅限 Canvas 的群組。
- **中繼資料延續：** 還原分頁或群組後，在同一瀏覽器工作階段再次儲存時，會保留原本的備註與標籤。
- **自動備份：** 寫入 Chrome 設定的下載目錄下之指定子資料夾，可依排程或資料變更後執行，並保留 1–99 份備份。
- **重複項目處理：** 完整網址重複時，可選擇全部保留、取代舊項目或取消；工具列可掃描重複項目。
- **診斷日誌：** 可在設定中查看、複製或清除匯出、匯入與自動備份事件。
- **桌面工作台：** 固定 1200px 桌面幾何；窄視窗保留完整版面並使用水平捲動，不重新排版為手機工具列。

### 安裝

#### 從此儲存庫安裝

1. 開啟 `chrome://extensions`，啟用開發人員模式。
2. 選擇「載入未封裝項目」，指定此資料夾。
3. 程式變更後，使用 Chrome 擴充功能卡片上的「重新載入」。
4. 若命令未綁定或與其他命令衝突，開啟 `chrome://extensions/shortcuts` 並指定其他組合鍵。

#### 分享給其他人

1. 執行 `./scripts/pack.sh` 建立乾淨 ZIP，輸出為 `dist/TabWall-<version>.zip`。
2. 只分享 ZIP，不要分享整個 Git 儲存庫。
3. 接收者解壓縮後啟用開發人員模式，選擇「載入未封裝項目」，指定解壓縮後的資料夾。
4. 每次行為或資源變更後都要重新建立 ZIP；打包規則請查看 `AGENTS.md`。

### 開發

- 完成一組相關修改後，使用 Chrome 的原生「重新載入」。
- 只修改 `park.html` 或 `park.js` 也需要重新載入擴充功能，或重新開啟畫布。
- 版本與打包規則請遵循 `AGENTS.md`。
- 發布說明請查看 [docs/CHANGELOG.md](docs/CHANGELOG.md)。

### 檔案

```text
manifest.json   background.js   mediaDb.js   noteMedia.js   backupBuild.js
content.js      popup.html      popup.js       park.html       park.js
icons/          scripts/pack.sh
AGENTS.md       README.md
docs/privacy.md docs/CHANGELOG.md
```
