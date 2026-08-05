# TabWall

Manifest V3 Chromium extension: park **tabs** and **Tab Groups** as a visual photo wall (~95% overlay).

**Current version:** see `manifest.json` (currently **2.11.1**).  
**Changelog / 開發歷程:** [`docs/CHANGELOG.md`](docs/CHANGELOG.md)

## Architecture

- **Meta** (url/title/note/tags/order) → `chrome.storage.local`
- **Images** (thumbnail + full snapshot) → **IndexedDB** blobs
- Opening the wall loads **meta only**; thumbs load lazily in the wall iframe (with cache)
- First launch migrates old inline base64 into IDB automatically
- Group cover area is fixed **16:10** so large thumbs cannot stretch cards

## Shortcuts

Defaults (customizable in **Settings → 快捷鍵** / in-page rebinding):

| Shortcut | Action |
|----------|--------|
| `Option/Alt+S` | Park current tab |
| `Option/Alt+Shift+G` | Park current Tab Group |
| `Option/Alt+O` | Toggle TabWall |
| `/` | Focus search |
| `⌥⌘S` (Mac) / `Alt+Win+S` | Open / close settings (in-wall) |
| Plain search | `||` = OR, space/`&&` = AND (case-insensitive) |
| `t`/`tag` + Tab | Search tags only |
| `n`/`note` + Tab | Search notes only |
| `g`/`group` + Tab | Search groups only (group name or member tabs) |
| `re`/`regex` + Tab | Enable regex mode |
| `all` + Tab | Reset field scope |
| Empty search + Backspace/Delete or Esc | Leave tag/note/group/regex modes |
| `.*` (toolbar) | Toggle regex search (`/pattern/flags` supported) |
| `Esc` | Close panels / TabWall |
| `←` / `→` | Prev / next snapshot |

Two channels:

1. **In-page hotkeys** (`hotkeys.js` content script) — work on normal websites even if Chrome global bindings are empty. Uses physical keys (`e.code`) so macOS Option+letter works.
2. **Chrome global commands** (`chrome.commands`) — needed on `chrome://` and similar restricted pages. Manage via Settings → “在 Chrome 設定全域快捷鍵” or `chrome://extensions/shortcuts`.

After reload/update, re-open or refresh existing tabs once so the content script injects.

## Card interaction

| Action | Result |
|--------|--------|
| Click **thumbnail** | Restore tab / group (short click; **groups confirm first**) |
| Click **title / meta** | Copy saved URL(s) — groups copy member URLs, one per line |
| Drag from **thumbnail** | Reorder cards |
| Drag onto another card’s **title / meta** (brief pause, **+** on title) | **Stack** into a group |
| Restore a stack/group | Recreates a Chrome **Tab Group** |

List view supports copy on title/URL; card drag/stack is cards view only.

## Search

- Plain: `grafana zabbix` (AND), `grafana||zabbix` (OR)
- Regex: toolbar `.*` or `re`/`regex` + Tab
- Field scope: `tag` / `note` / `group` + Tab
- When a **group** matches, the card lists **which member tabs** hit (restore / preview per row)
- Typing in search is debounced; thumbs load when near the viewport

## Features

- Group park/restore, member note/tags, multi-select batch ops
- **Stack:** iOS-style merge by dropping a card on another’s **title area**
- Floating settings / tags / help (click outside to close)
- **Backup export:** lite JSON (no images) or full ZIP with binary media; filenames use **local time + offset** (e.g. `2026-08-04T13-00-00+0800`)
- **Multi-select export:** batch bar → export lite/full for selected cards only
- **Restore modes:** replace or append; after choosing a file, **pick which tabs/groups** to write (each row has **Preview**: full ZIP shows thumbs/snapshots; lite is text / members only)
- **Manual add:** paste URLs (one per line); wrap with `#GROUP:Name` … `#GROUP:Name` to create a group (placeholder thumb/snapshot so manual cards are obvious)
- **Group restore:** confirms before restoring an entire group
- **Auto backup:** writes under Chrome’s **configured download location** (not always `~/Downloads` — see `chrome://settings/downloads`) into a subfolder (default `TabWall-Backups`); scheduled and/or after data changes; keep 1–99 copies; full path updates after a successful backup
- **Dedup (human-decided):** exact URL on save → keep both / replace / cancel; toolbar **掃描重複** scans the wall
- **Diagnostic log:** Settings → 診斷日誌 (export/import/auto-backup events; copy/clear)

## Install

### From this repo (developers)

1. `chrome://extensions` → Developer mode  
2. Load unpacked → this folder  
3. After code changes: **Reload** the extension on that page  
4. If shortcuts or in-page hotkeys misbehave: also **refresh** the target website tab  

### Share with others (recommended)

1. Build a clean zip: `./scripts/pack.sh` → `dist/TabWall-<version>.zip`  
2. Send the zip only (not the whole git tree)  
3. Recipient: unzip → Developer mode → **Load unpacked** → select the **unzipped folder**  
4. Rebuild the zip after every code change before sharing again (see **`AGENTS.md`**)

## Development

- Use Chrome’s native **Reload** on the extension card after a coherent set of edits (do not reload mid-broken file).
- UI-only tweaks to `park.html` / `park.js` still need extension reload (or re-open the wall) so the iframe picks up new scripts.
- Versioning and packaging rules: **`AGENTS.md`** (patch +1 for small fixes; re-pack clean zip for sharing).
- Release notes and feature history: **`docs/CHANGELOG.md`**.

## Files

```text
manifest.json   background.js   mediaDb.js   backupBuild.js
hotkeys.js      content.js      park.html    park.js
icons/          scripts/pack.sh
AGENTS.md       README.md
docs/privacy.md docs/CHANGELOG.md
```

Privacy policy (for Chrome Web Store URL): `docs/privacy.md`  
Changelog / 開發歷程: `docs/CHANGELOG.md`  
Store listing drafts are **not** in git — keep them only under local `private/` (gitignored).
