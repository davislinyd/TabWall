# TabWall — Agent / 開發規範

## 版號（manifest.json `version`）

語意化版本 `MAJOR.MINOR.PATCH`：

| 類型 | 格式 | 何時 |
|------|------|------|
| **Patch（小型修正）** | `x.y.N` → **N+1** | bug fix、小 UX、文案、效能微調、不改主功能面 |
| **Minor（功能）** | `x.N.0` | 新功能模組、可感知的能力新增 |
| **Major** | `N.0.0` | 破壞性變更、資料格式不相容 |

### 強制規則

1. **每次可交付的程式變更都必須更新 `manifest.json` 的 `version`。**
2. **小型修正一律只加 patch（最後一碼 +1）**，例如 `2.6.0` → `2.6.1` → `2.6.2`。
3. 同一輪交付若含多個小修，合併為 **一次** patch 遞增即可。
4. 新增功能達「使用者可感知的新能力」時升 minor，並將 patch 歸零（`2.6.3` → `2.7.0`）。
5. Commit／README 若提到版本，與 `manifest.json` 保持一致。

## 實作偏好

- 最小變更：只改與需求直接相關的檔案與行。
- 回覆使用者：繁體中文（專有名詞可保留英文）。
- 不提交 secrets、`.ai/status.json`、本機快取。

## 開發成本控制（避免單次 session 過度耗用 token）

背景：曾發生單一 session 因未分段、且平行開多個子 agent，累積到 400+ 輪、上下文逼近 440k tokens，實際消耗遠超任務所需。

### 強制規則

1. **大範圍調查／規劃任務（效能排查、多功能一次設計等）必須主動分段**：完成一個可交付的階段後，建議使用者 `/clear` 或另開新 session，不要讓單一對話持續累積到數百輪。
2. **子 agent（Explore / Plan）數量依任務範圍決定，不預設開滿**：範圍明確的小任務用 1 個 Explore 就好；只有在確定需要多個獨立方向平行探索/規劃時才多開。
3. 不確定任務規模時，先用 1 個 Explore 探路，視結果再決定是否需要加開更多子 agent。

## 驗證

- 變更 JS 後執行 `node --check` 相關檔。
- 拖曳／快捷鍵／儲存等 UI 行為需在說明中標明如何手動驗。

## 分享打包（Load unpacked ZIP）

給他人本機安裝時使用 **clean zip**（解壓後「載入未封裝項目」），不是整個 git 資料夾。

### 強制規則

1. **每次修改會影響擴充行為的程式或資源**（`*.js` / `park.html` / `manifest.json` / `icons/*` 等），在交付或分享前都必須 **重新打包**。
2. 輸出路徑：`dist/TabWall-<version>.zip`，`<version>` 必須與 `manifest.json` 的 `version` 一致。
3. **打包檔只能含執行所需檔案**（白名單），不得夾帶開發／文件／隱私草稿／截圖／git 等。

### 白名單（僅這些）

```text
manifest.json
background.js
content.js
mediaDb.js
backupBuild.js
park.html
park.js
icons/icon16.png
icons/icon48.png
icons/icon128.png
```

### 明確排除（示例）

`.git/`、`docs/`、`private/`、`README.md`、`AGENTS.md`、`scripts/`、`TabWall screenshots/`、`.gitignore`、編輯器設定、`.DS_Store`、舊版 zip 以外的雜項。

### 指令

```bash
./scripts/pack.sh
# 或：bash scripts/pack.sh
```

`dist/` 已在 `.gitignore`，**不要**把 zip commit 進倉庫。
