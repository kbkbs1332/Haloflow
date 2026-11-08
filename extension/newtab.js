/* HaloFlow · 光环首页 */
(() => {
  const canvas = document.getElementById('scene');
  const ctx = canvas.getContext('2d', { alpha: true });
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let W = 0, H = 0, DPR = 1, cx = 0, cy = 0, R = 0;
  let stars = [], dots = [], ripples = [];
  let time = 0, lastFrame = 0;
  let pointer = { x: 0, y: 0, tx: 0, ty: 0 };

  const CYAN = [56, 240, 216];
  const VIOLET = [124, 92, 255];
  const PINK = [255, 92, 200];
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

  /* ---------------- 尺寸 ---------------- */
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    const portrait = H > W * 1.1;
    cx = W / 2;
    cy = portrait ? H * 0.345 : H * 0.415;
    R = Math.min(W, H) * (portrait ? 0.243 : 0.282);

    buildStars();
    buildDots();
  }

  function buildStars() {
    const n = Math.min(260, Math.round((W * H) / 9000));
    stars = Array.from({ length: n }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      r: Math.random() * 1.1 + 0.25,
      a: Math.random() * 0.55 + 0.12,
      tw: Math.random() * Math.PI * 2,
      sp: 0.4 + Math.random() * 1.4
    }));
  }

  function buildDots() {
    const n = W < 600 ? 54 : 92;
    dots = Array.from({ length: n }, () => {
      const ringIdx = Math.floor(Math.random() * 3);
      const rr = R * (1.02 + ringIdx * 0.17) + (Math.random() - 0.5) * 10;
      const dir = ringIdx % 2 === 0 ? 1 : -1;
      return {
        r: rr,
        a: Math.random() * Math.PI * 2,
        v: dir * (0.08 + Math.random() * 0.28) * (R / 260),
        size: 0.6 + Math.random() * 1.9,
        c: [CYAN, VIOLET, PINK][Math.floor(Math.random() * 3)],
        glow: 0.3 + Math.random() * 0.7,
        trail: 0.05 + Math.random() * 0.16
      };
    });
  }

  /* ---------------- 绘制 ---------------- */
  function drawStars(t) {
    for (const s of stars) {
      const tw = 0.55 + 0.45 * Math.sin(t * s.sp + s.tw);
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(200,232,255,${s.a * tw})`;
      ctx.fill();
    }
  }

  function arc(r, rot, from, to, width, color, alpha) {
    if (alpha <= 0.002) return;
    ctx.beginPath();
    ctx.arc(0, 0, r, from, to);
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawRings(t) {
    ctx.translate(cx, cy);
    ctx.lineCap = 'round';

    // 外环：双弧，慢转
    const rOuter = R * 1.62;
    ctx.globalCompositeOperation = 'lighter';
    arc(rOuter, t * 0.05, 0.2, 1.55, 1.1, rgba(CYAN, 0.55), 0.62);
    arc(rOuter, t * 0.05, Math.PI + 0.5, Math.PI + 1.5, 0.85, rgba(VIOLET, 0.6), 0.5);
    // 光晕
    arc(rOuter, t * 0.05, 0.2, 1.55, 7, rgba(CYAN, 0.16), 0.34);
    arc(rOuter, t * 0.05, Math.PI + 0.5, Math.PI + 1.5, 6, rgba(VIOLET, 0.16), 0.26);

    // 主环：多段
    const rMain = R;
    const seg = [
      [0.0, 0.9, CYAN, 1.6, 1],
      [1.15, 1.95, VIOLET, 1.1, 0.75],
      [2.3, 3.2, PINK, 0.9, 0.55],
      [3.5, 4.4, CYAN, 0.7, 0.45],
      [4.7, 5.9, VIOLET, 1.3, 0.6]
    ];
    const rotMain = -t * 0.075;
    for (const [a, b, c, w, al] of seg) {
      arc(rMain, rotMain, a, b, w, rgba(c, 0.85), al * 0.8);
      arc(rMain, rotMain, a, b, w * 6, rgba(c, 0.13), al * 0.5);
    }

    // 能量扫掠
    const sweep = (t * 0.35) % (Math.PI * 2);
    arc(rMain, 0, sweep, sweep + 0.5, 2.2, 'rgba(220,255,252,0.9)', 0.7);
    arc(rMain, 0, sweep, sweep + 0.5, 14, rgba(CYAN, 0.22), 0.45);

    // 内环：刻度
    const rInner = R * 0.56;
    const rotIn = t * 0.12;
    arc(rInner, rotIn, 0, Math.PI * 2, 0.7, 'rgba(150,200,230,0.14)', 1);
    for (let i = 0; i < 40; i++) {
      const a = rotIn + (i / 40) * Math.PI * 2;
      const long = i % 6 === 0;
      const r1 = rInner - (long ? 9 : 4);
      const r2 = rInner - 1;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
      ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
      ctx.strokeStyle = long ? 'rgba(120,220,255,0.38)' : 'rgba(120,180,220,0.15)';
      ctx.lineWidth = long ? 1.2 : 0.8;
      ctx.stroke();
    }

    ctx.globalCompositeOperation = 'source-over';
    ctx.translate(-cx, -cy);
  }

  function drawDots(t) {
    ctx.translate(cx, cy);
    ctx.globalCompositeOperation = 'lighter';
    for (const d of dots) {
      const a = d.a + d.v * 0;
      const x = Math.cos(a) * d.r;
      const y = Math.sin(a) * d.r;

      // 拖尾
      ctx.beginPath();
      ctx.arc(0, 0, d.r, a - d.trail * Math.sign(d.v), a);
      ctx.lineWidth = d.size * 1.4;
      ctx.strokeStyle = rgba(d.c, 0.22 * d.glow);
      ctx.lineCap = 'round';
      ctx.stroke();

      // 光点
      ctx.beginPath();
      ctx.arc(x, y, d.size * 2.6, 0, Math.PI * 2);
      ctx.fillStyle = rgba(d.c, 0.16 * d.glow);
      ctx.fill();

      ctx.beginPath();
      ctx.arc(x, y, d.size, 0, Math.PI * 2);
      ctx.fillStyle = rgba(d.c, 0.9);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.translate(-cx, -cy);
  }

  function drawRipples(t) {
    if (ripples.length === 0 && t % 2.6 < 0.02) ripples.push({ r: R * 0.1, a: 0.5 });
    ctx.translate(cx, cy);
    ctx.globalCompositeOperation = 'lighter';
    for (const rp of ripples) {
      ctx.beginPath();
      ctx.arc(0, 0, rp.r, 0, Math.PI * 2);
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = rgba(CYAN, rp.a * 0.5);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.translate(-cx, -cy);
  }

  /* ---------------- 主循环 ---------------- */
  function frame(ts) {
    if (!lastFrame) lastFrame = ts;
    const dt = Math.min(0.05, (ts - lastFrame) / 1000);
    lastFrame = ts;
    time += dt;

    // 视差缓动
    pointer.x += (pointer.tx - pointer.x) * 0.05;
    pointer.y += (pointer.ty - pointer.y) * 0.05;

    ctx.clearRect(0, 0, W, H);

    ctx.save();
    ctx.translate(pointer.x * 10, pointer.y * 10);
    drawStars(time);
    ctx.restore();

    ctx.save();
    ctx.translate(pointer.x * -22, pointer.y * -22);
    drawRings(time);
    ctx.restore();

    ctx.save();
    ctx.translate(pointer.x * -14, pointer.y * -14);
    drawDots(time);
    drawRipples(time);
    ctx.restore();

    // 粒子角度推进
    for (const d of dots) d.a += d.v * dt;

    // 波纹生命周期
    for (let i = ripples.length - 1; i >= 0; i--) {
      const rp = ripples[i];
      rp.r += dt * R * 0.55;
      rp.a -= dt * 0.42;
      if (rp.a <= 0) ripples.splice(i, 1);
    }

    requestAnimationFrame(frame);
  }

  /* ---------------- 时钟 ---------------- */
  const clockEl = document.getElementById('clock');
  const dateEl = document.getElementById('date');
  const greetEl = document.getElementById('greet');
  const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  function tickClock() {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    clockEl.innerHTML = `${hh}:${mm}<span class="sec">${ss}</span>`;
    dateEl.textContent = `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日 · ${WEEK[d.getDay()]}`;
    const h = d.getHours();
    const g =
      h < 5 ? '夜深了，还在线喵' :
      h < 9 ? '早上好' :
      h < 12 ? '上午好' :
      h < 14 ? '午安' :
      h < 18 ? '下午好' :
      h < 23 ? '晚上好' : '夜深了，早点睡喵';
    greetEl.textContent = g;
  }
  tickClock();
  setInterval(tickClock, 1000);

  /* ---------------- 搜索 ---------------- */
  const form = document.getElementById('searchForm');
  const input = document.getElementById('q');

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const raw = input.value.trim();
    if (!raw) return;
    const looksLikeUrl = /^(https?:\/\/)?([\w-]+\.)+[a-z]{2,}(\/[^\s]*)?$/i.test(raw) && !raw.includes(' ');
    if (looksLikeUrl) {
      location.href = /^https?:\/\//i.test(raw) ? raw : 'https://' + raw;
    } else {
      location.href = 'https://www.bing.com/search?q=' + encodeURIComponent(raw);
    }
  });

  // "/" 聚焦搜索框
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== input) {
      e.preventDefault();
      input.focus();
    }
  });

  /* ---------------- 快捷链接 ---------------- */
  const DEFAULT_LINKS = [
    { name: 'GitHub', url: 'https://github.com', ico: '◆' },
    { name: 'Bilibili', url: 'https://www.bilibili.com', ico: '▶' },
    { name: '知乎', url: 'https://www.zhihu.com', ico: '○' },
    { name: '百度', url: 'https://www.baidu.com', ico: '◎' },
    { name: 'Edge', url: 'https://www.microsoft.com/edge', ico: '◈' },
    { name: 'RikkaHub', url: 'https://github.com/rikkahub/rikkahub', ico: '⌘' }
  ];

  function renderLinks() {
    const nav = document.getElementById('links');
    nav.innerHTML = '';
    DEFAULT_LINKS.forEach((l) => {
      const a = document.createElement('a');
      a.className = 'link';
      a.href = l.url;
      a.innerHTML = `<span class="ico">${l.ico}</span>${l.name}`;
      a.addEventListener('mousedown', (e) => e.stopPropagation());
      nav.appendChild(a);
    });
  }

  /* ---------------- 视差 ---------------- */
  window.addEventListener('pointermove', (e) => {
    pointer.tx = (e.clientX / W - 0.5) * 2;
    pointer.ty = (e.clientY / H - 0.5) * 2;
  }, { passive: true });

  window.addEventListener('pointerleave', () => { pointer.tx = 0; pointer.ty = 0; });

  /* ---------------- 启动 ---------------- */
  let rz;
  window.addEventListener('resize', () => {
    clearTimeout(rz);
    rz = setTimeout(resize, 140);
  });

  resize();
  renderLinks();
  if (reduceMotion) {
    ctx.clearRect(0, 0, W, H);
    drawStars(0);
    drawRings(0);
    drawDots(0);
  } else {
    requestAnimationFrame(frame);
  }
})();
