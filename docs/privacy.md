# Privacy Policy — TabWall

**Last updated:** 2026-08-05  
**Product:** TabWall (Chrome / Chromium extension)  
**Contact:** Use the support email or GitHub repository issues associated with the extension listing.

## Summary

TabWall parks browser tabs and Tab Groups as a visual photo wall **on your device**.  
We do **not** operate a TabWall backend that receives your browsing data. Parked URLs, titles, notes, tags, and screenshots stay in **your browser’s local storage**.

## Data the extension processes

When you use TabWall, it may process:

| Data | Purpose | Where stored |
|------|---------|----------------|
| Tab / group URLs, titles, favicon URLs | Park and restore sessions | `chrome.storage.local` on your device |
| Notes and tags you enter | Search and organize parked items | `chrome.storage.local` |
| Screenshots (thumbnails and full snapshots) | Photo-wall preview | IndexedDB on your device |
| Extension settings (theme, sort, shortcuts, etc.) | Preferences | `chrome.storage.local` |
| Temporary in-memory state | Conflict UI, drag/stack, open panels | Memory only (cleared when the service worker or page unloads) |

The extension reads the **currently active tab** (and related group tabs when you park a Tab Group) to capture a screenshot and save metadata. It does this only when **you** trigger park / related actions (or use your configured keyboard shortcuts).

## Data we do not collect

TabWall does **not**:

- Send parked tabs, screenshots, notes, or tags to TabWall servers (there are none for this product)
- Sell or rent your data
- Use your parked content for advertising
- Require an account to use the extension

If you install from the Chrome Web Store, **Google** may process data under Google’s own policies (install metrics, store account, etc.). That is separate from TabWall’s local storage.

## Permissions (why they are needed)

| Permission | Why |
|------------|-----|
| `tabs`, `tabGroups` | Read tab/group info to park and restore; recreate Tab Groups on restore |
| `activeTab` | Work with the tab you are using when you invoke the extension |
| `scripting` | Inject a lightweight script so keyboard shortcuts and the photo-wall overlay work on normal web pages |
| Host access (`<all_urls>` / broad site access) | Allow shortcuts and the overlay on general websites; capture the visible tab when you park (subject to browser limits on special pages such as `chrome://`) |
| `storage`, `unlimitedStorage` | Save many parked items and screenshot blobs locally |

## Local backups you export

If you use **export / import backup**, files are created or read **on your machine** at your request. TabWall does not upload those files. Protect exported backups as you would any file that may contain URLs and page images.

## Data retention and deletion

- Data remains until **you** delete parked items, clear extension data, or uninstall the extension.
- Uninstalling the extension removes its local extension storage (per browser behavior).
- You can delete individual items or restore/delete in bulk inside TabWall.

## Children

TabWall is a productivity tool for browser sessions. It is not directed at children under 13.

## Changes to this policy

We may update this policy when the extension’s data practices change. The “Last updated” date at the top will be revised. Continued use after an update means you accept the revised policy.

## Contact

For privacy questions about TabWall, contact the publisher via the Chrome Web Store listing support channel or the project’s public repository issues.

---

# 隱私權政策 — TabWall（中文摘要）

**最後更新日期：** 2026-08-05

TabWall 將分頁與 Tab Group 暫存為本機照片牆。  
**不會**把您的網址、備註、標籤或截圖上傳到 TabWall 自有伺服器（本產品不提供此類後端）。資料保存在**您的瀏覽器本機**（`chrome.storage` 與 IndexedDB）。

僅在您操作（含快捷鍵）時讀取目前分頁／群組以截圖與儲存。  
您匯出的備份檔僅在本機產生；請自行妥善保管。  
解除安裝或清除擴充功能資料後，依瀏覽器機制刪除本機資料。

權限用途：分頁／群組讀寫與還原、在一般網頁注入快捷鍵與浮層、本機大量儲存截圖。  
若透過 Chrome 線上應用程式商店安裝，Google 可能依其政策處理商店相關資料，與 TabWall 本機儲存無關。

隱私疑問請透過商店刊登的支援管道或專案公開儲存庫 Issues 聯絡發行者。
