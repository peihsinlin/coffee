# 杯誌 CupLog

課堂用的杯測評分表。老師設定主題與品項後產生 QR Code，學生用手機掃碼就能評分，填完自動計算總分與排名，產生結果總表，可列印或另存圖片。

👉 線上使用：<https://peihsinlin.github.io/coffee/ccdcuppingform/>

## 使用流程

**1. 老師：設定主題**

- 輸入本次主題
- 用 ＋／－ 設定品項數量（1～12）
- 每個品項可填名稱、烘焙度（選填）、起算分（預設 80）
- 按「產生評分 QR Code」

**2. 分享評分頁**

- 投影或分享 QR Code 畫面，讓學生掃碼
- 也可以按「複製連結」貼到群組，或按「進入評分頁」直接在同一支手機評分

**3. 學生：評分**

- 填寫姓名／暱稱（必填）
- 每個品項可填風／滋味描述、烘焙度（Agtron），以及備註
- 每個評分項目從 −2、−1、0、+1、+2 選擇，預設為 0；上方即時顯示該品項的總分
- 品項多時，可用畫面側邊的數字按鈕快速跳到指定品項
- 按「完成評分，產生結果表」

**4. 結果總表**

- 橫式總表列出每個品項的名次、烘焙度、描述、各項分數、總分與備註，第一名會標示出來
- 「列印」：使用瀏覽器列印，也可以另存成 PDF
- 「另存圖片」：存成 JPG。iPhone／iPad 會開啟分享選單，可以直接存到照片
- 可以回到評分頁修改後重新產生

## 評分項目與計分

| 項目 | 是否計分 |
|---|---|
| 乾／濕香 Fragrance / Aroma | 不計分，僅記錄 |
| 1. 風／滋味 Flavor | 計分 |
| 2. 酸質 Acidity | 計分 |
| 3. 口感 Mouthfeel / Body | 計分 |
| 4. 甜度 Sweetness | 計分 |
| 5. 餘韻 Aftertaste | 計分 |
| 6. 平衡性 Balance | 計分 |
| 7. 乾淨度／缺點 Clean Cup / Defect | 計分 |

**總分 ＝ 起算分 ＋ 七個計分項目的分數加總**（每項 −2 ～ +2）。

同分的品項名次相同，下一名順延（例如兩個並列第 1，下一個是第 3）。

## 注意事項

- 主題與品項資料都放在評分連結的網址裡，沒有伺服器，也不會上傳評分結果。每位學生的評分只存在自己的手機畫面上，請用列印或另存圖片留存。
- 重新整理或關閉頁面會清空評分內容。電腦瀏覽器會先跳出確認視窗，手機瀏覽器則不一定會提醒。
- 從 LINE、Messenger、Instagram 等 App 裡點開連結時，畫面會要求改用手機瀏覽器開啟，因為 App 內建的瀏覽器常常無法列印或存圖。
- 可以加到手機主畫面當 App 使用，離線也能開啟。

## 專案檔案

```
index.html            頁面
script.js             程式邏輯
style.css             樣式
vendor.js             第三方套件（QR Code 產生、畫面轉圖片）
manifest.json         PWA 設定
service-worker.js     離線快取
icons/                App 圖示
```

修改任何被快取的檔案後，請把 `service-worker.js` 裡的 `CACHE_VERSION` 加一，否則使用者裝置上的舊快取不會更新。

## 第三方元件

- [QRCode for JavaScript](https://github.com/davidshimjs/qrcodejs)（Kazuhiko Arase，MIT License）
- [html2canvas](https://html2canvas.hertzen.com/) 1.4.1（Niklas von Hertzen，MIT License）
- Noto Serif TC、Noto Sans TC 字型（Google Fonts，SIL Open Font License 1.1）
