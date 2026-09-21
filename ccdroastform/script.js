'use strict';

var state = { planEvents: [], miniFireEvents: [], miniDamperEvents: [] };  // planEvents: {id, seconds, type, value}（SR540/SR800 專用）
// miniFireEvents: {id, seconds, value, auto?}（Mini500 火力提醒，value 為 0.1-3.0 的字串）
// miniDamperEvents: {id, anchor, seconds, value, auto?}（Mini500 風門提醒，anchor 為空字串代表「無」，否則為錨定的爆點事件名稱）

var roast = null;         // active/finished roast data
var timerInterval = null;
var wakeLock = null;
var audioCtx = null;

// ---------- App 內建瀏覽器（LINE／IG／FB／微信等 WebView）偵測 ----------
// 這類 App 內建瀏覽器通常限制或阻擋「列印」「另存圖片」等功能，UA 字串裡大多會帶有各自 App 的專屬標記。
// 注意：先前曾用「Android 且 UA 含 ; wv)」這種通用寫法去猜測「是不是 WebView」，但這條規則太粗略，
// 在部分 Android 手機的預設瀏覽器上也可能誤判成 App 內建瀏覽器，造成「明明用瀏覽器開啟卻還是跳提示」，
// 所以拿掉這條通用判斷，只保留各家 App 專屬、不會跟一般瀏覽器 UA 混淆的關鍵字，避免誤判。
function isInAppBrowser(){
  var ua = navigator.userAgent || '';
  var patterns = [
    /FBAN|FBAV/i,                      // Facebook
    /Instagram/i,                      // Instagram
    /\bLine\//i,                       // LINE
    /MicroMessenger/i,                 // 微信 WeChat
    /TikTok|musical_ly|BytedanceWebview/i, // TikTok
    /\bThreads\b/i,                    // Threads
    /MQQBrowser|QQBrowser/i,           // QQ
    /WeiBo/i,                          // 微博
    /Snapchat/i                        // Snapchat
  ];
  return patterns.some(function(re){ return re.test(ua); });
}
document.addEventListener('DOMContentLoaded', function(){
  var overlay = document.getElementById('inAppBrowserOverlay');
  if (!overlay) return;
  // 顯示／隱藏一律直接設定 inline style，不依賴 hidden 屬性或 CSS 選擇器優先權，
  // 避免再次發生「CSS 規則蓋掉顯示狀態、導致怎麼按都關不掉」的問題
  function hideOverlay(){ overlay.style.display = 'none'; }
  function showOverlay(){ overlay.style.display = 'flex'; }

  if (isInAppBrowser()) showOverlay(); else hideOverlay();

  var dismissBtn = document.getElementById('btnDismissInAppNotice');
  if (dismissBtn) dismissBtn.addEventListener('click', hideOverlay);
  var closeBtn = document.getElementById('btnCloseInAppNotice');
  if (closeBtn) closeBtn.addEventListener('click', hideOverlay);
});

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

// ---------- 自訂操作提醒（風速／火力） ----------
function renderPlanEventList(){
  var wind = state.planEvents.filter(function(ev){ return ev.type === '風速'; }).sort(function(a,b){ return a.seconds - b.seconds; });
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

// ---------- 自訂操作提醒（Mini500 專用：火力／風門分開自訂） ----------
function renderMiniPlanEventList(){
  var fire = state.miniFireEvents.slice().sort(function(a, b){ return a.seconds - b.seconds; });
  var damper = state.miniDamperEvents.slice().sort(function(a, b){
    var aa = a.anchor || '', bb = b.anchor || '';
    if (aa !== bb) return aa === '' ? -1 : (bb === '' ? 1 : aa.localeCompare(bb));
    return a.seconds - b.seconds;
  });

  function renderList(elId, items, isDamper){
    var list = document.getElementById(elId);
    if (!list) return;
    if (items.length === 0){
      list.innerHTML = '<li class="event-list__empty">尚未加入</li>';
      return;
    }
    list.innerHTML = items.map(function(ev){
      var timeLabel = (isDamper && ev.anchor) ? (ev.anchor + '後 ' + formatTime(ev.seconds)) : formatTime(ev.seconds);
      return '<li>' +
        '<span class="event-list__time">' + escapeHtml(timeLabel) + '</span>' +
        '<span class="event-list__label">' + escapeHtml(ev.value) + '</span>' +
        '<button type="button" class="event-list__del" data-id="' + ev.id + '" aria-label="刪除">✕</button>' +
        '</li>';
    }).join('');
  }

  renderList('planMiniFireList', fire, false);
  renderList('planMiniDamperList', damper, true);
}

// ---------- 烘焙計劃預設曲線（Fresh Roast SR540／SR800）----------
// 每筆用 [秒數, 數值] 表示，匯入時會轉成跟手動新增一樣的 state.planEvents 項目
var ROAST_PLAN_PRESETS = {
  SR540: [
    {
      id: 'sr540-slow', label: 'SR540 慢烘淺焙',
      wind: [[0, 9], [120, 7], [180, 6], [240, 5]],
      fire: [[0, 2], [120, 4], [180, 5], [240, 6], [300, 7]]
    },
    {
      id: 'sr540-medium', label: 'SR540 中焙',
      wind: [[0, 9], [120, 7], [180, 6], [240, 5]],
      fire: [[0, 3], [120, 4], [180, 5], [240, 6], [300, 7], [360, 8], [420, 9]]
    },
    {
      id: 'sr540-fast', label: 'SR540 快烘深焙',
      wind: [[0, 9], [120, 7], [180, 6], [240, 5]],
      fire: [[0, 6], [240, 7], [300, 8]]
    }
  ],
  SR800: [
    {
      id: 'sr800-slow', label: 'SR800 慢烘淺焙',
      wind: [[0, 9], [120, 7], [240, 6], [360, 5]],
      fire: [[0, 1], [120, 3], [180, 4], [240, 5], [300, 6], [360, 7], [420, 8], [480, 9]]
    },
    {
      id: 'sr800-medium', label: 'SR800 中焙',
      wind: [[0, 9], [120, 7], [240, 6], [360, 5]],
      fire: [[0, 3], [120, 4], [180, 5], [240, 6], [300, 7], [360, 8], [420, 9]]
    },
    {
      id: 'sr800-fast', label: 'SR800 快烘深焙',
      wind: [[0, 9], [120, 7], [240, 6], [360, 5], [420, 4]],
      fire: [[0, 6], [240, 7], [300, 8], [360, 9]]
    }
  ]
};

// 依目前選擇的烘豆機，把對應的預設烘焙計劃列進下拉選單；不是 SR540／SR800 就清空
function renderPlanPresetOptions(){
  var select = document.getElementById('planPresetSelect');
  if (!select) return;
  var machine = document.getElementById('machineSelect').value;
  var presets = ROAST_PLAN_PRESETS[machine] || [];
  select.innerHTML = '<option value="">請選擇</option>' +
    presets.map(function(p){ return '<option value="' + p.id + '">' + escapeHtml(p.label) + '</option>'; }).join('');
}

// 匯入預設烘焙計劃：取代目前所有的風速／火力提醒
function importPlanPreset(presetId){
  var machine = document.getElementById('machineSelect').value;
  var presets = ROAST_PLAN_PRESETS[machine] || [];
  var preset = presets.find(function(p){ return p.id === presetId; });
  if (!preset) return;
  if (state.planEvents.length > 0){
    if (!window.confirm('匯入「' + preset.label + '」會取代目前已設定的風速／火力提醒，確定要繼續嗎？')) return;
  }
  var events = [];
  preset.wind.forEach(function(pair){
    events.push({ id: uid(), seconds: pair[0], type: '風速', value: String(pair[1]) });
  });
  preset.fire.forEach(function(pair){
    events.push({ id: uid(), seconds: pair[0], type: '火力', value: String(pair[1]) });
  });
  state.planEvents = events;
  renderPlanEventList();
}

// ---------- Mini500 專用：風門選項（順序固定，調整面板的 +/- 也依這個順序切換） ----------
var DAMPER_OPTIONS = ['全開','左5','左4','左3','左2','左1','中間','右1','右2','右3','右4','右5','全關'];

// ---------- 烘焙計劃：目前僅 Mini500 有對照表，依烘前重量自動帶入建議值 ----------
// 對照表裡的 power000/power200/power800 是「火力 x10」的整數（例如 4 代表 0.4），
// 實際帶入欄位時要除以10，欄位輸入範圍限制在 0.1-3.0
function getRoastPlan(weight){
  if (weight <= 225)  return { chargeTemp:130, damper000:'右2', power000:4, power200:6, power800:4, rpm:55 };
  if (weight <= 275)  return { chargeTemp:135, damper000:'右2', power000:5, power200:7, power800:5, rpm:56 };
  if (weight <= 325)  return { chargeTemp:140, damper000:'右2', power000:6, power200:8, power800:6, rpm:57 };
  if (weight <= 375)  return { chargeTemp:150, damper000:'右2', power000:7, power200:9, power800:7, rpm:58 };
  if (weight <= 425)  return { chargeTemp:155, damper000:'右2', power000:8, power200:10, power800:8, rpm:59 };
  return { chargeTemp:160, damper000:'右1', power000:9, power200:11, power800:9, rpm:60 };
}
function clearRoastPlan(){
  ['planChargeTemp','sessionRpm'].forEach(function(id){
    var el = document.getElementById(id);
    if (el) el.value = '';
  });
  state.miniFireEvents = [];
  state.miniDamperEvents = [];
  renderMiniPlanEventList();
}
// 依烘前重量帶入建議值：入豆溫度／轉速／初始風門直接填入欄位，回溫點火力、2:00 火力、8:00 火力
// 則以「自動帶入」的提醒項目加進火力清單（會先移除先前自動帶入的項目再重新加入，
// 使用者自己手動新增的提醒不受影響）；初始火力欄位維持使用者自行輸入的值（預設 0.1），不會被覆蓋。
// 風門提醒固定自動帶入「乾燥終點後 00:00 全開」「乾燥終點後 00:50 左2」「乾燥終點後 01:00 右2」
// 「一爆起後 00:50 全開」這四筆預設值，不論烘前重量多少都一樣（沒有對照表可查，是固定的操作建議）
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
  document.getElementById('sessionRpm').value = plan.rpm;
  document.getElementById('planDamperInit').value = plan.damper000;

  state.miniFireEvents = state.miniFireEvents.filter(function(ev){ return !ev.auto; });
  state.miniFireEvents.push({ id: uid(), seconds: 0, value: (plan.power000 / 10).toFixed(1), auto: true });
  state.miniFireEvents.push({ id: uid(), seconds: 120, value: (plan.power200 / 10).toFixed(1), auto: true });
  state.miniFireEvents.push({ id: uid(), seconds: 480, value: (plan.power800 / 10).toFixed(1), auto: true });

  state.miniDamperEvents = state.miniDamperEvents.filter(function(ev){ return !ev.auto; });
  state.miniDamperEvents.push({ id: uid(), anchor: '乾燥終點', seconds: 0, value: '全開', auto: true });
  state.miniDamperEvents.push({ id: uid(), anchor: '乾燥終點', seconds: 50, value: '左2', auto: true });
  state.miniDamperEvents.push({ id: uid(), anchor: '乾燥終點', seconds: 60, value: '右2', auto: true });
  state.miniDamperEvents.push({ id: uid(), anchor: '一爆起', seconds: 50, value: '全開', auto: true });

  renderMiniPlanEventList();
}

// ---------- 音效與語音 ----------
// iPhone（iOS Safari）在背景或閒置一段時間後會把 AudioContext 自動 suspend，
// resume() 又是非同步的：如果沒等 resume 完成就排音效，聲音會直接消失不會播放，
// 這是「風速／火力沒有聲音提醒」的主因，因此這裡改成等 resume 完成後才真正播放。
// 判斷是否為 iPhone／iPad（iPadOS 13+ 會偽裝成 MacIntel，用觸控點數輔助判斷）
function isIOS(){
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function ensureAudioCtx(){
  if (!audioCtx){
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    } catch (e){
      // 部分 Android 瀏覽器（如 Samsung Internet）在某些情況下建立 AudioContext 會丟出例外，
      // 這裡務必接住，避免整個「開始烘豆」的點擊處理被中斷、導致畫面完全沒反應
      audioCtx = null;
    }
  }
  return audioCtx;
}
function resumeAudioCtx(){
  if (audioCtx && audioCtx.state === 'suspended'){
    audioCtx.resume().catch(function(){});
  }
  keepAlivePlaying();
}
// iPhone 近期會在「靜音鍵切到靜音」或畫面閒置一段時間後，把 AudioContext 播出的嗶聲當成
// 一般背景音效而整個消音（即使 resume() 顯示已成功），這是「嘟嘟嘟嗶提醒聲不見了」的主因。
// 讓一段極短、幾乎無聲的 <audio> 維持在播放狀態，可以讓系統把這個分頁判定成「正在播放音訊」，
// 使後續 Web Audio 的嗶聲即使在靜音鍵開啟時也能正常播出；沒有播放中就嘗試重新播放一次即可。
function keepAlivePlaying(){
  var el = document.getElementById('silentKeepAlive');
  if (!el) return;
  if (el.paused){
    el.play().catch(function(){});
  }
}
// Android Chrome 的自動播放限制比較嚴格：AudioContext 必須在使用者手勢（點擊）當下就實際呼叫
// resume() 並播放過一次聲音才算「解鎖」，之後計時器（非使用者操作）裡才能正常播放嗶聲，
// 只呼叫 ensureAudioCtx() 建立 context、卻沒在手勢當下 resume＋播放，就是「Android沒有嗶聲」的主因。
var audioPrimed = false;
function primeAudio(){
  keepAlivePlaying(); // 在使用者手勢當下啟動，之後才有機會在背景／靜音鍵狀態下持續播放
  if (audioPrimed) return;
  var ctx = ensureAudioCtx();
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') ctx.resume().catch(function(){});
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    gain.gain.value = 0.0001; // 幾乎無聲，只是為了在手勢當下真正跑一次音效解鎖
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.05);
    audioPrimed = true;
  } catch (e){}
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
// 快取語音清單：iOS 上 getVoices() 一開始可能是空的，要等 voiceschanged 事件才拿得到完整清單，
// 沒快取、每次 speak() 才呼叫 getVoices() 容易在清單還沒載入時選到錯的語音（或選到英文語音）
var cachedVoices = [];
function refreshVoiceCache(){
  if ('speechSynthesis' in window){
    cachedVoices = window.speechSynthesis.getVoices() || [];
  }
}
if ('speechSynthesis' in window){
  refreshVoiceCache();
  window.speechSynthesis.onvoiceschanged = refreshVoiceCache;
}
// 選女聲的中文語音：光比對語系（zh-TW／zh-CN）選出來的語音在部分 iPhone 上仍可能是男聲，
// 所以先找名稱有明確標示女聲、或已知平台常見女聲名稱（iOS 的 Mei-Jia、Android/Chrome 的 Ting-Ting 等）的語音，
// 再排除名稱標示男聲的語音，最後才依語系優先序（zh-TW＞zh-CN＞任何zh）挑選
function pickZhVoice(){
  var voices = cachedVoices.length ? cachedVoices : (('speechSynthesis' in window) ? window.speechSynthesis.getVoices() : []);
  if (!voices || !voices.length) return null;
  var zhVoices = voices.filter(function(v){ return /^zh/i.test(v.lang); });
  if (!zhVoices.length) return null;

  var byKnownFemaleName = zhVoices.find(function(v){
    return /female|女/i.test(v.name) || /mei[-\s]?jia|ting[-\s]?ting|yating|shu-min/i.test(v.name);
  });
  if (byKnownFemaleName) return byKnownFemaleName;

  var nonMale = zhVoices.filter(function(v){ return !/male|男/i.test(v.name); });
  var pool = nonMale.length ? nonMale : zhVoices;
  return pool.find(function(v){ return v.lang === 'zh-TW'; }) ||
    pool.find(function(v){ return /^zh-TW/i.test(v.lang); }) ||
    pool.find(function(v){ return /^zh-CN/i.test(v.lang); }) ||
    pool[0];
}
function speak(text){
  if (!('speechSynthesis' in window)) return;
  // 注意：這裡刻意不在播放前呼叫 cancel()。Web Speech API 本身就會把多個 speak() 依序排隊播放，
  // 若在風速、火力同時觸發、幾乎同時呼叫 speak() 時貿然 cancel()，會把前一句正在播放或剛要開始的
  // 語音打斷／清掉，這正是「風速聲音不見」「第一個字被蓋住」的成因，改成不主動 cancel、讓它們照順序播完。
  var u = new SpeechSynthesisUtterance(text);
  if (isIOS()){
    // iOS Safari 有已知問題：明確指定 utterance.voice 有時反而會挑到系統預設（英文、常是男聲）的語音，
    // 只設定 lang 為 zh-TW、不指定 voice，才會正確用回系統內建的中文女聲（Mei-Jia）
    u.lang = 'zh-TW';
  } else {
    var zh = pickZhVoice();
    if (zh) { u.voice = zh; u.lang = zh.lang; } else { u.lang = 'zh-TW'; }
  }
  u.rate = 1;
  window.speechSynthesis.speak(u);
}
// iOS 的語音合成（speechSynthesis）跟 AudioContext 是兩套各自獨立的「解鎖」機制：
// AudioContext 解鎖了，不代表 speechSynthesis 之後也能在計時器（非使用者操作）裡正常發聲，
// 一定要先在使用者手勢（點擊）當下實際呼叫過一次 speak()，之後計時器觸發的語音才會真的有聲音。
// 只需要解鎖一次即可，之後不再重複呼叫，避免多次插入近乎無聲的語音打亂正常提醒的播放順序。
var speechPrimed = false;
function primeSpeech(){
  if (speechPrimed) return;
  if (!('speechSynthesis' in window)) return;
  try {
    var u = new SpeechSynthesisUtterance(' ');
    u.volume = 0.01;
    window.speechSynthesis.speak(u);
    speechPrimed = true;
  } catch (e){}
}
// 烘豆過程中，點擊畫面上的按鈕時嘗試解鎖／喚醒音效與語音（語音只會實際解鎖一次），
// 增加 iPhone 在螢幕鎖定、切換App或音訊被系統中斷後恢復正常提醒音的機會
document.addEventListener('DOMContentLoaded', function(){
  document.getElementById('screen-roast').addEventListener('click', function(){
    primeAudio();
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
    keepAlivePlaying();
    // 畫面從背景／螢幕關閉切回前景時，也順便把可能卡住的語音佇列恢復一次
    try {
      if ('speechSynthesis' in window && window.speechSynthesis.paused) window.speechSynthesis.resume();
    } catch (e){}
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
  return triggeredLog.some(function(ev){ return ev.label.indexOf('風速') === 0 || ev.label.indexOf('火力') === 0; });
}

// 風速／火力階梯圖，畫在主曲線下方，藍色F=風速、橘色P=火力，仿照烘豆機軟體常見畫法
// 風速／火力階梯圖：F、P 共用同一個數值刻度，數值相同時線會交叉，畫法參考烘豆機軟體常見樣式
function drawStepChart(ctx, x0, yTop, w, bandH, xScale, fanItems, powerItems, gridColor){
  // 風速／火力數值固定是 1-9，直接用 1-9 當作縮放範圍，這樣格線才會跟數值對得上
  var vMax = 9;
  var vMin = 0;
  var padTop = 14, padBottom = 14;
  var plotTop = yTop + padTop, plotBottom = yTop + bandH - padBottom;

  function yFor(v){
    if (v == null) return (plotTop + plotBottom) / 2;
    var clamped = Math.max(vMin, Math.min(vMax, v));
    return plotBottom - (clamped - vMin) / (vMax - vMin || 1) * (plotBottom - plotTop);
  }

  // 1-9 淺灰色網格，方便對照風速／火力數值
  ctx.strokeStyle = gridColor || 'rgba(42,33,27,0.12)';
  ctx.lineWidth = 1;
  for (var gv = 1; gv <= 9; gv++){
    var gy = yFor(gv);
    ctx.beginPath(); ctx.moveTo(x0, gy); ctx.lineTo(x0 + w, gy); ctx.stroke();
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
      var by = Math.max(plotTop + 1, Math.min(yTop + bandH - bh - 1, y - bh - 3));
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
  ctx.fillStyle = '#3E6B8A'; ctx.fillText('F 風速', x0, yTop + 4);
  ctx.fillStyle = '#BD6B2E'; ctx.fillText('P 火力', x0 + 44, yTop + 4);
}

// 圖表配色主題：dark 是原本畫面／JPG匯出用的深色版，light 是白底版（供列印使用）
var CHART_THEMES = {
  dark: {
    bg: '#241712', border: 'rgba(243,232,211,0.14)', gridLine: 'rgba(243,232,211,0.08)',
    axisText: '#c9b693', labelText: '#F3E9D8', legendText: '#F3E9D8', placeholderText: '#c9b693',
    bandDry: 'rgba(139,195,74,0.16)', bandMaillard: 'rgba(255,202,58,0.16)', bandDevelopment: 'rgba(224,102,102,0.18)'
  },
  light: {
    bg: '#ffffff', border: 'rgba(42,33,27,0.20)', gridLine: 'rgba(42,33,27,0.12)',
    axisText: '#6B5D4F', labelText: '#2A211B', legendText: '#2A211B', placeholderText: '#8a7a68',
    bandDry: 'rgba(139,195,74,0.22)', bandMaillard: 'rgba(255,202,58,0.22)', bandDevelopment: 'rgba(224,102,102,0.20)'
  }
};

function renderChart(ctx, x0, y0, w, h, tempLog, triggeredLog, stepBandH, crackEvents, theme, machine){
  var th = CHART_THEMES[theme] || CHART_THEMES.dark;
  var isMini = machine === 'Mini500';
  stepBandH = stepBandH || 0;
  var stepGap = stepBandH > 0 ? 22 : 0;

  ctx.fillStyle = th.bg;
  ctx.fillRect(x0, y0, w, h);
  ctx.strokeStyle = th.border;
  ctx.lineWidth = 1;
  ctx.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1);

  if (tempLog.length === 0){
    ctx.fillStyle = th.placeholderText;
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
  var maxTemp = Math.max.apply(null, temps.concat([250]));
  var minTemp = Math.min.apply(null, temps.concat([0]));
  if (maxTemp === minTemp) maxTemp = minTemp + 50;

  function xScale(t){ return x0 + padL + (t / maxT) * plotW; }
  function yScale(temp){ return y0 + padT + (1 - (temp - minTemp) / (maxTemp - minTemp)) * plotH; }

  // 烘焙階段背景色：SR540／SR800 維持原本固定 155°C 分期；Mini500 改用「乾燥終點」事件的實際溫度來分期
  // （乾燥終點以下為脫水期淡綠、乾燥終點至一爆起為梅納期淺黃、一爆起以上為發展期淺紅）
  // 尚未記錄對應事件時，後面的分期先不畫，整段當作前一期
  var firstCrack = findEventByKeyword(crackEvents || [], '一爆');
  var developmentStart = firstCrack ? firstCrack.temp : null;
  var dryEnd;
  if (isMini){
    var dryEndEvent = findEventByKeyword(crackEvents || [], '乾燥終點');
    dryEnd = dryEndEvent ? dryEndEvent.temp : null;
  } else {
    dryEnd = 155;
  }
  function fillTempBand(tLo, tHi, color){
    var lo = Math.max(minTemp, tLo);
    var hi = Math.min(maxTemp, tHi);
    if (hi <= lo) return;
    var yTop = yScale(hi);
    var yBottom = yScale(lo);
    ctx.fillStyle = color;
    ctx.fillRect(x0 + padL, yTop, plotW, yBottom - yTop);
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0 + padL, y0 + padT, plotW, plotH);
  ctx.clip();
  if (dryEnd == null){
    fillTempBand(-Infinity, Infinity, th.bandDry);
  } else {
    fillTempBand(-Infinity, dryEnd, th.bandDry);
    if (developmentStart != null){
      fillTempBand(dryEnd, developmentStart, th.bandMaillard);
      fillTempBand(developmentStart, Infinity, th.bandDevelopment);
    } else {
      fillTempBand(dryEnd, Infinity, th.bandMaillard);
    }
  }
  ctx.restore();

  // 溫度格線（左軸）
  ctx.strokeStyle = th.gridLine;
  ctx.fillStyle = th.axisText;
  ctx.font = '10px monospace';
  ctx.textAlign = 'right';
  var step = 50;
  for (var t = Math.ceil(minTemp / step) * step; t <= maxTemp; t += step){
    var y = yScale(t);
    ctx.beginPath(); ctx.moveTo(x0 + padL, y); ctx.lineTo(x0 + w - padR, y); ctx.stroke();
    ctx.fillText(String(t), x0 + padL - 6, y + 3);
  }

  // RoR 副軸（右側刻度）：SR540／SR800 維持原本依數值動態縮放（最小60）；
  // Mini500 改成固定上限20，且負值（升溫速率為負）直接不畫進線裡，只保留 0 與正值
  var rorSeries = computeRorSeries(tempLog);
  var rorMax;
  if (isMini){
    rorSeries = rorSeries.filter(function(r){ return r.ror >= 0; });
    rorMax = 20;
  } else {
    rorMax = 60;
    if (rorSeries.length){
      var maxAbs = Math.max.apply(null, rorSeries.map(function(r){ return Math.abs(r.ror); }).concat([10]));
      rorMax = Math.max(60, Math.ceil(maxAbs / 10) * 10);
    }
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
  var collisionThreshold = 80; // px，小於此距離視為時間接近
  // 不論標籤在上方還是下方，只要跟前一個事件的 x 位置太接近，都要往外再多拉開一層，
  // 避免像一爆止／結束烘豆這種一個上一個下、但時間點很接近的事件，標籤仍然擠在一起
  var lastX = null;
  var globalLevel = 0;
  sortedEvents.forEach(function(ev, idx){
    var side = (idx % 2 === 0) ? 'above' : 'below';
    ev._side = side;
    var x = xScale(ev.t);
    if (lastX !== null && Math.abs(x - lastX) < collisionThreshold){
      globalLevel++;
    } else {
      globalLevel = 0;
    }
    ev._labelLevel = globalLevel;
    lastX = x;
  });

  var lineGap = 12; // 兩行文字的行距
  sortedEvents.forEach(function(ev){
    var x = xScale(ev.t);
    var y = yScale(ev.temp);
    var lvl = ev._labelLevel || 0;
    var extraGap = lvl * 30;
    var extraShift = lvl * 56;
    var minY = y0 + padT + 4;
    var maxY = y0 + mainH - padB - 4 - lineGap;
    var line1Y, line2Y;
    if (ev._side === 'below'){
      line1Y = Math.max(minY, Math.min(maxY, y + 26 + extraGap));
      line2Y = line1Y + lineGap;
    } else {
      line2Y = Math.max(minY + lineGap, Math.min(maxY + lineGap, y - 20 - extraGap));
      line1Y = line2Y - lineGap;
    }
    var labelX = x - 22 - extraShift;
    var textX = Math.max(x0 + padL + 30, x - 25 - extraShift);

    ctx.strokeStyle = '#BD6B2E';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(labelX, (line1Y + line2Y) / 2); ctx.stroke();

    // 第一行：事件名稱＋時間
    ctx.fillStyle = th.labelText;
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
  ctx.fillStyle = th.legendText; ctx.fillText('BT', x0 + padL + 22, y0 + 17);
  ctx.strokeStyle = '#8B3A2B'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(x0 + padL + 4, y0 + 28); ctx.lineTo(x0 + padL + 18, y0 + 28); ctx.stroke();
  ctx.fillStyle = th.legendText; ctx.fillText('RoR', x0 + padL + 22, y0 + 31);

  // 時間刻度
  // Mini500 按下「回溫點」後，回溫點那一刻要接著標記「00:00」，之後的刻度都依回溫點重新歸零計算
  // （只改標籤文字與刻度落點，曲線本身仍照實際累計時間畫，不會因此變形）
  ctx.fillStyle = th.axisText;
  ctx.font = '10px monospace';
  ctx.textAlign = 'center';
  var xStep = maxT > 600 ? 120 : 60;
  var chartResetAt = null;
  if (isMini){
    var chartTpEvent = findEventByKeyword(crackEvents || [], '回溫點');
    chartResetAt = chartTpEvent ? chartTpEvent.t : null;
  }
  if (chartResetAt != null){
    for (var tt1 = 0; tt1 < chartResetAt; tt1 += xStep){
      ctx.fillText(formatTime(tt1), xScale(tt1), y0 + mainH - 8);
    }
    for (var tt2 = chartResetAt; tt2 <= maxT; tt2 += xStep){
      ctx.fillText(formatTime(tt2 - chartResetAt), xScale(tt2), y0 + mainH - 8);
    }
  } else {
    for (var tt = 0; tt <= maxT; tt += xStep){
      ctx.fillText(formatTime(tt), xScale(tt), y0 + mainH - 8);
    }
  }

  // 風速／火力階梯圖（僅在有這類事件時顯示），跟上方圖表隔開一段距離
  if (stepBandH > 0){
    var stepTop = y0 + mainH + stepGap;
    ctx.strokeStyle = th.border;
    ctx.beginPath(); ctx.moveTo(x0, stepTop - stepGap / 2); ctx.lineTo(x0 + w, stepTop - stepGap / 2); ctx.stroke();
    var fanItems = triggeredLog.filter(function(ev){ return ev.label.indexOf('風速') === 0; })
      .map(function(ev){ return { t: ev.t, value: ev.label.replace('風速 ', '') }; }).sort(function(a,b){ return a.t - b.t; });
    var powerItems = triggeredLog.filter(function(ev){ return ev.label.indexOf('火力') === 0; })
      .map(function(ev){ return { t: ev.t, value: ev.label.replace('火力 ', '') }; }).sort(function(a,b){ return a.t - b.t; });
    drawStepChart(ctx, x0 + padL, stepTop, w - padL - padR, stepBandH, xScale, fanItems, powerItems, th.gridLine);
  }
}

// 風速／火力階梯圖是依 1-9 數值設計的，Mini500 的「風門」不是數值、「火力」又改成 0.1-3.0，
// 跟這個階梯圖的畫法不相容，所以 Mini500 一律不顯示階梯圖，風門／火力只顯示在下方的事件時間軸表格
function drawLiveCurve(){
  var canvas = document.getElementById('liveCurve');
  var hasFP = roast.machineName !== 'Mini500' && hasFanPowerEvents(roast.triggeredLog);
  var stepBandH = hasFP ? 90 : 0;
  canvas.style.height = (180 + stepBandH + (hasFP ? 22 : 0)) + 'px';
  var ctx = resizeCanvas(canvas);
  renderChart(ctx, 0, 0, canvas.clientWidth, canvas.clientHeight, roast.tempLog, roast.triggeredLog, stepBandH, roast.crackEvents, 'light', roast.machineName);
  renderBeanInfoTable('liveBeanInfoBody');
  renderLogTable('liveLogTableBody');
}
function drawResultCurve(){
  var canvas = document.getElementById('resultCurve');
  var hasFP = roast.machineName !== 'Mini500' && hasFanPowerEvents(roast.triggeredLog);
  var stepBandH = hasFP ? 100 : 0;
  canvas.style.height = (260 + stepBandH + (hasFP ? 22 : 0)) + 'px';
  var ctx = resizeCanvas(canvas);
  renderChart(ctx, 0, 0, canvas.clientWidth, canvas.clientHeight, roast.tempLog, roast.triggeredLog, stepBandH, roast.crackEvents, 'light', roast.machineName);
}

// ---------- 溫度輸入面板 ----------
function showTempPrompt(auto, crackLabel){
  var panel = document.getElementById('tempPrompt');
  var label = crackLabel ? ('請輸入「' + crackLabel + '」溫度') : (auto ? '請輸入目前溫度' : '手動記溫');
  document.getElementById('tempPromptLabel').textContent = label;
  var input = document.getElementById('tempPromptInput');
  input.value = '';
  panel.hidden = false;
  panel.classList.add('capture-panel--active');
  // 記錄「彈出當下」的累計秒數，送出時一律用這個時間點，不用送出當下的時間，
  // 避免打字／猶豫太久導致實際記錄的時間點被延後
  if (roast) roast.pendingPromptElapsed = roast.elapsed;
  // 面板在畫面上的位置可能離目前捲動位置很遠（例如按下畫面最下方的「結束烘豆，查看結果」按鈕時，
  // 面板其實在畫面中段、當下不在可視範圍內），iPhone 在輸入框還沒捲進畫面內時 focus 常常悄悄失敗，
  // 游標不會真的跳進欄位、鍵盤也不會跳出來，使用者完全看不出來要輸入溫度，因此先捲動讓面板進入畫面
  if (typeof panel.scrollIntoView === 'function') panel.scrollIntoView({ block: 'center', behavior: 'smooth' });
  // 用兩層 requestAnimationFrame 等捲動與版面都穩定後再 focus，
  // 避免剛切換 hidden／捲動的當下某些手機瀏覽器 focus 不會生效，游標沒有真的跳進輸入欄位
  requestAnimationFrame(function(){
    requestAnimationFrame(function(){
      input.focus();
      if (typeof input.select === 'function') input.select();
    });
  });
}
function hideTempPrompt(){
  var panel = document.getElementById('tempPrompt');
  panel.hidden = true;
  panel.classList.remove('capture-panel--active');
}

// ---------- 風速／火力提醒的確認提示（時間到時除了語音提示外，需按確認才寫入紀錄；超過10秒沒動作則自動寫入） ----------
// 若風速、火力同時到達提醒時間，兩筆會同時列出，各自獨立確認／倒數，不互相排隊等待
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
// ---------- Mini500 專用：風門提醒的「事件錨點」排程 ----------
// 風門自訂提醒若選了事件（回溫點／乾燥終點／第一聲／一爆起／一爆止／二爆起／二爆止），
// 不會有固定的絕對觸發時間，要等該事件真的被記錄下來時，才依「事件發生時間＋設定的分:秒」動態排入 roast.events，
// 用跟固定時間提醒完全相同的「嗶聲＋語音＋確認寫入」流程處理
function scheduleAnchoredDamperEvents(anchorLabel, anchorT){
  if (!roast || !roast.pendingAnchorEvents) return;
  roast.pendingAnchorEvents.forEach(function(item){
    if (item.scheduled || item.anchor !== anchorLabel) return;
    item.scheduled = true;
    roast.events.push({ label: '風門 ' + item.value, seconds: anchorT + item.offsetSeconds, triggered: false });
  });
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

// ---------- 烘豆中彈性更改風速／火力 ----------
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
// 找出目前的風速／火力數值（紀錄中該類型最新一筆），沒有紀錄時預設 5
function getCurrentAdjustValue(type){
  if (!roast) return 5;
  var matches = roast.triggeredLog.filter(function(ev){ return ev.label.indexOf(type + ' ') === 0; });
  if (matches.length === 0) return 5;
  var latest = matches.reduce(function(a, b){ return a.t > b.t ? a : b; });
  return clampAdjustValue(latest.label.slice(type.length + 1));
}

// ---------- Mini500 專用：風門（1-9 以外，改成從固定選項清單裡選）／火力（0.1-3.0 小數）的調整邏輯 ----------
function clampPowerDecimal(v){
  v = parseFloat(v);
  if (isNaN(v)) v = 1;
  v = Math.max(0.1, Math.min(3.0, v));
  return Math.round(v * 10) / 10;
}
// 依 DAMPER_OPTIONS 清單的順序，往前／往後切換一格（超出範圍就停在頭尾，不循環）
function stepDamperValue(current, delta){
  var idx = DAMPER_OPTIONS.indexOf(current);
  if (idx === -1) idx = 6; // 找不到目前值時，預設從「中間」開始
  idx = Math.max(0, Math.min(DAMPER_OPTIONS.length - 1, idx + delta));
  return DAMPER_OPTIONS[idx];
}
// 找出目前的風門數值（紀錄中最新一筆風門），沒有紀錄時預設用設定頁帶入的初始風門
function getCurrentDamperValue(){
  if (!roast) return DAMPER_OPTIONS[6];
  var matches = roast.triggeredLog.filter(function(ev){ return ev.label.indexOf('風門 ') === 0; });
  if (matches.length === 0){
    var initial = roast.plan && roast.plan.damperInit;
    return (initial && DAMPER_OPTIONS.indexOf(initial) !== -1) ? initial : DAMPER_OPTIONS[6];
  }
  var latest = matches.reduce(function(a, b){ return a.t > b.t ? a : b; });
  return latest.label.slice(3);
}
// 找出目前的火力數值（Mini500 的小數版本，紀錄中最新一筆火力），沒有紀錄時預設用設定頁帶入的初始火力
function getCurrentPowerDecimal(){
  if (!roast) return '1.0';
  var matches = roast.triggeredLog.filter(function(ev){ return ev.label.indexOf('火力 ') === 0; });
  if (matches.length === 0){
    var initial = roast.plan && parseFloat(roast.plan.powerInit);
    return clampPowerDecimal(initial || 1).toFixed(1);
  }
  var latest = matches.reduce(function(a, b){ return a.t > b.t ? a : b; });
  return clampPowerDecimal(latest.label.slice(3)).toFixed(1);
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

// 曲線下面積（梯形法積分溫度對時間），當作「總熱能」的相對比較指標：
// 面積越大代表整段烘焙過程中溫度（豆溫）累積得越高／越久，可以用來比較不同烘焙之間的熱量差異，
// 單位是 °C·分（溫度乘以時間），不是實際物理熱力學上的焦耳，只是一個方便比較的相對數值
function computeThermalEnergy(tempLog, crackEvents, machineName){
  var pts = (tempLog || []).slice().sort(function(a, b){ return a.t - b.t; });
  // Mini500：總熱能只算「回溫點之後」的曲線下面積（回溫點溫度不清空紀錄，但積分只取回溫點（含）以後的點）
  if (machineName === 'Mini500'){
    var tpMatches = (crackEvents || []).filter(function(e){ return e.label === '回溫點'; });
    if (tpMatches.length){
      var tp = tpMatches.reduce(function(a, b){ return a.t < b.t ? a : b; });
      pts = pts.filter(function(p){ return p.t >= tp.t; });
    }
  }
  if (pts.length < 2) return null;
  var area = 0;
  for (var i = 1; i < pts.length; i++){
    var dt = pts[i].t - pts[i - 1].t;
    area += dt * (pts[i].temp + pts[i - 1].temp) / 2;
  }
  // 扣除起始溫度（入豆溫度／Mini500 則為回溫點溫度）以下、一路到 0 度的矩形面積，只算「超出起始溫度」的部分，
  // 避免每次烘焙起始溫度不同時，這段基準值把總熱能的數字灌高、失去比較意義
  var chargeTemp = pts[0].temp;
  var totalT = pts[pts.length - 1].t - pts[0].t;
  area -= chargeTemp * totalT;
  return area / 60; // 秒轉分鐘，單位變成 °C·分
}

function computeSummary(){
  var summary = { dtrText: '—', devTimeText: '—', devPercentText: '—', devRiseText: '—', riseText: '—', lossText: '—', energyText: '—' };
  if (!roast) return summary;

  // 發展時間比 DTR = (結束時間 - 一爆開始時間) / 結束時間，拆成「發展時間」「發展百分比」兩個獨立數值顯示
  var firstCrack = findEventByKeyword(roast.crackEvents, '一爆');
  var dropEvent = findEventByKeyword(roast.crackEvents, '結束烘豆') || findEventByKeyword(roast.crackEvents, '下豆');
  var endT = dropEvent ? dropEvent.t : roast.elapsed;
  if (firstCrack && endT > firstCrack.t){
    var devTime = endT - firstCrack.t;
    var dtr = (devTime / endT) * 100;
    summary.devTimeText = formatTime(devTime);
    summary.devPercentText = dtr.toFixed(1) + '%';
    summary.dtrText = summary.devTimeText + '　' + summary.devPercentText;
  }

  // 總升溫 = 下豆溫度（或最後一筆溫度）－ 回溫點溫度（或第一筆溫度）
  var tp = findEventByKeyword(roast.crackEvents, '回溫');
  var startTemp = tp && tp.temp != null ? tp.temp : (roast.tempLog[0] ? roast.tempLog[0].temp : null);
  var endTemp = dropEvent && dropEvent.temp != null ? dropEvent.temp : (roast.tempLog.length ? roast.tempLog[roast.tempLog.length - 1].temp : null);
  if (startTemp != null && endTemp != null){
    var rise = endTemp - startTemp;
    summary.riseText = (rise >= 0 ? '+' : '') + rise.toFixed(0) + '°C';
  }

  // 發展期升溫 = 下豆溫度（或最後一筆溫度）－ 一爆起溫度
  if (firstCrack && firstCrack.temp != null && endTemp != null){
    var devRise = endTemp - firstCrack.temp;
    summary.devRiseText = (devRise >= 0 ? '+' : '') + devRise.toFixed(0) + '°C';
  }

  // 失重 = (烘前重量 － 烘後重量) / 烘前重量
  var weightAfter = parseFloat(document.getElementById('weightAfter').value);
  if (roast.weightBefore && !isNaN(weightAfter) && weightAfter > 0){
    var loss = ((roast.weightBefore - weightAfter) / roast.weightBefore) * 100;
    summary.lossText = loss.toFixed(1) + '%';
  }

  // 總熱能：溫度曲線下面積
  var energy = computeThermalEnergy(roast.tempLog, roast.crackEvents, roast.machineName);
  if (energy != null){
    summary.energyText = energy.toFixed(0) + ' °C·分';
  }

  return summary;
}

// 幫「風速／火力」欄位做一對一配對：每個事件只會配到離它最近的一個欄位。
// 原本的做法是每一欄各自獨立找「容許誤差內最近的事件」，若兩個相鄰欄位剛好都落在同一個事件的容許誤差
// 範圍內（例如 02:41、03:03 都在 20 秒內能配到 03:00 觸發的事件），就會讓同一筆事件被重複帶入兩欄，
// 例如「02:41 只有手動記溫」卻被誤帶入 03:00 的風速值。改成先列出所有「事件—欄位」的合法配對，
// 依距離由近到遠排序，再依序搶配（一個事件配一欄、一欄配一個事件），確保不會重複。
// resetAt（Mini500 專用）：回溫點那一欄單純是溫度事件紀錄，不參與風門／火力配對。
function buildEventColumnMap(cols, triggeredLog, prefix, tolerance, resetAt){
  var candidates = [];
  var allEvents = [];
  triggeredLog.forEach(function(ev){
    if (ev.label.indexOf(prefix) !== 0) return;
    // 回溫點當下（或非常接近回溫點）就生效的提醒，畫面上已經由回溫點後新增的「00:00」欄位直接帶出數值，
    // 這裡完全不再參與配對，避免因為回溫點欄位、00:00 欄位都不能配對，被硬塞到回溫點前後的欄位、造成誤導
    if (resetAt != null && Math.abs(ev.t - resetAt) <= tolerance) return;
    allEvents.push(ev);
    cols.forEach(function(p, idx){
      if (p.synthetic) return; // 回溫點後新增的「00:00」欄位是帶入既有範本值的展示欄，不參與事件配對，避免搶走真正的紀錄
      if (resetAt != null && p.t === resetAt) return; // 回溫點欄位單純記錄溫度事件，不標記風門／火力
      var diff = Math.abs(ev.t - p.t);
      if (diff <= tolerance) candidates.push({ ev: ev, idx: idx, diff: diff });
    });
  });
  candidates.sort(function(a, b){ return a.diff - b.diff; });
  var usedCols = {};
  var usedEvents = [];
  var map = {};
  candidates.forEach(function(c){
    if (usedCols[c.idx] || usedEvents.indexOf(c.ev) !== -1) return;
    usedCols[c.idx] = true;
    usedEvents.push(c.ev);
    map[c.idx] = c.ev.label.replace(prefix + ' ', '');
  });

  // 若兩筆事件時間太接近、搶著配同一欄，容許誤差內較遠的那筆會完全配不到欄位而消失不見。
  // 這裡讓還沒配到欄位的事件，往它理想欄位（不限容許誤差）的「前一欄」找還沒被用掉的欄位補記錄，
  // 這樣較早發生的那筆會被記到前一格，而不是整筆不見
  allEvents.forEach(function(ev){
    if (usedEvents.indexOf(ev) !== -1) return;
    var nearestIdx = -1, nearestDiff = Infinity;
    cols.forEach(function(p, idx){
      if (p.synthetic) return;
      if (resetAt != null && p.t === resetAt) return;
      var diff = Math.abs(ev.t - p.t);
      if (diff < nearestDiff){ nearestDiff = diff; nearestIdx = idx; }
    });
    if (nearestIdx === -1) return;
    for (var idx2 = nearestIdx; idx2 >= 0; idx2--){
      if (cols[idx2].synthetic) continue;
      if (resetAt != null && cols[idx2].t === resetAt) continue;
      if (usedCols[idx2]) continue;
      usedCols[idx2] = true;
      usedEvents.push(ev);
      map[idx2] = ev.label.replace(prefix + ' ', '');
      break;
    }
  });

  return map;
}

// 計算「30秒升溫」列：當格溫度減「最接近30秒前」的欄位溫度，而不是單純往回數一欄。
// 因為有手動記溫時會插入不是整30秒格的欄位（例如 02:22 是手動記溫），若只是「往回一欄」，
// 02:32 這種緊接在手動記溫欄位後面的整30秒格，就會誤用只隔 10 秒的 02:22 來算，而不是真正30秒前的 02:02，
// 改成動態往回找離「目前時間－30秒」最接近（且在容許誤差內）的欄位，跳過事件（爆點）欄位當基準
function compute30sRow(cols, isCrackCol){
  return cols.map(function(p, i){
    if (isCrackCol(p.t) || p.synthetic) return null;
    var target = p.t - 30;
    var best = null, bestDiff = 15; // 只在離「30秒前」15秒內才算數
    for (var k = i - 1; k >= 0; k--){
      if (isCrackCol(cols[k].t) || cols[k].synthetic) continue;
      var diff = Math.abs(cols[k].t - target);
      if (diff < bestDiff){ bestDiff = diff; best = cols[k]; }
    }
    if (!best) return null;
    return Math.round(p.temp - best.temp);
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
      if (isCrackCol(p.t) || p.synthetic || usedIdx[idx]) return;
      var diff = Math.abs(p.t - m);
      if (diff < bestDiff){ bestDiff = diff; bestIdx = idx; }
    });
    if (bestIdx !== -1){ pickedIdx[bestIdx] = true; usedIdx[bestIdx] = true; }
  }

  return cols.map(function(p, i){
    if (isCrackCol(p.t) || p.synthetic || !pickedIdx[i]) return null;
    var target = p.t - 60;
    var best = null, bestDiff = 20;
    for (var k = i - 1; k >= 0; k--){
      if (isCrackCol(cols[k].t) || cols[k].synthetic) continue;
      var diff = Math.abs(cols[k].t - target);
      if (diff < bestDiff){ bestDiff = diff; best = cols[k]; }
    }
    if (!best) return null;
    return Math.round(p.temp - best.temp);
  });
}

// 事件時間軸欄位：一般用溫度紀錄（tempLog）依時間排序後的每一點當一欄；
// Mini500 若已經按過「回溫點」，會在回溫點那一欄後面多插入一欄代表「歸零後的 00:00」，
// 帶入回溫點當下即將生效的火力設定，方便直接看到重新計時後的起點（這欄是展示用，不是真正的溫度紀錄，
// 30"/60" 升溫與風門／火力配對都會跳過它）
function buildLogCols(){
  var cols = roast.tempLog.slice().sort(function(a, b){ return a.t - b.t; });
  if (roast.machineName === 'Mini500' && roast.resetMarker){
    var rm = roast.resetMarker;
    var idx = -1;
    for (var i = 0; i < cols.length; i++){
      if (cols[i].t === rm.t) idx = i;
    }
    if (idx !== -1){
      var marker = { t: rm.t, temp: rm.temp, synthetic: true, power: rm.power };
      cols = cols.slice(0, idx + 1).concat([marker], cols.slice(idx + 1));
    }
  }
  return cols;
}

// 欄位「時間」列要顯示的文字：回溫點之後（不含回溫點自己那一欄）都改成相對於回溫點重新歸零的時間，
// 回溫點之前的欄位、以及回溫點自己那一欄，維持顯示原本的絕對累計時間
function displayColTime(p){
  if (p.synthetic) return '00:00';
  if (roast.machineName === 'Mini500' && roast.resetAt != null && p.t > roast.resetAt){
    return formatTime(p.t - roast.resetAt);
  }
  return formatTime(p.t);
}

// 橫向表格：時間為欄，時間/溫度/30秒RoR/60秒RoR/風速/火力為列；targetId 可指定烘豆中或結果頁的表格
// 烘豆中的表格（liveLogTableBody）額外加一列刪除按鈕，方便刪掉新增錯誤的溫度紀錄
function renderLogTable(targetId){
  var isLive = (targetId === 'liveLogTableBody');
  var body = document.getElementById(targetId || 'logTableBody');
  var cols = buildLogCols();
  if (cols.length === 0){
    body.innerHTML = '<tr><th></th><td class="log-table__empty">尚無溫度紀錄</td></tr>';
    return;
  }

  var rows = '';
  var crackTimes = (roast.crackEvents || []).map(function(e){ return e.t; });
  function isCrackCol(t){ return crackTimes.indexOf(t) !== -1; }
  // 回溫點後新增的「00:00」欄位單純是展示用的參考欄，不是真正的事件，樣式維持跟一般欄位一樣，不特別醒目
  function tdClass(base, p){
    var classes = [];
    if (base) classes.push(base);
    if (!p.synthetic && isCrackCol(p.t)) classes.push('lt-event-col');
    return classes.length ? (' class="' + classes.join(' ') + '"') : '';
  }

  rows += '<tr><th>時間</th>' + cols.map(function(p){
    return '<td' + tdClass(null, p) + '>' + displayColTime(p) + '</td>';
  }).join('') + '</tr>';

  rows += '<tr><th>溫度</th>' + cols.map(function(p){
    return '<td' + tdClass('lt-temp', p) + '>' + p.temp + '</td>';
  }).join('') + '</tr>';

  var row30 = compute30sRow(cols, isCrackCol);
  rows += '<tr><th>30&quot;</th>' + cols.map(function(p, i){
    var v = row30[i];
    if (v == null) return '<td' + tdClass(null, p) + '></td>';
    return '<td' + tdClass('lt-ror', p) + '>' + v + '</td>';
  }).join('') + '</tr>';

  var row60 = compute60sRow(cols, isCrackCol);
  rows += '<tr><th>60&quot;</th>' + cols.map(function(p, i){
    var v = row60[i];
    if (v == null) return '<td' + tdClass(null, p) + '></td>';
    return '<td' + tdClass('lt-ror lt-ror-strong', p) + '>' + v + '</td>';
  }).join('') + '</tr>';

  // 回溫點後新增的「00:00」參考欄不是事件，這裡留空，不標注文字
  rows += '<tr><th>事件</th>' + cols.map(function(p){
    if (p.synthetic) return '<td></td>';
    var ev = (roast.crackEvents || []).find(function(e){ return e.t === p.t; });
    return '<td' + tdClass(ev ? 'lt-event-cell' : null, p) + '>' + (ev ? escapeHtml(ev.label) : '') + '</td>';
  }).join('') + '</tr>';

  // Mini500 用「風門」取代「風速」（事件時間軸的欄位名稱與比對前綴都要跟著換）
  // 「回溫點」那一欄單純是溫度事件紀錄，不標記風門／火力；回溫點後新增的「00:00」參考欄也不參與配對
  var windLabel = (roast.machineName === 'Mini500') ? '風門' : '風速';
  var windMap = buildEventColumnMap(cols, roast.triggeredLog, windLabel, 20, roast.resetAt);
  rows += '<tr><th>' + windLabel + '</th>' + cols.map(function(p, i){
    if (p.synthetic) return '<td></td>';
    return '<td' + tdClass(null, p) + '>' + escapeHtml(windMap[i] || '') + '</td>';
  }).join('') + '</tr>';

  var powerMap = buildEventColumnMap(cols, roast.triggeredLog, '火力', 20, roast.resetAt);
  rows += '<tr><th>火力</th>' + cols.map(function(p, i){
    // 回溫點後新增的「00:00」參考欄純粹帶入即將生效的火力值，跟一般欄位一樣的樣式即可，不用特別加粗或標色
    if (p.synthetic) return '<td>' + escapeHtml(p.power || '') + '</td>';
    return '<td' + tdClass(null, p) + '>' + escapeHtml(powerMap[i] || '') + '</td>';
  }).join('') + '</tr>';

  if (isLive){
    rows += '<tr><th>刪除</th>' + cols.map(function(p){
      if (p.synthetic) return '<td></td>';
      return '<td' + tdClass(null, p) + '><button type="button" class="lt-del-btn" data-t="' + p.t + '" aria-label="刪除這筆溫度紀錄">✕</button></td>';
    }).join('') + '</tr>';
  }

  body.innerHTML = rows;
}

// 刪除一筆新增錯誤的溫度紀錄（依時間 t 刪除）；若該時間點也是一爆／二爆事件，一併移除對應紀錄，
// 並重新啟用被停用的爆點按鈕，若移除的是一爆起，也重設發展時間相關狀態
function deleteTempPoint(t){
  if (!roast) return;
  roast.tempLog = roast.tempLog.filter(function(p){ return p.t !== t; });
  var removedCracks = roast.crackEvents.filter(function(e){ return e.t === t; });
  roast.crackEvents = roast.crackEvents.filter(function(e){ return e.t !== t; });
  removedCracks.forEach(function(ev){
    var btn = document.querySelector('.crack-btn[data-label="' + ev.label + '"]');
    if (btn) btn.disabled = false;
    if (ev.label === '一爆起' && roast.firstCrackTime === t){
      roast.firstCrackTime = null;
      document.getElementById('devReadout').hidden = true;
    }
    // Mini500：如果刪掉的剛好是「回溫點」那筆紀錄，連帶取消歸零狀態，畫面計時器改回顯示絕對累計時間，
    // 事件時間軸也不再顯示回溫點後新增的「00:00」欄位
    if (ev.label === '回溫點' && roast.resetAt === t){
      roast.resetAt = null;
      roast.resetMarker = null;
      roast.timeOffset = 0;
    }
  });
  drawLiveCurve();
  updateRorReadout();
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
  document.getElementById('summaryDevTime').textContent = s.devTimeText;
  document.getElementById('summaryDevPercent').textContent = s.devPercentText;
  document.getElementById('summaryDevRise').textContent = s.devRiseText;
  document.getElementById('summaryRise').textContent = s.riseText;
  document.getElementById('summaryLoss').textContent = s.lossText;
  document.getElementById('summaryEnergy').textContent = s.energyText;
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
  // 部分 Android 瀏覽器的語音（speechSynthesis）有已知 bug：佇列裡的語音有時會卡在
  // 「準備要唸」卻實際上不出聲，一直悶著直到畫面狀態改變（例如螢幕關掉）才會突然補講，
  // 這正是「烘豆很久都沒有聲音、螢幕關掉才發出聲音」的成因。跟嗶聲一樣，被暫停就先恢復；
  // 每 3 秒（不用每秒，太頻繁可能打斷正在講的短句）額外做一次 pause／resume 的「踢一下」，
  // 把卡住的佇列踢醒，這是這類 bug 常見的因應方式
  if ('speechSynthesis' in window){
    var ss = window.speechSynthesis;
    if (ss.paused) ss.resume();
    else if ((ss.speaking || ss.pending) && elapsed % 3 === 0){
      ss.pause();
      ss.resume();
    }
  }
  // 畫面上顯示的計時器：Mini500 按下「回溫點」後會歸零重新計算（見 timeOffset），
  // 溫度紀錄／事件時間軸內部仍用未歸零的絕對累計秒數（elapsed）當作時間座標，兩者不會互相影響
  var dispElapsed = elapsed - (roast.timeOffset || 0);
  document.getElementById('timerDisplay').textContent = formatTime(dispElapsed);

  if (roast.firstCrackTime != null){
    var devTime = elapsed - roast.firstCrackTime;
    var devPercent = elapsed > 0 ? (devTime / elapsed * 100) : 0;
    document.getElementById('devReadout').textContent = '發展時間 ' + formatTime(devTime) + '（' + devPercent.toFixed(1) + '%）';
  }

  // 提前3秒／2秒／1秒的「嘟」提示音，讓人先準備看溫度（依畫面上顯示的時間為準，回溫點歸零後 30 秒節奏也一併重新起算）
  if (dispElapsed > 0 && (dispElapsed % 30 === 27 || dispElapsed % 30 === 28 || dispElapsed % 30 === 29) && roast.lastDuduAt !== dispElapsed){
    roast.lastDuduAt = dispElapsed;
    beep(600, 90, 0.55);
  }

  // 第30秒整的「嗶」聲，並跳出溫度輸入
  // 若此時「手動記溫／一爆起／一爆止／二爆起／二爆止」的溫度輸入正在進行中，先不要蓋掉它，
  // 等那筆溫度填完送出後，再補顯示這次的30秒溫度提示
  var onGridMark = (dispElapsed > 0 && dispElapsed % 30 === 0);
  if (onGridMark && roast.lastPromptAt !== dispElapsed){
    roast.lastPromptAt = dispElapsed;
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
      // 時間到了先用語音／嗶聲提醒，實際是否寫入紀錄改由彈出的確認提示決定；若風速、火力同時到時間，會同時列在提示清單中
      var pending = { t: elapsed, label: ev.label, temp: nearestTemp, timer: null };
      pending.timer = setTimeout(function(){
        var idx = roast.pendingConfirms.indexOf(pending);
        if (idx !== -1) resolvePendingConfirm(idx, true);
      }, 10000);
      roast.pendingConfirms.push(pending);

      if (ev.seconds === 0){
        // 烘豆一開始（0:00）就設定好的風速／火力，屬於起始設定而非中途提醒，
        // 不需要嗶聲或語音打斷剛開始烘豆的當下，只留確認清單讓使用者確認寫入即可
      } else if (onGridMark){
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
  renderMiniPlanEventList();

  var machineSelect = document.getElementById('machineSelect');
  machineSelect.addEventListener('change', function(){
    var selected = !!machineSelect.value;
    var isMini = machineSelect.value === 'Mini500';
    document.getElementById('panel-session').hidden = !selected;
    document.getElementById('panel-plan').hidden = !selected;
    document.getElementById('planFixedFields').hidden = !isMini;
    document.getElementById('planCustomSection').hidden = !(selected && !isMini);
    document.getElementById('planMiniCustomSection').hidden = !(selected && isMini);
    renderPlanPresetOptions();
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
  ['newPlanEventMin', 'newPlanEventSec', 'newMiniFireMin', 'newMiniFireSec', 'newMiniDamperMin', 'newMiniDamperSec'].forEach(function(id){
    document.getElementById(id).addEventListener('input', function(){
      this.value = this.value.replace(/[^0-9]/g, '');
    });
  });
  // 數值只允許輸入 1-9 的單一數字
  document.getElementById('newPlanEventValue').addEventListener('input', function(){
    var digits = this.value.replace(/[^1-9]/g, '');
    this.value = digits.slice(-1);
  });

  // 匯入預設烘焙計劃
  document.getElementById('btnImportPlanPreset').addEventListener('click', function(){
    var presetId = document.getElementById('planPresetSelect').value;
    if (!presetId) return;
    importPlanPreset(presetId);
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
    var isDuplicate = state.planEvents.some(function(ev){ return ev.type === type && ev.seconds === seconds; });
    if (isDuplicate){ err.textContent = '這個時間已經設定過' + type + '，請刪除原本的設定或改用其他時間'; return; }
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

  // 新增自訂操作提醒（Mini500：火力，時間＋0.1-3.0 數值）
  document.getElementById('btnAddMiniFireEvent').addEventListener('click', function(){
    var min = parseInt(document.getElementById('newMiniFireMin').value || '0', 10);
    var sec = parseInt(document.getElementById('newMiniFireSec').value || '0', 10);
    var value = parseFloat(document.getElementById('newMiniFireValue').value);
    var err = document.getElementById('miniFireFormError');
    var seconds = (min || 0) * 60 + (sec || 0);
    if (seconds < 0){ err.textContent = '請輸入正確的時間'; return; }
    if (isNaN(value) || value < 0.1 || value > 3.0){ err.textContent = '請輸入 0.1-3.0 的數值'; return; }
    var isDuplicate = state.miniFireEvents.some(function(ev){ return ev.seconds === seconds; });
    if (isDuplicate){ err.textContent = '這個時間已經設定過火力，請刪除原本的設定或改用其他時間'; return; }
    err.textContent = '';
    state.miniFireEvents.push({ id: uid(), seconds: seconds, value: clampPowerDecimal(value).toFixed(1) });
    renderMiniPlanEventList();
    document.getElementById('newMiniFireMin').value = '';
    document.getElementById('newMiniFireSec').value = '';
    document.getElementById('newMiniFireValue').value = '';
  });

  // 新增自訂操作提醒（Mini500：風門，可選錨定事件＋時間＋風門選項）
  document.getElementById('btnAddMiniDamperEvent').addEventListener('click', function(){
    var anchor = document.getElementById('newMiniDamperAnchor').value;
    var min = parseInt(document.getElementById('newMiniDamperMin').value || '0', 10);
    var sec = parseInt(document.getElementById('newMiniDamperSec').value || '0', 10);
    var value = document.getElementById('newMiniDamperValue').value;
    var err = document.getElementById('miniDamperFormError');
    var seconds = (min || 0) * 60 + (sec || 0);
    if (seconds < 0){ err.textContent = '請輸入正確的時間'; return; }
    if (DAMPER_OPTIONS.indexOf(value) === -1){ err.textContent = '請選擇風門'; return; }
    var isDuplicate = state.miniDamperEvents.some(function(ev){ return (ev.anchor || '') === anchor && ev.seconds === seconds; });
    if (isDuplicate){ err.textContent = '這個時間已經設定過風門，請刪除原本的設定或改用其他時間'; return; }
    err.textContent = '';
    state.miniDamperEvents.push({ id: uid(), anchor: anchor, seconds: seconds, value: value });
    renderMiniPlanEventList();
    document.getElementById('newMiniDamperMin').value = '';
    document.getElementById('newMiniDamperSec').value = '';
  });

  // 刪除自訂操作提醒（Mini500 火力／風門共用同一個刪除按鈕樣式）
  function handleMiniEventDelete(e){
    var btn = e.target.closest('.event-list__del');
    if (!btn) return;
    state.miniFireEvents = state.miniFireEvents.filter(function(ev){ return ev.id !== btn.dataset.id; });
    state.miniDamperEvents = state.miniDamperEvents.filter(function(ev){ return ev.id !== btn.dataset.id; });
    renderMiniPlanEventList();
  }
  document.getElementById('planMiniFireList').addEventListener('click', handleMiniEventDelete);
  document.getElementById('planMiniDamperList').addEventListener('click', handleMiniEventDelete);

  // 開始烘豆
  document.getElementById('btnStartRoast').addEventListener('click', function(){
    var machineName = machineSelect.value;
    if (!machineName || !document.getElementById('roasterName').value.trim() || !document.getElementById('beanOrigin').value.trim() || !(parseFloat(document.getElementById('weightBefore').value) > 0) || !document.getElementById('sessionTemp').value.trim()) return;
    // 解鎖音效／語音失敗也不該卡住「開始烘豆」，某些 Android 瀏覽器在這一步丟例外時
    // 若沒接住，會讓整個點擊處理中斷，畫面看起來像按了完全沒反應
    // 上一次烘豆（或上一次「開始新的烘豆」後停留在設定頁）殘留的語音佇列／暫停狀態，
    // 有些手機瀏覽器會一直卡著不清除，導致這次烘豆很久都沒有語音提示，直到螢幕關掉、
    // 系統把分頁狀態重置後才突然補講；每次真正開始烘豆時先清空佇列、把解鎖狀態重設，
    // 強制重新解鎖一次，避免延續到上一輪的壞狀態
    try {
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    } catch (e){}
    speechPrimed = false;
    try { primeAudio(); } catch (e){}
    try { primeSpeech(); } catch (e){}

    // Mini500 沒有像 SR540／SR800 那樣的自訂風速／火力提醒清單，改用設定頁「自訂操作提醒」裡
    // 分開自訂的火力／風門清單（含依烘前重量自動帶入的回溫點火力、2:00 火力、8:00 火力）；
    // 這些提醒屬於「回溫點之後」才生效的時間軸，開始烘豆當下先不排入 roast.events，
    // 只記錄成範本（miniScheduleTemplate），等按下「回溫點」時才依新的 0:00 正式排入（見 tempPromptForm 的回溫點分支）。
    // 風門提醒若有錨定事件（回溫點／乾燥終點／…），一樣要等事件真的發生時才動態排程
    var miniScheduleTemplate = [];
    var events;
    if (machineName === 'Mini500'){
      state.miniFireEvents.forEach(function(ev){
        miniScheduleTemplate.push({ label: '火力 ' + ev.value, baseSeconds: ev.seconds });
      });
      state.miniDamperEvents.forEach(function(ev){
        if (ev.anchor) return;
        miniScheduleTemplate.push({ label: '風門 ' + ev.value, baseSeconds: ev.seconds });
      });
      events = [];
    } else {
      events = state.planEvents.map(function(ev){
        return { label: ev.type + ' ' + ev.value, seconds: ev.seconds, triggered: false };
      });
    }

    roast = {
      machineName: machineName,
      dateStr: new Date().toLocaleString('zh-TW', { hour12: false }),
      startAt: Date.now(),
      pausedElapsed: 0,
      elapsed: 0,
      timeOffset: 0, // Mini500 按下「回溫點」後，會把這個值設成當下的 elapsed，讓畫面計時器與提醒排程都以此為新的 0:00
      resetAt: null, // 回溫點發生時的絕對累計秒數（尚未按下時為 null）
      resetMarker: null, // 回溫點後在事件時間軸新增的「00:00」欄位資料
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
      miniScheduleTemplate: miniScheduleTemplate,
      pendingAnchorEvents: machineName === 'Mini500' ? state.miniDamperEvents.filter(function(ev){ return !!ev.anchor; }).map(function(ev){
        return { anchor: ev.anchor, offsetSeconds: ev.seconds, value: ev.value, scheduled: false };
      }) : [],
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
        powerInit: document.getElementById('planPowerInit').value.trim(),
        damperInit: document.getElementById('planDamperInit').value
      },
      events: events
    };

    document.getElementById('appbarTitle').textContent = '烘豆小助手';
    var appbarSubtitle = document.getElementById('appbarSubtitle');
    appbarSubtitle.textContent = '目前烘豆機：' + roast.machineName;
    appbarSubtitle.hidden = false;
    document.getElementById('roastDate').textContent = roast.dateStr;
    document.getElementById('timerDisplay').textContent = '00:00';
    document.getElementById('rorReadout').textContent = 'RoR（升溫速率）－';
    document.getElementById('devReadout').hidden = true;
    document.querySelectorAll('.crack-btn').forEach(function(btn){ btn.disabled = false; });
    // Mini500 才顯示「回溫點／乾燥終點／第一聲」，並把「調整風速」按鈕換成「調整風門」
    document.querySelectorAll('.crack-btn--mini').forEach(function(btn){ btn.hidden = (machineName !== 'Mini500'); });
    document.getElementById('btnChangeFan').textContent = (machineName === 'Mini500') ? '調整風門' : '調整風速';
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

    // Mini500：設定頁的「初始火力」「初始風門」是開始烘豆當下就生效的固定設定（不是需要確認的提醒），
    // 直接記錄在事件時間軸最左邊（0:00）那一欄，跟「初始火力」的需求對應
    if (machineName === 'Mini500'){
      var initPowerVal = document.getElementById('planPowerInit').value.trim();
      var initDamperVal = document.getElementById('planDamperInit').value;
      var seedTemp = isNaN(startTemp) ? null : startTemp;
      if (initPowerVal) roast.triggeredLog.push({ t: 0, label: '火力 ' + initPowerVal, temp: seedTemp });
      if (initDamperVal) roast.triggeredLog.push({ t: 0, label: '風門 ' + initDamperVal, temp: seedTemp });
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

    // Mini500「回溫點」：畫面上的計時器歸零重新開始計算，但溫度紀錄與事件時間軸都不清空，
    // 回溫點本身的溫度會被記錄下來（接續在原本的紀錄之後）；設定頁「自訂操作提醒」裡的火力／風門
    // 提醒範本（miniScheduleTemplate）到這一刻才正式依新的 0:00 排入排程，2:00／8:00 火力等都是
    // 從這裡開始重新算起
    if (roast.pendingCrackLabel === '回溫點'){
      var tpT = (roast.pendingPromptElapsed != null) ? roast.pendingPromptElapsed : roast.elapsed;
      roast.tempLog.push({ t: tpT, temp: val });
      roast.crackEvents.push({ t: tpT, label: '回溫點', temp: val });

      // 找出「0:00 火力」的範本值（回溫點火力），連同回溫點溫度一起帶入事件時間軸新增的「00:00」欄位，
      // 讓使用者能立刻看到歸零後即將生效的火力設定；實際的提醒／確認寫入仍會照常在稍後另外跑一次
      var zeroFireTpl = (roast.miniScheduleTemplate || []).filter(function(t){
        return t.baseSeconds === 0 && t.label.indexOf('火力 ') === 0;
      })[0];
      roast.resetAt = tpT;
      roast.resetMarker = {
        t: tpT,
        temp: val,
        power: zeroFireTpl ? zeroFireTpl.label.slice(3) : (roast.plan.powerInit || '')
      };

      roast.pendingConfirms.forEach(function(item){ clearTimeout(item.timer); });
      roast.pendingConfirms = [];
      roast.firstCrackTime = null;
      roast.lastPromptAt = 0;
      roast.lastDuduAt = 0;
      roast.timeOffset = tpT;
      (roast.miniScheduleTemplate || []).forEach(function(tpl){
        roast.events.push({ label: tpl.label, seconds: roast.timeOffset + tpl.baseSeconds, baseSeconds: tpl.baseSeconds, triggered: false });
      });
      document.getElementById('devReadout').hidden = true;
      var usedTpBtn = document.querySelector('.crack-btn[data-label="回溫點"]');
      if (usedTpBtn) usedTpBtn.disabled = true;
      roast.pendingCrackLabel = null;
      hideTempPrompt();
      scheduleAnchoredDamperEvents('回溫點', tpT);
      drawLiveCurve();
      updateRorReadout();
      renderConfirmPanel();
      return;
    }

    var elapsed = (roast.pendingPromptElapsed != null) ? roast.pendingPromptElapsed : roast.elapsed;
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
      // Mini500：乾燥終點／第一聲／一爆起／一爆止／二爆起／二爆止 也可能是風門提醒的錨定事件
      if (roast.machineName === 'Mini500') scheduleAnchoredDamperEvents(crackLabel, elapsed);
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

  // 取消記錄溫度：不寫入任何紀錄，直接關閉輸入欄位；如果背後還排著一筆30秒自動提醒，跟送出時一樣接著補顯示
  document.getElementById('btnTempPromptCancel').addEventListener('click', function(){
    if (!roast){ hideTempPrompt(); return; }
    roast.pendingCrackLabel = null;
    roast.pendingFinish = false;
    hideTempPrompt();
    if (roast.pending30Mark){
      roast.pending30Mark = false;
      showTempPrompt(true);
    }
  });

  // 風速／火力提醒確認：按確認才寫入紀錄，按取消則不寫入；同時到時間的提醒會各自獨立列出
  document.getElementById('eventConfirmList').addEventListener('click', function(e){
    var btn = e.target.closest('button[data-action]');
    if (!btn) return;
    resolvePendingConfirm(parseInt(btn.dataset.idx, 10), btn.dataset.action === 'confirm');
  });

  // 刪除新增錯誤的溫度紀錄（烘豆中的表格才有這一列刪除按鈕）
  document.getElementById('liveLogTableBody').addEventListener('click', function(e){
    var btn = e.target.closest('.lt-del-btn');
    if (!btn || !roast) return;
    if (!window.confirm('確定要刪除這筆溫度紀錄嗎？')) return;
    deleteTempPoint(parseFloat(btn.dataset.t));
  });

  // 烘豆過程中隨時新增一筆風速／風門／火力紀錄，預設帶入目前數值，可用 -/+ 按鈕調整：
  // SR540／SR800 維持原本風速／火力 1-9 整數；Mini500 改成風門（固定選項清單）／火力（0.1-3.0 小數）
  var adjustType = null;
  var adjustMode = 'intStep'; // 'intStep'（1-9整數）／'damper'（風門選項清單）／'decimalPower'（0.1-3.0小數）
  function openAdjustPanel(type, label, mode){
    adjustType = type;
    adjustMode = mode;
    var valueEl = document.getElementById('adjustPanelValue');
    if (mode === 'damper'){
      document.getElementById('adjustPanelLabel').textContent = label;
      valueEl.value = getCurrentDamperValue();
      valueEl.readOnly = true;
      valueEl.inputMode = 'none';
      valueEl.removeAttribute('maxlength');
      valueEl.removeAttribute('pattern');
    } else if (mode === 'decimalPower'){
      document.getElementById('adjustPanelLabel').textContent = label + '（0.1-3.0）';
      valueEl.value = getCurrentPowerDecimal();
      valueEl.readOnly = false;
      valueEl.inputMode = 'decimal';
      valueEl.removeAttribute('maxlength');
      valueEl.setAttribute('pattern', '[0-9.]*');
    } else {
      document.getElementById('adjustPanelLabel').textContent = label + '（1-9）';
      valueEl.value = String(getCurrentAdjustValue(type));
      valueEl.readOnly = false;
      valueEl.inputMode = 'numeric';
      valueEl.setAttribute('maxlength', '1');
      valueEl.setAttribute('pattern', '[1-9]');
    }
    var panel = document.getElementById('adjustPanel');
    panel.hidden = false;
    panel.classList.add('capture-panel--active');
  }
  document.getElementById('btnChangeFan').addEventListener('click', function(){
    if (roast && roast.machineName === 'Mini500'){
      openAdjustPanel('風門', '調整風門', 'damper');
    } else {
      openAdjustPanel('風速', '調整風速', 'intStep');
    }
  });
  document.getElementById('btnChangePower').addEventListener('click', function(){
    if (roast && roast.machineName === 'Mini500'){
      openAdjustPanel('火力', '調整火力', 'decimalPower');
    } else {
      openAdjustPanel('火力', '調整火力', 'intStep');
    }
  });

  document.getElementById('adjustPanelValue').addEventListener('input', function(){
    var el = document.getElementById('adjustPanelValue');
    if (adjustMode === 'damper') return; // 風門只能用 +/- 切換選項，不開放直接輸入
    if (adjustMode === 'decimalPower'){
      el.value = el.value.replace(/[^0-9.]/g, '');
      return;
    }
    var digits = el.value.replace(/[^1-9]/g, '');
    el.value = digits.slice(-1);
  });

  document.getElementById('adjustPanelMinus').addEventListener('click', function(){
    var el = document.getElementById('adjustPanelValue');
    if (adjustMode === 'damper'){
      el.value = stepDamperValue(el.value, -1);
    } else if (adjustMode === 'decimalPower'){
      el.value = clampPowerDecimal((parseFloat(el.value) || 1) - 0.1).toFixed(1);
    } else {
      el.value = String(clampAdjustValue((parseInt(el.value, 10) || 5) - 1));
    }
  });
  document.getElementById('adjustPanelPlus').addEventListener('click', function(){
    var el = document.getElementById('adjustPanelValue');
    if (adjustMode === 'damper'){
      el.value = stepDamperValue(el.value, 1);
    } else if (adjustMode === 'decimalPower'){
      el.value = clampPowerDecimal((parseFloat(el.value) || 1) + 0.1).toFixed(1);
    } else {
      el.value = String(clampAdjustValue((parseInt(el.value, 10) || 5) + 1));
    }
  });

  document.getElementById('btnAdjustCancel').addEventListener('click', function(){
    adjustType = null;
    adjustMode = 'intStep';
    hideAdjustPanel();
  });

  document.getElementById('btnAdjustSubmit').addEventListener('click', function(){
    if (!roast || !adjustType) return;
    var raw = document.getElementById('adjustPanelValue').value;
    var val;
    if (adjustMode === 'damper'){
      val = (DAMPER_OPTIONS.indexOf(raw) !== -1) ? raw : getCurrentDamperValue();
    } else if (adjustMode === 'decimalPower'){
      val = clampPowerDecimal(raw).toFixed(1);
    } else {
      val = clampAdjustValue(raw);
    }
    var elapsed = roast.elapsed;
    var nearestTemp = findNearestTemp(roast.tempLog, elapsed);
    roast.triggeredLog.push({ t: elapsed, label: adjustType + ' ' + val, temp: nearestTemp });
    adjustType = null;
    adjustMode = 'intStep';
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
    document.getElementById('appbarTitle').textContent = '烘豆小助手';
    var appbarSubtitle = document.getElementById('appbarSubtitle');
    appbarSubtitle.textContent = '';
    appbarSubtitle.hidden = true;
    showScreen('setup');
  });

  // 列印烘焙紀錄：改成跟 JPG 匯出相同版面內容的白底版本，取代直接列印畫面上的深色面板
  document.getElementById('btnPrintRoast').addEventListener('click', function(){
    if (!roast) return;
    var canvas = buildRoastCanvas('light');
    var img = document.getElementById('printExportImage');
    img.onload = function(){ window.print(); };
    img.src = canvas.toDataURL('image/jpeg', 0.95);
  });

  // 橫向事件時間軸表格（與畫面上「事件時間軸」表格版面一致）：時間為欄，各項目為列
  function buildExportTableRows(cols){
    var crackTimes = (roast.crackEvents || []).map(function(e){ return e.t; });
    function isCrackCol(t){ return crackTimes.indexOf(t) !== -1; }
    // 回溫點後新增的「00:00」參考欄不是事件，不用醒目底色標示
    function crackFlag(p){ return !p.synthetic && isCrackCol(p.t); }
    var resetAt = roast.resetAt;
    var rowDefs = [
      { label: '時間', cells: cols.map(function(p){ return { text: displayColTime(p), crack: crackFlag(p) }; }) },
      { label: '溫度', cells: cols.map(function(p){ return { text: String(p.temp), crack: crackFlag(p), style: 'temp' }; }) },
      { label: '30"', cells: (function(){
          var row30 = compute30sRow(cols, isCrackCol);
          return cols.map(function(p, i){
            var v = row30[i];
            if (v == null) return { text: '', crack: crackFlag(p) };
            return { text: String(v), crack: false, style: 'ror' };
          });
        })() },
      { label: '60"', cells: (function(){
          var row60 = compute60sRow(cols, isCrackCol);
          return cols.map(function(p, i){
            var v = row60[i];
            if (v == null) return { text: '', crack: crackFlag(p) };
            return { text: String(v), crack: false, style: 'ror' };
          });
        })() },
      // 回溫點後新增的「00:00」參考欄不是事件，留空不標注文字
      { label: '事件', cells: cols.map(function(p){
          if (p.synthetic) return { text: '', crack: false };
          var ev = (roast.crackEvents || []).find(function(e){ return e.t === p.t; });
          return { text: ev ? ev.label : '', crack: !!ev, style: ev ? 'event' : null };
        }) },
      // 「回溫點」那一欄單純是溫度事件紀錄，不標記風門／火力；「00:00」參考欄也不參與配對
      { label: (roast.machineName === 'Mini500') ? '風門' : '風速', cells: (function(){
          var windLabel = (roast.machineName === 'Mini500') ? '風門' : '風速';
          var windMap = buildEventColumnMap(cols, roast.triggeredLog, windLabel, 20, resetAt);
          return cols.map(function(p, i){
            if (p.synthetic) return { text: '', crack: false };
            return { text: windMap[i] || '', crack: crackFlag(p) };
          });
        })() },
      { label: '火力', cells: (function(){
          var powerMap = buildEventColumnMap(cols, roast.triggeredLog, '火力', 20, resetAt);
          return cols.map(function(p, i){
            // 「00:00」參考欄純粹帶入即將生效的火力值，用一般樣式即可，不用加粗或特別標色
            if (p.synthetic) return { text: p.power || '', crack: false };
            return { text: powerMap[i] || '', crack: crackFlag(p) };
          });
        })() }
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
  // 建立烘焙紀錄的完整版面（頁首文字、圖表、生豆資訊表、事件時間軸表）到一個 canvas，
  // theme 為 'dark'（預設，跟畫面一致，供 JPG 匯出使用）或 'light'（白底，供列印使用）
  function buildRoastCanvas(theme){
    theme = theme || 'dark';
    var palette = (theme === 'light') ? {
      pageBg: '#ffffff', title: '#2A211B', subtitle: '#6B5D4F', meta: '#96521F',
      stat: '#4A3F35', diff: '#8B3A2B', sectionTitle: '#96521F', footer: '#8a7a68', placeholder: '#8a7a68'
    } : {
      pageBg: '#241712', title: '#F3E9D8', subtitle: '#D9C6A3', meta: '#BD6B2E',
      stat: '#D9C6A3', diff: '#8B3A2B', sectionTitle: '#BD6B2E', footer: '#c9b693', placeholder: '#c9b693'
    };

    var summary = computeSummary();
    var cols = buildLogCols();
    var labelColW = 58, colW = 52;
    var tableW = labelColW + Math.max(cols.length, 1) * colW;
    var w = Math.max(900, tableW + 48);
    var headerH = 144;
    var stepBandH = (roast.machineName !== 'Mini500' && hasFanPowerEvents(roast.triggeredLog)) ? 130 : 0;
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

    ctx.fillStyle = palette.pageBg;
    ctx.fillRect(0, 0, w, totalH);

    var gb = roast.greenBean || {};
    var beanParts = [gb.origin, gb.farm, gb.variety, gb.process].filter(function(v){ return v; });
    var line1Text = (beanParts.length ? beanParts.join(' · ') + ' ' : '') + '烘焙紀錄';
    var line2Text = '烘豆機：' + roast.machineName + '　烘豆師：' + ((roast.session && roast.session.roasterName) || '—') + '　烘豆時間：' + roast.dateStr;
    var line3Text = '烘豆時間 ' + formatTime(roast.elapsed) + '　總升溫 ' + summary.riseText + '　總熱能 ' + summary.energyText + '　發展時間 ' + summary.devTimeText + '　發展百分比 ' + summary.devPercentText + '　發展期升溫 ' + summary.devRiseText;
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

    ctx.fillStyle = palette.title;
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(line1Text, 24, 34);
    ctx.fillStyle = palette.subtitle;
    ctx.font = '14px sans-serif';
    ctx.fillText(line2Text, 24, 58);
    ctx.fillStyle = palette.meta;
    ctx.font = '13px monospace';
    ctx.fillText(line3Text, 24, 82);

    drawTextSegments([
      { text: '烘後重量 ' + (weightAfterVal || '—') + 'g　', color: palette.stat },
      { text: '烘焙度(豆) ' + (levelBean || '—') + '　', color: palette.stat },
      { text: '烘焙度(粗粉) ' + (levelCoarse || '—') + ' ', color: palette.stat },
      { text: '(粗粉差 ' + (diffCoarseVal != null ? diffCoarseVal : '—') + ')　', color: palette.diff },
      { text: '烘焙度(細粉) ' + (levelFine || '—') + ' ', color: palette.stat },
      { text: '(細粉差 ' + (diffFineVal != null ? diffFineVal : '—') + ')', color: palette.diff }
    ], 24, 106);

    renderChart(ctx, 24, headerH, w - 48, chartH - 20, roast.tempLog, roast.triggeredLog, stepBandH, roast.crackEvents, theme, roast.machineName);

    var beanY = headerH + chartH + beanTitleH;
    ctx.fillStyle = palette.sectionTitle;
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('生豆資訊', 24, beanY - 12);
    drawExportBeanInfoTable(ctx, 24, beanY, w - 48);

    var tableY = beanY + beanTableH + tableTitleH;
    ctx.fillStyle = palette.sectionTitle;
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('事件時間軸', 24, tableY - 12);

    if (cols.length === 0){
      ctx.fillStyle = palette.placeholder;
      ctx.font = '14px sans-serif';
      ctx.fillText('尚無溫度紀錄', 24, tableY + 20);
    } else {
      drawExportLogTable(ctx, 24, tableY, cols);
    }

    ctx.fillStyle = palette.footer;
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('由烘豆小助手匯出', 24, totalH - 16);

    return canvas;
  }

  document.getElementById('btnExportJpg').addEventListener('click', function(){
    if (!roast) return;
    var canvas = buildRoastCanvas('light');

    canvas.toBlob(function(blob){
      var dateStr = new Date().toISOString().slice(0, 10);
      var gb = roast.greenBean || {};
      var nameParts = [gb.origin, gb.farm, gb.variety, gb.process].filter(function(v){ return v; });
      var beanNamePart = nameParts.join(' ').replace(/[\\/:*?"<>|]/g, '');
      var filename = '烘焙紀錄-' + (beanNamePart ? beanNamePart + '-' : '') + dateStr + '.jpg';

      // iPhone（iOS Safari）不支援 <a download> 直接存檔，只會開新分頁，改用 Web Share API
      // 讓使用者直接「儲存影像」到相簿；Android 的 canShare 也可能回傳 true，但那邊原本的
      // <a download> 就能直接存檔，所以只在 iOS 上才走分享面板，其餘（Android／桌機）都維持原本的直接下載
      var file = (typeof File !== 'undefined') ? new File([blob], filename, { type: 'image/jpeg' }) : null;
      if (isIOS() && file && navigator.canShare && navigator.canShare({ files: [file] })){
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

// ---------- PWA：註冊 service worker（負責離線快取），失敗也不影響一般網頁使用 ----------
if ('serviceWorker' in navigator){
  window.addEventListener('load', function(){
    navigator.serviceWorker.register('service-worker.js').catch(function(){});
  });
}
