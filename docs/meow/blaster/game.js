/* =========================================================
   猫爪炮台 NEKO BLASTER
   竖版弹幕 · Canvas 2D · 无外部素材
   ========================================================= */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const randi = (a, b) => Math.floor(rand(a, b + 1));
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

  /* ---------------------------------------------------------
     画布 / 版面
     --------------------------------------------------------- */
  const cvs = $("stage");
  const ctx = cvs.getContext("2d", { alpha: false });
  let W = 0, H = 0, DPR = 1, VW = 0, OX = 0, bgCache = null;

  function layer(w, h) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }

  function resize() {
    W = Math.max(300, window.innerWidth);
    H = Math.max(420, window.innerHeight);
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    cvs.width = Math.round(W * DPR);
    cvs.height = Math.round(H * DPR);
    cvs.style.width = W + "px";
    cvs.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    VW = Math.min(W, Math.round(H * 0.74), 620);
    OX = (W - VW) / 2;
    buildBG();
    if (player) {
      player.x = clamp(player.x, OX + 18, OX + VW - 18);
      player.y = clamp(player.y, H * 0.45, H - 42);
    }
  }

  function buildBG() {
    const s = 0.5;
    const c = layer(W * s, H * s);
    const g = c.getContext("2d");
    const w = c.width, h = c.height;

    const base = g.createLinearGradient(0, 0, w * 0.4, h);
    base.addColorStop(0, "#070a1e");
    base.addColorStop(0.42, "#090d24");
    base.addColorStop(0.78, "#120a26");
    base.addColorStop(1, "#1a0b22");
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);

    const blobs = [
      [0.18, 0.16, 0.55, "rgba(96,64,214,.34)"],
      [0.82, 0.28, 0.42, "rgba(0,190,180,.2)"],
      [0.5, 0.92, 0.6, "rgba(230,70,150,.2)"],
      [0.68, 0.06, 0.3, "rgba(120,90,255,.24)"]
    ];
    for (const [bx, by, br, col] of blobs) {
      const rx = w * br, ry = h * br * 0.8;
      const gr = g.createRadialGradient(w * bx, h * by, 0, w * bx, h * by, Math.max(rx, ry));
      gr.addColorStop(0, col);
      gr.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = gr;
      g.beginPath();
      g.ellipse(w * bx, h * by, rx, ry, 0, 0, TAU);
      g.fill();
    }

    // 深海斜光
    g.save();
    g.globalCompositeOperation = "lighter";
    for (let i = 0; i < 4; i++) {
      const lx = w * (0.15 + i * 0.24);
      const lg = g.createLinearGradient(lx, 0, lx + w * 0.16, h);
      lg.addColorStop(0, "rgba(120,210,255,.055)");
      lg.addColorStop(1, "rgba(120,210,255,0)");
      g.fillStyle = lg;
      g.beginPath();
      g.moveTo(lx - w * 0.03, 0);
      g.lineTo(lx + w * 0.06, 0);
      g.lineTo(lx + w * 0.22, h);
      g.lineTo(lx + w * 0.1, h);
      g.fill();
    }
    g.restore();

    // 静态微尘
    for (let i = 0; i < 220; i++) {
      g.fillStyle = "rgba(200,225,255," + (Math.random() * 0.25 + 0.04).toFixed(3) + ")";
      g.fillRect(Math.random() * w, Math.random() * h, 1, 1);
    }

    bgCache = c;
  }

  /* ---------------------------------------------------------
     音效（WebAudio 手搓）
     --------------------------------------------------------- */
  const Sound = (() => {
    let ac = null, master = null, noiseBuf = null;
    let on = localStorage.getItem("blaster-sound") !== "0";

    function init() {
      if (ac) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ac = new AC();
      master = ac.createGain();
      master.gain.value = 0.42;
      master.connect(ac.destination);
      const len = Math.floor(ac.sampleRate * 0.5);
      noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    }

    function now() { return ac ? ac.currentTime : 0; }

    function tone(freq, dur, vol, type, slideTo) {
      if (!on || !ac) return;
      try {
        const t = now();
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = type || "square";
        o.frequency.setValueAtTime(freq, t);
        if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t + dur);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(vol, t + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g);
        g.connect(master);
        o.start(t);
        o.stop(t + dur + 0.02);
      } catch (e) {}
    }

    function noise(dur, vol, freq, q) {
      if (!on || !ac || !noiseBuf) return;
      try {
        const t = now();
        const src = ac.createBufferSource();
        src.buffer = noiseBuf;
        const bp = ac.createBiquadFilter();
        bp.type = "lowpass";
        bp.frequency.setValueAtTime(freq, t);
        bp.frequency.exponentialRampToValueAtTime(Math.max(120, freq * 0.18), t + dur);
        bp.Q.value = q || 1;
        const g = ac.createGain();
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        src.connect(bp); bp.connect(g); g.connect(master);
        src.start(t); src.stop(t + dur);
      } catch (e) {}
    }

    return {
      init,
      get on() { return on; },
      toggle() {
        on = !on;
        localStorage.setItem("blaster-sound", on ? "1" : "0");
        if (on) { init(); tone(880, 0.08, 0.05, "sine"); }
        return on;
      },
      shoot() { tone(rand(880, 980), 0.045, 0.028, "square", 620); },
      laser() { tone(rand(300, 340), 0.05, 0.014, "sawtooth", 260); },
      hit() { tone(rand(220, 280), 0.04, 0.02, "triangle", 160); },
      boom() { noise(0.34, 0.16, 1400, 0.8); tone(120, 0.22, 0.06, "sine", 50); },
      bigBoom() { noise(0.9, 0.3, 900, 0.7); tone(80, 0.7, 0.1, "sine", 32); },
      pickup() { tone(760, 0.07, 0.05, "sine"); setTimeout(() => tone(1140, 0.09, 0.045, "sine"), 60); },
      bombb() { noise(0.7, 0.26, 2200, 1.2); tone(320, 0.5, 0.09, "sawtooth", 60); },
      alarm() { tone(520, 0.12, 0.05, "square"); setTimeout(() => tone(390, 0.16, 0.05, "square"), 130); },
      hurt() { noise(0.3, 0.2, 500, 1); tone(180, 0.3, 0.08, "sawtooth", 60); }
    };
  })();

  /* ---------------------------------------------------------
     预渲染素材
     --------------------------------------------------------- */
  const SP = {};

  function sprite(w, h, draw) {
    const c = layer(w * 2, h * 2);
    const g = c.getContext("2d");
    g.scale(2, 2);
    draw(g, w, h);
    c.sw = w; c.sh = h;
    return c;
  }

  function glowSprite(color, size) {
    const s = size || 64;
    return sprite(s, s, (g) => {
      const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      gr.addColorStop(0, color);
      gr.addColorStop(0.35, color.replace(/[\d.]+\)$/, "0.55)"));
      gr.addColorStop(1, color.replace(/[\d.]+\)$/, "0)"));
      g.fillStyle = gr;
      g.fillRect(0, 0, s, s);
    });
  }

  function buildSprites() {
    /* ---- 玩家机 ---- */
    SP.ship = sprite(46, 56, (g, w, h) => {
      g.translate(w / 2, h / 2);

      const halo = g.createRadialGradient(0, 2, 2, 0, 2, 25);
      halo.addColorStop(0, "rgba(255,158,196,.34)");
      halo.addColorStop(1, "rgba(255,158,196,0)");
      g.fillStyle = halo;
      g.beginPath(); g.arc(0, 2, 25, 0, TAU); g.fill();

      // 侧翼炮
      for (const s of [-1, 1]) {
        g.save();
        g.translate(s * 12.5, 7);
        g.rotate(s * 0.1);
        const pg = g.createLinearGradient(0, -12, 0, 16);
        pg.addColorStop(0, "#f3e9ff");
        pg.addColorStop(1, "#a58fd6");
        g.fillStyle = pg;
        g.beginPath();
        g.moveTo(0, -13);
        g.lineTo(4.6, -4);
        g.lineTo(4, 13);
        g.lineTo(-4, 13);
        g.lineTo(-4.6, -4);
        g.closePath();
        g.fill();
        g.fillStyle = "#7bffe6";
        g.beginPath(); g.ellipse(0, 2, 1.8, 5, 0, 0, TAU); g.fill();
        g.restore();
      }

      // 机身
      const bg = g.createLinearGradient(0, -24, 0, 20);
      bg.addColorStop(0, "#fffafd");
      bg.addColorStop(0.4, "#ffdcea");
      bg.addColorStop(1, "#ff96be");
      g.fillStyle = bg;
      g.beginPath();
      g.moveTo(0, -24);
      g.quadraticCurveTo(8.5, -15, 8.5, -2);
      g.quadraticCurveTo(8, 13, 0, 19);
      g.quadraticCurveTo(-8, 13, -8.5, -2);
      g.quadraticCurveTo(-8.5, -15, 0, -24);
      g.closePath();
      g.fill();

      // 猫耳
      g.fillStyle = "#ffb0cd";
      for (const s of [-1, 1]) {
        g.beginPath();
        g.moveTo(s * 3.4, -17);
        g.lineTo(s * 10.4, -25.5);
        g.lineTo(s * 9.2, -12.4);
        g.closePath();
        g.fill();
      }
      g.fillStyle = "#ff86b4";
      for (const s of [-1, 1]) {
        g.beginPath();
        g.moveTo(s * 5.2, -16.4);
        g.lineTo(s * 9.2, -21.4);
        g.lineTo(s * 8.4, -13.6);
        g.closePath();
        g.fill();
      }

      // 座舱
      const cg = g.createLinearGradient(0, -9, 0, 3);
      cg.addColorStop(0, "#b9fff2");
      cg.addColorStop(1, "#3fd8cc");
      g.fillStyle = cg;
      g.beginPath(); g.ellipse(0, -4, 4.4, 7.2, 0, 0, TAU); g.fill();
      g.fillStyle = "rgba(255,255,255,.75)";
      g.beginPath(); g.ellipse(-1.3, -7, 1.3, 2.4, -0.3, 0, TAU); g.fill();

      // 腮线
      g.strokeStyle = "rgba(120,60,100,.28)";
      g.lineWidth = 0.8;
      for (const s of [-1, 1]) {
        for (let i = 0; i < 2; i++) {
          g.beginPath();
          g.moveTo(s * 5.6, 1 + i * 3.2);
          g.lineTo(s * 9.6, 2.6 + i * 3.6);
          g.stroke();
        }
      }

      // 尾喷口
      g.fillStyle = "#4b3560";
      for (const s of [-1, 1]) {
        const x = s * 4.4 - 2.2, y = 15.5, rw = 4.4, rh = 4, rr = 1.4;
        g.beginPath();
        g.moveTo(x + rr, y);
        g.lineTo(x + rw - rr, y);
        g.quadraticCurveTo(x + rw, y, x + rw, y + rr);
        g.lineTo(x + rw, y + rh - rr);
        g.quadraticCurveTo(x + rw, y + rh, x + rw - rr, y + rh);
        g.lineTo(x + rr, y + rh);
        g.quadraticCurveTo(x, y + rh, x, y + rh - rr);
        g.lineTo(x, y + rr);
        g.quadraticCurveTo(x, y, x + rr, y);
        g.closePath();
        g.fill();
      }
      g.fillStyle = "#ffe9a8";
      for (const s of [-1, 1]) {
        g.beginPath(); g.arc(s * 4.4, 17.5, 1.4, 0, TAU); g.fill();
      }
    });

    /* ---- 水母 ---- */
    SP.jelly = sprite(44, 50, (g, w, h) => {
      g.translate(w / 2, 20);
      const halo = g.createRadialGradient(0, 0, 2, 0, 0, 23);
      halo.addColorStop(0, "rgba(255,140,205,.42)");
      halo.addColorStop(1, "rgba(255,140,205,0)");
      g.fillStyle = halo; g.beginPath(); g.arc(0, 0, 23, 0, TAU); g.fill();

      g.strokeStyle = "rgba(255,190,225,.75)";
      g.lineWidth = 1.6;
      g.lineCap = "round";
      for (let i = 0; i < 5; i++) {
        const x = -11 + i * 5.5;
        g.beginPath();
        g.moveTo(x, 4);
        g.bezierCurveTo(x - 3, 12, x + 4, 16, x - 1, 25);
        g.stroke();
      }

      const bg = g.createLinearGradient(0, -16, 0, 7);
      bg.addColorStop(0, "#ffd6ea");
      bg.addColorStop(0.55, "#ff9ec4");
      bg.addColorStop(1, "#d65b96");
      g.fillStyle = bg;
      g.beginPath();
      g.moveTo(-15, 5);
      g.bezierCurveTo(-15, -15, 15, -15, 15, 5);
      g.quadraticCurveTo(10, 9, 6, 5);
      g.quadraticCurveTo(2, 9, -2, 5);
      g.quadraticCurveTo(-6, 9, -10, 5);
      g.quadraticCurveTo(-13, 8, -15, 5);
      g.fill();
      g.fillStyle = "rgba(255,255,255,.55)";
      g.beginPath(); g.ellipse(-5, -8, 3.4, 2.2, -0.4, 0, TAU); g.fill();
      g.fillStyle = "rgba(90,20,60,.75)";
      g.beginPath(); g.arc(-4.6, -1.5, 1.5, 0, TAU); g.fill();
      g.beginPath(); g.arc(4.6, -1.5, 1.5, 0, TAU); g.fill();
    });

    /* ---- 河豚 ---- */
    SP.puffer = sprite(48, 48, (g, w, h) => {
      g.translate(w / 2, h / 2);
      const halo = g.createRadialGradient(0, 0, 2, 0, 0, 24);
      halo.addColorStop(0, "rgba(255,206,120,.35)");
      halo.addColorStop(1, "rgba(255,206,120,0)");
      g.fillStyle = halo; g.beginPath(); g.arc(0, 0, 24, 0, TAU); g.fill();

      g.strokeStyle = "#ffce78";
      g.lineWidth = 2.4;
      g.lineCap = "round";
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU;
        g.beginPath();
        g.moveTo(Math.cos(a) * 11, Math.sin(a) * 11);
        g.lineTo(Math.cos(a) * 17.5, Math.sin(a) * 17.5);
        g.stroke();
      }
      const bg = g.createRadialGradient(-4, -5, 2, 0, 0, 15);
      bg.addColorStop(0, "#fff3cf");
      bg.addColorStop(0.55, "#ffd47f");
      bg.addColorStop(1, "#e09a3c");
      g.fillStyle = bg;
      g.beginPath(); g.arc(0, 0, 13.5, 0, TAU); g.fill();
      g.fillStyle = "rgba(70,40,10,.82)";
      g.beginPath(); g.arc(-4.6, -2.4, 1.9, 0, TAU); g.fill();
      g.beginPath(); g.arc(4.6, -2.4, 1.9, 0, TAU); g.fill();
      g.strokeStyle = "rgba(70,40,10,.7)";
      g.lineWidth = 1.2;
      g.beginPath(); g.arc(0, 4, 4, 0.25, Math.PI - 0.25); g.stroke();
    });

    /* ---- 电鳗 ---- */
    SP.eel = sprite(28, 66, (g, w, h) => {
      g.translate(w / 2, h / 2);
      const halo = g.createRadialGradient(0, 0, 2, 0, 0, 24);
      halo.addColorStop(0, "rgba(140,190,255,.38)");
      halo.addColorStop(1, "rgba(140,190,255,0)");
      g.fillStyle = halo;
      g.beginPath(); g.ellipse(0, 0, 16, 29, 0, 0, TAU); g.fill();

      const bg = g.createLinearGradient(0, -30, 0, 30);
      bg.addColorStop(0, "#e7f3ff");
      bg.addColorStop(0.45, "#9fd8ff");
      bg.addColorStop(1, "#4f7de0");
      g.fillStyle = bg;
      g.beginPath();
      g.moveTo(0, -29);
      g.bezierCurveTo(9, -20, 10, 2, 6, 20);
      g.quadraticCurveTo(4, 29, 0, 30);
      g.quadraticCurveTo(-4, 29, -6, 20);
      g.bezierCurveTo(-10, 2, -9, -20, 0, -29);
      g.fill();
      g.strokeStyle = "rgba(180,230,255,.75)";
      g.lineWidth = 1.3;
      for (let i = 0; i < 5; i++) {
        g.beginPath();
        g.moveTo(-5.5 + i * 0.4, -16 + i * 8);
        g.lineTo(5.5 - i * 0.4, -12 + i * 8);
        g.stroke();
      }
      g.fillStyle = "rgba(20,40,90,.85)";
      g.beginPath(); g.arc(-3.2, -18, 1.7, 0, TAU); g.fill();
      g.beginPath(); g.arc(3.2, -18, 1.7, 0, TAU); g.fill();
    });

    /* ---- 乌贼 ---- */
    SP.squid = sprite(48, 56, (g, w, h) => {
      g.translate(w / 2, 22);
      const halo = g.createRadialGradient(0, 0, 2, 0, 0, 26);
      halo.addColorStop(0, "rgba(180,150,255,.4)");
      halo.addColorStop(1, "rgba(180,150,255,0)");
      g.fillStyle = halo; g.beginPath(); g.arc(0, 0, 26, 0, TAU); g.fill();

      g.strokeStyle = "rgba(190,160,255,.8)";
      g.lineWidth = 2.2;
      g.lineCap = "round";
      for (let i = 0; i < 4; i++) {
        const x = -8 + i * 5.4;
        g.beginPath();
        g.moveTo(x, 12);
        g.quadraticCurveTo(x + (i - 1.5) * 3, 22, x + (i - 1.5) * 2, 30);
        g.stroke();
      }
      const bg = g.createLinearGradient(0, -16, 0, 14);
      bg.addColorStop(0, "#e6dcff");
      bg.addColorStop(0.6, "#b6a6ff");
      bg.addColorStop(1, "#6f57c9");
      g.fillStyle = bg;
      g.beginPath();
      g.moveTo(0, -20);
      g.quadraticCurveTo(14, -6, 12, 10);
      g.lineTo(0, 15);
      g.lineTo(-12, 10);
      g.quadraticCurveTo(-14, -6, 0, -20);
      g.fill();
      g.fillStyle = "rgba(30,16,60,.8)";
      g.beginPath(); g.ellipse(-4.4, -3, 2.4, 3.2, 0.2, 0, TAU); g.fill();
      g.beginPath(); g.ellipse(4.4, -3, 2.4, 3.2, -0.2, 0, TAU); g.fill();
      g.fillStyle = "rgba(255,255,255,.85)";
      g.beginPath(); g.arc(-4.9, -4, 0.9, 0, TAU); g.fill();
      g.beginPath(); g.arc(3.9, -4, 0.9, 0, TAU); g.fill();
    });

    /* ---- 螃蟹 ---- */
    SP.crab = sprite(54, 44, (g, w, h) => {
      g.translate(w / 2, h / 2);
      const halo = g.createRadialGradient(0, 0, 2, 0, 0, 26);
      halo.addColorStop(0, "rgba(255,120,110,.34)");
      halo.addColorStop(1, "rgba(255,120,110,0)");
      g.fillStyle = halo; g.beginPath(); g.arc(0, 0, 26, 0, TAU); g.fill();

      g.strokeStyle = "#e8654f";
      g.lineWidth = 2.6;
      g.lineCap = "round";
      for (const s of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
          g.beginPath();
          g.moveTo(s * 8, 4 + i * 3);
          g.lineTo(s * (15 + i * 2), 9 + i * 5);
          g.stroke();
        }
      }
      g.fillStyle = "#ff8a72";
      for (const s of [-1, 1]) {
        g.save();
        g.translate(s * 17, -6);
        g.rotate(s * -0.35);
        g.beginPath(); g.ellipse(0, 0, 7, 5.2, 0, 0, TAU); g.fill();
        g.fillStyle = "#c9483a";
        g.beginPath(); g.ellipse(2, -2, 3, 1.4, 0, 0, TAU); g.fill();
        g.restore();
      }
      const bg = g.createLinearGradient(0, -14, 0, 14);
      bg.addColorStop(0, "#ffc0ad");
      bg.addColorStop(1, "#ef6a4f");
      g.fillStyle = bg;
      g.beginPath(); g.ellipse(0, 0, 15, 12, 0, 0, TAU); g.fill();
      g.fillStyle = "#2a0e0a";
      g.beginPath(); g.arc(-4.6, -3.6, 2, 0, TAU); g.fill();
      g.beginPath(); g.arc(4.6, -3.6, 2, 0, TAU); g.fill();
      g.fillStyle = "#fff";
      g.beginPath(); g.arc(-5.1, -4.4, 0.75, 0, TAU); g.fill();
      g.beginPath(); g.arc(4.1, -4.4, 0.75, 0, TAU); g.fill();
    });

    /* ---- 子弹 ---- */
    SP.bolt = sprite(14, 26, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, "rgba(200,255,248,0)");
      gr.addColorStop(0.45, "rgba(123,255,230,.95)");
      gr.addColorStop(1, "rgba(255,255,255,1)");
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(w / 2, 0);
      g.quadraticCurveTo(w / 2 + 3.4, h * 0.4, w / 2 + 1.6, h);
      g.lineTo(w / 2 - 1.6, h);
      g.quadraticCurveTo(w / 2 - 3.4, h * 0.4, w / 2, 0);
      g.fill();
    });

    function makeOrb(core, mid) {
      return sprite(52, 52, (g) => {
        g.translate(26, 26);
        const gr = g.createRadialGradient(0, 0, 0, 0, 0, 25);
        gr.addColorStop(0, "#ffffff");
        gr.addColorStop(0.2, core);
        gr.addColorStop(0.52, mid);
        gr.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = gr;
        g.beginPath(); g.arc(0, 0, 25, 0, TAU); g.fill();
        g.strokeStyle = "rgba(255,255,255,.55)";
        g.lineWidth = 1;
        g.beginPath(); g.arc(0, 0, 9.5, 0, TAU); g.stroke();
      });
    }
    SP.ebPink = makeOrb("#ffd3e7", "rgba(255,105,180,.62)");
    SP.ebPurple = makeOrb("#e9d8ff", "rgba(158,110,255,.62)");
    SP.ebRice = makeOrb("#dcfffa", "rgba(80,255,220,.55)");
    SP.orbPink = glowSprite("rgba(255,120,190,1)", 34);
    SP.orbPurple = glowSprite("rgba(178,130,255,1)", 46);
    SP.orbRice = glowSprite("rgba(150,255,235,1)", 22);
    SP.orbGold = glowSprite("rgba(255,220,120,1)", 40);
    SP.spark = glowSprite("rgba(255,240,210,1)", 26);
  }

  /* ---------------------------------------------------------
     游戏状态
     --------------------------------------------------------- */
  let state = "menu";
  let player = null;
  let score = 0, best = +(localStorage.getItem("blaster-best") || 0) || 0;
  let combo = 0, comboT = 0, graze = 0, energy = 0;
  let stageT = 0, loopN = 1;
  let shake = 0, flash = 0, flashCol = "255,255,255";
  let timeScale = 1, slowT = 0;
  let boss = null, bossAt = 52, bossWarn = 0, spawnT = 0.8, earlySpawns = 0;
  let laserSnd = 0, godMode = false;

  const bullets = [], ebullets = [], enemies = [], pickups = [], parts = [], floats = [], rings = [];

  const WEAPONS = {
    pulse:  { name: "猫爪脉冲",   color: "#7bffe6", cd: 0.095 },
    spread: { name: "樱花散射",   color: "#ff9ec4", cd: 0.165 },
    laser:  { name: "激光逗猫棒", color: "#ffe27a", cd: 0 },
    homing: { name: "追尾鱼雷",   color: "#b6a6ff", cd: 0.26 }
  };

  const ETYPES = {
    jelly:  { hp: 3,  r: 17, score: 70,  spr: "jelly",  drop: 0.13 },
    eel:    { hp: 4,  r: 14, score: 110, spr: "eel",    drop: 0.15 },
    puffer: { hp: 7,  r: 17, score: 150, spr: "puffer", drop: 0.2 },
    squid:  { hp: 13, r: 20, score: 240, spr: "squid",  drop: 0.28 },
    crab:   { hp: 22, r: 22, score: 380, spr: "crab",   drop: 0.36 }
  };

  const PICKS = {
    P:  { label: "P", color: "#7bffe6", name: "火力 +1" },
    S:  { label: "S", color: "#ff9ec4", name: "樱花散射" },
    L:  { label: "L", color: "#ffe27a", name: "激光逗猫棒" },
    H:  { label: "H", color: "#b6a6ff", name: "追尾鱼雷" },
    B:  { label: "B", color: "#ff8a72", name: "喵炮 +1" },
    HP: { label: "♥", color: "#ff6f9c", name: "回复 1 命" }
  };

  function makePlayer() {
    return {
      x: OX + VW / 2, y: H - Math.min(150, H * 0.2),
      r: 2.8, vx: 0, vy: 0,
      lives: 3, bombs: 3,
      weapon: "pulse", level: 2,
      invuln: 2, fireCd: 0, beamW: 0, tilt: 0
    };
  }

  function resetRun() {
    bullets.length = 0; ebullets.length = 0; enemies.length = 0;
    pickups.length = 0; parts.length = 0; floats.length = 0; rings.length = 0;
    score = 0; combo = 0; comboT = 0; graze = 0; energy = 0;
    stageT = 0; loopN = 1; spawnT = 0.6; earlySpawns = 0; bossAt = 52; bossWarn = 0; boss = null;
    shake = 0; flash = 0; timeScale = 1; slowT = 0;
    player = makePlayer();
    syncHUD(true);
  }

  /* ---------------------------------------------------------
     小工具
     --------------------------------------------------------- */
  function addShake(v) { shake = Math.max(shake, v); }
  function addFlash(a, col) { flash = Math.max(flash, a); flashCol = col || "255,255,255"; }

  function floater(x, y, text, color, size) {
    floats.push({ x, y, text, color: color || "#ffe27a", size: size || 12, life: 0.9, max: 0.9 });
  }

  function burst(x, y, n, color, spd, kind) {
    if (parts.length > 520) n = Math.min(n, 6);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const s = rand(spd * 0.25, spd);
      parts.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: rand(0.25, 0.7), max: 0.7, r: rand(1.2, 3.4),
        color: color, drag: 0.92, kind: kind || "dot"
      });
    }
  }

  function ring(x, y, r0, r1, color, life) {
    rings.push({ x, y, r: r0, r1, color, life: life || 0.45, max: life || 0.45 });
  }

  /* ---------------------------------------------------------
     玩家子弹
     --------------------------------------------------------- */
  function addB(x, y, ang, spd, dmg, kind, r) {
    bullets.push({
      x, y, vx: Math.sin(ang) * spd, vy: -Math.cos(ang) * spd,
      dmg, kind, r: r || 3, t: 0, tgt: null, dead: false
    });
  }

  function nearestEnemy(x, y, maxD) {
    let bestE = null, bestD = maxD == null ? 1e9 : maxD;
    for (const e of enemies) {
      if (e.dead) continue;
      const d = dist(x, y, e.x, e.y);
      if (d < bestD) { bestD = d; bestE = e; }
    }
    if (boss && !boss.dying) {
      const d = dist(x, y, boss.x, boss.y);
      if (d < bestD) { bestD = d; bestE = boss; }
    }
    return bestE && bestE.dead ? null : bestE;
  }

  function shoot() {
    const lv = player.level;
    const w = player.weapon;
    if (w === "laser") return;

    if (w === "pulse") {
      const n = clamp(lv, 1, 5);
      const span = n >= 4 ? 0.26 : n === 3 ? 0.12 : 0;
      for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0 : i / (n - 1) - 0.5;
        addB(player.x + t * 10, player.y - 16, t * span, 1080, 1.15, "bolt", 4.6);
      }
      Sound.shoot();
    } else if (w === "spread") {
      const n = 3 + lv;
      const span = 1.05;
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1) - 0.5;
        addB(player.x, player.y - 12, t * span, 880, 0.95, "boltPink", 3.2);
      }
      Sound.shoot();
    } else if (w === "homing") {
      const n = 1 + Math.floor(lv / 2);
      for (let i = 0; i < n; i++) {
        const side = n === 1 ? 0 : (i - (n - 1) / 2) * 12;
        addB(player.x + side, player.y - 12, side * 0.012, 620, 2.1, "missile", 3.4);
        const b = bullets[bullets.length - 1];
        b.tgt = nearestEnemy(b.x, b.y, 520);
      }
      Sound.shoot();
    }
  }

  function shootOnce() {
    const cd = WEAPONS[player.weapon].cd;
    player.fireCd = cd;
    shoot();
  }

  /* ---------------------------------------------------------
     敌弹
     --------------------------------------------------------- */
  function addEB(x, y, ang, spd, r, kind) {
    ebullets.push({
      x, y, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
      r, kind: kind || "pink", grazed: false, t: 0, spin: Math.random() * TAU
    });
  }

  function aimAngle(x, y) {
    return Math.atan2(player.y - y, player.x - x);
  }

  function aimShot(x, y, n, spread, spd, r, kind, offset) {
    const base = aimAngle(x, y) + (offset || 0);
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : i / (n - 1) - 0.5;
      addEB(x, y, base + t * spread, spd, r, kind);
    }
  }

  function radialBurst(x, y, n, spd, r, kind, offset) {
    for (let i = 0; i < n; i++) {
      addEB(x, y, (i / n) * TAU + (offset || 0), spd, r, kind);
    }
  }

  /* ---------------------------------------------------------
     掉落物
     --------------------------------------------------------- */
  function dropPickup(x, y, forced) {
    let type = forced;
    if (!type) {
      const roll = Math.random();
      if (roll < 0.52) type = "P";
      else if (roll < 0.66) type = "S";
      else if (roll < 0.78) type = "L";
      else if (roll < 0.9) type = "H";
      else if (roll < 0.96) type = "B";
      else type = "HP";
    }
    pickups.push({ x, y, vy: rand(52, 74), vx: rand(-16, 16), type, t: 0, life: 11 });
  }

  function collectPickup(p) {
    const info = PICKS[p.type];
    if (p.type === "P") {
      if (player.level < 5) { player.level++; floater(p.x, p.y, "火力 Lv." + player.level, info.color, 12); }
      else { score += 200; floater(p.x, p.y, "+200", info.color, 12); }
    } else if (p.type === "S" || p.type === "L" || p.type === "H") {
      player.weapon = p.type === "S" ? "spread" : p.type === "L" ? "laser" : "homing";
      if (player.level < 2) player.level = 2;
      floater(p.x, p.y, info.name, info.color, 12);
    } else if (p.type === "B") {
      player.bombs = Math.min(5, player.bombs + 1);
      floater(p.x, p.y, "喵炮 +1", info.color, 12);
    } else if (p.type === "HP") {
      player.lives = Math.min(5, player.lives + 1);
      floater(p.x, p.y, "回复 1 命", info.color, 12);
    }
    Sound.pickup();
    burst(p.x, p.y, 10, info.color, 180);
    syncHUD(true);
  }

  /* ---------------------------------------------------------
     受伤 / 炸弹
     --------------------------------------------------------- */
  function hurtPlayer() {
    if (player.invuln > 0 || state !== "playing" || godMode) return;
    player.lives--;
    player.invuln = 2.6;
    addShake(22);
    addFlash(0.8, "255,120,170");
    Sound.hurt();
    burst(player.x, player.y, 26, "#ff9ec4", 300);
    ring(player.x, player.y, 6, 130, "#ff9ec4", 0.55);

    for (let i = ebullets.length - 1; i >= 0; i--) {
      const b = ebullets[i];
      if (dist(b.x, b.y, player.x, player.y) < 150) {
        burst(b.x, b.y, 2, "#ffc2dd", 90);
        ebullets.splice(i, 1);
      }
    }
    if (player.lives <= 0) gameOver();
    syncHUD(true);
  }

  function useBomb() {
    if (state !== "playing" || !player || player.bombs <= 0) {
      if (state === "playing") toast("喵炮用完了喵");
      return;
    }
    player.bombs--;
    player.invuln = Math.max(player.invuln, 1.4);
    addShake(26);
    addFlash(0.9, "255,240,200");
    Sound.bombb();
    ring(player.x, player.y, 10, Math.max(W, H) * 0.95, "#ffe27a", 0.7);

    for (let i = ebullets.length - 1; i >= 0; i--) {
      const b = ebullets[i];
      score += 3;
      burst(b.x, b.y, 1, "#ffe27a", 60);
      ebullets.splice(i, 1);
    }
    for (const e of enemies.slice()) {
      if (!e.dead) damageEnemy(e, 60);
    }
    if (boss && !boss.dying) damageBoss(180);
    syncHUD(true);
  }

  /* ---------------------------------------------------------
     敌人
     --------------------------------------------------------- */
  function spawnEnemy(type, x) {
    const d = ETYPES[type];
    const hp = d.hp * (1 + (loopN - 1) * 0.5);
    const e = {
      type, x: x == null ? rand(OX + 34, OX + VW - 34) : x, y: -46,
      hp, maxHp: hp, r: d.r, score: d.score,
      t: 0, fireT: rand(0.8, 2.0), seed: rand(0, 100),
      flash: 0, dead: false,
      holdY: rand(H * 0.14, H * 0.32),
      dir: Math.random() < 0.5 ? -1 : 1
    };
    enemies.push(e);
    return e;
  }

  function damageEnemy(e, dmg) {
    if (e.dead) return;
    e.hp -= dmg;
    e.flash = 0.08;
    if (e.hp <= 0) killEnemy(e);
    else if (Math.random() < 0.35) burst(e.x, e.y, 1, "#ffe9c4", 70);
  }

  function killEnemy(e) {
    if (e.dead) return;
    e.dead = true;
    combo++;
    comboT = 2.3;
    const mult = 1 + Math.min(combo, 40) * 0.025;
    const gain = Math.round(e.score * mult);
    score += gain;

    const d = ETYPES[e.type];
    const big = e.type === "crab" || e.type === "squid";
    burst(e.x, e.y, big ? 26 : 15, "#ffd7ea", big ? 320 : 220);
    burst(e.x, e.y, big ? 10 : 6, "#fff3c4", 180);
    ring(e.x, e.y, 4, big ? 78 : 46, "#ffb8d8", 0.4);
    Sound.boom();
    addShake(big ? 9 : 4);
    if (combo > 0 && combo % 10 === 0) floater(e.x, e.y - 10, "连击 ×" + combo, "#ffe27a", 11);
    if (Math.random() < d.drop) dropPickup(e.x, e.y);

    const idx = enemies.indexOf(e);
    if (idx >= 0) enemies.splice(idx, 1);
    syncHUD(true);
  }

  function updateEnemies(dt) {
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      if (e.dead) { enemies.splice(i, 1); continue; }
      e.t += dt;
      if (e.flash > 0) e.flash -= dt;

      if (e.type === "jelly") {
        e.y += 58 * dt;
        e.x += Math.sin(e.t * 1.7 + e.seed) * 40 * dt;
        if (e.y > 46 && e.y < H - 90) {
          e.fireT -= dt;
          if (e.fireT <= 0) {
            e.fireT = rand(2.4, 3.1);
            aimShot(e.x, e.y + 8, 1, 0, 155, 4.6, "pink");
          }
        }
      } else if (e.type === "eel") {
        e.y += 235 * dt;
        e.x += clamp((player.x - e.x) * 1.6 * dt, -70, 70);
        if (e.y < H - 120) {
          e.fireT -= dt;
          if (e.fireT <= 0 && e.y > 60) {
            e.fireT = 1.6;
            aimShot(e.x, e.y + 10, 1, 0, 210, 3.6, "rice");
          }
        }
      } else if (e.type === "puffer") {
        if (e.y < e.holdY) e.y += 74 * dt;
        else {
          e.y += Math.sin(e.t * 1.4 + e.seed) * 14 * dt;
          e.x += Math.sin(e.t * 0.7 + e.seed) * 46 * dt;
          e.fireT -= dt;
          if (e.fireT <= 0) {
            e.fireT = rand(2.1, 2.7);
            aimShot(e.x, e.y + 12, 3, 0.34, 140, 5.2, "pink");
          }
        }
      } else if (e.type === "squid") {
        if (e.y < e.holdY) e.y += 52 * dt;
        else {
          e.y += Math.sin(e.t * 0.9 + e.seed) * 10 * dt;
          e.x += e.dir * 26 * dt;
          if (e.x < OX + 30 || e.x > OX + VW - 30) e.dir *= -1;
          e.fireT -= dt;
          if (e.fireT <= 0) {
            e.fireT = rand(3.0, 3.8);
            radialBurst(e.x, e.y + 6, 9, 118, 6.4, "purple", e.t * 0.5);
          }
        }
      } else if (e.type === "crab") {
        if (e.y < e.holdY) e.y += 44 * dt;
        else {
          e.x += e.dir * 42 * dt;
          if (e.x < OX + 34 || e.x > OX + VW - 34) e.dir *= -1;
          e.y += Math.sin(e.t * 1.1 + e.seed) * 9 * dt;
          e.fireT -= dt;
          if (e.fireT <= 0) {
            e.fireT = rand(2.6, 3.4);
            aimShot(e.x, e.y + 12, 5, 0.62, 132, 6.2, "purple");
          }
        }
      }

      e.x = clamp(e.x, OX + 16, OX + VW - 16);
      if (e.y > H + 70) enemies.splice(i, 1);
    }
  }

  /* ---------------------------------------------------------
     BOSS · 深海利维坦
     --------------------------------------------------------- */
  function spawnBoss() {
    const hp = 980 + (loopN - 1) * 620;
    boss = {
      x: OX + VW / 2, y: -160, r: 72,
      hp, maxHp: hp,
      t: 0, phase: 1, flash: 0, dir: 1,
      dying: 0, enter: true,
      fireA: 1.6, fireB: 3.2, spiral: 0, spiralA: 0, boomT: 0
    };
    Sound.alarm();
    addShake(12);
    toast("⚠ 深海利维坦来了喵");
  }

  function damageBoss(dmg) {
    if (!boss || boss.dying > 0 || boss.enter) return;
    boss.hp -= dmg;
    boss.flash = 0.07;
    if (boss.hp <= 0) {
      boss.hp = 0;
      boss.dying = 2.4;
      boss.boomT = 0;
      timeScale = 0.32;
      slowT = 1.5;
      addFlash(0.7, "255,235,200");
      addShake(24);
      Sound.bigBoom();
    }
  }

  function updateBoss(dt) {
    if (!boss) return;
    const b = boss;
    if (b.flash > 0) b.flash -= dt;

    if (b.dying > 0) {
      b.dying -= dt;
      b.boomT -= dt;
      if (b.boomT <= 0) {
        b.boomT = 0.11;
        const ox = rand(-b.r * 0.8, b.r * 0.8), oy = rand(-b.r * 0.6, b.r * 0.6);
        burst(b.x + ox, b.y + oy, 14, pick(["#ffd7ea", "#ffe27a", "#ff9ec4"]), 300);
        ring(b.x + ox, b.y + oy, 4, 70, "#ffe27a", 0.4);
        addShake(8);
        Sound.boom();
      }
      if (b.dying <= 0) bossDefeated();
      return;
    }

    if (b.enter) {
      b.y += 92 * dt;
      if (b.y >= H * 0.235) { b.y = H * 0.235; b.enter = false; }
      return;
    }

    b.t += dt;
    const ratio = b.hp / b.maxHp;
    b.phase = ratio > 0.66 ? 1 : ratio > 0.33 ? 2 : 3;

    if (b.phase === 1) {
      b.x = OX + VW / 2 + Math.sin(b.t * 0.6) * VW * 0.26;
      b.y = H * 0.235 + Math.sin(b.t * 0.9) * 14;
      b.fireA -= dt;
      if (b.fireA <= 0) {
        b.fireA = 1.7;
        aimShot(b.x, b.y + 30, 3, 0.3, 165, 6, "pink");
      }
      b.fireB -= dt;
      if (b.fireB <= 0) {
        b.fireB = 4.4;
        radialBurst(b.x, b.y + 10, 14, 128, 6.2, "purple", b.t);
      }
    } else if (b.phase === 2) {
      b.x = OX + VW / 2 + Math.sin(b.t * 0.85) * VW * 0.33;
      b.y = H * 0.215 + Math.sin(b.t * 1.3) * 18;
      b.spiral += dt;
      if (b.spiral > 0.085) {
        b.spiral = 0;
        b.spiralA += 0.36;
        for (let s = 0; s < 2; s++) {
          addEB(b.x, b.y + 20, b.spiralA + s * Math.PI, 148, 4.8, "rice");
        }
      }
      b.fireA -= dt;
      if (b.fireA <= 0) {
        b.fireA = 1.9;
        aimShot(b.x, b.y + 26, 5, 0.5, 175, 5.6, "pink");
      }
    } else {
      const tx = clamp(player.x, OX + 80, OX + VW - 80);
      b.x = lerp(b.x, tx, 1.4 * dt);
      b.y = H * 0.225 + Math.sin(b.t * 1.8) * 22;
      b.fireB -= dt;
      if (b.fireB <= 0) {
        b.fireB = 2.2;
        radialBurst(b.x, b.y + 8, 18, 145, 5.6, "purple", b.t * 0.7);
      }
      b.fireA -= dt;
      if (b.fireA <= 0) {
        b.fireA = 1.15;
        aimShot(b.x, b.y + 24, 5, 0.66, 200, 5, "pink");
      }
      b.spiral += dt;
      if (b.spiral > 0.14) {
        b.spiral = 0;
        b.spiralA += 0.5;
        addEB(b.x - 34, b.y + 18, b.spiralA, 168, 4.4, "rice");
        addEB(b.x + 34, b.y + 18, b.spiralA + Math.PI, 168, 4.4, "rice");
      }
    }

    b.x = clamp(b.x, OX + b.r * 0.7, OX + VW - b.r * 0.7);
    if (dist(b.x, b.y, player.x, player.y) < b.r * 0.72 + 10) hurtPlayer();
  }

  function bossDefeated() {
    const gain = 5000 * loopN;
    score += gain;
    floater(boss.x, boss.y, "+" + gain, "#ffe27a", 22);
    burst(boss.x, boss.y, 70, "#ffe9c4", 520);
    burst(boss.x, boss.y, 40, "#ff9ec4", 380);
    ring(boss.x, boss.y, 10, 420, "#ffe27a", 0.9);
    addFlash(1, "255,250,220");
    addShake(30);
    Sound.bigBoom();

    const drops = ["P", "H", "B", "HP"];
    for (let i = 0; i < drops.length; i++) {
      dropPickup(boss.x + (i - 1.5) * 56, boss.y + rand(-10, 18), drops[i]);
      const dp = pickups[pickups.length - 1];
      if (dp) { dp.vx = (i - 1.5) * 26; dp.vy = rand(40, 58); }
    }
    ebullets.length = 0;
    boss = null;
    loopN++;
    bossAt = stageT + 52;
    timeScale = 1;
    slowT = 0;
    toast("第 " + loopN + " 波 · 深海又涌上来了");
    syncHUD(true);
  }

  /* ---------------------------------------------------------
     刷怪导演
     --------------------------------------------------------- */
  function weightedSpawn(pool) {
    let total = 0;
    for (const p of pool) total += p[1];
    let r = Math.random() * total;
    for (const p of pool) {
      r -= p[1];
      if (r <= 0) return spawnEnemy(p[0]);
    }
    return spawnEnemy("jelly");
  }

  function formation() {
    const kind = stageT > 26 ? pick(["jelly", "eel", "puffer"]) : "jelly";
    const n = randi(3, 5);
    const cx = rand(OX + VW * 0.28, OX + VW * 0.72);
    for (let i = 0; i < n; i++) {
      const e = spawnEnemy(kind, clamp(cx + (i - (n - 1) / 2) * 46, OX + 28, OX + VW - 28));
      e.y = -46 - Math.abs(i - (n - 1) / 2) * 34;
    }
  }

  function updateSpawn(dt) {
    if (boss) return;
    if (bossWarn > 0) {
      bossWarn -= dt;
      if (bossWarn <= 0) { bossWarn = 0; spawnBoss(); }
      return;
    }
    if (stageT >= bossAt) { bossWarn = 2.4; return; }
    if (enemies.length >= 13) return;

    spawnT -= dt;
    if (spawnT > 0) return;

    const t = stageT;
    spawnT = Math.max(0.42, 1.22 - t * 0.011) * rand(0.85, 1.15);

    if (earlySpawns < 3) {
      earlySpawns++;
      spawnEnemy("jelly", clamp(player.x + rand(-14, 14), OX + 28, OX + VW - 28));
      return;
    }

    const pool = [["jelly", 40]];
    if (t > 8) pool.push(["eel", 26]);
    if (t > 15) pool.push(["puffer", 24]);
    if (t > 26) pool.push(["squid", 15]);
    if (t > 38) pool.push(["crab", 11]);

    if (Math.random() < 0.16 + Math.min(0.16, t * 0.002)) formation();
    else weightedSpawn(pool);
  }

  /* ---------------------------------------------------------
     玩家
     --------------------------------------------------------- */
  const keys = new Set();
  const drag = { on: false, px: 0, py: 0, sx: 0, sy: 0, id: null };

  function updateLaser(dt) {
    const w = 5 + player.level * 2.6;
    player.beamW = w;
    const dps = 66 + player.level * 27;
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      if (e.y < player.y - 6 && Math.abs(e.x - player.x) < w * 0.55 + e.r * 0.85) {
        damageEnemy(e, dps * dt);
      }
    }
    if (boss && !boss.enter && boss.dying <= 0 && Math.abs(boss.x - player.x) < w * 0.55 + boss.r * 0.8) {
      damageBoss(dps * dt * 1.15);
    }
    if (Math.random() < dt * 34) {
      burst(player.x + rand(-w * 0.4, w * 0.4), rand(0, player.y - 30), 1, "#ffe27a", 90);
    }
    laserSnd -= dt;
    if (laserSnd <= 0) { laserSnd = 0.085; Sound.laser(); }
  }

  function updatePlayer(dt) {
    if (player.invuln > 0) player.invuln -= dt;
    player.tilt = lerp(player.tilt, 0, Math.min(1, dt * 9));

    let kx = 0, ky = 0;
    if (keys.has("a") || keys.has("arrowleft")) kx -= 1;
    if (keys.has("d") || keys.has("arrowright")) kx += 1;
    if (keys.has("w") || keys.has("arrowup")) ky -= 1;
    if (keys.has("s") || keys.has("arrowdown")) ky += 1;
    if (kx || ky) {
      const len = Math.hypot(kx, ky) || 1;
      player.x += (kx / len) * 430 * dt;
      player.y += (ky / len) * 430 * dt;
      player.tilt = lerp(player.tilt, kx * 0.9, Math.min(1, dt * 12));
    }
    player.x = clamp(player.x, OX + 16, OX + VW - 16);
    player.y = clamp(player.y, H * 0.32, H - 34);

    if (player.weapon === "laser") {
      player.beamW = 5 + player.level * 2.6;
      updateLaser(dt);
    } else {
      player.fireCd -= dt;
      if (player.fireCd <= 0) shootOnce();
    }
  }

  /* ---------------------------------------------------------
     子弹 / 掉落 / 特效
     --------------------------------------------------------- */
  function updateBullets(dt) {
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.t += dt;

      if (b.kind === "missile") {
        const lost = !b.tgt || b.tgt.dead || (b.tgt === boss && (!boss || boss.dying > 0));
        if (lost) b.tgt = nearestEnemy(b.x, b.y, 620);
        if (b.tgt) {
          const want = Math.atan2(b.tgt.y - b.y, b.tgt.x - b.x);
          const cur = Math.atan2(b.vy, b.vx);
          let diff = ((want - cur + Math.PI * 3) % TAU) - Math.PI;
          const na = cur + clamp(diff, -5.4 * dt, 5.4 * dt);
          const sp = Math.hypot(b.vx, b.vy);
          b.vx = Math.cos(na) * sp;
          b.vy = Math.sin(na) * sp;
        }
      }

      b.x += b.vx * dt;
      b.y += b.vy * dt;

      if (b.y < -30 || b.y > H + 30 || b.x < OX - 40 || b.x > OX + VW + 40) {
        bullets.splice(i, 1);
        continue;
      }

      let hit = false;
      for (let j = enemies.length - 1; j >= 0; j--) {
        const e = enemies[j];
        if (e.dead) continue;
        if (dist(b.x, b.y, e.x, e.y) < e.r * 0.9 + b.r) {
          damageEnemy(e, b.dmg);
          if (b.kind === "missile") {
            burst(b.x, b.y, 6, "#c9b8ff", 140);
            for (const o of enemies) if (!o.dead && o !== e && dist(b.x, b.y, o.x, o.y) < 46) damageEnemy(o, b.dmg * 0.6);
          }
          hit = true;
          break;
        }
      }
      if (!hit && boss && boss.dying <= 0 && !boss.enter && dist(b.x, b.y, boss.x, boss.y) < boss.r * 0.8 + b.r) {
        damageBoss(b.dmg);
        if (b.kind === "missile") burst(b.x, b.y, 6, "#c9b8ff", 140);
        hit = true;
      }
      if (hit) bullets.splice(i, 1);
    }
  }

  function updateEBullets(dt) {
    for (let i = ebullets.length - 1; i >= 0; i--) {
      const b = ebullets[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.t += dt;
      b.spin += dt * 2;

      if (b.x < OX - 60 || b.x > OX + VW + 60 || b.y < -60 || b.y > H + 60) {
        ebullets.splice(i, 1);
        continue;
      }

      const d = dist(b.x, b.y, player.x, player.y);
      if (d < b.r + player.r + 1.5 && player.invuln <= 0) {
        ebullets.splice(i, 1);
        hurtPlayer();
        continue;
      }
      if (!b.grazed && d < 32 && d > b.r + player.r + 2) {
        b.grazed = true;
        graze++;
        energy = Math.min(100, energy + 2.4);
        score += 8;
        if (Math.random() < 0.5) burst(b.x, b.y, 1, "#b9fff2", 40);
        if (energy >= 100) {
          energy = 0;
          if (player.bombs < 5) {
            player.bombs++;
            toast("能量满槽 · 喵炮 +1");
            Sound.pickup();
          } else {
            score += 300;
            floater(player.x, player.y - 26, "+300", "#7bffe6", 13);
          }
        }
        syncHUD(true);
      }
    }
  }

  function updatePickups(dt) {
    for (let i = pickups.length - 1; i >= 0; i--) {
      const p = pickups[i];
      p.t += dt;
      p.life -= dt;

      const d = dist(p.x, p.y, player.x, player.y);
      if (d < 110) {
        const a = Math.atan2(player.y - p.y, player.x - p.x);
        const pull = (110 - d) * 5.2;
        p.vx += Math.cos(a) * pull * dt;
        p.vy += Math.sin(a) * pull * dt;
      }
      p.vx *= 0.985;
      p.vy = Math.min(p.vy + 40 * dt, 190);
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      if (d < 26) { collectPickup(p); pickups.splice(i, 1); continue; }
      if (p.life <= 0 || p.y > H + 40) pickups.splice(i, 1);
    }
  }

  function updateFX(dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= p.drag;
      p.vy *= p.drag;
      p.life -= dt;
      if (p.life <= 0) parts.splice(i, 1);
    }
    for (let i = floats.length - 1; i >= 0; i--) {
      const f = floats[i];
      f.y -= 34 * dt;
      f.life -= dt;
      if (f.life <= 0) floats.splice(i, 1);
    }
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      r.life -= dt;
      r.r = lerp(r.r, r.r1, Math.min(1, dt * 8));
      if (r.life <= 0) rings.splice(i, 1);
    }
  }

  /* ---------------------------------------------------------
     主循环逻辑
     --------------------------------------------------------- */
  function updateGame(rawDt) {
    if (slowT > 0) {
      slowT -= rawDt;
      timeScale = lerp(timeScale, 0.3, Math.min(1, rawDt * 10));
    } else {
      timeScale = lerp(timeScale, 1, Math.min(1, rawDt * 6));
    }
    const dt = rawDt * timeScale;

    stageT += dt;
    if (comboT > 0) {
      comboT -= dt;
      if (comboT <= 0) { combo = 0; syncHUD(true); }
    }

    updatePlayer(dt);
    updateEnemies(dt);
    updateBoss(dt);
    updateBullets(dt);
    updateEBullets(dt);
    updatePickups(dt);
    updateSpawn(dt);
    updateFX(dt);

    shake = Math.max(0, shake - 54 * rawDt);
    flash = Math.max(0, flash - 2.2 * rawDt);
    syncHUD(false);
  }

  function updateIdle(rawDt) {
    updateFX(rawDt);
    shake = Math.max(0, shake - 54 * rawDt);
    flash = Math.max(0, flash - 2.2 * rawDt);
  }

  /* ---------------------------------------------------------
     渲染
     --------------------------------------------------------- */
  let stars = [];

  function initStars() {
    stars = [];
    const n = Math.round((W * H) / 9000);
    for (let i = 0; i < n; i++) {
      const z = Math.random();
      stars.push({
        x: Math.random() * W,
        y: Math.random() * H,
        sp: 14 + z * 74,
        w: z > 0.8 ? 1.8 : 1,
        h: z > 0.8 ? 3.4 : 1.6,
        a: 0.14 + z * 0.5,
        c: Math.random() < 0.12 ? "#9ff5ff" : Math.random() < 0.16 ? "#ffc2e0" : "#ffffff"
      });
    }
  }

  function drawStars(dt) {
    ctx.save();
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      s.y += s.sp * dt;
      if (s.y > H + 2) { s.y = -3; s.x = Math.random() * W; }
      ctx.globalAlpha = s.a;
      ctx.fillStyle = s.c;
      ctx.fillRect(s.x, s.y, s.w, s.h);
    }
    ctx.restore();
  }

  function drawSpr(spr, x, y, scale, rot, alpha) {
    const w = spr.sw * (scale || 1), h = spr.sh * (scale || 1);
    ctx.save();
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.translate(x, y);
    if (rot) ctx.rotate(rot);
    ctx.drawImage(spr, -w / 2, -h / 2, w, h);
    ctx.restore();
  }

  function roundRectPath(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.lineTo(x + w - r, y);
    g.quadraticCurveTo(x + w, y, x + w, y + r);
    g.lineTo(x + w, y + h - r);
    g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    g.lineTo(x + r, y + h);
    g.quadraticCurveTo(x, y + h, x, y + h - r);
    g.lineTo(x, y + r);
    g.quadraticCurveTo(x, y, x + r, y);
    g.closePath();
  }

  function drawField() {
    if (OX > 3) {
      ctx.fillStyle = "rgba(3,2,10,.62)";
      ctx.fillRect(0, 0, OX, H);
      ctx.fillRect(OX + VW, 0, W - OX - VW, H);
    }
    const g = ctx.createLinearGradient(OX, 0, OX + VW, 0);
    g.addColorStop(0, "rgba(123,255,230,.22)");
    g.addColorStop(0.06, "rgba(123,255,230,0)");
    g.addColorStop(0.94, "rgba(255,158,196,0)");
    g.addColorStop(1, "rgba(255,158,196,.22)");
    ctx.fillStyle = g;
    ctx.fillRect(OX, 0, 1.2, H);
    ctx.fillRect(OX + VW - 1.2, 0, 1.2, H);
  }

  function drawPickups() {
    for (const p of pickups) {
      const info = PICKS[p.type];
      const pulse = 0.75 + Math.sin(p.t * 6) * 0.25;
      const blink = p.life < 2.4 ? (Math.sin(p.life * 18) > 0 ? 1 : 0.28) : 1;
      ctx.save();
      ctx.globalAlpha = blink;
      ctx.globalCompositeOperation = "lighter";
      const gr = ctx.createRadialGradient(p.x, p.y, 1, p.x, p.y, 22 * pulse);
      gr.addColorStop(0, info.color);
      gr.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.arc(p.x, p.y, 22 * pulse, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "rgba(12,10,26,.86)";
      ctx.beginPath(); ctx.arc(p.x, p.y, 10, 0, TAU); ctx.fill();
      ctx.strokeStyle = info.color;
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(p.x, p.y, 10, 0, TAU); ctx.stroke();
      ctx.fillStyle = info.color;
      ctx.font = "800 10px ui-monospace,Menlo,monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(info.label, p.x, p.y + 0.5);
      ctx.restore();
    }
  }

  function drawBeam() {
    if (player.weapon !== "laser" || state !== "playing") return;
    const w = player.beamW;
    const top = 0;
    const y2 = player.y - 12;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const g = ctx.createLinearGradient(player.x - w, 0, player.x + w, 0);
    g.addColorStop(0, "rgba(255,226,122,0)");
    g.addColorStop(0.4, "rgba(255,226,122,.28)");
    g.addColorStop(0.5, "rgba(255,255,255,.92)");
    g.addColorStop(0.6, "rgba(255,226,122,.28)");
    g.addColorStop(1, "rgba(255,226,122,0)");
    ctx.fillStyle = g;
    const wob = Math.sin(performance.now() * 0.04) * 1.6;
    ctx.fillRect(player.x - w + wob, top, w * 2, y2);
    ctx.globalAlpha = 0.5;
    ctx.fillRect(player.x - 1.2 + wob * 0.4, top, 2.4, y2);
    ctx.restore();
  }

  function drawEnemies() {
    for (const e of enemies) {
      const spr = SP[ETYPES[e.type].spr];
      const rot = Math.sin(e.t * 1.8 + e.seed) * 0.1;
      const scale = 1;
      drawSpr(spr, e.x, e.y, scale, rot, 1);

      if (e.flash > 0) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = Math.min(0.85, e.flash * 9);
        ctx.fillStyle = "#ffffff";
        ctx.beginPath(); ctx.arc(e.x, e.y, e.r * 0.9, 0, TAU); ctx.fill();
        ctx.restore();
      }

      if (e.maxHp > 8 && e.hp < e.maxHp) {
        const w = 30, hp = clamp(e.hp / e.maxHp, 0, 1);
        ctx.fillStyle = "rgba(8,6,18,.7)";
        ctx.fillRect(e.x - w / 2, e.y - e.r - 10, w, 3);
        ctx.fillStyle = "#ff9ec4";
        ctx.fillRect(e.x - w / 2, e.y - e.r - 10, w * hp, 3);
      }
    }
  }

  function drawBoss() {
    if (!boss) return;
    const b = boss;
    const t = b.t;
    ctx.save();
    ctx.translate(b.x, b.y);

    // 光晕
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.5 + Math.sin(t * 2) * 0.08;
    ctx.drawImage(SP.orbPurple, -b.r * 2.1, -b.r * 2.1, b.r * 4.2, b.r * 4.2);
    ctx.restore();

    ctx.rotate(Math.sin(t * 1.6) * 0.035);

    // 侧鳍
    ctx.fillStyle = "#2b1b52";
    for (const s of [-1, 1]) {
      ctx.save();
      ctx.rotate(s * (0.5 + Math.sin(t * 2.2) * 0.12));
      ctx.beginPath();
      ctx.moveTo(s * b.r * 0.5, 0);
      ctx.quadraticCurveTo(s * b.r * 1.5, -b.r * 0.3, s * b.r * 1.35, b.r * 0.55);
      ctx.quadraticCurveTo(s * b.r * 0.9, b.r * 0.3, s * b.r * 0.5, 0);
      ctx.fill();
      ctx.restore();
    }

    // 尾巴
    ctx.strokeStyle = "#3a2464";
    ctx.lineWidth = b.r * 0.3;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(b.r * 0.55, 0);
    ctx.quadraticCurveTo(b.r * 1.1, Math.sin(t * 2) * 16, b.r * 1.35, Math.sin(t * 2 + 1) * 24);
    ctx.stroke();

    // 身体
    const g = ctx.createRadialGradient(-b.r * 0.25, -b.r * 0.35, b.r * 0.12, 0, 0, b.r * 1.12);
    g.addColorStop(0, "#7c59c8");
    g.addColorStop(0.45, "#4a2d80");
    g.addColorStop(0.8, "#2a1848");
    g.addColorStop(1, "#180e2c");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, 0, b.r, b.r * 0.84, 0, 0, TAU);
    ctx.fill();

    // 腹部条纹
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(0, 0, b.r * 0.98, b.r * 0.8, 0, 0, TAU);
    ctx.clip();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = "#ffd6ea";
    for (let i = -3; i <= 3; i++) {
      ctx.beginPath();
      ctx.ellipse(0, i * b.r * 0.16, b.r * 0.85, b.r * 0.035, 0, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    // 大嘴
    ctx.save();
    ctx.translate(0, b.r * 0.3);
    ctx.fillStyle = "#170a1e";
    ctx.beginPath();
    ctx.ellipse(0, 0, b.r * 0.62, b.r * 0.3, 0, 0, Math.PI);
    ctx.fill();
    ctx.fillStyle = "#3d0d2c";
    ctx.beginPath();
    ctx.ellipse(0, b.r * 0.04, b.r * 0.52, b.r * 0.15, 0, 0, Math.PI);
    ctx.fill();
    // 牙
    ctx.fillStyle = "#ffeede";
    const teeth = 9;
    for (let i = 0; i < teeth; i++) {
      const p = i / (teeth - 1);
      const x = -b.r * 0.58 + p * b.r * 1.16;
      const y = Math.sin(p * Math.PI) * b.r * 0.1;
      const hh = b.r * (0.1 + Math.sin(p * Math.PI) * 0.07);
      ctx.beginPath();
      ctx.moveTo(x - b.r * 0.035, y);
      ctx.lineTo(x + b.r * 0.035, y);
      ctx.lineTo(x, y + hh);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // 大眼
    const eyeX = -b.r * 0.42, eyeY = -b.r * 0.24;
    ctx.fillStyle = "#0d0718";
    ctx.beginPath(); ctx.arc(eyeX, eyeY, b.r * 0.2, 0, TAU); ctx.fill();
    const eyeG = ctx.createRadialGradient(eyeX - 3, eyeY - 3, 1, eyeX, eyeY, b.r * 0.16);
    eyeG.addColorStop(0, "#ffe27a");
    eyeG.addColorStop(0.6, "#ff8f4d");
    eyeG.addColorStop(1, "#a02a2a");
    ctx.fillStyle = eyeG;
    ctx.beginPath(); ctx.arc(eyeX, eyeY, b.r * 0.16, 0, TAU); ctx.fill();
    ctx.fillStyle = "#1a0a14";
    ctx.beginPath();
    ctx.ellipse(eyeX + Math.sin(t * 1.3) * 3, eyeY, b.r * 0.045, b.r * 0.13, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,.8)";
    ctx.beginPath(); ctx.arc(eyeX - b.r * 0.06, eyeY - b.r * 0.06, b.r * 0.04, 0, TAU); ctx.fill();

    // 小眼
    ctx.fillStyle = "#ffcf6b";
    ctx.beginPath(); ctx.arc(b.r * 0.36, -b.r * 0.34, b.r * 0.055, 0, TAU); ctx.fill();
    ctx.fillStyle = "#0d0718";
    ctx.beginPath(); ctx.arc(b.r * 0.36, -b.r * 0.34, b.r * 0.026, 0, TAU); ctx.fill();

    // 提灯
    const lx = -b.r * 0.62, ly = -b.r * 0.95 + Math.sin(t * 2.4) * 7;
    ctx.strokeStyle = "#6b4bb0";
    ctx.lineWidth = b.r * 0.055;
    ctx.beginPath();
    ctx.moveTo(-b.r * 0.5, -b.r * 0.55);
    ctx.quadraticCurveTo(-b.r * 0.75, -b.r * 0.85, lx, ly);
    ctx.stroke();
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const lg = ctx.createRadialGradient(lx, ly, 0, lx, ly, b.r * 0.55);
    lg.addColorStop(0, "rgba(180,255,240,.95)");
    lg.addColorStop(0.35, "rgba(123,255,230,.5)");
    lg.addColorStop(1, "rgba(123,255,230,0)");
    ctx.fillStyle = lg;
    ctx.beginPath(); ctx.arc(lx, ly, b.r * 0.55, 0, TAU); ctx.fill();
    ctx.restore();
    ctx.fillStyle = "#eafffb";
    ctx.beginPath(); ctx.arc(lx, ly, b.r * 0.085, 0, TAU); ctx.fill();

    if (b.flash > 0) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = Math.min(0.7, b.flash * 8);
      ctx.fillStyle = "#ffffff";
      ctx.beginPath(); ctx.ellipse(0, 0, b.r, b.r * 0.84, 0, 0, TAU); ctx.fill();
      ctx.restore();
    }

    ctx.restore();
  }

  function drawEBullets() {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const b of ebullets) {
      const spr = b.kind === "purple" ? SP.ebPurple : b.kind === "rice" ? SP.ebRice : SP.ebPink;
      const size = b.r * (b.kind === "rice" ? 4.4 : 4.8);
      ctx.save();
      ctx.translate(b.x, b.y);
      if (b.kind === "rice") ctx.rotate(Math.atan2(b.vy, b.vx) + Math.PI / 2);
      ctx.drawImage(spr, -size / 2, -size / 2, size, size);
      ctx.globalAlpha = 0.5 + Math.sin(b.spin) * 0.2;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 0.9;
      ctx.beginPath(); ctx.arc(0, 0, b.r * 1.15, 0, TAU); ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  function drawPBullets() {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const b of bullets) {
      if (b.kind === "missile") {
        const a = Math.atan2(b.vy, b.vx) + Math.PI / 2;
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(a);
        ctx.fillStyle = "rgba(182,166,255,.85)";
        roundRectPath(ctx, -2, -7, 4, 14, 2);
        ctx.fill();
        ctx.fillStyle = "#efe8ff";
        roundRectPath(ctx, -1, -9, 2, 6, 1);
        ctx.fill();
        ctx.restore();
        ctx.drawImage(SP.orbRice, b.x - 7, b.y - 7, 14, 14);
      } else if (b.kind === "boltPink") {
        const a = Math.atan2(b.vy, b.vx) + Math.PI / 2;
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(a);
        ctx.fillStyle = "rgba(255,158,196,.9)";
        roundRectPath(ctx, -2.2, -9, 4.4, 18, 2.2);
        ctx.fill();
        ctx.fillStyle = "#fff2f8";
        roundRectPath(ctx, -1, -9, 2, 11, 1);
        ctx.fill();
        ctx.restore();
      } else {
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(Math.atan2(b.vy, b.vx) + Math.PI / 2);
        ctx.drawImage(SP.bolt, -7, -13, 14, 26);
        ctx.restore();
      }
    }
    ctx.restore();
  }

  function drawPlayer() {
    if (!player || state === "over") return;
    const inv = player.invuln > 0;
    const blink = inv && Math.sin(performance.now() * 0.03) < 0 ? 0.32 : 1;

    // 引擎焰
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const flame = 12 + Math.sin(performance.now() * 0.05) * 4;
    const fg = ctx.createLinearGradient(0, player.y + 14, 0, player.y + 20 + flame);
    fg.addColorStop(0, "rgba(255,240,180,.9)");
    fg.addColorStop(0.4, "rgba(255,150,200,.55)");
    fg.addColorStop(1, "rgba(255,120,190,0)");
    ctx.fillStyle = fg;
    for (const s of [-1, 1]) {
      const fx = player.x + s * 4.4;
      ctx.beginPath();
      ctx.moveTo(fx - 2.4, player.y + 14);
      ctx.lineTo(fx + 2.4, player.y + 14);
      ctx.lineTo(fx, player.y + 18 + flame);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    drawSpr(SP.ship, player.x, player.y, 1, player.tilt * 0.16, blink);

    // 判定点
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = inv ? "rgba(255,255,255,.9)" : "rgba(255,255,255,.55)";
    ctx.beginPath(); ctx.arc(player.x, player.y, 2.2, 0, TAU); ctx.fill();
    ctx.globalAlpha = 0.35;
    ctx.beginPath(); ctx.arc(player.x, player.y, 5.5, 0, TAU); ctx.fill();
    ctx.restore();

    if (inv) {
      ctx.save();
      ctx.globalAlpha = 0.35 + Math.sin(performance.now() * 0.012) * 0.15;
      ctx.strokeStyle = "#7bffe6";
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(player.x, player.y, 22, 0, TAU); ctx.stroke();
      ctx.restore();
    }
  }

  function drawFX() {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const p of parts) {
      const a = clamp(p.life / p.max, 0, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      if (p.kind === "dot") {
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (0.4 + a * 0.8), 0, TAU); ctx.fill();
      } else {
        ctx.fillRect(p.x, p.y, p.r, p.r);
      }
    }
    ctx.restore();

    ctx.save();
    for (const r of rings) {
      const a = clamp(r.life / r.max, 0, 1);
      ctx.globalAlpha = a * 0.75;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 2 + a * 2.5;
      ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, TAU); ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const f of floats) {
      const a = clamp(f.life / f.max, 0, 1);
      ctx.globalAlpha = a;
      ctx.font = "900 " + f.size + "px ui-monospace,Menlo,monospace";
      ctx.fillStyle = "rgba(0,0,0,.45)";
      ctx.fillText(f.text, f.x + 1, f.y + 1);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.restore();
  }

  function drawBossBar() {
    if (!boss || boss.enter) return;
    const w = Math.min(VW * 0.82, 420);
    const x = OX + (VW - w) / 2;
    const y = Math.max(88, H * 0.088);
    const p = clamp(boss.hp / boss.maxHp, 0, 1);

    ctx.save();
    ctx.fillStyle = "rgba(8,6,18,.72)";
    roundRectPath(ctx, x - 2, y - 2, w + 4, 10, 5);
    ctx.fill();

    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, "#ff9ec4");
    g.addColorStop(0.55, "#ff5fa2");
    g.addColorStop(1, "#b06bff");
    ctx.fillStyle = g;
    roundRectPath(ctx, x, y, Math.max(2, w * p), 6, 3);
    ctx.fill();

    ctx.globalAlpha = 0.35;
    ctx.fillStyle = "#fff";
    roundRectPath(ctx, x, y, Math.max(2, w * p), 2, 1);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.fillStyle = "rgba(255,255,255,.5)";
    for (let i = 1; i < 3; i++) ctx.fillRect(x + w * (i / 3), y, 1, 6);

    ctx.font = "800 8px ui-monospace,Menlo,monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillStyle = "rgba(255,214,234,.85)";
    ctx.fillText("LEVIATHAN · 深海利维坦", x + w / 2, y - 5);
    ctx.restore();
  }

  function drawWarning() {
    if (bossWarn <= 0 || boss) return;
    const a = 0.45 + Math.sin(performance.now() * 0.02) * 0.35;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = "rgba(255,60,110,.16)";
    ctx.fillRect(OX, H * 0.4, VW, 92);
    ctx.strokeStyle = "rgba(255,120,160,.7)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 6; i++) {
      const y = H * 0.4 + 8 + i * 15;
      ctx.beginPath();
      ctx.moveTo(OX, y);
      ctx.lineTo(OX + VW, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "900 22px ui-monospace,Menlo,monospace";
    ctx.fillStyle = "#ff9ec4";
    ctx.fillText("WARNING", OX + VW / 2, H * 0.4 + 34);
    ctx.font = "800 10px ui-monospace,Menlo,monospace";
    ctx.fillStyle = "rgba(255,214,234,.8)";
    ctx.fillText("深海利维坦接近中", OX + VW / 2, H * 0.4 + 58);
    ctx.restore();
  }

  function render(t, rawDt) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (bgCache) ctx.drawImage(bgCache, 0, 0, W, H);
    else { ctx.fillStyle = "#070912"; ctx.fillRect(0, 0, W, H); }

    drawStars(rawDt);

    ctx.save();
    if (shake > 0.4) {
      ctx.translate(rand(-shake, shake) * 0.55, rand(-shake, shake) * 0.55);
    }

    drawField();
    drawPickups();
    drawBeam();
    drawEnemies();
    drawBoss();
    drawEBullets();
    drawPBullets();
    drawPlayer();
    drawFX();
    ctx.restore();

    drawBossBar();
    drawWarning();

    if (flash > 0.002) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = "rgba(" + flashCol + "," + (flash * 0.5).toFixed(3) + ")";
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }

  /* ---------------------------------------------------------
     HUI / 界面
     --------------------------------------------------------- */
  const hc = { score: -1, best: -1, lives: -1, bombs: -1, weapon: "", level: -1, energy: -1, graze: -1, combo: -1 };

  function fmt(n) {
    return String(Math.max(0, Math.floor(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function syncHUD(force) {
    if (!player) return;
    if (force || hc.score !== score) { $("score").textContent = fmt(score); hc.score = score; }
    if (force || hc.best !== best) { $("best").textContent = "BEST " + fmt(best); hc.best = best; }
    if (force || hc.lives !== player.lives) {
      let html = "";
      const slots = Math.max(3, player.lives);
      for (let i = 0; i < slots; i++) html += '<i class="' + (i < player.lives ? "" : "off") + '"></i>';
      $("hearts").innerHTML = html;
      hc.lives = player.lives;
    }
    if (force || hc.bombs !== player.bombs) {
      $("bombNum").textContent = String(player.bombs);
      $("bombBtn").classList.toggle("empty", player.bombs <= 0);
      hc.bombs = player.bombs;
    }
    if (force || hc.weapon !== player.weapon) {
      $("wname").textContent = WEAPONS[player.weapon].name;
      hc.weapon = player.weapon;
    }
    if (force || hc.level !== player.level) {
      $("wlv").textContent = "Lv." + player.level;
      hc.level = player.level;
    }
    if (force || hc.energy !== energy) {
      $("ebar").style.width = clamp(energy, 0, 100).toFixed(0) + "%";
      hc.energy = energy;
    }
    if (force || hc.graze !== graze) {
      $("grazeTxt").textContent = "擦弹 " + graze + (energy > 70 ? " · 能量快满了" : " · 满槽送喵炮");
      hc.graze = graze;
    }
    const mult = 1 + Math.min(combo, 40) * 0.025;
    if (force || hc.combo !== combo) {
      const el = $("combo");
      if (combo >= 3) {
        el.textContent = "×" + mult.toFixed(2).replace(/0$/, "");
        el.classList.add("on");
      } else {
        el.classList.remove("on");
      }
      hc.combo = combo;
    }
  }

  function showScreen(id, on) {
    const el = $(id);
    if (!el) return;
    el.classList.toggle("hide", !on);
    if (on) {
      el.classList.remove("show");
      void el.offsetWidth;
      el.classList.add("show");
    }
  }

  let toastTimer = 0;
  function toast(msg) {
    const el = $("toastB");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("on"), 2000);
  }

  function startGame() {
    Sound.init();
    resetRun();
    state = "playing";
    lastT = 0;
    showScreen("menu", false);
    showScreen("overScr", false);
    showScreen("pauseScr", false);
    $("bombBtn").classList.add("live");
    $("pauseBtn").textContent = "❚❚";
    syncHUD(true);
    toast("开打喵！拖动移动，自动开火");
  }

  function pauseGame() {
    if (state !== "playing") return;
    state = "paused";
    showScreen("pauseScr", true);
    $("bombBtn").classList.remove("live");
    $("pauseBtn").textContent = "▶";
  }

  function resumeGame() {
    if (state !== "paused") return;
    state = "playing";
    lastT = 0;
    showScreen("pauseScr", false);
    $("bombBtn").classList.add("live");
    $("pauseBtn").textContent = "❚❚";
  }

  function gameOver() {
    if (state === "over") return;
    state = "over";
    const rec = score > best;
    if (rec) {
      best = score;
      try { localStorage.setItem("blaster-best", String(best)); } catch (e) {}
    }
    $("finalScore").textContent = fmt(score);
    $("finalBest").textContent = fmt(best);
    $("finalWave").textContent = String(loopN);
    $("finalGraze").textContent = String(graze);
    $("newRecord").classList.toggle("hide", !rec);
    $("overTag").textContent = "RESULT · 本局战果";
    $("overTitle").textContent = rec ? "破纪录了喵！" : "被鱼打倒了喵…";
    showScreen("overScr", true);
    $("bombBtn").classList.remove("live");
    $("menuBest").textContent = fmt(best);
    addShake(28);
    addFlash(0.9, "255,120,170");
    Sound.bigBoom();
    syncHUD(true);
  }

  /* ---------------------------------------------------------
     输入
     --------------------------------------------------------- */
  cvs.addEventListener("pointerdown", (e) => {
    if (state !== "playing" || !player || drag.on) return;
    drag.on = true;
    drag.id = e.pointerId;
    drag.px = e.clientX;
    drag.py = e.clientY;
    drag.sx = player.x;
    drag.sy = player.y;
    try { cvs.setPointerCapture(e.pointerId); } catch (err) {}
    e.preventDefault();
  }, { passive: false });

  cvs.addEventListener("pointermove", (e) => {
    if (!drag.on || e.pointerId !== drag.id || state !== "playing" || !player) return;
    const nx = clamp(drag.sx + (e.clientX - drag.px), OX + 16, OX + VW - 16);
    const ny = clamp(drag.sy + (e.clientY - drag.py), H * 0.3, H - 34);
    player.tilt = clamp(player.tilt + (nx - player.x) * 0.16, -1, 1);
    player.x = nx;
    player.y = ny;
    e.preventDefault();
  }, { passive: false });

  function endDrag(e) {
    if (!drag.on) return;
    if (e && e.pointerId !== drag.id) return;
    drag.on = false;
    drag.id = null;
  }
  cvs.addEventListener("pointerup", endDrag);
  cvs.addEventListener("pointercancel", endDrag);
  window.addEventListener("blur", () => endDrag());
  cvs.addEventListener("contextmenu", (e) => e.preventDefault());

  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (k === "arrowup" || k === "arrowdown" || k === "arrowleft" || k === "arrowright" || k === " ") e.preventDefault();
    if (e.repeat) { if (k === "b") return; }
    if (k === "p" || k === "escape") {
      if (state === "playing") pauseGame();
      else if (state === "paused") resumeGame();
      return;
    }
    if (k === "b" || k === " ") {
      if (state === "playing") useBomb();
      return;
    }
    if (k === "enter" && (state === "menu" || state === "over")) {
      startGame();
      return;
    }
    keys.add(k);
  });
  window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));

  /* ---------------------------------------------------------
     按钮
     --------------------------------------------------------- */
  $("startBtn").addEventListener("click", startGame);
  $("againBtn").addEventListener("click", startGame);
  $("restartBtn").addEventListener("click", startGame);
  $("resumeBtn").addEventListener("click", resumeGame);
  $("pauseBtn").addEventListener("click", () => {
    if (state === "playing") pauseGame();
    else if (state === "paused") resumeGame();
  });
  $("bombBtn").addEventListener("click", useBomb);
  $("soundBtn").addEventListener("click", () => {
    const on = Sound.toggle();
    $("soundBtn").classList.toggle("on", on);
    $("soundBtn").textContent = on ? "♪" : "×";
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state === "playing") pauseGame();
  });

  /* ---------------------------------------------------------
     循环 / 启动
     --------------------------------------------------------- */
  let lastT = 0;

  function loop(t) {
    requestAnimationFrame(loop);
    let raw = lastT ? (t - lastT) / 1000 : 0.016;
    lastT = t;
    if (!isFinite(raw) || raw <= 0) raw = 0.016;
    raw = Math.min(raw, 0.05);
    if (document.hidden) return;

    if (state === "playing") updateGame(raw);
    else updateIdle(raw);

    render(t, raw);
  }

  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resize();
      initStars();
    }, 120);
  });
  window.addEventListener("orientationchange", () => {
    setTimeout(() => { resize(); initStars(); }, 240);
  });

  function boot() {
    buildSprites();
    resize();
    initStars();
    player = makePlayer();
    $("menuBest").textContent = fmt(best);
    $("best").textContent = "BEST " + fmt(best);
    $("soundBtn").classList.toggle("on", Sound.on);
    $("soundBtn").textContent = Sound.on ? "♪" : "×";
    syncHUD(true);
    requestAnimationFrame(loop);

    // 开发调试钩子：仅在 ?dev=1 时暴露
    if (/[?&]dev=1/.test(location.search)) {
      window.__nb = {
        get state() { return state; },
        get score() { return score; },
        get player() { return player; },
        get boss() { return boss; },
        get enemies() { return enemies.length; },
        god(on) { godMode = !!on; },
        bossNow() { bossWarn = 0.01; },
        addScore(n) { score += n; syncHUD(true); },
        clearBullets() { ebullets.length = 0; },
        killBoss() { if (boss) damageBoss(boss.maxHp + 5000); },
        pick(type) { if (player) dropPickup(player.x, player.y - 40, type); },
        hurt() { godMode = false; player.invuln = 0; hurtPlayer(); },
        fx() {
          return {
            rings: rings.map(r => ({ x: Math.round(r.x), y: Math.round(r.y), r: Math.round(r.r), r1: Math.round(r.r1), c: r.color })),
            picks: pickups.map(p => ({ x: Math.round(p.x), y: Math.round(p.y), t: p.type })),
            parts: parts.length, floats: floats.map(f => f.text), eb: ebullets.length, pb: bullets.length
          };
        }
      };
    }
  }

  boot();
})();
