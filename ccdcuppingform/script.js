const CATEGORY_DEFS = [
  {key:'flavor',     num:1, label:'風／滋味',     en:'Flavor'},
  {key:'acidity',    num:2, label:'酸質',         en:'Acidity/Acid/Salt'},
  {key:'mouthfeel',  num:3, label:'口感',         en:'Mouthfeel/Body'},
  {key:'sweetness',  num:4, label:'甜度',         en:'Sweetness'},
  {key:'aftertaste', num:5, label:'餘韻',         en:'Aftertaste'},
  {key:'balance',    num:6, label:'平衡性',       en:'Balance'},
  {key:'clean',      num:7, label:'乾淨度／缺點', en:'Clean Cup/Defect'}
];

const state = {
  topic:'', name:'', notes:'',
  items:[]
};

let teacherItems = [{ name:'品項1', roast:'' }];

function makeScores(){
  const s = { aroma:0 };
  CATEGORY_DEFS.forEach(c=>{ s[c.key] = 0; });
  return s;
}
function newItemData(name, roast){
  return { name: (name && name.trim()) ? name.trim() : '品項1', flavorNote:'', agtron: (roast || ''), notes:'', scores: makeScores() };
}
function itemTotal(item){
  return 80 + CATEGORY_DEFS.reduce((sum,c)=>sum+item.scores[c.key],0);
}

// =====================================================================
// 老師端：品項數量 → 動態品項名稱／烘焙度欄位
// =====================================================================
function applyItemCount(n){
  if(isNaN(n) || n < 1) n = 1;
  if(n > 12) n = 12;
  document.getElementById('in-count').value = n;
  while(teacherItems.length < n) teacherItems.push({ name:'品項' + (teacherItems.length + 1), roast:'' });
  while(teacherItems.length > n) teacherItems.pop();
  renderTeacherItemFields();
}

function stepItemCount(delta){
  const current = parseInt(document.getElementById('in-count').value, 10);
  applyItemCount((isNaN(current) ? teacherItems.length : current) + delta);
}

function renderTeacherItemFields(){
  const container = document.getElementById('teacher-items-container');
  container.innerHTML = '';
  teacherItems.forEach((item, i)=>{
    const field = document.createElement('div');
    field.className = 'two-col-row';
    field.innerHTML = `
      <div class="field">
        <label>品項${i+1} 名稱</label>
        <input type="text" class="teacher-item-name" value="${item.name}" placeholder="例如：品項${i+1}">
      </div>
      <div class="field">
        <label>烘焙度<em>（選填）</em></label>
        <input type="text" inputmode="numeric" class="teacher-item-roast" value="${item.roast}" placeholder="選填">
      </div>
    `;
    field.querySelector('.teacher-item-name').addEventListener('input', e=>{ item.name = e.target.value; });
    field.querySelector('.teacher-item-roast').addEventListener('input', e=>{ item.roast = e.target.value; });
    container.appendChild(field);
  });
}

// =====================================================================
// 學生端：品項評分卡片（品項數量與名稱由老師端決定，此處不可增減）
// =====================================================================
function buildItemBlock(item, idx){
  const wrap = document.createElement('div');
  wrap.className = 'item-block';

  const fieldsMeta = [
    {key:'aroma', scored:false, label:'乾／濕香', en:'Fragrance / Aroma'},
    ...CATEGORY_DEFS.map(c=>({key:c.key, scored:true, num:c.num, label:c.label, en:c.en}))
  ];

  const scoreFieldsHtml = fieldsMeta.map((f,i)=>`
    <div class="score-field ${i===0?'first':''}" data-key="${f.key}">
      <div class="score-head">
        ${f.scored? `<span class="score-num">${f.num}</span>` : ''}
        <span class="score-name">${f.label} <em>${f.en}</em></span>
        ${!f.scored? '<span class="not-scored">不計分</span>' : ''}
      </div>
      <div class="ticks"></div>
      <div class="tick-labels"><span>無味</span><span>清淡</span><span></span><span>滿意</span><span>特殊</span></div>
    </div>
  `).join('');

  wrap.innerHTML = `
    <div class="item-head">
      <span class="item-title">${item.name}</span>
      <div class="item-right">
        <span class="item-total"><span class="tot-num">80</span><small> 分</small></span>
      </div>
    </div>
    <div class="item-body">
      <div class="two-col-row">
        <div class="field">
          <label class="field-label-strong">風／滋味描述</label>
          <input type="text" class="in-flavor-note" placeholder="選填" value="${item.flavorNote}">
        </div>
        <div class="field">
          <label class="field-label-strong">烘焙度 <em>Agtron</em></label>
          <input type="text" inputmode="numeric" class="in-agtron" placeholder="選填" value="${item.agtron}">
        </div>
      </div>
      ${scoreFieldsHtml}
      <div class="field" style="margin-top:14px;">
        <label>備註（選填）</label>
        <textarea class="in-item-notes" placeholder="選填">${item.notes}</textarea>
      </div>
    </div>
  `;

  wrap.querySelector('.in-flavor-note').addEventListener('input', e=>{ item.flavorNote = e.target.value; });
  wrap.querySelector('.in-agtron').addEventListener('input', e=>{ item.agtron = e.target.value; });
  wrap.querySelector('.in-item-notes').addEventListener('input', e=>{ item.notes = e.target.value; });

  wrap.querySelectorAll('.score-field').forEach(field=>{
    const key = field.dataset.key;
    const ticksEl = field.querySelector('.ticks');
    [-2,-1,0,1,2].forEach(v=>{
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tick' + (v===0 ? ' zero selected' : '');
      b.textContent = v;
      b.addEventListener('click', ()=>{
        ticksEl.querySelectorAll('.tick').forEach(t=>t.classList.remove('selected','pos','neg'));
        b.classList.add('selected');
        if(v>0) b.classList.add('pos');
        if(v<0) b.classList.add('neg');
        item.scores[key] = v;
        wrap.querySelector('.tot-num').textContent = itemTotal(item);
      });
      ticksEl.appendChild(b);
    });
  });

  return wrap;
}

function renderAllItems(){
  const container = document.getElementById('items-container');
  container.innerHTML = '';
  state.items.forEach((item, idx)=>{
    container.appendChild(buildItemBlock(item, idx));
  });
}

// ---- view switching ----
function goView(id){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  document.querySelector('.shell').classList.toggle('wide', id==='view-result');
  window.scrollTo(0,0);
}

// ---- teacher creates session / QR ----
let currentSessionUrl = '';

function createSession(){
  const topic = document.getElementById('in-topic').value.trim();
  if(!topic){
    document.getElementById('in-topic').focus();
    return;
  }
  const items = teacherItems.map((it,i)=> ({
    n: (it.name && it.name.trim()) ? it.name.trim() : ('品項' + (i+1)),
    r: (it.roast || '').trim()
  }));

  state.topic = topic;
  state.items = items.map(it => newItemData(it.n, it.r));

  document.getElementById('qr-topic-text').textContent = topic;

  const url = new URL(window.location.href.split('?')[0]);
  url.searchParams.set('topic', topic);
  url.searchParams.set('items', JSON.stringify(items));
  url.searchParams.set('view', 'score');
  currentSessionUrl = url.toString();

  const qrEl = document.getElementById('qrcode');
  qrEl.innerHTML = '';
  if(window.QRCode){
    new QRCode(qrEl, { text:url.toString(), width:220, height:220, colorDark:'#2A211B', colorLight:'#F3E9D8' });
  } else {
    qrEl.textContent = 'QR 產生失敗，請確認網路連線';
  }
  goView('view-qr');
}

// ---- QR 頁：複製評分頁連結（方便在社群分享） ----
async function copyScoreLink(){
  if(!currentSessionUrl) return;
  const btn = document.getElementById('copy-link-btn');
  const flashCopied = () => {
    if(!btn) return;
    const original = btn.textContent;
    btn.textContent = '已複製 ✓';
    setTimeout(()=>{ btn.textContent = original; }, 1800);
  };

  try {
    await navigator.clipboard.writeText(currentSessionUrl);
    flashCopied();
  } catch(e){
    // fallback for browsers/contexts without Clipboard API permission
    const ta = document.createElement('textarea');
    ta.value = currentSessionUrl;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      flashCopied();
    } catch(e2){
      alert('複製失敗，請長按網址手動複製：\n' + currentSessionUrl);
    }
    document.body.removeChild(ta);
  }
}

// ---- QR 頁：同裝置直接進入評分頁（免掃碼） ----
function goToScoreDirect(){
  document.getElementById('score-topic-echo').textContent = state.topic;
  renderAllItems();
  goView('view-score');
}

// ---- score view validation + submit ----
function validateField(inputId, fieldId){
  const val = document.getElementById(inputId).value.trim();
  const field = document.getElementById(fieldId);
  if(!val){ field.classList.add('error'); return false; }
  field.classList.remove('error');
  return true;
}

function submitScore(){
  const nameOk = validateField('in-name','field-name');
  if(!nameOk){
    document.getElementById('in-name').focus();
    return;
  }
  state.name = document.getElementById('in-name').value.trim();

  renderResult();
  goView('view-result');
}

// standard competition ranking (ties share rank; next rank skips accordingly)
function computeRanks(totals){
  const sorted = totals.map((t,i)=>({t,i})).sort((a,b)=>b.t-a.t);
  const ranks = new Array(totals.length);
  sorted.forEach((s,pos)=>{
    if(pos>0 && s.t === sorted[pos-1].t){
      ranks[s.i] = ranks[sorted[pos-1].i];
    } else {
      ranks[s.i] = pos+1;
    }
  });
  return ranks;
}

function renderResult(){
  document.getElementById('rc-topic').textContent = state.topic || '（本堂主題未設定）';
  document.getElementById('rc-name').textContent = state.name;
  document.getElementById('rc-date').textContent = new Date().toLocaleString('zh-TW', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });

  const totals = state.items.map(itemTotal);
  const ranks = computeRanks(totals);

  const tbody = document.getElementById('rc-tbody');
  tbody.innerHTML = '';
  state.items.forEach((item, idx)=>{
    const total = totals[idx];
    const rank = ranks[idx];
    const aromaV = item.scores.aroma;
    const aromaCls = aromaV>0?'pos':(aromaV<0?'neg':'zero');
    const scoredCells = CATEGORY_DEFS.map(c=>{
      const v = item.scores[c.key];
      const cls = v>0?'pos':(v<0?'neg':'zero');
      return `<td class="num ${cls}">${v>0?'+':''}${v}</td>`;
    }).join('');
    const tr = document.createElement('tr');
    if(rank===1) tr.className = 'rank-first-row';
    tr.innerHTML = `
      <td class="item-name">${item.name}</td>
      <td class="rank">${rank}</td>
      <td>${item.agtron ? item.agtron : '—'}</td>
      <td class="flavor-note">${item.flavorNote ? item.flavorNote : '—'}</td>
      <td class="num ${aromaCls}">${aromaV>0?'+':''}${aromaV}</td>
      ${scoredCells}
      <td class="total">${total}</td>
      <td class="flavor-note">${item.notes ? item.notes : '—'}</td>
    `;
    tbody.appendChild(tr);
  });
}

function formatDateForFilename(d){
  const pad = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}`;
}

// iPhone / iPad only (iPadOS 13+ reports as "MacIntel" but has touch support,
// which is how we tell it apart from a real Mac).
function isAppleTouchDevice(){
  const ua = navigator.userAgent || '';
  const isIPhoneIPod = /iPhone|iPod/.test(ua);
  const isIPad = /iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return isIPhoneIPod || isIPad;
}

// LINE / Messenger / Instagram / WeChat / Twitter in-app "mini browsers" —
// these often block window.print() and behave inconsistently with file
// downloads / long-press "save image" — best fixed by asking the user to
// open the page in a real browser rather than working around each quirk.
function isInAppBrowser(){
  const ua = navigator.userAgent || '';
  return /Line\//i.test(ua) || /FBAN|FBAV|FB_IAB|FBIOS/i.test(ua) ||
         /Messenger/i.test(ua) || /Instagram/i.test(ua) ||
         /MicroMessenger/i.test(ua) || /Twitter/i.test(ua);
}
function isAndroidDevice(){
  return /Android/i.test(navigator.userAgent || '');
}

// Proactive banner shown once on load when an in-app browser is detected,
// pointing the user at the "⋯" menu so they open the page in a real browser
// before running into print/download limitations.
function showInAppBrowserBanner(){
  const el = document.getElementById('inapp-browser-notice');
  if(el) el.style.display = 'flex';
}
function dismissInAppBrowserNotice(){
  const el = document.getElementById('inapp-browser-notice');
  if(el) el.style.display = 'none';
}

// 列印按鈕：in-app 瀏覽器通常沒有列印功能，改為引導使用者改用一般瀏覽器開啟
function handlePrint(){
  if(!isInAppBrowser()){
    window.print();
    return;
  }
  if(isAndroidDevice()){
    const proceed = confirm('目前在 LINE／Messenger 等 App 內建瀏覽器中，列印功能可能無法使用。\n\n按下「確定」將嘗試用手機瀏覽器（Chrome）開啟此頁面。');
    if(proceed){
      const noProto = window.location.href.replace(/^https?:\/\//,'');
      window.location.href = 'intent://' + noProto + '#Intent;scheme=https;package=com.android.chrome;end';
    }
  } else {
    alert('目前在 App 內建瀏覽器中，列印功能可能無法使用。\n請點畫面右上角的「⋯」或分享選單，選擇「在瀏覽器中開啟」，再使用列印功能。');
  }
}

async function saveAsImage(){
  const card = document.getElementById('resultCard');
  const scrollWrap = card.querySelector('.table-scroll');
  const table = document.getElementById('rc-table');
  const attribution = document.getElementById('rc-attribution');

  // temporarily expand the card to the table's full natural width so the
  // capture isn't clipped by the on-screen horizontal-scroll viewport, and
  // reveal the attribution line (hidden on-screen, shown in exported output)
  const prevWidth = card.style.width;
  const prevMaxWidth = card.style.maxWidth;
  scrollWrap.classList.add('capture-mode');
  const fullWidth = table.scrollWidth + 34; // + card's left/right padding
  card.style.maxWidth = 'none';
  card.style.width = fullWidth + 'px';
  if(attribution) attribution.style.display = 'inline';

  const restore = () => {
    card.style.width = prevWidth;
    card.style.maxWidth = prevMaxWidth;
    scrollWrap.classList.remove('capture-mode');
    if(attribution) attribution.style.display = '';
  };

  let canvas;
  try {
    canvas = await html2canvas(card, { backgroundColor:'#F3E9D8', scale:2 });
  } catch(e){
    restore();
    alert('另存圖片失敗，請改用「列印」功能另存 PDF。');
    return;
  }
  restore();

  const safe = s => (s || '').replace(/[^\w\u4e00-\u9fa5]+/g, '').slice(0, 30);
  const filename = `CCD杯測表_${safe(state.topic) || '主題'}_${safe(state.name) || '姓名'}_${formatDateForFilename(new Date())}.jpg`;

  canvas.toBlob(async (blob) => {
    if(!blob){
      alert('另存圖片失敗，請改用「列印」功能另存 PDF。');
      return;
    }
    const file = new File([blob], filename, { type:'image/jpeg' });

    // iPhone / iPad: use the native share sheet so the image can be saved
    // straight to Photos (iOS Safari doesn't support a normal <a download>).
    if(isAppleTouchDevice() && navigator.canShare && navigator.canShare({ files:[file] })){
      try {
        await navigator.share({ files:[file], title: filename });
      } catch(shareErr){
        // user cancelled the share sheet — respect that, don't force a download
      }
      return;
    }

    // everyone else (Android, desktop...): direct file download. In-app
    // browsers are handled upfront by the banner asking users to switch to
    // a real browser, so this stays simple rather than adding extra steps.
    const link = document.createElement('a');
    link.download = filename;
    link.href = URL.createObjectURL(blob);
    link.click();
    setTimeout(()=> URL.revokeObjectURL(link.href), 4000);
  }, 'image/jpeg', 0.92);
}

// ---- init ----
document.getElementById('count-minus').addEventListener('click', ()=> stepItemCount(-1));
document.getElementById('count-plus').addEventListener('click', ()=> stepItemCount(1));
document.getElementById('in-count').addEventListener('blur', e=> applyItemCount(parseInt(e.target.value,10)));
document.getElementById('in-count').addEventListener('keydown', e=>{
  if(e.key==='Enter'){ e.target.blur(); }
});

// ---- warn before refresh/close so in-progress scoring isn't lost ----
// Note: this native confirm dialog is a browser feature — desktop browsers
// (Chrome/Edge/Firefox/Safari) show it, but mobile Safari and mobile Chrome
// intentionally ignore it on page refresh (a platform limitation, not
// something a web page can override). It still works for anyone testing
// on a laptop/desktop browser.
window.addEventListener('beforeunload', function(e){
  e.preventDefault();
  e.returnValue = '確定要離開嗎？尚未送出的評分將會遺失。';
  return e.returnValue;
});

(function init(){
  renderTeacherItemFields();

  if(isInAppBrowser()) showInAppBrowserBanner();

  const params = new URLSearchParams(window.location.search);
  const topic = params.get('topic');
  const itemsParam = params.get('items');

  if(topic){
    state.topic = topic;
    let items = [{ n:'品項1', r:'' }];
    if(itemsParam){
      try {
        const parsed = JSON.parse(itemsParam);
        if(Array.isArray(parsed) && parsed.length){
          // support both the current {n, r} format and older plain-string links
          items = parsed.map((it, i) => (typeof it === 'string')
            ? { n: it, r:'' }
            : { n: it.n || ('品項' + (i+1)), r: it.r || '' });
        }
      } catch(e){ /* fall back to default */ }
    }
    state.items = items.map(it => newItemData(it.n, it.r));
    document.getElementById('score-topic-echo').textContent = topic;
    renderAllItems();
    goView('view-score');
  } else {
    goView('view-teacher');
  }
})();
