---
layout: default
title: "Privacy Policy — TabWall"
permalink: /privacy.html
---

# Privacy Policy — TabWall

**Last updated:** 2026-09-01
**Product:** TabWall (Chrome / Chromium extension)  
**Contact:** Use the [GitHub repository issues](https://github.com/davislinyd/TabWall/issues).

## Summary

TabWall parks browser tabs and Tab Groups as a visual photo wall **on your device**.  
We do **not** operate a TabWall backend that receives your browsing data. Parked URLs, titles, notes, tags, and screenshots stay in **your browser’s local storage**.
Reminder schedules and notification text stay in your browser’s local storage and are used to deliver local browser notifications. If you configure optional Webhook profiles, the reminder context is also sent to the HTTP(S) endpoints you choose; those endpoints are not TabWall servers.
TabWall also checks the public GitHub latest-release API on install, browser startup, and then once every 24 hours. That unauthenticated request contains no parked URLs, titles, notes, tags, screenshots, or other saved tab data; GitHub may process normal request metadata such as an IP address under its own policies.

## Data the extension processes

When you use TabWall, it may process:

| Data | Purpose | Where stored |
|------|---------|----------------|
| Reminder mode, next trigger time, interval, and notification text | Schedule local browser notifications for cards | Local extension storage on your device |
| Tab / group URLs, titles, display titles, favicon URLs | Park and restore sessions | `chrome.storage.local` on your device |
| Notes and tags you enter | Search and organize parked items | `chrome.storage.local` |
| Live page notes and tags (without parking) | Annotate a full URL that is not parked | `chrome.storage.local` (`pageAnnotations`) |
| Page-drawing strokes, shape outlines, highlighter lines, and text boxes | Overlay notes that do not change the host page | IndexedDB on your device |
| Card lock status and optional password hashes | Card privacy (salted SHA-256 hash) | `chrome.storage.local` |
| Screenshots (thumbnails and full snapshots) and image-card files | Photo-wall preview | IndexedDB on your device |
| Custom wallpaper image (optional) | Canvas background | IndexedDB on your device |
| Extension settings (theme, wallpaper fit/blur/strength, sort, view, auto-backup preferences, etc.) | Preferences | `chrome.storage.local` |
| Auto-backup preferences (subfolder name, schedule) | Control local automatic backups under your download directory | `chrome.storage.local` |
| Latest GitHub release metadata (stable tag, version, Release URL, check time, and handled-release key) | Compare versions and show an in-app update link | `chrome.storage.local`; the request is sent to GitHub’s public API |
| Webhook profile names, URLs, headers, bodies, and reminder profile IDs | Send the reminder context to endpoints you explicitly select | Profile data in `chrome.storage.local`; request data is sent only to the configured endpoint |
| AI provider profiles, Bearer tokens, custom headers, selected models, and cached `/models` lists | Connect the Agent to OpenAI-compatible endpoints you configure | `chrome.storage.local` only; omitted from JSON, ZIP, and automatic backups |
| AI prompts, selected page context, tool schemas, and model responses | Analyze tabs when you enable the AI agent | Sent to the configured OpenAI-compatible endpoint (loopback HTTP or HTTPS). Conversation and page bodies are not persisted by TabWall |
| Optional rate-limit quota snapshot (Requests / Tokens / Reset) | Show the latest provider quota in the current AI panel | In-memory panel session only; taken from successful or `429` response headers; not stored |
| Optional bridge tool arguments and results | Reserved UI for a local bridge that is not implemented yet | Not sent; Bridge health, tools, and token flows are disabled |
| Optional AI bridge token | Reserved for a future bridge session | Not used; the Bridge block is disabled and does not store a token |
| Temporary in-memory state | Unlocked card session IDs, conflict UI, drag/stack, open panels | Memory only (cleared when the service worker or page unloads) |

The extension reads the **currently active tab** (and related group tabs when you park a Tab Group) to capture a screenshot and save metadata. It does this only when **you** trigger park / related actions or use a Chrome command assigned to TabWall.

## Data we do not collect

TabWall does **not**:

- Send parked tabs, screenshots, notes, or tags to TabWall servers (there are none for this product)
- Send AI prompts, page context, or local model responses to TabWall servers (there are none for this product)
- Sell or rent your data
- Use your parked content for advertising
- Require an account to use the extension
- Send reminder text, card metadata, or notification history to TabWall servers (there are none for this product)

The update check stores only the latest release metadata and local status. It does not download, install, or replace the extension, and it does not use Chrome system notifications. After you click the in-app version badge to open a Release page, that release is marked handled; downloading, installing, and reloading remain manual. GitHub’s own processing and retention rules apply to its API request metadata.

If you configure a Webhook profile, TabWall sends a fixed `POST` with the body and headers you entered to that profile’s HTTP(S) URL when a selected reminder fires or you press Test. The body can include reminder fields such as the title, URL, message, mode, time, and tags through the documented template variables. Requests omit cookies and use a 15-second timeout; the endpoint’s own retention and logging policy applies after delivery. Profile URLs, headers, and bodies stay local and are excluded from exported backups.

If you add a remote HTTPS AI provider, TabWall sends prompts and any approved tab context to that endpoint. Loopback endpoints stay on this device. Remote reads require confirmation unless that provider bypasses Agent confirmations; write tools still confirm unless bypass is enabled. TabWall does not call a billing or credit API; quota text comes only from OpenAI-compatible rate-limit headers.

The Bridge settings block is visible but disabled. TabWall does not currently send bridge tool arguments, health checks, or a bridge token.

## Permissions (why they are needed)

| Permission | Why |
|------------|-----|
| `notifications` | Display optional local browser notifications for reminders |
| `tabs`, `tabGroups` | Read tab/group info to park and restore; recreate Tab Groups on restore |
| `scripting` | Inject a lightweight script so the photo-wall overlay works on normal web pages |
| Host access (`<all_urls>` / broad site access) | Allow the overlay on general websites and capture the visible tab when you park (subject to browser limits on special pages such as `chrome://`) |
| `storage`, `unlimitedStorage` | Save many parked items and screenshot blobs locally |
| `alarms` | Schedule optional automatic local backups, card reminders, and the daily GitHub release check |
| `downloads` | Write optional automatic backups into a subfolder of your browser download directory; the absolute path is known after each download completes |

The default AI provider is local `llama.cpp` at `http://127.0.0.1:8080/v1`. Other providers must use loopback HTTP or HTTPS. Large page and tool context is trimmed before a request. Bearer tokens and custom headers stay in `chrome.storage.local` and are excluded from backups. The Bridge block is not implemented.

The alarms permission schedules both optional automatic backups and card reminders. Reminder notifications are delivered by the browser on this device.
It also schedules the daily public GitHub release check; the check uses release metadata only and does not read parked content.

## Local backups you export

If you use **export / import backup**, files are created or read **on your machine** at your request. TabWall does not upload those files. Protect exported backups as you would any file that may contain URLs and page images.

If you enable **auto backup**, TabWall queries Chrome Downloads history to identify its own backup files and deletes older TabWall backups according to your retention setting. It writes backup files into a **subfolder of your browser’s download directory** (name configurable in settings). Automatic backups are not uploaded to TabWall servers. You can change the subfolder name or disable auto backup at any time.

## Data retention and deletion

- Data remains until **you** delete parked items, clear extension data, or uninstall the extension.
- Uninstalling the extension removes its local extension storage (per browser behavior).
- You can delete individual items or restore/delete in bulk inside TabWall.

## Children

TabWall is a productivity tool for browser sessions. It is not directed at children under 13.

## Changes to this policy

We may update this policy when the extension’s data practices change. The “Last updated” date at the top will be revised. Continued use after an update means you accept the revised policy.

## Contact

For privacy questions about TabWall, contact the publisher through the [project’s public GitHub repository issues](https://github.com/davislinyd/TabWall/issues).

---

# 隱私權政策 — TabWall（中文摘要）

**最後更新日期：** 2026-09-01

TabWall 將分頁與 Tab Group 暫存為本機照片牆。  
提醒的模式、下一次觸發時間、間隔與通知文字也只保存在您的瀏覽器本機，用來排程本機通知。
**不會**把您的網址、備註、標籤、截圖或自訂背景上傳到 TabWall 自有伺服器（本產品不提供此類後端）。資料保存在**您的瀏覽器本機**（`chrome.storage` 與 IndexedDB）。
TabWall 會在安裝／瀏覽器啟動時，並於之後每 24 小時向公開 GitHub latest-release API 檢查穩定版 metadata。請求只含 release tag、版本與 Release URL 等必要資料，不會傳送已儲存的網址、標題、備註、標籤、截圖或其他分頁內容；GitHub 對一般 request metadata（例如 IP）依其政策處理。
若您設定 Webhook profile，提醒到期或按下 Test 時，提醒 context 會依您輸入的 body／headers 送到您指定的 HTTP／HTTPS endpoint；該 endpoint 不是 TabWall 伺服器，後續保存與日誌依對方政策處理。Profile 的 URL、headers、body 只保存在 `chrome.storage.local`，不會進入匯出的備份檔，request 也不帶 cookies。

僅在您操作（含 Chrome 快捷鍵命令）時讀取目前分頁／群組以截圖與儲存。
提醒通知由瀏覽器本機排程與發送；若啟用 Webhook，提醒內容只會另外送到您明確設定的 endpoint，不會送到 TabWall 伺服器。
您匯出的備份檔僅在本機產生；請自行妥善保管。  
若啟用**自動備份**，TabWall 會查詢 Chrome 的 Downloads history 以辨識自己建立的備份，並依您設定的保留數量刪除舊的 TabWall 備份；備份會寫入瀏覽器**下載目錄**下您指定的子資料夾，不會上傳。
解除安裝或清除擴充功能資料後，依瀏覽器機制刪除本機資料（已寫出的備份檔仍留在下載目錄，需自行刪除）。

若啟用 AI，提示、選取的分頁 context、工具 schema 與模型回覆會送到你設定的 OpenAI-compatible endpoint。預設是本機 `llama.cpp`；遠端 HTTPS 讀取 TabWall 資料前會確認，除非該 Provider 啟用略過確認。Provider profiles、Bearer token 與自訂 headers 只存在 `chrome.storage.local`，不進入備份。對話、頁面正文與 quota 快照不會由 TabWall 持久化。Bridge 區塊可見但尚未實作，不會發送 health、tools 或 token。

更新提示只在 TabWall Canvas rail 的版本 badge 顯示，不使用系統 Chrome notification，也不會自動下載、安裝或替換擴充功能。點擊 badge 開啟 GitHub Release 頁面成功後，該 release 會標記為已處理；下載、安裝與重新載入仍需手動完成。更新檢查狀態不會進入備份檔。

權限用途：分頁／群組讀寫與還原、在一般網頁注入照片牆浮層、本機大量儲存截圖、可選的下載目錄自動備份。
隱私疑問請透過[專案公開儲存庫 Issues](https://github.com/davislinyd/TabWall/issues) 聯絡發行者。
