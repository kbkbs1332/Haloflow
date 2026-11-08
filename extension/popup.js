const $ = (s) => document.querySelector(s);

function setStatus(text, kind) {
  const bar = $('#statusBar');
  bar.className = 'status' + (kind ? ' ' + kind : '');
  $('#statusText').textContent = text;
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function sendToTab(msg) {
  const tab = await activeTab();
  if (!tab || !tab.id) throw new Error('找不到当前标签页');
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tab.id, msg, (res) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      resolve(res);
    });
  });
}

let curMode = 'replace';

function paintMode(m) {
  curMode = m === 'replace' ? 'replace' : 'both';
  document.querySelectorAll('#modeSeg button').forEach((b) => {
    b.classList.toggle('on', b.dataset.mode === curMode);
  });
}

document.querySelectorAll('#modeSeg button').forEach((b) => {
  b.addEventListener('click', async () => {
    paintMode(b.dataset.mode);
    await new Promise((r) => chrome.runtime.sendMessage({ type: 'setConfig', patch: { translateMode: curMode } }, r));
    try { await sendToTab({ type: 'setMode', mode: curMode }); } catch (_) {}
  });
});

async function init() {
  const res = await new Promise((r) => chrome.runtime.sendMessage({ type: 'getConfig' }, r));
  const cfg = res?.config || {};
  paintMode(cfg.translateMode === 'both' ? 'both' : 'replace');
  if (!cfg.apiKey && !/localhost|127\.0\.0\.1/.test(cfg.baseUrl || '')) {
    setStatus('未配置 API Key，先点右上角 ⚙ 设置', 'warn');
  } else {
    setStatus(`${cfg.model || '未选模型'} · ${cfg.targetLang || '中文'}`, 'ok');
  }

  try {
    const st = await sendToTab({ type: 'status' });
    if (st?.ok && st.pageTranslated) setStatus('本页已翻译 · 可随时恢复原文', 'ok');
  } catch (_) { /* 受限页面（edge:// 等）忽略 */ }
}

$('#btnPage').addEventListener('click', async () => {
  try {
    await sendToTab({ type: 'translatePage' });
    setStatus('已开始整页翻译，稍等喵…', 'ok');
    setTimeout(() => window.close(), 400);
  } catch (e) {
    setStatus('这个页面不能翻译（' + e.message + '）', 'err');
  }
});

$('#btnRestore').addEventListener('click', async () => {
  try {
    await sendToTab({ type: 'restorePage' });
    setStatus('已恢复原文', 'ok');
  } catch (e) {
    setStatus('恢复失败：' + e.message, 'err');
  }
});

$('#btnSettings').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('#linkOptions').addEventListener('click', (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); });
$('#linkNewtab').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL('newtab.html') });
});

/* ---------- 星轨：围绕北极星的同心圆弧（长曝光效果） ---------- */
(function starTrails() {
  const canvas = document.getElementById('sky');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let W = 0, H = 0, DPR = 1, trails = [], t = 0, last = 0, raf = 0;

  function build() {
    const maxR = Math.hypot(W, H) * 0.92;
    trails = [];
    const N = W < 360 ? 96 : 118;
    for (let i = 0; i < N; i++) {
      const r = 18 + Math.pow(Math.random(), 0.55) * maxR;
      const a0 = Math.random() * Math.PI * 2;
      // 越靠外弧越长（和真实星轨一致）；整体拉长，形成连续同心弧
      const len = (0.34 + Math.random() * 1.05) * (0.5 + (r / maxR) * 0.9);
      // 靠近圆心的弧淡一点，避免压住内容
      const depth = 0.35 + Math.pow(r / maxR, 0.6) * 0.85;
      trails.push({
        r, a0, len,
        w: 0.6 + Math.random() * 1.15,
        alpha: (0.10 + Math.random() * 0.32) * depth,
        hue: Math.random() < 0.72 ? 192 : 268,
        speed: 0.6 + Math.random() * 0.8
      });
    }
  }

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth || window.innerWidth;
    H = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    build();
  }

  function draw(dt) {
    t += dt;
    ctx.clearRect(0, 0, W, H);

    // 北极星：画面上方 16%
    const cx = W * 0.5;
    const cy = H * 0.24;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';

    for (const tr of trails) {
      const rot = t * 0.00028 * tr.speed;
      const a1 = tr.a0 + rot;
      const a2 = a1 + tr.len;

      // 弧体
      ctx.beginPath();
      ctx.arc(0, 0, tr.r, a1, a2);
      ctx.lineWidth = tr.w;
      ctx.strokeStyle = 'hsla(' + tr.hue + ', 92%, 76%, ' + tr.alpha + ')';
      ctx.stroke();

      // 弧尾的星点
      const ex = Math.cos(a2) * tr.r;
      const ey = Math.sin(a2) * tr.r;
      ctx.beginPath();
      ctx.arc(ex, ey, tr.w * 1.15, 0, Math.PI * 2);
      ctx.fillStyle = 'hsla(' + tr.hue + ', 100%, 90%, ' + (tr.alpha * 2.1) + ')';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(ex, ey, tr.w * 3.6, 0, Math.PI * 2);
      ctx.fillStyle = 'hsla(' + tr.hue + ', 100%, 82%, ' + (tr.alpha * 0.28) + ')';
      ctx.fill();
    }

    // 北极星本体
    ctx.beginPath();
    ctx.arc(0, 0, 1.7, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(240, 255, 255, 0.92)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, 9, 0, Math.PI * 2);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 9);
    g.addColorStop(0, 'rgba(200, 245, 255, 0.42)');
    g.addColorStop(1, 'rgba(200, 245, 255, 0)');
    ctx.fillStyle = g;
    ctx.fill();

    ctx.restore();
  }

  function loop(ts) {
    if (!last) last = ts;
    const dt = Math.min(0.05, (ts - last) / 1000);
    last = ts;
    draw(dt);
    raf = requestAnimationFrame(loop);
  }

  resize();
  window.addEventListener('resize', () => { resize(); }, { passive: true });

  if (reduce) draw(0);
  else raf = requestAnimationFrame(loop);
})();

init();