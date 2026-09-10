'use strict';

var state = {
  machines: [],
  events: []   // {id, label, seconds}
};

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

// ---------- 本機儲存：烘豆機 ----------
function loadMachines(){
  try{ return JSON.parse(localStorage.getItem('roast_machines') || '[]'); }
  catch(e){ return []; }
}
function saveMachines(){ localStorage.setItem('roast_machines', JSON.stringify(state.machines)); }

function renderMachineSelect(){
  var sel = document.getElementById('machineSelect');
  var current = sel.value;
  sel.innerHTML = '<option value="">請選擇烘豆機</option>' + state.machines.map(function(m){
    return '<option value="' + m.id + '">' + escapeHtml(m.name) + '</option>';
  }).join('');
  if (state.machines.some(function(m){ return m.id === current; })) sel.value = current;
  updateStartButton();
}

function updateStartButton(){
  var sel = document.getElementById('machineSelect');
  document.getElementById('btnStartRoast').disabled = !sel.value;
}

// ---------- 事件清單 ----------
function renderEventList(){
  var list = document.getElementById('eventList');
  if (state.events.length === 0){
    list.innerHTML = '<li class="event-list__empty">尚未加入事件，可用上方快速按鈕或自訂新增</li>';
    return;
  }
  var sorted = state.events.slice().sort(function(a,b){ return a.seconds - b.seconds; });
  list.innerHTML = sorted.map(function(ev){
    return '<li>' +
      '<span class="event-list__time">' + formatTime(ev.seconds) + '</span>' +
      '<span class="event-list__label">' + escapeHtml(ev.label) + '</span>' +
      '<button type="button" class="event-list__del" data-id="' + ev.id + '" aria-label="刪除 ' + escapeHtml(ev.label) + '">✕</button>' +
      '</li>';
  }).join('');
}

// ---------- 音效與語音 ----------
function ensureAudioCtx(){
  if (!audioCtx){
    var AC = window.AudioContext || window.webkitAudioContext;
    if (AC) audioCtx = new AC();
  }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}
function beep(freq, duration){
  var ctx = ensureAudioCtx();
  if (!ctx) return;
  var osc = ctx.createOscillator();
  var gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.value = 0.28;
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + duration / 1000);
}
function speak(text){
  if (!('speechSynthesis' in window)) return;
  var u = new SpeechSynthesisUtterance(text);
  var voices = window.speechSynthesis.getVoices();
  var zh = voices.find(function(v){ return /zh/i.test(v.lang); });
  if (zh) { u.voice = zh; u.lang = zh.lang; } else { u.lang = 'zh-TW'; }
  u.rate = 1;
  window.speechSynthesis.speak(u);
}

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
  if (document.visibilityState === 'visible' && roast && roast.running) requestWakeLock();
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

function renderChart(ctx, x0, y0, w, h, tempLog, triggeredLog){
  ctx.fillStyle = '#2c2016';
  ctx.fillRect(x0, y0, w, h);
  ctx.strokeStyle = 'rgba(243,232,211,0.14)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1);

  if (tempLog.length === 0){
    ctx.fillStyle = '#8a7a63';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('尚無溫度紀錄', x0 + w / 2, y0 + h / 2);
    return;
  }

  var padL = 40, padR = 14, padT = 14, padB = 24;
  var plotW = w - padL - padR, plotH = h - padT - padB;

  var allT = tempLog.map(function(p){ return p.t; }).concat(triggeredLog.map(function(e){ return e.t; }));
  var maxT = Math.max.apply(null, allT.concat([60]));
  var temps = tempLog.map(function(p){ return p.temp; });
  var maxTemp = Math.max.apply(null, temps.concat([220]));
  var minTemp = Math.min.apply(null, temps.concat([0]));
  if (maxTemp === minTemp) maxTemp = minTemp + 50;

  function xScale(t){ return x0 + padL + (t / maxT) * plotW; }
  function yScale(temp){ return y0 + padT + (1 - (temp - minTemp) / (maxTemp - minTemp)) * plotH; }

  // 溫度格線
  ctx.strokeStyle = 'rgba(243,232,211,0.08)';
  ctx.fillStyle = '#8a7a63';
  ctx.font = '10px monospace';
  ctx.textAlign = 'right';
  var step = 50;
  for (var t = Math.ceil(minTemp / step) * step; t <= maxTemp; t += step){
    var y = yScale(t);
    ctx.beginPath(); ctx.moveTo(x0 + padL, y); ctx.lineTo(x0 + w - padR, y); ctx.stroke();
    ctx.fillText(String(t), x0 + padL - 6, y + 3);
  }

  // 事件標記線
  triggeredLog.forEach(function(ev){
    var x = xScale(ev.t);
    ctx.strokeStyle = '#c1501e';
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, y0 + padT); ctx.lineTo(x, y0 + h - padB); ctx.stroke();
    ctx.setLineDash([]);
  });

  // 溫度曲線
  ctx.strokeStyle = '#e2a73b';
  ctx.lineWidth = 2;
  ctx.beginPath();
  tempLog.forEach(function(p, i){
    var x = xScale(p.t), y = yScale(p.temp);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.fillStyle = '#e2a73b';
  tempLog.forEach(function(p){
    ctx.beginPath(); ctx.arc(xScale(p.t), yScale(p.temp), 2.5, 0, Math.PI * 2); ctx.fill();
  });

  // 事件文字標籤
  ctx.fillStyle = '#f3e8d3';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'left';
  triggeredLog.forEach(function(ev){
    ctx.fillText(ev.label, xScale(ev.t) + 3, y0 + padT + 10);
  });

  // 時間刻度
  ctx.fillStyle = '#8a7a63';
  ctx.font = '10px monospace';
  ctx.textAlign = 'center';
  var xStep = maxT > 600 ? 120 : 60;
  for (var tt = 0; tt <= maxT; tt += xStep){
    ctx.fillText(formatTime(tt), xScale(tt), y0 + h - 8);
  }
}

function drawLiveCurve(){
  var canvas = document.getElementById('liveCurve');
  var ctx = resizeCanvas(canvas);
  renderChart(ctx, 0, 0, canvas.clientWidth, canvas.clientHeight, roast.tempLog, roast.triggeredLog);
}
function drawResultCurve(){
  var canvas = document.getElementById('resultCurve');
  var ctx = resizeCanvas(canvas);
  renderChart(ctx, 0, 0, canvas.clientWidth, canvas.clientHeight, roast.tempLog, roast.triggeredLog);
}

// ---------- 溫度輸入面板 ----------
function showTempPrompt(auto){
  var panel = document.getElementById('tempPrompt');
  document.getElementById('tempPromptLabel').textContent = auto ? '請輸入目前溫度' : '手動記錄溫度';
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

function addLiveLogRow(elapsed, text){
  var list = document.getElementById('liveLog');
  var empty = list.querySelector('.log-list__empty');
  if (empty) empty.remove();
  var li = document.createElement('li');
  li.innerHTML = '<span>' + formatTime(elapsed) + '</span><span>' + escapeHtml(text) + '</span>';
  list.insertBefore(li, list.firstChild);
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
  var firstCrack = findEventByKeyword(roast.triggeredLog, '一爆');
  var dropEvent = findEventByKeyword(roast.triggeredLog, '下豆');
  var endT = dropEvent ? dropEvent.t : roast.elapsed;
  if (firstCrack && endT > firstCrack.t){
    var dtr = ((endT - firstCrack.t) / endT) * 100;
    summary.dtrText = dtr.toFixed(1) + '%';
  }

  // 總升溫 = 下豆溫度（或最後一筆溫度）－ 回溫點溫度（或第一筆溫度）
  var tp = findEventByKeyword(roast.triggeredLog, '回溫');
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

function renderSummary(){
  var s = computeSummary();
  document.getElementById('summaryDtr').textContent = s.dtrText;
  document.getElementById('summaryRise').textContent = s.riseText;
  document.getElementById('summaryLoss').textContent = s.lossText;
  return s;
}

// ---------- 計時器 ----------
function tick(){
  if (!roast || !roast.running) return;
  var elapsed = roast.pausedElapsed + Math.floor((Date.now() - roast.startAt) / 1000);
  roast.elapsed = elapsed;
  document.getElementById('timerDisplay').textContent = formatTime(elapsed);

  if (elapsed > 0 && elapsed % 30 === 27 && roast.lastWarnAt !== elapsed){
    roast.lastWarnAt = elapsed;
    beep(660, 90); // 提前3秒的預警音，提醒先看一眼溫度
  }

  if (elapsed > 0 && elapsed % 30 === 0 && roast.lastPromptAt !== elapsed){
    roast.lastPromptAt = elapsed;
    beep(880, 150);
    showTempPrompt(true);
  }

  roast.events.forEach(function(ev){
    if (!ev.triggered && elapsed >= ev.seconds){
      ev.triggered = true;
      var nearestTemp = findNearestTemp(roast.tempLog, elapsed);
      roast.triggeredLog.push({ t: elapsed, label: ev.label, temp: nearestTemp });
      beep(720, 120);
      setTimeout(function(){ beep(720, 120); }, 180);
      speak(ev.label);
      addLiveLogRow(elapsed, '事件：' + ev.label);
      drawLiveCurve();
    }
  });
}

// ---------- 事件綁定 ----------
document.addEventListener('DOMContentLoaded', function(){
  state.machines = loadMachines();
  renderMachineSelect();
  renderEventList();

  var machineSelect = document.getElementById('machineSelect');
  machineSelect.addEventListener('change', updateStartButton);

  // 新增烘豆機
  var addMachineForm = document.getElementById('addMachineForm');
  document.getElementById('btnAddMachine').addEventListener('click', function(){
    addMachineForm.hidden = !addMachineForm.hidden;
    document.getElementById('machineFormError').textContent = '';
  });
  document.getElementById('btnCancelMachine').addEventListener('click', function(){
    addMachineForm.hidden = true;
  });
  document.getElementById('btnSaveMachine').addEventListener('click', function(){
    var name = document.getElementById('newMachineName').value.trim();
    var capacity = document.getElementById('newMachineCapacity').value.trim();
    var note = document.getElementById('newMachineNote').value.trim();
    var err = document.getElementById('machineFormError');
    if (!name){ err.textContent = '請輸入烘豆機名稱'; return; }
    err.textContent = '';
    var machine = { id: uid(), name: name, capacity: capacity, note: note };
    state.machines.push(machine);
    saveMachines();
    renderMachineSelect();
    machineSelect.value = machine.id;
    updateStartButton();
    document.getElementById('newMachineName').value = '';
    document.getElementById('newMachineCapacity').value = '';
    document.getElementById('newMachineNote').value = '';
    addMachineForm.hidden = true;
  });

  // 事件快速範本
  document.querySelectorAll('#eventTemplates .chip').forEach(function(chip){
    chip.addEventListener('click', function(){
      var seconds = parseInt(chip.dataset.seconds, 10);
      document.getElementById('newEventLabel').value = chip.dataset.label;
      document.getElementById('newEventMin').value = Math.floor(seconds / 60);
      document.getElementById('newEventSec').value = seconds % 60;
      document.getElementById('newEventLabel').focus();
    });
  });

  // 新增自訂事件
  document.getElementById('btnAddEvent').addEventListener('click', function(){
    var label = document.getElementById('newEventLabel').value.trim();
    var min = parseInt(document.getElementById('newEventMin').value || '0', 10);
    var sec = parseInt(document.getElementById('newEventSec').value || '0', 10);
    var err = document.getElementById('eventFormError');
    var seconds = (min || 0) * 60 + (sec || 0);
    if (!label){ err.textContent = '請輸入事件名稱'; return; }
    if (seconds <= 0){ err.textContent = '請輸入大於 0 的提醒時間'; return; }
    err.textContent = '';
    state.events.push({ id: uid(), label: label, seconds: seconds });
    renderEventList();
    document.getElementById('newEventLabel').value = '';
    document.getElementById('newEventMin').value = '';
    document.getElementById('newEventSec').value = '';
  });

  // 刪除事件（事件委派）
  document.getElementById('eventList').addEventListener('click', function(e){
    var btn = e.target.closest('.event-list__del');
    if (!btn) return;
    state.events = state.events.filter(function(ev){ return ev.id !== btn.dataset.id; });
    renderEventList();
  });

  // 開始烘豆
  document.getElementById('btnStartRoast').addEventListener('click', function(){
    var machine = state.machines.find(function(m){ return m.id === machineSelect.value; });
    if (!machine) return;
    ensureAudioCtx();

    roast = {
      machineName: machine.name,
      dateStr: new Date().toLocaleString('zh-TW', { hour12: false }),
      startAt: Date.now(),
      pausedElapsed: 0,
      elapsed: 0,
      running: true,
      lastPromptAt: 0,
      lastWarnAt: 0,
      tempLog: [],
      triggeredLog: [],
      weightBefore: parseFloat(document.getElementById('weightBefore').value) || null,
      events: state.events.map(function(ev){ return { label: ev.label, seconds: ev.seconds, triggered: false }; })
    };

    document.getElementById('roastMachineName').textContent = roast.machineName;
    document.getElementById('roastDate').textContent = roast.dateStr;
    document.getElementById('timerDisplay').textContent = '00:00';
    document.getElementById('liveLog').innerHTML = '<li class="log-list__empty">尚無紀錄</li>';
    document.getElementById('rorReadout').textContent = 'RoR（升溫速率）－';
    document.getElementById('weightAfter').value = '';
    document.getElementById('btnPauseResume').textContent = '暫停';
    hideTempPrompt();

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
    showTempPrompt(false);
  });

  // 溫度輸入送出
  document.getElementById('tempPromptForm').addEventListener('submit', function(e){
    e.preventDefault();
    var input = document.getElementById('tempPromptInput');
    var val = parseFloat(input.value);
    if (isNaN(val)) return;
    var elapsed = roast.elapsed;
    roast.tempLog.push({ t: elapsed, temp: val });
    addLiveLogRow(elapsed, '溫度 ' + val + '°C');
    hideTempPrompt();
    drawLiveCurve();
    updateRorReadout();
  });

  // 結束烘豆
  document.getElementById('btnFinishRoast').addEventListener('click', function(){
    clearInterval(timerInterval);
    roast.running = false;
    releaseWakeLock();

    document.getElementById('resultMachineName').textContent = roast.machineName;
    document.getElementById('resultMeta').textContent = roast.dateStr + ' · 總時間 ' + formatTime(roast.elapsed);
    renderSummary();

    var body = document.getElementById('eventTableBody');
    var sorted = roast.triggeredLog.slice().sort(function(a,b){ return a.t - b.t; });
    body.innerHTML = sorted.length ? sorted.map(function(ev){
      return '<tr><td>' + formatTime(ev.t) + '</td><td>' + escapeHtml(ev.label) + '</td><td>' + (ev.temp != null ? ev.temp + '°C' : '—') + '</td></tr>';
    }).join('') : '<tr><td colspan="3" class="event-table__empty">尚無事件紀錄</td></tr>';

    showScreen('result');
    drawResultCurve();
  });

  // 輸入烘後重量時即時重算失重
  document.getElementById('weightAfter').addEventListener('input', function(){
    if (roast) renderSummary();
  });

  // 開始新的烘焙
  document.getElementById('btnNewRoast').addEventListener('click', function(){
    state.events = [];
    roast = null;
    renderEventList();
    showScreen('setup');
  });

  // 匯出 JPG
  document.getElementById('btnExportJpg').addEventListener('click', function(){
    if (!roast) return;
    var summary = computeSummary();
    var w = 900;
    var headerH = 118;
    var chartH = 340;
    var rowH = 32;
    var tableHeaderH = 40;
    var sorted = roast.triggeredLog.slice().sort(function(a,b){ return a.t - b.t; });
    var rows = Math.max(sorted.length, 1);
    var tableH = tableHeaderH + rows * rowH + 16;
    var totalH = headerH + chartH + tableH + 50;

    var canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = totalH;
    var ctx = canvas.getContext('2d');

    ctx.fillStyle = '#221811';
    ctx.fillRect(0, 0, w, totalH);

    ctx.fillStyle = '#f3e8d3';
    ctx.font = 'bold 24px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(roast.machineName, 24, 40);
    ctx.fillStyle = '#b6a58a';
    ctx.font = '14px sans-serif';
    ctx.fillText(roast.dateStr + ' · 總時間 ' + formatTime(roast.elapsed), 24, 66);
    ctx.fillStyle = '#e2a73b';
    ctx.font = '13px monospace';
    ctx.fillText('DTR ' + summary.dtrText + '　總升溫 ' + summary.riseText + '　失重 ' + summary.lossText, 24, 92);

    renderChart(ctx, 24, headerH, w - 48, chartH - 20, roast.tempLog, roast.triggeredLog);

    var y = headerH + chartH + 16;
    ctx.fillStyle = '#e2a73b';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText('時間', 24, y);
    ctx.fillText('事件', 140, y);
    ctx.fillText('溫度', 420, y);
    y += 10;
    ctx.strokeStyle = 'rgba(243,232,211,0.2)';
    ctx.beginPath(); ctx.moveTo(24, y); ctx.lineTo(w - 24, y); ctx.stroke();
    y += 26;

    ctx.font = '14px monospace';
    if (sorted.length === 0){
      ctx.fillStyle = '#8a7a63';
      ctx.fillText('尚無事件紀錄', 24, y);
    } else {
      sorted.forEach(function(ev){
        ctx.fillStyle = '#e2a73b';
        ctx.fillText(formatTime(ev.t), 24, y);
        ctx.fillStyle = '#f3e8d3';
        ctx.fillText(ev.label, 140, y);
        ctx.fillText(ev.temp != null ? ev.temp + '°C' : '—', 420, y);
        y += rowH;
      });
    }

    ctx.fillStyle = '#8a7a63';
    ctx.font = '12px sans-serif';
    ctx.fillText('由烘焙控制台匯出', 24, totalH - 16);

    canvas.toBlob(function(blob){
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      var dateStr = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = 'roast-' + dateStr + '.jpg';
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
