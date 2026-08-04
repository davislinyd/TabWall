# TabWall

Manifest V3 Chromium extension: park **tabs** and **Tab Groups** as a visual photo wall (~95% overlay).

## Performance (v2.4)

- **Meta** (url/title/note/tags/order) → `chrome.storage.local`
- **Images** (thumbnail + full snapshot) → **IndexedDB** blobs
- Opening the wall loads **meta only**; thumbnails lazy-load when visible; full snapshots load on expand
- First launch migrates old inline base64 into IDB automatically

## Shortcuts

| Shortcut | Action |
|----------|--------|
| `Option/Alt+S` | Park current tab |
| `Option/Alt+Shift+G` | Park current Tab Group |
| `Option/Alt+O` | Toggle TabWall |
| `/` | Focus search |
| `Esc` | Close panels / TabWall |
| `←` / `→` | Prev / next snapshot |

## Features

- Group park/restore, member note/tags, multi-select batch ops
- Floating settings / tags / help (click outside to close)
- Backup: lite JSON (no images) or full ZIP with binary media

## Install

1. `chrome://extensions` → Developer mode  
2. Load unpacked → this folder  
3. Reload after updates  

## Files

```text
manifest.json  background.js  mediaDb.js  content.js  park.html  park.js  icons/
```
