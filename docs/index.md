---
layout: default
title: TabWall
permalink: /
---

# TabWall

## English

[中文](#中文)

TabWall is a Manifest V3 Chromium extension that parks tabs and Tab Groups as a visual photo wall. Data stays on the device.

**Current version:** [manifest.json](https://github.com/davislinyd/TabWall/blob/main/manifest.json)

**Release history:** [CHANGELOG](CHANGELOG.html)

**Privacy policy:** [privacy policy](privacy.html)

**License:** [MIT License](https://github.com/davislinyd/TabWall/blob/main/LICENSE)

### Architecture

- Metadata such as URLs, titles, notes, tags, and order is stored in `chrome.storage.local`.
- Thumbnails and full snapshots are stored as `IndexedDB` blobs.
- Opening the wall loads metadata first; thumbnails load lazily inside the wall frame.
- The first launch migrates legacy inline `Base64` media into `IndexedDB`.
- Group covers use a fixed `16:10` ratio so large images do not stretch cards.

### Shortcuts

Chrome command defaults are declared in `manifest.json` and managed in `chrome://extensions/shortcuts`.

| Shortcut | Action |
|----------|--------|
| `Option/Alt+S` | Park the current tab |
| `Option/Alt+Shift+G` | Park the current Tab Group |
| `Option/Alt+O` | Toggle the TabWall photo wall |
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

The first three actions are Chrome commands. Their `suggested_key` values provide install-time defaults. Existing Chrome assignments, shortcut conflicts, and platform rules can leave a command unbound. Manage the commands in Chrome shortcut settings; TabWall only displays the current bindings and opens the settings page.

The other shortcuts are built-in wall-navigation behavior and cannot be customized in TabWall.

After an extension reload or update, reopen or refresh existing tabs when a page still has an older injected overlay.

### Card interaction

| Action | Result |
|--------|--------|
| Click a thumbnail | Restore a tab or group; groups ask for confirmation first |
| Click a title or metadata area | Copy the saved URL or the member URLs |
| Drag from a thumbnail | Reorder cards |
| Drag onto another card's title or metadata area | Stack the cards into a group |
| Restore a stack or group | Recreate a Chrome Tab Group |

List view supports copying from titles and URLs. Card dragging and stacking are available in card view.

### Search

- Plain search: `grafana zabbix` means AND; `grafana||zabbix` means OR.
- Regular expressions: use the `.*` toolbar control or `re` / `regex` followed by Tab.
- Field scope: use `tag`, `note`, or `group` followed by Tab.
- When a group matches, the card lists the member tabs that matched.
- Search input is debounced, and thumbnails load near the visible area.

### Features

- **New Tab and restricted pages:** New Tab opens TabWall directly; browser-restricted pages use a standalone TabWall tab when an overlay cannot be injected.
- **Static themes:** Backgrounds use static themes; video backgrounds and user-imported videos are not supported.
- Park and restore groups, with member notes and tags.
- Multi-selection and batch operations.
- **Stack:** merge cards by dropping one card onto another card's title area.
- Floating settings, tag, and help panels; click outside to close them.
- **Backup export:** lite JSON without images or a full ZIP with binary media. Filenames use local time and the UTC offset, for example `2026-08-04T13-00-00+0800`.
- **Multi-selection export:** export only selected cards as lite JSON or full ZIP.
- **Restore modes:** replace or append. After selecting a backup, choose which tabs and groups to write; full ZIP previews show images, while lite previews show text and members.
- **Manual add:** paste one URL per line. Wrap URLs between `#GROUP:Name` markers to create a group.
- **Group restore:** ask for confirmation before restoring a complete group.
- **Metadata continuity:** notes and tags are retained when a restored tab or group is saved again in the same browser session.
- **Automatic backup:** write under Chrome's configured download directory, in a configurable subfolder. Backups can run on a schedule or after data changes, and 1–99 copies can be retained.
- **Deduplication:** when an exact URL already exists, choose whether to keep both, replace the old item, or cancel. The toolbar can scan for duplicates.
- **Diagnostic log:** inspect, copy, or clear export, import, and automatic-backup events from Settings.

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
- See [CHANGELOG](CHANGELOG.html) for release notes.

### Files

```text
manifest.json   background.js   mediaDb.js   backupBuild.js
content.js      park.html       park.js
icons/          scripts/pack.sh
AGENTS.md       README.md
docs/privacy.md docs/CHANGELOG.md
```

## 中文

[English](#english)

TabWall 是一個 Manifest V3 Chromium 擴充功能，可將分頁與 Tab Group 暫存為照片牆，資料留在本機裝置。

**目前版本：** [manifest.json](https://github.com/davislinyd/TabWall/blob/main/manifest.json)

**開發歷程：** [CHANGELOG](CHANGELOG.html)

**隱私政策：** [隱私政策](privacy.html)

**授權：** [MIT License](https://github.com/davislinyd/TabWall/blob/main/LICENSE)

### 架構

- 網址、標題、備註、標籤與排序等中繼資料儲存在 `chrome.storage.local`。
- 縮圖與完整快照以 `IndexedDB` 二進位資料儲存。
- 開啟照片牆時先載入中繼資料，縮圖再於照片牆框架中延遲載入。
- 第一次啟動時，會將舊版的內嵌 `Base64` 媒體遷移至 `IndexedDB`。
- 群組封面固定使用 `16:10` 比例，避免大圖拉伸卡片。

### 快捷鍵

Chrome 快捷鍵預設值宣告於 `manifest.json`，並在 `chrome://extensions/shortcuts` 管理。

| 快捷鍵 | 動作 |
|--------|------|
| `Option/Alt+S` | 暫存目前分頁 |
| `Option/Alt+Shift+G` | 暫存目前 Tab Group |
| `Option/Alt+O` | 開關 TabWall 照片牆 |
| `/` | 聚焦搜尋框 |
| Mac 使用 `⌥⌘S`／Windows 使用 `Alt+Win+S` | 開啟或關閉照片牆設定 |
| 一般搜尋 | `||` 表示或；空格與 `&&` 表示且 |
| `t` 或 `tag` 加 Tab | 只搜尋標籤 |
| `n` 或 `note` 加 Tab | 只搜尋備註 |
| `g` 或 `group` 加 Tab | 只搜尋群組 |
| `re` 或 `regex` 加 Tab | 啟用正規表示式搜尋 |
| `all` 加 Tab | 重設搜尋欄位範圍 |
| 空白搜尋加 Backspace、Delete 或 Esc | 離開標籤、備註、群組或正規表示式模式 |
| 工具列中的 `.*` | 開關正規表示式搜尋，支援 `/pattern/flags` |
| `Esc` | 關閉面板或照片牆 |
| `←`／`→` | 顯示上一張或下一張快照 |

前三項是 Chrome commands。其 `suggested_key` 只提供安裝時的預設值；既有 Chrome 設定、快捷鍵衝突與平台規則都可能使命令保持未綁定。請在 Chrome 快捷鍵設定頁管理，TabWall 只顯示目前綁定並提供開啟設定頁的按鈕。

其餘快捷鍵是照片牆內建的操作，不可在 TabWall 中自訂。

擴充功能重新載入或更新後，若頁面仍保留舊版浮層，請重新開啟或重新整理該分頁。

### 卡片操作

| 操作 | 結果 |
|------|------|
| 點擊縮圖 | 還原分頁或群組；群組會先要求確認 |
| 點擊標題或中繼資料區 | 複製已儲存網址或群組成員網址 |
| 從縮圖拖曳 | 重新排列卡片 |
| 拖到另一張卡片的標題或中繼資料區 | 將卡片堆疊成群組 |
| 還原堆疊或群組 | 重新建立 Chrome Tab Group |

列表檢視支援從標題與網址複製內容；卡片拖曳與堆疊只在卡片檢視提供。

### 搜尋

- 一般搜尋：`grafana zabbix` 表示且；`grafana||zabbix` 表示或。
- 正規表示式：使用工具列的 `.*` 控制項，或輸入 `re`／`regex` 後按 Tab。
- 欄位範圍：輸入 `tag`、`note` 或 `group` 後按 Tab。
- 群組命中時，卡片會列出符合條件的成員分頁。
- 搜尋輸入採用延遲處理，縮圖會在接近可視範圍時載入。

### 功能

- **New Tab 與受限頁面：** New Tab 直接顯示 TabWall；瀏覽器受限頁面無法注入浮層時，會改開啟或聚焦獨立 TabWall 分頁。
- **靜態主題：** 背景使用靜態主題，不支援影片背景或使用者匯入影片。
- 暫存與還原群組，支援成員備註與標籤。
- 多選與批次操作。
- **堆疊：** 將一張卡片拖到另一張卡片的標題區即可合併。
- 設定、標籤與說明使用浮動面板；點擊外部即可關閉。
- **備份匯出：** 可匯出不含圖片的精簡 JSON，或包含二進位媒體的完整 ZIP；檔名使用本機時間與 UTC 時差，例如 `2026-08-04T13-00-00+0800`。
- **多選匯出：** 只匯出選取的卡片，可選精簡 JSON 或完整 ZIP。
- **還原模式：** 支援覆蓋或附加；選取備份後可決定要寫入哪些分頁與群組，完整 ZIP 可預覽圖片，精簡備份可預覽文字與成員。
- **手動新增：** 每行貼上一個網址；以 `#GROUP:Name` 標記包住網址即可建立群組。
- **群組還原：** 還原完整群組前會要求確認。
- **中繼資料延續：** 還原分頁或群組後，在同一瀏覽器工作階段再次儲存時，會保留原本的備註與標籤。
- **自動備份：** 寫入 Chrome 設定的下載目錄下之指定子資料夾，可依排程或資料變更後執行，並保留 1–99 份備份。
- **重複項目處理：** 完整網址重複時，可選擇全部保留、取代舊項目或取消；工具列可掃描重複項目。
- **診斷日誌：** 可在設定中查看、複製或清除匯出、匯入與自動備份事件。

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
- 只修改 `park.html` 或 `park.js` 也需要重新載入擴充功能，或重新開啟照片牆。
- 版本與打包規則請遵循 `AGENTS.md`。
- 發布說明請查看 [CHANGELOG](CHANGELOG.html)。

### 檔案

```text
manifest.json   background.js   mediaDb.js   backupBuild.js
content.js      park.html       park.js
icons/          scripts/pack.sh
AGENTS.md       README.md
docs/privacy.md docs/CHANGELOG.md
```
