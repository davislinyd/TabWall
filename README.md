# TabWall

Manifest V3 Chromium 擴充功能：在當前 Chrome 分頁上以前景浮層（約 **90%** 視窗）展示暫存分頁照片牆。

## 快捷鍵

| 快捷鍵（Mac / 其他） | 行為 |
|----------------------|------|
| `Option+S` / `Alt+S` | 擷取縮圖 + 全尺寸快照 |
| `Option+O` / `Alt+O` | 開關 TabWall 前景（不另開分頁） |

點工具列圖示等同開關。特殊頁（`chrome://` 等）無法注入時顯示 badge `!`。

## 功能

- **卡片 / 列表** 兩種檢視；可依最新、最舊、名稱、網域 **排序**
- 卡片 hover：中央大鈕 **⤢ Expand**、**✎ 編輯**；右上 **×** 刪除
- 編輯：可拖曳的 floating box（不佔全屏遮罩）
- Expand：原始像素快照（可捲動）
- **`/`** 搜尋 title / url / domain / note / tag
- **Dark / Light** 主題（工具列或設定內切換，會記住）
- 設定：儲存後關閉分頁，或僅儲存

## 安裝

1. `chrome://extensions` → 開發人員模式  
2. **載入未封裝項目** → 本專案根目錄  
3. 修改後請 **重新載入**  

## 檔案

```text
TabWall/
├── manifest.json
├── background.js
├── content.js
├── park.html
├── park.js
├── icons/
└── README.md
```
