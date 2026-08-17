---
layout: default
title: "Privacy Policy — TabWall"
permalink: /privacy.html
---

# Privacy Policy — TabWall

**Last updated:** 2026-08-17
**Product:** TabWall (Chrome / Chromium extension)  
**Contact:** Use the [GitHub repository issues](https://github.com/davislinyd/TabWall/issues).

## Summary

TabWall parks browser tabs and Tab Groups as a visual photo wall **on your device**.  
We do **not** operate a TabWall backend that receives your browsing data. Parked URLs, titles, notes, tags, and screenshots stay in **your browser’s local storage**.
Reminder schedules and notification text also stay in your browser’s local storage and are used only to deliver local browser notifications.

## Data the extension processes

When you use TabWall, it may process:

| Data | Purpose | Where stored |
|------|---------|----------------|
| Reminder mode, next trigger time, interval, and notification text | Schedule local browser notifications for cards | Local extension storage on your device |
| Tab / group URLs, titles, display titles, favicon URLs | Park and restore sessions | `chrome.storage.local` on your device |
| Notes and tags you enter | Search and organize parked items | `chrome.storage.local` |
| Live page notes and tags (without parking) | Annotate a full URL that is not parked | `chrome.storage.local` (`pageAnnotations`) |
| Page-drawing strokes, highlighter lines, and text boxes | Overlay notes that do not change the host page | IndexedDB on your device |
| Card lock status and optional password hashes | Card privacy (salted SHA-256 hash) | `chrome.storage.local` |
| Screenshots (thumbnails and full snapshots) and image-card files | Photo-wall preview | IndexedDB on your device |
| Custom wallpaper image (optional) | Canvas background | IndexedDB on your device |
| Extension settings (theme, wallpaper fit/blur/strength, sort, view, auto-backup preferences, etc.) | Preferences | `chrome.storage.local` |
| Auto-backup preferences (subfolder name, schedule) | Control local automatic backups under your download directory | `chrome.storage.local` |
| AI prompts, selected page context, tool schemas, and local model responses | Analyze tabs with a local `llama-server` when you enable the AI agent | Sent to the configured loopback endpoint; conversation and page bodies are not persisted by TabWall |
| Optional bridge tool arguments and results | Call tools you explicitly allow through a local bridge | Bridge memory / the third-party service selected by that bridge; external disclosure requires confirmation when page content may be included |
| Optional AI bridge token | Authenticate the current bridge session | In-memory panel session only; not stored in extension storage |
| Temporary in-memory state | Unlocked card session IDs, conflict UI, drag/stack, open panels | Memory only (cleared when the service worker or page unloads) |

The extension reads the **currently active tab** (and related group tabs when you park a Tab Group) to capture a screenshot and save metadata. It does this only when **you** trigger park / related actions or use a Chrome command assigned to TabWall.

## Data we do not collect

TabWall does **not**:

- Send parked tabs, screenshots, notes, or tags to TabWall servers (there are none for this product)
- Send AI prompts, page context, or local model responses to TabWall servers (there are none for this product)
- Sell or rent your data
- Use your parked content for advertising
- Require an account to use the extension
- Send reminder text, card metadata, or notification history to a server

If you configure the optional local bridge to call a third-party API, that bridge may send the arguments you approved to that service. TabWall does not accept arbitrary URLs, methods, or headers from the model; review the bridge registry and confirmation prompt before allowing a call.

## Permissions (why they are needed)

| Permission | Why |
|------------|-----|
| `notifications` | Display optional local browser notifications for reminders |
| `tabs`, `tabGroups` | Read tab/group info to park and restore; recreate Tab Groups on restore |
| `scripting` | Inject a lightweight script so the photo-wall overlay works on normal web pages |
| Host access (`<all_urls>` / broad site access) | Allow the overlay on general websites and capture the visible tab when you park (subject to browser limits on special pages such as `chrome://`) |
| `storage`, `unlimitedStorage` | Save many parked items and screenshot blobs locally |
| `alarms` | Schedule optional automatic local backups and card reminders |
| `downloads` | Write optional automatic backups into a subfolder of your browser download directory; the absolute path is known after each download completes |

The AI agent uses `http://127.0.0.1` / `http://localhost` endpoints only by default. The configured `contextSize` controls how much page and tool context is sent to the local model; large context is trimmed before a request. A bridge is optional and third-party API credentials are kept by the bridge rather than in TabWall.

The alarms permission schedules both optional automatic backups and card reminders. Reminder notifications are delivered by the browser on this device.

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

**最後更新日期：** 2026-08-16

TabWall 將分頁與 Tab Group 暫存為本機照片牆。  
提醒的模式、下一次觸發時間、間隔與通知文字也只保存在您的瀏覽器本機，用來排程本機通知。
**不會**把您的網址、備註、標籤、截圖或自訂背景上傳到 TabWall 自有伺服器（本產品不提供此類後端）。資料保存在**您的瀏覽器本機**（`chrome.storage` 與 IndexedDB）。

僅在您操作（含 Chrome 快捷鍵命令）時讀取目前分頁／群組以截圖與儲存。
提醒通知由瀏覽器本機排程與發送，不會把提醒內容傳到 TabWall 伺服器。
您匯出的備份檔僅在本機產生；請自行妥善保管。  
若啟用**自動備份**，TabWall 會查詢 Chrome 的 Downloads history 以辨識自己建立的備份，並依您設定的保留數量刪除舊的 TabWall 備份；備份會寫入瀏覽器**下載目錄**下您指定的子資料夾，不會上傳。
解除安裝或清除擴充功能資料後，依瀏覽器機制刪除本機資料（已寫出的備份檔仍留在下載目錄，需自行刪除）。

若啟用本機 AI，提示、選取的分頁 context、工具 schema 與模型回覆會送到你設定的 loopback `llama-server`，對話與頁面正文不會由 TabWall 持久化。Bridge 是選用功能；若你允許把可能含有分頁內容的資料送往第三方 API，資料會由 bridge 依其設定處理，且寫入／外部資料揭露會要求確認。Bridge token 只存在目前面板記憶體，不寫入 extension storage。

權限用途：分頁／群組讀寫與還原、在一般網頁注入照片牆浮層、本機大量儲存截圖、可選的下載目錄自動備份。
隱私疑問請透過[專案公開儲存庫 Issues](https://github.com/davislinyd/TabWall/issues) 聯絡發行者。
