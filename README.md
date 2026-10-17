# 咖啡小工具

烘豆、杯測與烘焙報告比對的網頁小工具。三個 App 都是純前端的靜態網頁，在手機或電腦的瀏覽器打開就能用，不需要安裝，也不會把資料上傳到伺服器。

👉 入口頁：<https://peihsinlin.github.io/coffee/>

| App | 說明 | 開啟 |
|---|---|---|
| [焙比 RoastDiff](roastdiff/) | 讀取 Nucleus Link／Kaffelogic Nano 7 匯出的烘焙報告 PDF，整理成表格，並疊圖比較多支烘焙的豆溫、ROR、風扇曲線 | [開啟](https://peihsinlin.github.io/coffee/roastdiff/) |
| [烘豆小助手](ccdroastform/) | 手機用的烘豆計時器暨記錄器，支援 Mini500、Fresh Roast SR800／SR540，烘完產出曲線圖與摘要 | [開啟](https://peihsinlin.github.io/coffee/ccdroastform/) |
| [杯誌 CupLog](ccdcuppingform/) | 課堂杯測評分表，用 QR Code 分享給學生，自動計分排名，可列印或存圖 | [開啟](https://peihsinlin.github.io/coffee/ccdcuppingform/) |

各 App 的功能與使用方式，請看各資料夾裡的 README。

## 加到手機主畫面

三個 App 都可以加到手機主畫面，像一般 App 一樣全螢幕開啟：

- **iPhone（Safari）**：開啟網址 → 分享按鈕 → 加入主畫面
- **Android（Chrome）**：開啟網址 → 右上角選單 → 安裝應用程式，或加入主畫面

## 專案結構

```
index.html        入口頁，連到三個 App
roastdiff/        焙比 RoastDiff
ccdroastform/     烘豆小助手
ccdcuppingform/   杯誌 CupLog
```

沒有建置流程，也沒有套件需要安裝，直接修改檔案、推送到 `main` 後，GitHub Pages 會自動更新。

本機預覽：在 repo 根目錄執行 `python3 -m http.server 8000`，再開 <http://localhost:8000/>。

## 授權

Copyright (c) 2026 PEI-HSIN LIN

焙比 RoastDiff 與烘豆小助手以 MIT License 釋出，詳見各資料夾裡的 `LICENSE.txt`。各 App 使用的第三方元件與字型，授權說明請見各自的 README。
