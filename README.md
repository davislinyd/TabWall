# TabWall

Manifest V3 Chromium extension: park **tabs** and **Tab Groups** as a visual photo wall (~95% overlay).

## Shortcuts

| Shortcut | Action |
|----------|--------|
| `Option/Alt+S` | Park current tab |
| `Option/Alt+Shift+G` | Park current Tab Group |
| `Option/Alt+O` | Toggle TabWall |
| `/` | Focus search |
| `Esc` | Close floating panels, then TabWall |
| `←` / `→` | Previous / next snapshot (while expanded) |

In-app **Help** button lists shortcuts and usage (中文 / English).

## Features

- Group cards · floating member panel · per-member snapshot / note / tags
- Snapshot lightbox with arrow navigation across saved tabs/members
- Multi-select batch restore / tags / delete
- Settings, Tags, Help as draggable float panels (click outside to close)
- Backup: lite JSON (no images) or full ZIP with binary media

## Install

1. `chrome://extensions` → Developer mode  
2. Load unpacked → this folder  
3. Reload after updates  

## Files

```text
manifest.json  background.js  content.js  park.html  park.js  icons/
```
