'use strict';

var state = { planEvents: [] };  // {id, seconds, type, value}

var roast = null;         // active/finished roast data
var timerInterval = null;
var wakeLock = null;
var audioCtx = null;

// ---------- 小工具 ----------
function formatTime(totalSeconds){
  var m = Math.floor(totalSeconds / 60);
  var s = totalSeconds % 60;
  return String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
}
function escapeHtml(str){
  return String(str).replace(/[&<>"']/g, function(c){
    return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
  });
}
function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,8); }

function updateStartButton(){
  var machineOk = !!document.getElementById('machineSelect').value;
  var nameOk = document.getElementById('roasterName').value.trim() !== '';
  var regionOk = document.getElementById('beanOrigin').value.trim() !== '';
  var weightOk = parseFloat(document.getElementById('weightBefore').value) > 0;
  var tempOk = document.getElementById('sessionTemp').value.trim() !== '';
  document.getElementById('btnStartRoast').disabled = !(machineOk && nameOk && regionOk && weightOk && tempOk);
}

// ---------- 自訂操作提醒（風力／火力） ----------
function renderPlanEventList(){
  var wind = state.planEvents.filter(function(ev){ return ev.type === '風力'; }).sort(function(a,b){ return a.seconds - b.seconds; });
  var fire = state.planEvents.filter(function(ev){ return ev.type === '火力'; }).sort(function(a,b){ return a.seconds - b.seconds; });

  function renderList(elId, items){
    var list = document.getElementById(elId);
    if (items.length === 0){
      list.innerHTML = '<li class="event-list__empty">尚未加入</li>';
      return;
    }
    list.innerHTML = items.map(function(ev){
      return '<li>' +
        '<span class="event-list__time">' + formatTime(ev.seconds) + '</span>' +
        '<span class="event-list__label">' + escapeHtml(ev.value) + '</span>' +
        '<button type="button" class="event-list__del" data-id="' + ev.id + '" aria-label="刪除">✕</button>' +
        '</li>';
    }).join('');
  }

  renderList('planEventListWind', wind);
  renderList('planEventListFire', fire);
}

// ---------- 烘焙計劃：目前僅 Mini500 有對照表，依烘前重量自動帶入建議值 ----------
function getRoastPlan(weight){
  if (weight <= 225)  return { chargeTemp:130, damper000:'右2', power000:4, power200:6, power800:4, rpm:55 };
  if (weight <= 275)  return { chargeTemp:135, damper000:'右2', power000:5, power200:7, power800:5, rpm:56 };
  if (weight <= 325)  return { chargeTemp:140, damper000:'右2', power000:6, power200:8, power800:6, rpm:57 };
  if (weight <= 375)  return { chargeTemp:150, damper000:'右2', power000:7, power200:9, power800:7, rpm:58 };
  if (weight <= 425)  return { chargeTemp:155, damper000:'右2', power000:8, power200:10, power800:8, rpm:59 };
  return { chargeTemp:160, damper000:'右1', power000:9, power200:11, power800:9, rpm:60 };
}
function clearRoastPlan(){
  ['planChargeTemp','planDamper000','planPower000','planPower200','planPower800','sessionRpm'].forEach(function(id){
    document.getElementById(id).value = '';
  });
}
function applyRoastPlan(){
  var machine = document.getElementById('machineSelect').value;
  if (machine !== 'Mini500'){
    clearRoastPlan();
    return;
  }
  var weight = parseFloat(document.getElementById('weightBefore').value);
  if (!weight || weight <= 0) return;
  var plan = getRoastPlan(weight);
  document.getElementById('planChargeTemp').value = plan.chargeTemp;
  document.getElementById('planDamper000').value = plan.damper000;
  document.getElementById('planPower000').value = plan.power000;
  document.getElementById('planPower200').value = plan.power200;
  document.getElementById('planPower800').value = plan.power800;
  document.getElementById('sessionRpm').value = plan.rpm;
}

// ---------- 音效與語音 ----------
// iPhone（iOS Safari）在背景或閒置一段時間後會把 AudioContext 自動 suspend，
// resume() 又是非同步的：如果沒等 resume 完成就排音效，聲音會直接消失不會播放，
// 這是「風力／火力沒有聲音提醒」的主因，因此這裡改成等 resume 完成後才真正播放。
function ensureAudioCtx(){
  if (!audioCtx){
    var AC = window.AudioContext || window.webkitAudioContext;
    if (AC) audioCtx = new AC();
  }
  return audioCtx;
}
function resumeAudioCtx(){
  if (audioCtx && audioCtx.state === 'suspended'){
    audioCtx.resume().catch(function(){});
  }
}
function beep(freq, duration, volume){
  var ctx = ensureAudioCtx();
  if (!ctx) return;
  function playNow(){
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.value = (volume != null) ? volume : 0.45;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration / 1000);
  }
  if (ctx.state === 'suspended'){
    ctx.resume().then(playNow).catch(function(){});
  } else {
    playNow();
  }
}
function speak(text){
  if (!('speechSynthesis' in window)) return;
  // iOS 的語音佇列偶爾會卡住，先清空再播放新的一句，避免後面提醒完全發不出聲音
  try { window.speechSynthesis.cancel(); } catch (e){}
  var u = new SpeechSynthesisUtterance(text);
  var voices = window.speechSynthesis.getVoices();
  var zh = voices.find(function(v){ return /zh/i.test(v.lang); });
  if (zh) { u.voice = zh; u.lang = zh.lang; } else { u.lang = 'zh-TW'; }
  u.rate = 1;
  window.speechSynthesis.speak(u);
}
// iOS 的語音合成（speechSynthesis）跟 AudioContext 是兩套各自獨立的「解鎖」機制：
// AudioContext 解鎖了，不代表 speechSynthesis 之後也能在計時器（非使用者操作）裡正常發聲，
// 一定要先在使用者手勢（點擊）當下實際呼叫過一次 speak()，之後計時器觸發的語音才會真的有聲音，
// 這極可能就是「風力／火力語音提醒」在 iPhone 上沒有聲音的主因。
function primeSpeech(){
  if (!('speechSynthesis' in window)) return;
  try {
    var u = new SpeechSynthesisUtterance(' ');
    u.volume = 0.01;
    window.speechSynthesis.speak(u);
  } catch (e){}
}
// 烘豆過程中，每次點擊畫面上的按鈕都順便嘗試解鎖／喚醒音效與語音，
// 增加 iPhone 在螢幕鎖定、切換App或音訊被系統中斷後恢復正常提醒音的機會
document.addEventListener('DOMContentLoaded', function(){
  document.getElementById('screen-roast').addEventListener('click', function(){
    ensureAudioCtx();
    resumeAudioCtx();
    primeSpeech();
  }, true);
});

// ---------- Wake Lock ----------
async function requestWakeLock(){
  if (!('wakeLock' in navigator)) return;
  try{ wakeLock = await navigator.wakeLock.request('screen'); }
  catch(e){ /* 裝置不支援或被拒絕，忽略即可 */ }
}
function releaseWakeLock(){
  if (wakeLock){ wakeLock.release().catch(function(){}); wakeLock = null; }
}
document.addEventListener('visibilitychange', function(){
  if (document.visibilityState === 'visible' && roast && roast.running){
    requestWakeLock();
    resumeAudioCtx();
  }
});

// ---------- 畫面切換 ----------
function showScreen(name){
  ['setup','roast','result'].forEach(function(s){
    document.getElementById('screen-' + s).hidden = (s !== name);
  });
}

// ---------- 圖表繪製 ----------
function resizeCanvas(canvas){
  var dpr = window.devicePixelRatio || 1;
  var rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  var ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

// 用二次貝茲曲線通過線段中點，讓折線看起來是平滑曲線
function strokeSmoothPath(ctx, pts){
  if (pts.length === 0) return;
  ctx.beginPath();
  if (pts.length === 1){
    ctx.moveTo(pts[0][0], pts[0][1]);
    ctx.lineTo(pts[0][0] + 0.01, pts[0][1]);
    ctx.stroke();
    return;
  }
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (var i = 1; i < pts.length; i++){
    var prev = pts[i - 1], curr = pts[i];
    var midX = (prev[0] + curr[0]) / 2, midY = (prev[1] + curr[1]) / 2;
    ctx.quadraticCurveTo(prev[0], prev[1], midX, midY);
  }
  var last = pts[pts.length - 1];
  ctx.lineTo(last[0], last[1]);
  ctx.stroke();
}

// 計算 RoR（升溫速率，°C/分鐘），優先用60秒間隔，不足時用30秒間隔*2估算
function computeRorSeries(tempLog){
  var out = [];
  tempLog.forEach(function(p){
    var past60 = findPointNear(tempLog, p.t - 60, 8);
    var val = null;
    if (past60){ val = p.temp - past60.temp; }
    else {
      var past30 = findPointNear(tempLog, p.t - 30, 5);
      if (past30) val = (p.temp - past30.temp) * 2;
    }
    if (val != null) out.push({ t: p.t, ror: val });
  });
  return out;
}

function hasFanPowerEvents(triggeredLog){
  return triggeredLog.some(function(ev){ return ev.label.indexOf('風力') === 0 || ev.label.indexOf('火力') === 0; });
}

// 風力／火力階梯圖，畫在主曲線下方，藍色F=風力、橘色P=火力，仿照烘豆機軟體常見畫法
// 風力／火力階梯圖：F、P 共用同一個數值刻度，數值相同時線會交叉，畫法參考烘豆機軟體常見樣式
function drawStepChart(ctx, x0, yTop, w, bandH, xScale, fanItems, powerItems){
  var allVals = fanItems.concat(powerItems)
    .map(function(it){ var v = parseFloat(it.value); return isNaN(v) ? null : v; })
    .filter(function(v){ return v != null; });
  var vMax = allVals.length ? Math.max.apply(null, allVals.concat([1])) : 1;
  var vMin = 0;
  var padTop = 14, padBottom = 14;
  var plotTop = yTop + padTop, plotBottom = yTop + bandH - padBottom;

  function yFor(v){
    if (v == null) return (plotTop + plotBottom) / 2;
    var clamped = Math.max(vMin, Math.min(vMax, v));
    return plotBottom - (clamped - vMin) / (vMax - vMin || 1) * (plotBottom - plotTop);
  }

  function drawLine(items, color){
    if (items.length === 0) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    var lastX = null, lastY = null;
    items.forEach(function(it, i){
      var v = parseFloat(it.value); v = isNaN(v) ? null : v;
      var x = xScale(it.t);
      var y = yFor(v);
      if (i === 0){ ctx.moveTo(x, y); }
      else { ctx.lineTo(x, lastY); ctx.lineTo(x, y); }
      lastX = x; lastY = y;
    });
    if (lastX != null){ ctx.lineTo(x0 + w - 4, lastY); }
    ctx.stroke();
  }

  function drawBadges(items, color, prefix){
    items.forEach(function(it){
      var v = parseFloat(it.value); v = isNaN(v) ? null : v;
      var x = xScale(it.t);
      var y = yFor(v);
      var text = prefix + it.value;
      ctx.font = 'bold 9px sans-serif';
      var tw = ctx.measureText(text).width;
      var bw = tw + 8, bh = 13;
      var bx = Math.max(x0, Math.min(x0 + w - bw, x - bw / 2));
      var by = Math.max(yTop + 1, Math.min(yTop + bandH - bh - 1, y - bh - 3));
      ctx.fillStyle = color;
      if (ctx.roundRect){ ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 3); ctx.fill(); }
      else { ctx.fillRect(bx, by, bw, bh); }
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.fillText(text, bx + bw / 2, by + bh - 3.5);
    });
  }

  drawLine(fanItems, '#3E6B8A');
  drawLine(powerItems, '#BD6B2E');
  drawBadges(fanItems, '#3E6B8A', 'F');
  drawBadges(powerItems, '#BD6B2E', 'P');

  // 左側小圖例
  ctx.font = 'bold 9px monospace';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#3E6B8A'; ctx.fillText('F 風力', x0, yTop - 2);
  ctx.fillStyle = '#BD6B2E'; ctx.fillText('P 火力', x0 + 44, yTop - 2);
}

function renderChart(ctx, x0, y0, w, h, tempLog, triggeredLog, stepBandH, crackEvents){
  stepBandH = stepBandH || 0;
  var stepGap = stepBandH > 0 ? 22 : 0;

  ctx.fillStyle = '#241712';
  ctx.fillRect(x0, y0, w, h);
  ctx.strokeStyle = 'rgba(243,232,211,0.14)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1);

  if (tempLog.length === 0){
    ctx.fillStyle = '#c9b693';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('尚無溫度紀錄', x0 + w / 2, y0 + h / 2);
    return;
  }

  var mainH = h - stepBandH - stepGap;
  var padL = 40, padR = 34, padT = 14, padB = 24;
  var plotW = w - padL - padR, plotH = mainH - padT - padB;

  var allT = tempLog.map(function(p){ return p.t; }).concat(triggeredLog.map(function(e){ return e.t; }));
  var maxT = Math.max.apply(null, allT.concat([60]));
  var temps = tempLog.map(function(p){ return p.temp; });
  var maxTemp = Math.max.apply(null, temps.concat([220]));
  var minTemp = Math.min.apply(null, temps.concat([0]));
  if (maxTemp === minTemp) maxTemp = minTemp + 50;

  function xScale(t){ return x0 + padL + (t / maxT) * plotW; }
  function yScale(temp){ return y0 + padT + (1 - (temp - minTemp) / (maxTemp - minTemp)) * plotH; }

  // 溫度格線（左軸）
  ctx.strokeStyle = 'rgba(243,232,211,0.08)';
  ctx.fillStyle = '#c9b693';
  ctx.font = '10px monospace';
  ctx.textAlign = 'right';
  var step = 50;
  for (var t = Math.ceil(minTemp / step) * step; t <= maxTemp; t += step){
    var y = yScale(t);
    ctx.beginPath(); ctx.moveTo(x0 + padL, y); ctx.lineTo(x0 + w - padR, y); ctx.stroke();
    ctx.fillText(String(t), x0 + padL - 6, y + 3);
  }

  // RoR 副軸（右側刻度）
  var rorSeries = computeRorSeries(tempLog);
  var rorMax = 60;
  if (rorSeries.length){
    var maxAbs = Math.max.apply(null, rorSeries.map(function(r){ return Math.abs(r.ror); }).concat([10]));
    rorMax = Math.max(60, Math.ceil(maxAbs / 10) * 10);
  }
  function yScaleRor(v){
    var clamped = Math.max(0, Math.min(rorMax, v));
    return y0 + padT + (1 - clamped / rorMax) * plotH;
  }
  ctx.fillStyle = '#8B3A2B';
  ctx.font = '9px monospace';
  ctx.textAlign = 'left';
  var rorStep = rorMax / 4;
  for (var rv = 0; rv <= rorMax; rv += rorStep){
    ctx.fillText(String(Math.round(rv)), x0 + w - padR + 4, yScaleRor(rv) + 3);
  }

  // 一爆／二爆事件：在曲線上標出小圓點（標籤稍後畫在曲線之上）
  ctx.fillStyle = '#BD6B2E';
  (crackEvents || []).forEach(function(ev){
    ctx.beginPath(); ctx.arc(xScale(ev.t), yScale(ev.temp), 3.5, 0, Math.PI * 2); ctx.fill();
  });

  // 溫度曲線（平滑）
  var tempPts = tempLog.map(function(p){ return [xScale(p.t), yScale(p.temp)]; });
  ctx.strokeStyle = '#5B6B3E';
  ctx.lineWidth = 2;
  strokeSmoothPath(ctx, tempPts);
  ctx.fillStyle = '#5B6B3E';
  tempLog.forEach(function(p){
    ctx.beginPath(); ctx.arc(xScale(p.t), yScale(p.temp), 2.5, 0, Math.PI * 2); ctx.fill();
  });

  // RoR 曲線（平滑，另一個顏色）
  if (rorSeries.length > 1){
    var rorPts = rorSeries.map(function(r){ return [xScale(r.t), yScaleRor(r.ror)]; });
    ctx.strokeStyle = '#8B3A2B';
    ctx.lineWidth = 1.5;
    strokeSmoothPath(ctx, rorPts);
  }

  // 一爆／二爆事件標註：仿照斜線引出標籤，兩行文字（第一行事件名稱+時間、第二行溫度）行距緊靠、不佔太多畫面，文字都在指標左邊避免超出圖表
  // 依時間排序後，不同事件錯開標註：第一個（通常是一爆起）在上方、下一個在下方，依序交錯，避免相鄰事件重疊；
  // 若同一側仍有時間太接近的事件，再逐層外推位置（往左、往外加大間距）
  var sortedEvents = (crackEvents || []).slice().sort(function(a, b){ return a.t - b.t; });
  var collisionThreshold = 65; // px，小於此距離視為時間接近
  var lastXBySide = { below: null, above: null };
  var levelBySide = { below: 0, above: 0 };
  sortedEvents.forEach(function(ev, idx){
    var side = (idx % 2 === 0) ? 'above' : 'below';
    ev._side = side;
    var x = xScale(ev.t);
    if (lastXBySide[side] !== null && Math.abs(x - lastXBySide[side]) < collisionThreshold){
      levelBySide[side]++;
    } else {
      levelBySide[side] = 0;
    }
    ev._labelLevel = levelBySide[side];
    lastXBySide[side] = x;
  });

  var lineGap = 11; // 兩行文字緊靠，避免佔用太多畫面
  sortedEvents.forEach(function(ev){
    var x = xScale(ev.t);
    var y = yScale(ev.temp);
    var lvl = ev._labelLevel || 0;
    var extraGap = lvl * 22;
    var extraShift = lvl * 42;
    var minY = y0 + padT + 4;
    var maxY = y0 + mainH - padB - 4 - lineGap;
    var line1Y, line2Y;
    if (ev._side === 'below'){
      line1Y = Math.max(minY, Math.min(maxY, y + 18 + extraGap));
      line2Y = line1Y + lineGap;
    } else {
      line2Y = Math.max(minY + lineGap, Math.min(maxY + lineGap, y - 12 - extraGap));
      line1Y = line2Y - lineGap;
    }
    var labelX = x - 12 - extraShift;
    var textX = x - 15 - extraShift;

    ctx.strokeStyle = '#BD6B2E';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(labelX, (line1Y + line2Y) / 2); ctx.stroke();

    // 第一行：事件名稱＋時間
    ctx.fillStyle = '#F3E9D8';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(ev.label + ' ' + formatTime(ev.t), textX, line1Y);

    // 第二行：溫度數值
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText(ev.temp + '°C', textX, line2Y);
  });

  // 圖例（放左上，避免擋到右側事件標註）
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'left';
  ctx.strokeStyle = '#5B6B3E'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x0 + padL + 4, y0 + 14); ctx.lineTo(x0 + padL + 18, y0 + 14); ctx.stroke();
  ctx.fillStyle = '#F3E9D8'; ctx.fillText('BT', x0 + padL + 22, y0 + 17);
  ctx.strokeStyle = '#8B3A2B'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(x0 + padL + 4, y0 + 28); ctx.lineTo(x0 + padL + 18, y0 + 28); ctx.stroke();
  ctx.fillStyle = '#F3E9D8'; ctx.fillText('RoR', x0 + padL + 22, y0 + 31);

  // 時間刻度
  ctx.fillStyle = '#c9b693';
  ctx.font = '10px monospace';
  ctx.textAlign = 'center';
  var xStep = maxT > 600 ? 120 : 60;
  for (var tt = 0; tt <= maxT; tt += xStep){
    ctx.fillText(formatTime(tt), xScale(tt), y0 + mainH - 8);
  }

  // 風力／火力階梯圖（僅在有這類事件時顯示），跟上方圖表隔開一段距離
  if (stepBandH > 0){
    var stepTop = y0 + mainH + stepGap;
    ctx.strokeStyle = 'rgba(243,232,211,0.14)';
    ctx.beginPath(); ctx.moveTo(x0, stepTop - stepGap / 2); ctx.lineTo(x0 + w, stepTop - stepGap / 2); ctx.stroke();
    var fanItems = triggeredLog.filter(function(ev){ return ev.label.indexOf('風力') === 0; })
      .map(function(ev){ return { t: ev.t, value: ev.label.replace('風力 ', '') }; }).sort(function(a,b){ return a.t - b.t; });
    var powerItems = triggeredLog.filter(function(ev){ return ev.label.indexOf('火力') === 0; })
      .map(function(ev){ return { t: ev.t, value: ev.label.replace('火力 ', '') }; }).sort(function(a,b){ return a.t - b.t; });
    drawStepChart(ctx, x0 + padL, stepTop, w - padL - padR, stepBandH, xScale, fanItems, powerItems);
  }
}

function drawLiveCurve(){
  var canvas = document.getElementById('liveCurve');
  var hasFP = hasFanPowerEvents(roast.triggeredLog);
  var stepBandH = hasFP ? 90 : 0;
  canvas.style.height = (180 + stepBandH + (hasFP ? 22 : 0)) + 'px';
  var ctx = resizeCanvas(canvas);
  renderChart(ctx, 0, 0, canvas.clientWidth, canvas.clientHeight, roast.tempLog, roast.triggeredLog, stepBandH, roast.crackEvents);
  renderBeanInfoTable('liveBeanInfoBody');
  renderLogTable('liveLogTableBody');
}
function drawResultCurve(){
  var canvas = document.getElementById('resultCurve');
  var hasFP = hasFanPowerEvents(roast.triggeredLog);
  var stepBandH = hasFP ? 100 : 0;
  canvas.style.height = (260 + stepBandH + (hasFP ? 22 : 0)) + 'px';
  var ctx = resizeCanvas(canvas);
  renderChart(ctx, 0, 0, canvas.clientWidth, canvas.clientHeight, roast.tempLog, roast.triggeredLog, stepBandH, roast.crackEvents);
}

// ---------- 溫度輸入面板 ----------
function showTempPrompt(auto, crackLabel){
  var panel = document.getElementById('tempPrompt');
  var label = crackLabel ? ('請輸入「' + crackLabel + '」溫度') : (auto ? '請輸入目前溫度' : '手動記溫');
  document.getElementById('tempPromptLabel').textContent = label;
  document.getElementById('tempPromptInput').value = '';
  panel.hidden = false;
  panel.classList.add('capture-panel--active');
  document.getElementById('tempPromptInput').focus();
}
function hideTempPrompt(){
  var panel = document.getElementById('tempPrompt');
  panel.hidden = true;
  panel.classList.remove('capture-panel--active');
}

// ---------- 風力／火力提醒的確認提示（時間到時除了語音提示外，需按確認才寫入紀錄；超過10秒沒動作則自動寫入） ----------
// 若風力、火力同時到達提醒時間，兩筆會同時列出，各自獨立確認／倒數，不互相排隊等待
function renderConfirmPanel(){
  var panel = document.getElementById('eventConfirmPanel');
  var list = document.getElementById('eventConfirmList');
  if (!roast || roast.pendingConfirms.length === 0){
    panel.hidden = true;
    panel.classList.remove('capture-panel--active');
    list.innerHTML = '';
    return;
  }
  panel.hidden = false;
  panel.classList.add('capture-panel--active');
  list.innerHTML = roast.pendingConfirms.map(function(item, idx){
    return '<div class="event-confirm-item">' +
      '<span class="event-confirm-item__label">' + escapeHtml(item.label) + '（' + formatTime(item.t) + '）</span>' +
      '<div class="control-row">' +
        '<button type="button" data-action="cancel" data-idx="' + idx + '" class="btn btn--outline btn--sm">取消</button>' +
        '<button type="button" data-action="confirm" data-idx="' + idx + '" class="btn btn--primary btn--sm">確認寫入</button>' +
      '</div>' +
    '</div>';
  }).join('');
}
function resolvePendingConfirm(idx, write){
  if (!roast) return;
  var item = roast.pendingConfirms[idx];
  if (!item) return;
  clearTimeout(item.timer);
  roast.pendingConfirms.splice(idx, 1);
  if (write){
    roast.triggeredLog.push({ t: item.t, label: item.label, temp: item.temp });
    drawLiveCurve();
  }
  renderConfirmPanel();
}
function hideEventConfirm(){
  if (roast && roast.pendingConfirms){
    roast.pendingConfirms.forEach(function(item){ clearTimeout(item.timer); });
    roast.pendingConfirms = [];
  }
  var panel = document.getElementById('eventConfirmPanel');
  panel.hidden = true;
  panel.classList.remove('capture-panel--active');
  document.getElementById('eventConfirmList').innerHTML = '';
}

// ---------- 烘豆中彈性更改風力／火力 ----------
function hideAdjustPanel(){
  var panel = document.getElementById('adjustPanel');
  panel.hidden = true;
  panel.classList.remove('capture-panel--active');
}
function clampAdjustValue(v){
  v = parseInt(v, 10);
  if (isNaN(v)) return 5;
  return Math.max(1, Math.min(9, v));
}
// 找出目前的風力／火力數值（紀錄中該類型最新一筆），沒有紀錄時預設 5
function getCurrentAdjustValue(type){
  if (!roast) return 5;
  var matches = roast.triggeredLog.filter(function(ev){ return ev.label.indexOf(type + ' ') === 0; });
  if (matches.length === 0) return 5;
  var latest = matches.reduce(function(a, b){ return a.t > b.t ? a : b; });
  return clampAdjustValue(latest.label.slice(type.length + 1));
}

function findNearestTemp(tempLog, t){
  if (tempLog.length === 0) return null;
  var best = tempLog[0], bestDiff = Math.abs(tempLog[0].t - t);
  tempLog.forEach(function(p){
    var diff = Math.abs(p.t - t);
    if (diff < bestDiff){ best = p; bestDiff = diff; }
  });
  return best.temp;
}

// 找出最接近 targetT 秒的溫度點，容許 5 秒誤差（用來算 RoR）
function findPointNear(tempLog, targetT, tolerance){
  var best = null, bestDiff = tolerance;
  tempLog.forEach(function(p){
    var diff = Math.abs(p.t - targetT);
    if (diff <= bestDiff){ best = p; bestDiff = diff; }
  });
  return best;
}

// 更新畫面上的即時 RoR（升溫速率）顯示
function updateRorReadout(){
  var el = document.getElementById('rorReadout');
  if (!el || !roast || roast.tempLog.length === 0) return;
  var latest = roast.tempLog[roast.tempLog.length - 1];
  var p30 = findPointNear(roast.tempLog, latest.t - 30, 5);
  var p60 = findPointNear(roast.tempLog, latest.t - 60, 5);
  var parts = [];
  parts.push(p30 ? ('30秒 ' + (latest.temp - p30.temp >= 0 ? '+' : '') + (latest.temp - p30.temp) + '°C') : '30秒 —');
  parts.push(p60 ? ('60秒 ' + (latest.temp - p60.temp >= 0 ? '+' : '') + (latest.temp - p60.temp) + '°C') : '60秒 —');
  el.textContent = 'RoR（升溫速率）' + parts.join(' ／ ');
}

// ---------- 烘焙摘要（DTR / 總升溫 / 失重） ----------
function findEventByKeyword(triggeredLog, keyword){
  var matches = triggeredLog.filter(function(ev){ return ev.label.indexOf(keyword) !== -1; });
  if (matches.length === 0) return null;
  return matches.reduce(function(a, b){ return a.t < b.t ? a : b; });
}

function computeSummary(){
  var summary = { dtrText: '—', riseText: '—', lossText: '—' };
  if (!roast) return summary;

  // 發展時間比 DTR = (結束時間 - 一爆開始時間) / 結束時間
  var firstCrack = findEventByKeyword(roast.crackEvents, '一爆');
  var dropEvent = findEventByKeyword(roast.crackEvents, '結束烘豆') || findEventByKeyword(roast.crackEvents, '下豆');
  var endT = dropEvent ? dropEvent.t : roast.elapsed;
  if (firstCrack && endT > firstCrack.t){
    var devTime = endT - firstCrack.t;
    var dtr = (devTime / endT) * 100;
    summary.dtrText = formatTime(devTime) + '　' + dtr.toFixed(1) + '%';
  }

  // 總升溫 = 下豆溫度（或最後一筆溫度）－ 回溫點溫度（或第一筆溫度）
  var tp = findEventByKeyword(roast.crackEvents, '回溫');
  var startTemp = tp && tp.temp != null ? tp.temp : (roast.tempLog[0] ? roast.tempLog[0].temp : null);
  var endTemp = dropEvent && dropEvent.temp != null ? dropEvent.temp : (roast.tempLog.length ? roast.tempLog[roast.tempLog.length - 1].temp : null);
  if (startTemp != null && endTemp != null){
    var rise = endTemp - startTemp;
    summary.riseText = (rise >= 0 ? '+' : '') + rise.toFixed(0) + '°C';
  }

  // 失重 = (烘前重量 － 烘後重量) / 烘前重量
  var weightAfter = parseFloat(document.getElementById('weightAfter').value);
  if (roast.weightBefore && !isNaN(weightAfter) && weightAfter > 0){
    var loss = ((roast.weightBefore - weightAfter) / roast.weightBefore) * 100;
    summary.lossText = loss.toFixed(1) + '%';
  }

  return summary;
}

// 找出離 targetT 最近、且在 tolerance 秒內的觸發事件，用來對齊表格欄位
function findNearestEventForColumn(triggeredLog, prefix, targetT, tolerance){
  var best = null, bestDiff = tolerance;
  triggeredLog.forEach(function(ev){
    if (ev.label.indexOf(prefix) !== 0) return;
    var diff = Math.abs(ev.t - targetT);
    if (diff <= bestDiff){ bestDiff = diff; best = ev; }
  });
  return best ? best.label.replace(prefix + ' ', '') : '';
}

// 計算「30秒升溫」列：當格溫度減「往回最近一個非事件欄位」的溫度，跳過事件（爆點）欄位當基準，
// 避免像 07:03 這種下一格緊接在事件欄位（如一爆起）之後時，誤用事件當下的溫度當作起點算出錯誤（甚至變 0）的結果
function compute30sRow(cols, isCrackCol){
  return cols.map(function(p, i){
    if (isCrackCol(p.t)) return null;
    var prevIdx = i - 1;
    while (prevIdx >= 0 && isCrackCol(cols[prevIdx].t)) prevIdx--;
    if (prevIdx < 0) return null;
    return Math.round(p.temp - cols[prevIdx].temp);
  });
}

// 計算「60秒升溫」列該顯示在哪些欄位、以及對應的溫度差
// 由於溫度紀錄的實際時間點會因手動送出延遲而偏離整30秒格（累積後可能偏離超過原本±5秒的容許值），
// 改用「找出離每個整分鐘標記最近的欄位」來決定顯示欄位，並動態往回找最接近60秒前的溫度點來計算溫度差，
// 不再假設「往回數兩欄一定是60秒前」，避免夾雜手動溫度／事件時間點時算錯或漏算
function compute60sRow(cols, isCrackCol){
  var n = cols.length;
  if (n === 0) return [];
  var maxT = cols[n - 1].t;
  var pickedIdx = {};
  var usedIdx = {};
  for (var m = 60; m <= maxT + 25; m += 60){
    var bestIdx = -1, bestDiff = 25; // 只在離整分鐘 25 秒內才算「接近整分鐘」
    cols.forEach(function(p, idx){
      if (isCrackCol(p.t) || usedIdx[idx]) return;
      var diff = Math.abs(p.t - m);
      if (diff < bestDiff){ bestDiff = diff; bestIdx = idx; }
    });
    if (bestIdx !== -1){ pickedIdx[bestIdx] = true; usedIdx[bestIdx] = true; }
  }

  return cols.map(function(p, i){
    if (isCrackCol(p.t) || !pickedIdx[i]) return null;
    var target = p.t - 60;
    var best = null, bestDiff = 20;
    for (var k = i - 1; k >= 0; k--){
      if (isCrackCol(cols[k].t)) continue;
      var diff = Math.abs(cols[k].t - target);
      if (diff < bestDiff){ bestDiff = diff; best = cols[k]; }
    }
    if (!best) return null;
    return Math.round(p.temp - best.temp);
  });
}

// 橫向表格：時間為欄，時間/溫度/30秒RoR/60秒RoR/風速/火力為列；targetId 可指定烘豆中或結果頁的表格
function renderLogTable(targetId){
  var body = document.getElementById(targetId || 'logTableBody');
  var cols = roast.tempLog.slice().sort(function(a, b){ return a.t - b.t; });
  if (cols.length === 0){
    body.innerHTML = '<tr><th></th><td class="log-table__empty">尚無溫度紀錄</td></tr>';
    return;
  }

  var rows = '';
  var crackTimes = (roast.crackEvents || []).map(function(e){ return e.t; });
  function isCrackCol(t){ return crackTimes.indexOf(t) !== -1; }
  function tdClass(base, t){
    var classes = [];
    if (base) classes.push(base);
    if (isCrackCol(t)) classes.push('lt-event-col');
    return classes.length ? (' class="' + classes.join(' ') + '"') : '';
  }

  rows += '<tr><th>時間</th>' + cols.map(function(p){
    return '<td' + tdClass(null, p.t) + '>' + formatTime(p.t) + '</td>';
  }).join('') + '</tr>';

  rows += '<tr><th>溫度</th>' + cols.map(function(p){
    return '<td' + tdClass('lt-temp', p.t) + '>' + p.temp + '</td>';
  }).join('') + '</tr>';

  var row30 = compute30sRow(cols, isCrackCol);
  rows += '<tr><th>30&quot;</th>' + cols.map(function(p, i){
    var v = row30[i];
    if (v == null) return '<td' + tdClass(null, p.t) + '></td>';
    return '<td' + tdClass('lt-ror', p.t) + '>' + v + '</td>';
  }).join('') + '</tr>';

  var row60 = compute60sRow(cols, isCrackCol);
  rows += '<tr><th>60&quot;</th>' + cols.map(function(p, i){
    var v = row60[i];
    if (v == null) return '<td' + tdClass(null, p.t) + '></td>';
    return '<td' + tdClass('lt-ror lt-ror-strong', p.t) + '>' + v + '</td>';
  }).join('') + '</tr>';

  rows += '<tr><th>事件</th>' + cols.map(function(p){
    var ev = (roast.crackEvents || []).find(function(e){ return e.t === p.t; });
    return '<td' + tdClass(ev ? 'lt-event-cell' : null, p.t) + '>' + (ev ? escapeHtml(ev.label) : '') + '</td>';
  }).join('') + '</tr>';

  rows += '<tr><th>風速</th>' + cols.map(function(p){
    return '<td' + tdClass(null, p.t) + '>' + escapeHtml(findNearestEventForColumn(roast.triggeredLog, '風力', p.t, 20)) + '</td>';
  }).join('') + '</tr>';

  rows += '<tr><th>火力</th>' + cols.map(function(p){
    return '<td' + tdClass(null, p.t) + '>' + escapeHtml(findNearestEventForColumn(roast.triggeredLog, '火力', p.t, 20)) + '</td>';
  }).join('') + '</tr>';

  body.innerHTML = rows;
}

// 生豆資訊表格：帶入設定頁填寫的生豆資訊，targetId 可指定烘豆中或結果頁的表格
function renderBeanInfoTable(targetId){
  var body = document.getElementById(targetId);
  if (!body || !roast) return;
  var b = roast.greenBean || {};
  function v(val){ return val ? escapeHtml(val) : '—'; }
  var rows =
    '<tr><th>國家／地區</th><td>' + v(b.origin) + '</td><th>莊園</th><td>' + v(b.farm) + '</td></tr>' +
    '<tr><th>公司</th><td>' + v(b.company) + '</td><th>品種</th><td>' + v(b.variety) + '</td></tr>' +
    '<tr><th>處理法</th><td>' + v(b.process) + '</td><th>價格／1kg</th><td>' + v(b.price) + '</td></tr>' +
    '<tr><th>瑕疵率（%）</th><td>' + v(b.defectRate) + '</td><th>含水率（%）</th><td>' + v(b.moisture) + '</td></tr>' +
    '<tr><th>密度</th><td>' + v(b.density) + '</td><th>備註</th><td>' + v(b.notes) + '</td></tr>';
  body.innerHTML = rows;
}

function renderSummary(){
  var s = computeSummary();
  document.getElementById('summaryDtr').textContent = s.dtrText;
  document.getElementById('summaryRise').textContent = s.riseText;
  document.getElementById('summaryLoss').textContent = s.lossText;
  return s;
}

// 粗粉差／細粉差 = 烘焙度（豆）－ 烘焙度（粗粉／細粉）
function updateRoastLevelDiffs(){
  var bean = parseFloat(document.getElementById('roastLevelBean').value);
  var coarse = parseFloat(document.getElementById('roastLevelCoarse').value);
  var fine = parseFloat(document.getElementById('roastLevelFine').value);
  document.getElementById('diffCoarse').textContent = (!isNaN(bean) && !isNaN(coarse)) ? Math.abs(bean - coarse).toFixed(1) : '—';
  document.getElementById('diffFine').textContent = (!isNaN(bean) && !isNaN(fine)) ? Math.abs(bean - fine).toFixed(1) : '—';
}

// ---------- 計時器 ----------
function tick(){
  if (!roast || !roast.running) return;
  resumeAudioCtx(); // 每秒檢查一次，iPhone 背景／閒置後 AudioContext 被 suspend 時可以盡快恢復
  var elapsed = roast.pausedElapsed + Math.floor((Date.now() - roast.startAt) / 1000);
  roast.elapsed = elapsed;
  document.getElementById('timerDisplay').textContent = formatTime(elapsed);

  if (roast.firstCrackTime != null){
    var devTime = elapsed - roast.firstCrackTime;
    var devPercent = elapsed > 0 ? (devTime / elapsed * 100) : 0;
    document.getElementById('devReadout').textContent = '發展時間 ' + formatTime(devTime) + '（' + devPercent.toFixed(1) + '%）';
  }

  // 提前3秒／2秒／1秒的「嘟」提示音，讓人先準備看溫度
  if (elapsed > 0 && (elapsed % 30 === 27 || elapsed % 30 === 28 || elapsed % 30 === 29) && roast.lastDuduAt !== elapsed){
    roast.lastDuduAt = elapsed;
    beep(600, 90, 0.55);
  }

  // 第30秒整的「嗶」聲，並跳出溫度輸入
  // 若此時「手動記溫／一爆起／一爆止／二爆起／二爆止」的溫度輸入正在進行中，先不要蓋掉它，
  // 等那筆溫度填完送出後，再補顯示這次的30秒溫度提示
  var onGridMark = (elapsed > 0 && elapsed % 30 === 0);
  if (onGridMark && roast.lastPromptAt !== elapsed){
    roast.lastPromptAt = elapsed;
    beep(1000, 220, 0.6);
    if (document.getElementById('tempPrompt').hidden){
      roast.pendingCrackLabel = null;
      showTempPrompt(true);
    } else {
      roast.pending30Mark = true;
    }
  }

  var hasNewConfirm = false;
  roast.events.forEach(function(ev){
    if (!ev.triggered && elapsed >= ev.seconds){
      ev.triggered = true;
      hasNewConfirm = true;
      var nearestTemp = findNearestTemp(roast.tempLog, elapsed);
      // 時間到了先用語音／嗶聲提醒，實際是否寫入紀錄改由彈出的確認提示決定；若風力、火力同時到時間，會同時列在提示清單中
      var pending = { t: elapsed, label: ev.label, temp: nearestTemp, timer: null };
      pending.timer = setTimeout(function(){
        var idx = roast.pendingConfirms.indexOf(pending);
        if (idx !== -1) resolvePendingConfirm(idx, true);
      }, 10000);
      roast.pendingConfirms.push(pending);

      if (onGridMark){
        // 跟30秒的嗶聲同一秒：等嗶聲播完後直接語音播報，不要再多一次嘟聲造成混淆
        setTimeout(function(){ speak(ev.label); }, 400);
      } else {
        // 一般情況：先兩聲提示音播完，再接語音，避免聲音疊在一起
        beep(720, 120, 0.55);
        setTimeout(function(){ beep(720, 120, 0.55); }, 180);
        setTimeout(function(){ speak(ev.label); }, 380);
      }
    }
  });

  if (hasNewConfirm) renderConfirmPanel();
}

// ---------- 事件綁定 ----------
document.addEventListener('DOMContentLoaded', function(){
  renderPlanEventList();

  var machineSelect = document.getElementById('machineSelect');
  machineSelect.addEventListener('change', function(){
    var selected = !!machineSelect.value;
    var isMini = machineSelect.value === 'Mini500';
    document.getElementById('panel-session').hidden = !selected;
    document.getElementById('panel-plan').hidden = !selected;
    document.getElementById('planFixedFields').hidden = !isMini;
    document.getElementById('planCustomSection').hidden = !(selected && !isMini);
    updateStartButton();
    applyRoastPlan();
  });
  document.getElementById('sessionTemp').addEventListener('input', updateStartButton);
  document.getElementById('beanOrigin').addEventListener('input', updateStartButton);
  document.getElementById('roasterName').addEventListener('input', updateStartButton);
  document.getElementById('weightBefore').addEventListener('input', function(){
    updateStartButton();
    applyRoastPlan();
  });

  // 時間（分/秒）只允許輸入數字
  ['newPlanEventMin', 'newPlanEventSec'].forEach(function(id){
    document.getElementById(id).addEventListener('input', function(){
      this.value = this.value.replace(/[^0-9]/g, '');
    });
  });
  // 數值只允許輸入 1-9 的單一數字
  document.getElementById('newPlanEventValue').addEventListener('input', function(){
    var digits = this.value.replace(/[^1-9]/g, '');
    this.value = digits.slice(-1);
  });

  // 新增自訂操作提醒
  document.getElementById('btnAddPlanEvent').addEventListener('click', function(){
    var min = parseInt(document.getElementById('newPlanEventMin').value || '0', 10);
    var sec = parseInt(document.getElementById('newPlanEventSec').value || '0', 10);
    var type = document.getElementById('newPlanEventType').value;
    var value = document.getElementById('newPlanEventValue').value.trim();
    var err = document.getElementById('planEventFormError');
    var seconds = (min || 0) * 60 + (sec || 0);
    if (seconds < 0){ err.textContent = '請輸入正確的時間'; return; }
    if (!value || !/^[1-9]$/.test(value)){ err.textContent = '請輸入 1-9 的數值'; return; }
    err.textContent = '';
    state.planEvents.push({ id: uid(), seconds: seconds, type: type, value: value });
    renderPlanEventList();
    document.getElementById('newPlanEventMin').value = '';
    document.getElementById('newPlanEventSec').value = '';
    document.getElementById('newPlanEventValue').value = '';
  });

  // 刪除自訂操作提醒
  function handlePlanEventDelete(e){
    var btn = e.target.closest('.event-list__del');
    if (!btn) return;
    state.planEvents = state.planEvents.filter(function(ev){ return ev.id !== btn.dataset.id; });
    renderPlanEventList();
  }
  document.getElementById('planEventListWind').addEventListener('click', handlePlanEventDelete);
  document.getElementById('planEventListFire').addEventListener('click', handlePlanEventDelete);

  // 開始烘豆
  document.getElementById('btnStartRoast').addEventListener('click', function(){
    var machineName = machineSelect.value;
    if (!machineName || !document.getElementById('roasterName').value.trim() || !document.getElementById('beanOrigin').value.trim() || !(parseFloat(document.getElementById('weightBefore').value) > 0) || !document.getElementById('sessionTemp').value.trim()) return;
    ensureAudioCtx();
    primeSpeech();

    roast = {
      machineName: machineName,
      dateStr: new Date().toLocaleString('zh-TW', { hour12: false }),
      startAt: Date.now(),
      pausedElapsed: 0,
      elapsed: 0,
      running: true,
      lastPromptAt: 0,
      lastDuduAt: 0,
      tempLog: [],
      triggeredLog: [],
      crackEvents: [],
      pendingCrackLabel: null,
      pendingFinish: false,
      pending30Mark: false,
      firstCrackTime: null,
      pendingConfirms: [],
      weightBefore: parseFloat(document.getElementById('weightBefore').value) || null,
      greenBean: {
        origin: document.getElementById('beanOrigin').value.trim(),
        farm: document.getElementById('beanFarm').value.trim(),
        company: document.getElementById('beanCompany').value.trim(),
        variety: document.getElementById('beanVariety').value.trim(),
        process: document.getElementById('beanProcess').value.trim(),
        price: document.getElementById('beanPrice').value.trim(),
        defectRate: document.getElementById('beanDefectRate').value.trim(),
        moisture: document.getElementById('beanMoisture').value.trim(),
        density: document.getElementById('beanDensity').value.trim(),
        notes: document.getElementById('beanNotes').value.trim()
      },
      session: {
        roasterName: document.getElementById('roasterName').value.trim(),
        temp: document.getElementById('sessionTemp').value.trim(),
        rpm: document.getElementById('sessionRpm').value.trim()
      },
      plan: {
        chargeTemp: document.getElementById('planChargeTemp').value.trim(),
        damper000: document.getElementById('planDamper000').value.trim(),
        power000: document.getElementById('planPower000').value.trim(),
        power200: document.getElementById('planPower200').value.trim(),
        power800: document.getElementById('planPower800').value.trim()
      },
      events: state.planEvents.map(function(ev){
        return { label: ev.type + ' ' + ev.value, seconds: ev.seconds, triggered: false };
      })
    };

    document.getElementById('appbarTitle').textContent = roast.machineName + ' 烘豆控制台';
    document.getElementById('roastMachineName').textContent = '烘豆師：' + (roast.session.roasterName || '—');
    document.getElementById('roastDate').textContent = roast.dateStr;
    document.getElementById('timerDisplay').textContent = '00:00';
    document.getElementById('rorReadout').textContent = 'RoR（升溫速率）－';
    document.getElementById('devReadout').hidden = true;
    document.querySelectorAll('.crack-btn').forEach(function(btn){ btn.disabled = false; });
    document.getElementById('weightAfter').value = '';
    document.getElementById('roastLevelBean').value = '';
    document.getElementById('roastLevelCoarse').value = '';
    document.getElementById('roastLevelFine').value = '';
    updateRoastLevelDiffs();
    document.getElementById('btnPauseResume').textContent = '暫停';
    hideTempPrompt();
    hideEventConfirm();
    hideAdjustPanel();

    // 0:00 起始溫度：Mini500 用「入豆溫度」（依重量對照表帶入），其他機型用環境溫度
    var startTemp;
    if (machineName === 'Mini500'){
      startTemp = parseFloat(document.getElementById('planChargeTemp').value);
    } else {
      startTemp = parseFloat(document.getElementById('sessionTemp').value);
    }
    if (!isNaN(startTemp)){
      roast.tempLog.push({ t: 0, temp: startTemp });
    }

    showScreen('roast');
    requestWakeLock();
    drawLiveCurve();
    timerInterval = setInterval(tick, 1000);
  });

  // 暫停 / 繼續
  document.getElementById('btnPauseResume').addEventListener('click', function(){
    var btn = document.getElementById('btnPauseResume');
    if (roast.running){
      roast.pausedElapsed = roast.elapsed;
      roast.running = false;
      clearInterval(timerInterval);
      btn.textContent = '繼續';
    } else {
      roast.startAt = Date.now();
      roast.running = true;
      timerInterval = setInterval(tick, 1000);
      btn.textContent = '暫停';
    }
  });

  // 手動記錄溫度
  document.getElementById('btnManualTemp').addEventListener('click', function(){
    roast.pendingCrackLabel = null;
    showTempPrompt(false);
  });

  // 一爆起／一爆止／二爆起／二爆止
  document.querySelectorAll('.crack-btn').forEach(function(btn){
    btn.addEventListener('click', function(){
      roast.pendingCrackLabel = btn.dataset.label;
      showTempPrompt(false, btn.dataset.label);
    });
  });

  // 溫度輸入送出
  document.getElementById('tempPromptForm').addEventListener('submit', function(e){
    e.preventDefault();
    var input = document.getElementById('tempPromptInput');
    var val = parseFloat(input.value);
    if (isNaN(val)) return;
    var elapsed = roast.elapsed;
    roast.tempLog.push({ t: elapsed, temp: val });
    if (roast.pendingCrackLabel){
      var crackLabel = roast.pendingCrackLabel;
      roast.crackEvents.push({ t: elapsed, label: crackLabel, temp: val });
      if (crackLabel === '一爆起' && roast.firstCrackTime == null){
        roast.firstCrackTime = elapsed;
        document.getElementById('devReadout').hidden = false;
      }
      var usedBtn = document.querySelector('.crack-btn[data-label="' + crackLabel + '"]');
      if (usedBtn) usedBtn.disabled = true;
      roast.pendingCrackLabel = null;
    }
    hideTempPrompt();
    if (roast.pendingFinish){
      roast.pendingFinish = false;
      finishRoast();
    } else {
      drawLiveCurve();
      updateRorReadout();
      if (roast.pending30Mark){
        roast.pending30Mark = false;
        showTempPrompt(true);
      }
    }
  });

  // 風力／火力提醒確認：按確認才寫入紀錄，按取消則不寫入；同時到時間的提醒會各自獨立列出
  document.getElementById('eventConfirmList').addEventListener('click', function(e){
    var btn = e.target.closest('button[data-action]');
    if (!btn) return;
    resolvePendingConfirm(parseInt(btn.dataset.idx, 10), btn.dataset.action === 'confirm');
  });

  // 更改風力／更改火力：烘豆過程中彈性調整烘焙計劃的數值，輸入框限 1-9，預設帶入目前數值，可用 -/+ 按鈕調整
  var adjustType = null;
  function openAdjustPanel(type, label){
    adjustType = type;
    document.getElementById('adjustPanelLabel').textContent = label + '（1-9）';
    document.getElementById('adjustPanelValue').value = String(getCurrentAdjustValue(type));
    var panel = document.getElementById('adjustPanel');
    panel.hidden = false;
    panel.classList.add('capture-panel--active');
  }
  document.getElementById('btnChangeFan').addEventListener('click', function(){ openAdjustPanel('風力', '更改風力'); });
  document.getElementById('btnChangePower').addEventListener('click', function(){ openAdjustPanel('火力', '更改火力'); });

  document.getElementById('adjustPanelValue').addEventListener('input', function(){
    var el = document.getElementById('adjustPanelValue');
    var digits = el.value.replace(/[^1-9]/g, '');
    el.value = digits.slice(-1);
  });

  document.getElementById('adjustPanelMinus').addEventListener('click', function(){
    var el = document.getElementById('adjustPanelValue');
    el.value = String(clampAdjustValue((parseInt(el.value, 10) || 5) - 1));
  });
  document.getElementById('adjustPanelPlus').addEventListener('click', function(){
    var el = document.getElementById('adjustPanelValue');
    el.value = String(clampAdjustValue((parseInt(el.value, 10) || 5) + 1));
  });

  document.getElementById('btnAdjustCancel').addEventListener('click', function(){
    adjustType = null;
    hideAdjustPanel();
  });

  document.getElementById('btnAdjustSubmit').addEventListener('click', function(){
    if (!roast || !adjustType) return;
    var val = clampAdjustValue(document.getElementById('adjustPanelValue').value);
    var elapsed = roast.elapsed;
    var nearestTemp = findNearestTemp(roast.tempLog, elapsed);
    roast.triggeredLog.push({ t: elapsed, label: adjustType + ' ' + val, temp: nearestTemp });
    adjustType = null;
    hideAdjustPanel();
    drawLiveCurve();
  });

  // 烘焙度（豆／粗粉／細粉）：即時計算粗粉差、細粉差
  ['roastLevelBean', 'roastLevelCoarse', 'roastLevelFine'].forEach(function(id){
    document.getElementById(id).addEventListener('input', updateRoastLevelDiffs);
  });

  // 結束烘豆：先跳出溫度輸入框，送出後才真正結束
  function finishRoast(){
    clearInterval(timerInterval);
    roast.running = false;
    releaseWakeLock();

    document.getElementById('resultMachineName').textContent = roast.machineName;
    document.getElementById('resultMeta').textContent = roast.dateStr + ' · 總時間 ' + formatTime(roast.elapsed);
    renderSummary();
    renderBeanInfoTable('resultBeanInfoBody');
    renderLogTable('logTableBody');

    showScreen('result');
    drawResultCurve();
  }
  function requestFinishRoast(){
    roast.pendingCrackLabel = '結束烘豆';
    roast.pendingFinish = true;
    showTempPrompt(false, '結束烘豆');
  }
  document.getElementById('btnFinishRoast').addEventListener('click', requestFinishRoast);
  document.getElementById('btnEndRoastQuick').addEventListener('click', requestFinishRoast);

  // 輸入烘後重量時即時重算失重
  document.getElementById('weightAfter').addEventListener('input', function(){
    if (roast) renderSummary();
  });

  // 開始新的烘焙
  document.getElementById('btnNewRoast').addEventListener('click', function(){
    roast = null;
    document.getElementById('appbarTitle').textContent = '烘焙控制台';
    showScreen('setup');
  });

  // 列印烘焙紀錄
  document.getElementById('btnPrintRoast').addEventListener('click', function(){
    window.print();
  });

  // 橫向事件時間軸表格（與畫面上「事件時間軸」表格版面一致）：時間為欄，各項目為列
  function buildExportTableRows(cols){
    var crackTimes = (roast.crackEvents || []).map(function(e){ return e.t; });
    function isCrackCol(t){ return crackTimes.indexOf(t) !== -1; }
    var rowDefs = [
      { label: '時間', cells: cols.map(function(p){ return { text: formatTime(p.t), crack: isCrackCol(p.t) }; }) },
      { label: '溫度', cells: cols.map(function(p){ return { text: String(p.temp), crack: isCrackCol(p.t), style: 'temp' }; }) },
      { label: '30"', cells: (function(){
          var row30 = compute30sRow(cols, isCrackCol);
          return cols.map(function(p, i){
            var v = row30[i];
            if (v == null) return { text: '', crack: isCrackCol(p.t) };
            return { text: String(v), crack: false, style: 'ror' };
          });
        })() },
      { label: '60"', cells: (function(){
          var row60 = compute60sRow(cols, isCrackCol);
          return cols.map(function(p, i){
            var v = row60[i];
            if (v == null) return { text: '', crack: isCrackCol(p.t) };
            return { text: String(v), crack: false, style: 'ror' };
          });
        })() },
      { label: '事件', cells: cols.map(function(p){
          var ev = (roast.crackEvents || []).find(function(e){ return e.t === p.t; });
          return { text: ev ? ev.label : '', crack: !!ev, style: ev ? 'event' : null };
        }) },
      { label: '風速', cells: cols.map(function(p){
          return { text: findNearestEventForColumn(roast.triggeredLog, '風力', p.t, 20), crack: isCrackCol(p.t) };
        }) },
      { label: '火力', cells: cols.map(function(p){
          return { text: findNearestEventForColumn(roast.triggeredLog, '火力', p.t, 20), crack: isCrackCol(p.t) };
        }) }
    ];
    return rowDefs;
  }

  function drawExportLogTable(ctx, x0, y0, cols){
    var labelColW = 58;
    var colW = 52;
    var rowH = 30;
    var rowDefs = buildExportTableRows(cols);
    var tableW = labelColW + cols.length * colW;
    var tableH = rowDefs.length * rowH;

    // 表格底板（淺色，與畫面上的表格一致）
    ctx.fillStyle = '#F3E9D8';
    ctx.fillRect(x0, y0, tableW, tableH);

    rowDefs.forEach(function(row, ri){
      var ry = y0 + ri * rowH;

      // 標題欄（第一欄，列名稱）
      ctx.fillStyle = '#E8D9BE';
      ctx.fillRect(x0, ry, labelColW, rowH);
      ctx.fillStyle = '#2A211B';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(row.label, x0 + 8, ry + rowH / 2 + 4);

      row.cells.forEach(function(cell, ci){
        var cx = x0 + labelColW + ci * colW;
        if (cell.style === 'event'){
          ctx.fillStyle = 'rgba(139,58,43,0.22)';
          ctx.fillRect(cx, ry, colW, rowH);
        } else if (cell.crack){
          ctx.fillStyle = 'rgba(139,58,43,0.10)';
          ctx.fillRect(cx, ry, colW, rowH);
        }
        if (cell.text){
          ctx.textAlign = 'center';
          if (cell.style === 'temp'){
            ctx.fillStyle = '#96521F'; ctx.font = 'bold 11px monospace';
          } else if (cell.style === 'ror'){
            ctx.fillStyle = '#8B3A2B'; ctx.font = '11px monospace';
          } else if (cell.style === 'event'){
            ctx.fillStyle = '#8B3A2B'; ctx.font = 'bold 10px sans-serif';
          } else {
            ctx.fillStyle = '#2A211B'; ctx.font = '11px monospace';
          }
          ctx.fillText(cell.text, cx + colW / 2, ry + rowH / 2 + 4);
        }
      });
    });

    // 格線
    ctx.strokeStyle = '#C9B693';
    ctx.lineWidth = 1;
    for (var r = 0; r <= rowDefs.length; r++){
      var ly = y0 + r * rowH;
      ctx.beginPath(); ctx.moveTo(x0, ly); ctx.lineTo(x0 + tableW, ly); ctx.stroke();
    }
    for (var c = 0; c <= cols.length; c++){
      var lx = x0 + labelColW + c * colW;
      ctx.beginPath(); ctx.moveTo(lx, y0); ctx.lineTo(lx, y0 + tableH); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(x0 + labelColW, y0); ctx.lineTo(x0 + labelColW, y0 + tableH); ctx.stroke();
    ctx.strokeRect(x0, y0, tableW, tableH);

    return { width: tableW, height: tableH };
  }

  // 生豆資訊表格：5 欄（列）× 2 列（行），每格上方標籤、下方數值，較不佔垂直空間
  function drawExportBeanInfoTable(ctx, x0, y0, tableW){
    var colCount = 5;
    var rowH = 46;
    var colW = tableW / colCount;
    var gb = roast.greenBean || {};
    function v(val){ return val || '—'; }
    var cells = [
      ['國家／地區', v(gb.origin)], ['莊園', v(gb.farm)], ['公司', v(gb.company)], ['品種', v(gb.variety)], ['處理法', v(gb.process)],
      ['價格／1kg', v(gb.price)], ['瑕疵率(%)', v(gb.defectRate)], ['含水率(%)', v(gb.moisture)], ['密度', v(gb.density)], ['備註', v(gb.notes)]
    ];
    var tableH = rowH * 2;

    ctx.fillStyle = '#F3E9D8';
    ctx.fillRect(x0, y0, tableW, tableH);

    cells.forEach(function(cell, idx){
      var row = Math.floor(idx / colCount);
      var col = idx % colCount;
      var cx = x0 + col * colW;
      var cy = y0 + row * rowH;
      ctx.textAlign = 'left';

      ctx.fillStyle = '#6B5D4F';
      ctx.font = '10.5px sans-serif';
      ctx.fillText(cell[0], cx + 8, cy + 17);

      var valText = cell[1];
      var maxW = colW - 16;
      ctx.font = 'bold 12px sans-serif';
      while (ctx.measureText(valText).width > maxW && valText.length > 1){
        valText = valText.slice(0, -1);
      }
      if (valText !== cell[1]) valText += '…';
      ctx.fillStyle = '#2A211B';
      ctx.fillText(valText, cx + 8, cy + 35);
    });

    ctx.strokeStyle = '#C9B693';
    ctx.lineWidth = 1;
    for (var r = 0; r <= 2; r++){
      var ly = y0 + r * rowH;
      ctx.beginPath(); ctx.moveTo(x0, ly); ctx.lineTo(x0 + tableW, ly); ctx.stroke();
    }
    for (var c = 0; c <= colCount; c++){
      var lx = x0 + c * colW;
      ctx.beginPath(); ctx.moveTo(lx, y0); ctx.lineTo(lx, y0 + tableH); ctx.stroke();
    }
    ctx.strokeRect(x0, y0, tableW, tableH);

    return tableH;
  }

  // 匯出 JPG
  document.getElementById('btnExportJpg').addEventListener('click', function(){
    if (!roast) return;
    var summary = computeSummary();
    var cols = roast.tempLog.slice().sort(function(a, b){ return a.t - b.t; });
    var labelColW = 58, colW = 52;
    var tableW = labelColW + Math.max(cols.length, 1) * colW;
    var w = Math.max(900, tableW + 48);
    var headerH = 144;
    var stepBandH = hasFanPowerEvents(roast.triggeredLog) ? 130 : 0;
    var chartH = 340 + stepBandH + (stepBandH > 0 ? 22 : 0);
    var beanTitleH = 34;
    var beanTableH = 2 * 46;
    var tableTitleH = 34;
    var tableH = Math.max(cols.length ? 7 * 30 : 30, 30);
    var totalH = headerH + chartH + beanTitleH + beanTableH + tableTitleH + tableH + 50;

    var canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = totalH;
    var ctx = canvas.getContext('2d');

    ctx.fillStyle = '#241712';
    ctx.fillRect(0, 0, w, totalH);

    var gb = roast.greenBean || {};
    var beanParts = [gb.origin, gb.farm, gb.process].filter(function(v){ return v; });
    var line1Text = (beanParts.length ? beanParts.join(' · ') + ' ' : '') + '烘焙紀錄';
    var line2Text = roast.machineName + '　烘豆師：' + ((roast.session && roast.session.roasterName) || '—') + '　' + roast.dateStr;
    var line3Text = '總時間 ' + formatTime(roast.elapsed) + '　DTR ' + summary.dtrText + '　總升溫 ' + summary.riseText + '　失重 ' + summary.lossText;
    var weightAfterVal = document.getElementById('weightAfter').value;
    var levelBean = document.getElementById('roastLevelBean').value;
    var levelCoarse = document.getElementById('roastLevelCoarse').value;
    var levelFine = document.getElementById('roastLevelFine').value;
    var levelBeanNum = parseFloat(levelBean);
    var diffCoarseVal = (!isNaN(levelBeanNum) && levelCoarse !== '' && !isNaN(parseFloat(levelCoarse))) ? Math.abs(levelBeanNum - parseFloat(levelCoarse)).toFixed(1) : null;
    var diffFineVal = (!isNaN(levelBeanNum) && levelFine !== '' && !isNaN(parseFloat(levelFine))) ? Math.abs(levelBeanNum - parseFloat(levelFine)).toFixed(1) : null;

    // 依序畫出多段不同顏色的文字，回傳畫完後的 x 座標
    function drawTextSegments(segments, x, y){
      segments.forEach(function(seg){
        ctx.fillStyle = seg.color;
        ctx.font = seg.font || '13px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(seg.text, x, y);
        x += ctx.measureText(seg.text).width;
      });
      return x;
    }

    ctx.fillStyle = '#F3E9D8';
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(line1Text, 24, 34);
    ctx.fillStyle = '#D9C6A3';
    ctx.font = '14px sans-serif';
    ctx.fillText(line2Text, 24, 58);
    ctx.fillStyle = '#BD6B2E';
    ctx.font = '13px monospace';
    ctx.fillText(line3Text, 24, 82);

    drawTextSegments([
      { text: '烘後重量 ' + (weightAfterVal || '—') + 'g　', color: '#D9C6A3' },
      { text: '烘焙度(豆) ' + (levelBean || '—') + '　', color: '#D9C6A3' },
      { text: '烘焙度(粗粉) ' + (levelCoarse || '—') + ' ', color: '#D9C6A3' },
      { text: '(粗粉差 ' + (diffCoarseVal != null ? diffCoarseVal : '—') + ')　', color: '#8B3A2B' },
      { text: '烘焙度(細粉) ' + (levelFine || '—') + ' ', color: '#D9C6A3' },
      { text: '(細粉差 ' + (diffFineVal != null ? diffFineVal : '—') + ')', color: '#8B3A2B' }
    ], 24, 106);

    renderChart(ctx, 24, headerH, w - 48, chartH - 20, roast.tempLog, roast.triggeredLog, stepBandH, roast.crackEvents);

    var beanY = headerH + chartH + beanTitleH;
    ctx.fillStyle = '#BD6B2E';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('生豆資訊', 24, beanY - 12);
    drawExportBeanInfoTable(ctx, 24, beanY, w - 48);

    var tableY = beanY + beanTableH + tableTitleH;
    ctx.fillStyle = '#BD6B2E';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('事件時間軸', 24, tableY - 12);

    if (cols.length === 0){
      ctx.fillStyle = '#c9b693';
      ctx.font = '14px sans-serif';
      ctx.fillText('尚無溫度紀錄', 24, tableY + 20);
    } else {
      drawExportLogTable(ctx, 24, tableY, cols);
    }

    ctx.fillStyle = '#c9b693';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('由烘焙控制台匯出', 24, totalH - 16);

    canvas.toBlob(function(blob){
      var dateStr = new Date().toISOString().slice(0, 10);
      var filename = 'roast-' + dateStr + '.jpg';

      // iPhone（iOS Safari）不支援 <a download> 直接存檔，只會開新分頁；
      // 支援 Web Share API 時改用系統分享面板，可以直接「儲存影像」到相簿
      var file = (typeof File !== 'undefined') ? new File([blob], filename, { type: 'image/jpeg' }) : null;
      if (file && navigator.canShare && navigator.canShare({ files: [file] })){
        navigator.share({ files: [file], title: filename }).catch(function(){});
        return;
      }

      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function(){ URL.revokeObjectURL(url); }, 2000);
    }, 'image/jpeg', 0.92);
  });

  window.addEventListener('resize', function(){
    if (!roast) return;
    if (!document.getElementById('screen-roast').hidden) drawLiveCurve();
    if (!document.getElementById('screen-result').hidden) drawResultCurve();
  });
});
