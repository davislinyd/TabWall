# TabWall

Manifest V3 Chromium extension: park **tabs** and **Tab Groups** as a visual photo wall (~95% overlay).

## Performance (v2.6)

- **Meta** (url/title/note/tags/order) → `chrome.storage.local`
- **Images** (thumbnail + full snapshot) → **IndexedDB** blobs
- Opening the wall loads **meta only**; thumbs load eagerly in the wall iframe
- First launch migrates old inline base64 into IDB automatically

## Shortcuts

Defaults (customizable in **Settings → 快捷鍵**):

| Shortcut | Action |
|----------|--------|
| `Option/Alt+S` | Park current tab |
| `Option/Alt+Shift+G` | Park current Tab Group |
| `Option/Alt+O` | Toggle TabWall |
| `/` | Focus search |
| `Esc` | Close panels / TabWall |
| `←` / `→` | Prev / next snapshot |

Two channels:

1. **In-page hotkeys** (`hotkeys.js` content script) — work on normal websites even if Chrome global bindings are empty. Uses physical keys (`e.code`) so macOS Option+letter works.
2. **Chrome global commands** (`chrome.commands`) — needed on `chrome://` and similar restricted pages. Manage via Settings → “在 Chrome 設定全域快捷鍵” or `chrome://extensions/shortcuts`.

After reload/update, re-open existing tabs once so the content script injects.

## Features

- Group park/restore, member note/tags, multi-select batch ops
- Floating settings / tags / help (click outside to close)
- Backup: lite JSON (no images) or full ZIP with binary media
- **Dedup (human-decided):** exact URL match on save asks keep-both / replace / cancel; toolbar **掃描重複** scans the wall

## Install

1. `chrome://extensions` → Developer mode  
2. Load unpacked → this folder  
3. Reload after updates  

## Files

```text
manifest.json  background.js  mediaDb.js  hotkeys.js  content.js  park.html  park.js  icons/
```
