---
layout: default
title: "Privacy Policy — TabWall"
permalink: /privacy.html
---

# Privacy Policy — TabWall

**Last updated:** 2026-08-14  
**Product:** TabWall (Chrome / Chromium extension)  
**Contact:** Use the [GitHub repository issues](https://github.com/davislinyd/TabWall/issues).

## Summary

TabWall parks browser tabs and Tab Groups as a visual photo wall **on your device**.  
We do **not** operate a TabWall backend that receives your browsing data. Parked URLs, titles, notes, tags, and screenshots stay in **your browser’s local storage**.

## Data the extension processes

When you use TabWall, it may process:

| Data | Purpose | Where stored |
|------|---------|----------------|
| Tab / group URLs, titles, favicon URLs | Park and restore sessions | `chrome.storage.local` on your device |
| Notes and tags you enter | Search and organize parked items | `chrome.storage.local` |
| Screenshots (thumbnails and full snapshots) and image-card files | Photo-wall preview | IndexedDB on your device |
| Custom wallpaper image (optional) | Canvas background | IndexedDB on your device |
| Extension settings (theme, wallpaper fit/blur/strength, sort, view, auto-backup preferences, etc.) | Preferences | `chrome.storage.local` |
| Auto-backup preferences (subfolder name, schedule) | Control local automatic backups under your download directory | `chrome.storage.local` |
| Temporary in-memory state | Conflict UI, drag/stack, open panels | Memory only (cleared when the service worker or page unloads) |

The extension reads the **currently active tab** (and related group tabs when you park a Tab Group) to capture a screenshot and save metadata. It does this only when **you** trigger park / related actions or use a Chrome command assigned to TabWall.

## Data we do not collect

TabWall does **not**:

- Send parked tabs, screenshots, notes, or tags to TabWall servers (there are none for this product)
- Sell or rent your data
- Use your parked content for advertising
- Require an account to use the extension

## Permissions (why they are needed)

| Permission | Why |
|------------|-----|
| `tabs`, `tabGroups` | Read tab/group info to park and restore; recreate Tab Groups on restore |
| `scripting` | Inject a lightweight script so the photo-wall overlay works on normal web pages |
| Host access (`<all_urls>` / broad site access) | Allow the overlay on general websites and capture the visible tab when you park (subject to browser limits on special pages such as `chrome://`) |
| `storage`, `unlimitedStorage` | Save many parked items and screenshot blobs locally |
| `alarms` | Schedule optional automatic local backups |
| `downloads` | Write optional automatic backups into a subfolder of your browser download directory; the absolute path is known after each download completes |

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

**最後更新日期：** 2026-08-14

TabWall 將分頁與 Tab Group 暫存為本機照片牆。  
**不會**把您的網址、備註、標籤、截圖或自訂背景上傳到 TabWall 自有伺服器（本產品不提供此類後端）。資料保存在**您的瀏覽器本機**（`chrome.storage` 與 IndexedDB）。

僅在您操作（含 Chrome 快捷鍵命令）時讀取目前分頁／群組以截圖與儲存。
您匯出的備份檔僅在本機產生；請自行妥善保管。  
若啟用**自動備份**，TabWall 會查詢 Chrome 的 Downloads history 以辨識自己建立的備份，並依您設定的保留數量刪除舊的 TabWall 備份；備份會寫入瀏覽器**下載目錄**下您指定的子資料夾，不會上傳。
解除安裝或清除擴充功能資料後，依瀏覽器機制刪除本機資料（已寫出的備份檔仍留在下載目錄，需自行刪除）。

權限用途：分頁／群組讀寫與還原、在一般網頁注入照片牆浮層、本機大量儲存截圖、可選的下載目錄自動備份。
隱私疑問請透過[專案公開儲存庫 Issues](https://github.com/davislinyd/TabWall/issues) 聯絡發行者。
