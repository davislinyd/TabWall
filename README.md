# TabWall

Manifest V3 Chromium 擴充功能：在**當前分頁**以前景浮層展示暫存分頁照片牆。

## 快捷鍵

| 快捷鍵（Mac / 其他） | 行為 |
|----------------------|------|
| `Option+S` / `Alt+S` | 擷取當前分頁縮圖並寫入 TabWall |
| `Option+O` / `Alt+O` | 在當前頁開關照片牆浮層 |

點工具列圖示等同開關浮層（**不會**另開分頁或視窗）。

若快捷鍵無反應，到 `chrome://extensions/shortcuts` 重新指定。

## 照片牆浮層

- 覆蓋**當下分頁**全畫面，背景半透明 + **backdrop blur 虛化**
- 中央面板約 **90vw × 90vh**
- 縮圖為主，卡片底部 caption 顯示 **URL**
- 點擊卡片：還原分頁並關閉浮層
- 點擊 ×：僅刪除紀錄
- `Esc` 或點虛化背景：關閉

> `chrome://` 等特殊頁無法注入 content script；此時點 icon 會顯示 badge `!`，請改在一般網頁操作。

## 設定

浮層右上角 **設定**：

| 選項 | 說明 |
|------|------|
| 關閉該分頁 | 儲存後關閉來源分頁（預設） |
| 不額外執行動作 | 僅截圖寫入 storage，分頁保持開啟 |

## 安裝

1. `chrome://extensions` → 開發人員模式  
2. **載入未封裝項目** → 選擇本專案根目錄  
3. 修改後請 **重新載入** 擴充功能  

## 檔案

```text
TabWall/
├── manifest.json
├── background.js
├── content.js        # Shadow DOM 前景浮層
├── icons/
└── README.md
```
