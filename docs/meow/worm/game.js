/* =========================================================
   贪吃毛毛虫 · 客户端
   服务端权威，客户端只负责转向、插值和好看的毛毛虫。
   ========================================================= */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var SKIN_COLORS = {
    candy: "#ff8fc0", cream: "#ffcf5c", mint: "#6fe0c0",
    grape: "#b6a6ff", sky: "#8fd8ff", peach: "#ffb38a"
  };
  var SKINS = Object.keys(SKIN_COLORS);
  var SEG = 13, HEAD_R = 13, BODY_R = 9;

  var cvs = $("stage");
  var ctx = cvs.getContext("2d", { alpha: false });
  var W = 0, H = 0, DPR = 1;
  var world = 1600;
  var cam = { x: 800, y: 800, s: 0.7 };

  var ws = null, myId = null, joined = false;
  var state = "menu";                 // menu | playing | dead
  var snakes = new Map();
  var foods = [];
  var particles = [];
  var mySkin = localStorage.getItem("worm-skin") || "candy";
  if (!SKINS.includes(mySkin)) mySkin = "candy";
  var myName = localStorage.getItem("worm-name") || "";
  var best = +(localStorage.getItem("worm-best") || 0) || 0;
  var aim = 0, aimS = 0, lastSend = 0, pointerOn = false;
  var zoomPulse = 0, camBase = 0.8, flashCol = "255,209,102";
  var holes = [
    { x: 240, y: 240 }, { x: 1360, y: 240 },
    { x: 240, y: 1360 }, { x: 1360, y: 1360 }
  ];
  var joy = { x: 80, y: 700, dx: 0, dy: 0, active: false };
  var shock = [];
  var boostOn = false;
  var screenFlash = 0;
  var lastFrame = 0, stateAt = 0;
  var grassPattern = null;
  var boardAt = 0;
  var sparkAt = {};

  /* ---------------- 画布 ---------------- */
  function resize() {
    W = Math.max(300, window.innerWidth);
    H = Math.max(420, window.innerHeight);
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    cvs.width = Math.round(W * DPR);
    cvs.height = Math.round(H * DPR);
    cvs.style.width = W + "px";
    cvs.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    camBase = Math.min(1.3, Math.max(0.55, Math.max(W / 650, H / 950)));
    cam.s = camBase;
    if (topCvs) {
      topCvs.width = Math.round(W * DPR);
      topCvs.height = Math.round(H * DPR);
      topCvs.style.width = W + "px";
      topCvs.style.height = H + "px";
      tctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    }
    if (glReady) WormGL.resize(W, H, DPR);
    if (!joy.active) { joy.x = 80; joy.y = H - 118; }
    bgGrad = null;
    makeBg();
  }

  function buildGrass() {
    var c = document.createElement("canvas");
    c.width = c.height = 160;
    var g = c.getContext("2d");
    var grd = g.createLinearGradient(0, 0, 160, 160);
    grd.addColorStop(0, "#f8f4ff");
    grd.addColorStop(0.55, "#efe8ff");
    grd.addColorStop(1, "#ffeef8");
    g.fillStyle = grd;
    g.fillRect(0, 0, 160, 160);
    // 糖果屑
    for (var i = 0; i < 90; i++) {
      var x = Math.random() * 160, y = Math.random() * 160;
      g.fillStyle = ["rgba(255,143,192,.25)", "rgba(255,230,168,.4)", "rgba(160,140,255,.18)"][i % 3];
      g.beginPath();
      g.arc(x, y, Math.random() * 2 + 0.5, 0, 6.2832);
      g.fill();
    }
    for (var j = 0; j < 26; j++) {
      g.strokeStyle = "rgba(255,170,210,.28)";
      g.lineWidth = 1;
      var sx = Math.random() * 160, sy = Math.random() * 160;
      g.beginPath();
      g.moveTo(sx, sy);
      g.quadraticCurveTo(sx + 3, sy - 5, sx + 1, sy - 9);
      g.stroke();
    }
    grassPattern = ctx.createPattern(c, "repeat");
  }

  /* ---------------- 音效 ---------------- */
  var actx = null, sfxGain = null, soundOn = localStorage.getItem("worm-sound") !== "0";
  function initAudio() {
    if (actx) { if (actx.state === "suspended") actx.resume(); return; }
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      actx = new AC();
      sfxGain = actx.createGain();
      sfxGain.gain.value = 0.28;
      sfxGain.connect(actx.destination);
    } catch (e) {}
  }
  function beep(freq, dur, type, vol) {
    if (!soundOn || !actx) return;
    var t = actx.currentTime + 0.001;
    var o = actx.createOscillator(), g = actx.createGain();
    o.type = type || "triangle";
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(vol || 0.08, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (dur || 0.08));
    o.connect(g); g.connect(sfxGain);
    o.start(t); o.stop(t + (dur || 0.08) + 0.02);
  }
  function deathSound() {
    if (!soundOn || !actx) return;
    var t = actx.currentTime;
    var o = actx.createOscillator(), g = actx.createGain();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(320, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.5);
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    o.connect(g); g.connect(sfxGain);
    o.start(t); o.stop(t + 0.6);
  }

  /* ---------------- 网络 ---------------- */
  function wsUrl() {
    if (window.MEOW_WS_BASE) return window.MEOW_WS_BASE.replace(/\/$/, "") + "/ws/worm";
    return (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws/worm";
  }
  function send(obj) {
    if (ws && ws.readyState === 1) {
      try { ws.send(JSON.stringify(obj)); } catch (e) {}
    }
  }
  function connect() {
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
    try { ws = new WebSocket(wsUrl()); } catch (e) { $("menuMsg").textContent = "连不上草地喵"; return; }
    ws.addEventListener("open", function () {
      send({ t: "join", name: myName || ("毛毛" + (10 + Math.floor(Math.random() * 90))), skin: mySkin });
    });
    ws.addEventListener("message", function (ev) {
      var m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      onNet(m);
    });
    ws.addEventListener("close", function () {
      if (joined) {
        joined = false;
        state = "menu";
        $("menuMsg").textContent = "掉线了喵，刷新重进";
        show("menu", true);
        show("dead", false);
      }
    });
    ws.addEventListener("error", function () {});
  }

  function onNet(m) {
    if (m.t === "welcome") {
      myId = m.id;
      world = m.world || 1600;
      mySkin = m.skin || mySkin;
      if (m.holes) holes = m.holes;
      joined = true;
      state = "playing";
      show("menu", false);
      show("dead", false);
      $("online").textContent = "草地 " + (m.online || 1) + " 条";
      aim = -Math.PI / 2;
      aimS = aim;
      send({ t: "aim", a: aimS });
      toast("钻进草地了喵");
      return;
    }
    if (m.t === "error") {
      $("menuMsg").textContent = m.msg || "进不去喵";
      return;
    }
    if (m.t === "slam") {
      shock.push({ x: m.x, y: m.y, r: 20, max: 0.55, life: 0.55 });
      if (m.id !== myId) toast("有人放猫爪了喵");
      return;
    }
    if (m.t === "tp") {
      burst(m.x, m.y, "#b6a6ff", 16);
      if (m.id === myId) toast("嗖——穿过去了喵");
      return;
    }
    if (m.t === "event" && m.kind === "goldrain") {
      toast("金果雨！地图中央");
      screenFlash = 0.6;
      return;
    }
    if (m.t === "state") {
      stateAt = performance.now();
      updateSnakes(m.snakes || []);
      foods = m.food || [];
      $("online").textContent = "草地 " + snakes.size + " 条";
      return;
    }
  }

  function updateSnakes(list) {
    var seen = new Set();
    for (var i = 0; i < list.length; i++) {
      var d = list[i];
      seen.add(d.id);
      var s = snakes.get(d.id);
      var wasAlive = s ? s.alive : false;
      if (!s) {
        s = { id: d.id, path: [], dispX: d.x, dispY: d.y, score: d.sc };
        snakes.set(d.id, s);
      }
      if (!wasAlive && d.al) {
        s.path = [];
        s.dispX = d.x;
        s.dispY = d.y;
        s.score = d.sc;
      }
      if (s.score != null && d.sc > s.score + 0 && d.al) {
        burst(d.x, d.y, d.id === myId ? "#ffd166" : "#ffffff", 8);
        s.flashUntil = performance.now() + 280;
        if (d.id === myId) zoomPulse = Math.min(0.14, zoomPulse + 0.055);
      }
      s.name = d.n; s.skin = d.k;
      s.tx = d.x; s.ty = d.y; s.a = d.a;
      s.len = d.l; s.score = d.sc; s.kills = d.ki;
      s.alive = d.al; s.respawnAt = d.ra; s.killer = d.kn;
      s.deathReason = d.dr || "";
      s.boost = !!d.bo;
      s.stun = d.st || 0;
      s.slamCd = d.sk || 0;
      s.wasAlive = wasAlive;
      if (!s.dispA && s.dispA !== 0) s.dispA = d.a;
    }
    for (var id of [...snakes.keys()]) {
      if (!seen.has(id)) snakes.delete(id);
    }
    var me = snakes.get(myId);
    if (me) {
      $("score").textContent = String(me.score || 0);
      $("lenTxt").textContent = "LEN " + (me.len || 0);
      if (!me.alive && state === "playing") onDeath(me);
      if (me.alive && state === "dead") {
        state = "playing";
        show("dead", false);
        toast("复活了，继续吃喵");
      }
    }
  }

  function onDeath(me) {
    state = "dead";
    deathSound();
    burst(me.dispX || me.tx, me.dispY || me.ty, "#ff9ec4", 26);
    $("finalScore").textContent = String(me.score || 0);
    $("finalLen").textContent = String(me.len || 0);
    $("finalKill").textContent = String(me.kills || 0);
    var arr = [...snakes.values()].sort(function (a, b) { return (b.score || 0) - (a.score || 0); });
    var rank = arr.findIndex(function (x) { return x.id === myId; }) + 1;
    $("finalRank").textContent = rank > 0 ? "#" + rank : "-";
    var reason = me.deathReason || "wall";
    if (reason === "wall") {
      $("deadTag").textContent = "撞到边界了";
      $("deadTitle").textContent = "前面是墙喵…";
      toast("碰到边界了喵");
      flashCol = "255,70,120";
      screenFlash = 0.7;
    } else if (reason === "head") {
      $("deadTag").textContent = "和 " + (me.killer || "别人") + " 对撞了";
      $("deadTitle").textContent = "头对头，谁短谁吃亏喵";
    } else if (reason === "body") {
      $("deadTag").textContent = "被 " + (me.killer || "别人") + " 吃掉了";
      $("deadTitle").textContent = "撞到 " + (me.killer || "别人") + " 身上了喵";
    } else {
      $("deadTag").textContent = "出局了";
      $("deadTitle").textContent = "这局结束了喵";
    }
    if ((me.score || 0) > best) {
      best = me.score;
      try { localStorage.setItem("worm-best", String(best)); } catch (e) {}
    }
    show("dead", true);
    updateRespawnHint(me);
  }

  function updateRespawnHint(me) {
    var left = Math.max(0, (me.respawnAt || 0) - Date.now());
    $("respawnHint").textContent = left > 0 ? Math.ceil(left / 1000) + " 秒后自动复活" : "可以复活了喵";
  }

  /* ---------------- 渲染 ---------------- */
  var topCvs = $("top");
  var tctx = topCvs.getContext("2d");
  var glCvs = $("gl");
  var glReady = false;

  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function angleLerp(a, b, t) {
    var d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  }

  function hex2rgb(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function shade(hex, k) {
    var c = hex2rgb(hex);
    return "rgb(" + clamp(Math.round(c[0] * k), 0, 255) + "," + clamp(Math.round(c[1] * k), 0, 255) + "," + clamp(Math.round(c[2] * k), 0, 255) + ")";
  }

  function bodyPoints(s) {
    var pts = [{ x: s.dispX, y: s.dispY }];
    var acc = 0, px = s.dispX, py = s.dispY, need = s.len || 6;
    var path = s.path;
    for (var i = 0; i < path.length && pts.length < need; i++) {
      var p = path[i];
      var d = Math.hypot(p.x - px, p.y - py);
      acc += d;
      if (acc >= SEG) { pts.push({ x: p.x, y: p.y }); acc = 0; }
      px = p.x; py = p.y;
    }
    return pts;
  }

  function burst(x, y, color, n) {
    if (!isFinite(x) || !isFinite(y)) return;
    var rgb = hex2rgb(color);
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 150;
      particles.push({
        x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0.4 + Math.random() * 0.5, max: 0.9,
        rgb: rgb, r: 2 + Math.random() * 3, star: Math.random() < 0.5
      });
    }
  }

  function worldToScreen(x, y) {
    return { x: (x - cam.x) * cam.s + W / 2, y: (y - cam.y) * cam.s + H / 2 };
  }
  function inView(x, y, pad) {
    var p = worldToScreen(x, y);
    return p.x > -pad && p.x < W + pad && p.y > -pad && p.y < H + pad;
  }

  function drawFood(f) {
    var x = f.x, y = f.y, t = performance.now() * 0.002;
    var bob = Math.sin(t + f.id) * 2;
    var p = worldToScreen(x, y + bob);
    var r = 12 * cam.s;
    if (!inView(x, y, 40)) return;

    // 柔光
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    var glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 2.6);
    var gc = f.t === "gold" ? "255,209,102" : f.t === "meat" ? "255,143,182" : "255,110,160";
    glow.addColorStop(0, "rgba(" + gc + ",.45)");
    glow.addColorStop(1, "rgba(" + gc + ",0)");
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(p.x, p.y, r * 2.6, 0, 6.2832); ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(cam.s, cam.s);
    if (f.t === "gold") {
      ctx.rotate(Math.sin(t * 0.8 + f.id) * 0.25);
      ctx.fillStyle = "#ffd166";
      ctx.beginPath();
      for (var i = 0; i < 5; i++) {
        var a = -Math.PI / 2 + i * Math.PI * 2 / 5;
        var a2 = a + Math.PI / 5;
        ctx.lineTo(Math.cos(a) * 13, Math.sin(a) * 13);
        ctx.lineTo(Math.cos(a2) * 5.5, Math.sin(a2) * 5.5);
      }
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#fff6d8";
      ctx.beginPath(); ctx.arc(-3, -3, 2.6, 0, 6.2832); ctx.fill();
    } else if (f.t === "meat") {
      ctx.fillStyle = "#ff8fb6";
      ctx.beginPath(); ctx.ellipse(0, 0, 11, 9, Math.sin(t) * 0.15, 0, 6.2832); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,.7)";
      ctx.beginPath(); ctx.ellipse(-3, -3, 3, 2, 0, 0, 6.2832); ctx.fill();
    } else {
      ctx.rotate(Math.sin(t + f.id) * 0.18);
      var sg = ctx.createLinearGradient(0, -10, 0, 12);
      sg.addColorStop(0, "#ffb3d1");
      sg.addColorStop(1, "#ff4f80");
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.moveTo(0, 12);
      ctx.quadraticCurveTo(-12, 2, -9, -6);
      ctx.quadraticCurveTo(-4, -11, 0, -8);
      ctx.quadraticCurveTo(4, -11, 9, -6);
      ctx.quadraticCurveTo(12, 2, 0, 12);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,.85)";
      for (var sd = 0; sd < 5; sd++) {
        ctx.beginPath();
        ctx.arc(-5 + (sd % 3) * 5, -2 + Math.floor(sd / 3) * 5, 1.1, 0, 6.2832);
        ctx.fill();
      }
      ctx.fillStyle = "#7fe3c4";
      for (var lf = -1; lf <= 1; lf++) {
        ctx.beginPath();
        ctx.moveTo(0, -8);
        ctx.lineTo(lf * 6, -13);
        ctx.lineTo(lf * 2, -7);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawHoles() {
    var t = performance.now() * 0.001;
    for (var i = 0; i < holes.length; i++) {
      var h = holes[i];
      if (!inView(h.x, h.y, 80)) continue;
      var p = worldToScreen(h.x, h.y);
      var r = 30 * cam.s;
      ctx.save();
      ctx.translate(p.x, p.y);
      var g = ctx.createRadialGradient(0, 0, 2, 0, 0, r);
      g.addColorStop(0, "rgba(20,8,32,.95)");
      g.addColorStop(0.65, "rgba(120,60,170,.55)");
      g.addColorStop(1, "rgba(255,143,192,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, 6.2832); ctx.fill();
      ctx.strokeStyle = "rgba(255,150,210,.65)";
      ctx.lineWidth = 2 * cam.s;
      for (var k = 0; k < 3; k++) {
        ctx.beginPath();
        ctx.arc(0, 0, r * (0.45 + k * 0.2), t * (1 + k * 0.3), t * (1 + k * 0.3) + 4.2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  var bgGrad = null;
  function makeBg() {
    bgGrad = ctx.createLinearGradient(0, 0, 0, H);
    bgGrad.addColorStop(0, "#150c22");
    bgGrad.addColorStop(0.5, "#1b1029");
    bgGrad.addColorStop(1, "#241233");
  }

  /* WebGL 身体 */
  function addBodyGL(s) {
    var pts = bodyPoints(s);
    var n = pts.length;
    if (n < 2) return;
    var rgb = hex2rgb(SKIN_COLORS[s.skin] || SKIN_COLORS.candy);
    var t = performance.now() * 0.004;
    var phase = (t * 0.32) % 1.3 - 0.15;

    for (var i = n - 1; i >= 1; i--) {
      var p = worldToScreen(pts[i].x, pts[i].y);
      var k = 1 - (i / n) * 0.42;
      var r = BODY_R * (0.72 + 0.28 * k) * cam.s;
      var bright = 0.5 + 0.5 * k;
      var flow = 1 - Math.abs(i / Math.max(1, n - 1) - phase) * 5;
      var cr = rgb[0] * bright, cg = rgb[1] * bright, cb = rgb[2] * bright;
      if (flow > 0) {
        cr = cr + (255 - cr) * flow * 0.55;
        cg = cg + (240 - cg) * flow * 0.55;
        cb = cb + (180 - cb) * flow * 0.55;
      }
      WormGL.add(p.x, p.y, r, cr, cg, cb, 0.95);
      if (i > 1) {
        var prevP = worldToScreen(pts[i - 1].x, pts[i - 1].y);
        WormGL.add((p.x + prevP.x) / 2, (p.y + prevP.y) / 2, r * 0.96, cr, cg, cb, 0.9);
      }
      if (s.boost && i > n * 0.55 && i % 3 === 0) {
        WormGL.add(p.x, p.y, r * 1.9, 255, 170, 220, 0.12);
      }
    }

    // 尾迹星屑
    if (s.alive) {
      var tp = worldToScreen(pts[n - 1].x, pts[n - 1].y);
      var tw = 2.5 + Math.sin(t * 3) * 1.2;
      WormGL.add(tp.x, tp.y, tw * 2.4 * cam.s, 255, 240, 170, 0.8);
    }
  }

  function drawShockwaves(dt) {
    for (var i = shock.length - 1; i >= 0; i--) {
      var s = shock[i];
      s.life -= dt;
      if (s.life <= 0) { shock.splice(i, 1); continue; }
      var a = clamp(s.life / s.max, 0, 1);
      var p = worldToScreen(s.x, s.y);
      tctx.save();
      tctx.globalAlpha = a * 0.9;
      tctx.strokeStyle = "#ffd1e3";
      tctx.lineWidth = 3 * cam.s;
      tctx.beginPath();
      tctx.arc(p.x, p.y, s.r * cam.s, 0, 6.2832);
      tctx.stroke();
      tctx.globalAlpha = a * 0.4;
      tctx.lineWidth = 10 * cam.s;
      tctx.strokeStyle = "#ff8fc0";
      tctx.stroke();
      tctx.restore();
    }
  }

  function drawJoystick() {
    var r = 50, kr = 21;
    tctx.save();
    tctx.globalAlpha = 0.9;
    tctx.fillStyle = "rgba(60,34,80,.55)";
    tctx.strokeStyle = "rgba(255,143,192,.45)";
    tctx.lineWidth = 2;
    tctx.beginPath(); tctx.arc(joy.x, joy.y, r, 0, 6.2832); tctx.fill(); tctx.stroke();
    var kx = joy.x + joy.dx * (r - kr) * 0.9;
    var ky = joy.y + joy.dy * (r - kr) * 0.9;
    var kg = tctx.createRadialGradient(kx - 6, ky - 6, 2, kx, ky, kr);
    kg.addColorStop(0, "#ffd1e3");
    kg.addColorStop(1, "#ff8fc0");
    tctx.fillStyle = kg;
    tctx.beginPath(); tctx.arc(kx, ky, kr, 0, 6.2832); tctx.fill();
    tctx.strokeStyle = "rgba(255,255,255,.7)";
    tctx.lineWidth = 1.5;
    tctx.stroke();
    tctx.restore();
  }

  function drawSlamBtn() {
    var bx = W - 62, by = H - 200, r = 34;
    var me = snakes.get(myId);
    var cd = me ? (me.slamCd || 0) : 0;
    var ready = cd <= 0;
    tctx.save();
    tctx.globalAlpha = ready ? 0.95 : 0.45;
    var g = tctx.createRadialGradient(bx - 8, by - 10, 3, bx, by, r);
    g.addColorStop(0, ready ? "rgba(255,230,190,.95)" : "rgba(120,90,140,.7)");
    g.addColorStop(1, ready ? "rgba(255,143,192,.85)" : "rgba(70,50,90,.6)");
    tctx.fillStyle = g;
    tctx.beginPath(); tctx.arc(bx, by, r, 0, 6.2832); tctx.fill();
    tctx.strokeStyle = "rgba(255,255,255,.6)";
    tctx.lineWidth = 2;
    tctx.stroke();
    tctx.fillStyle = ready ? "#4a2438" : "#ffe6f2";
    tctx.font = "900 11px -apple-system,'PingFang SC',sans-serif";
    tctx.textAlign = "center";
    tctx.textBaseline = "middle";
    tctx.fillText("猫爪", bx, by);
    if (!ready) {
      tctx.beginPath();
      tctx.strokeStyle = "rgba(255,255,255,.85)";
      tctx.lineWidth = 3;
      tctx.arc(bx, by, r - 2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - cd / 4200));
      tctx.stroke();
    }
    tctx.restore();
  }

  var stars = [];
  (function () {
    for (var i = 0; i < 130; i++) {
      stars.push({ x: Math.random() * 1600, y: Math.random() * 1600, r: Math.random() * 1.6 + 0.4, a: Math.random() * 0.5 + 0.15 });
    }
  })();

  function drawBase() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = bgGrad || "#160d22";
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(cam.s, cam.s);
    ctx.translate(-cam.x, -cam.y);

    ctx.fillStyle = "#170e24";
    ctx.fillRect(0, 0, world, world);

    for (var i = 0; i < stars.length; i++) {
      var st = stars[i];
      ctx.globalAlpha = st.a;
      ctx.fillStyle = "#d9c8ff";
      ctx.fillRect(st.x, st.y, st.r, st.r);
    }
    ctx.globalAlpha = 1;

    ctx.strokeStyle = "rgba(180,140,255,.08)";
    ctx.lineWidth = 1 / cam.s;
    var step = 100;
    var x0 = Math.floor((cam.x - W / (2 * cam.s)) / step) * step;
    var y0 = Math.floor((cam.y - H / (2 * cam.s)) / step) * step;
    for (var gx = x0; gx < cam.x + W / (2 * cam.s); gx += step) {
      ctx.beginPath(); ctx.moveTo(gx, Math.max(0, cam.y - H / (2 * cam.s))); ctx.lineTo(gx, Math.min(world, cam.y + H / (2 * cam.s))); ctx.stroke();
    }
    for (var gy = y0; gy < cam.y + H / (2 * cam.s); gy += step) {
      ctx.beginPath(); ctx.moveTo(Math.max(0, cam.x - W / (2 * cam.s)), gy); ctx.lineTo(Math.min(world, cam.x + W / (2 * cam.s)), gy); ctx.stroke();
    }

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = "rgba(255,120,190,.65)";
    ctx.lineWidth = 4 / cam.s;
    ctx.strokeRect(2, 2, world - 4, world - 4);
    ctx.restore();

    ctx.restore();

    drawHoles();
    for (var f = 0; f < foods.length; f++) drawFood(foods[f]);
  }

  function computeCam(dt) {
    zoomPulse = Math.max(0, zoomPulse - dt * 0.6);
    var targetS = camBase * (1 + Math.min(0.16, zoomPulse));
    cam.s = lerp(cam.s, targetS, Math.min(1, dt * 7));
    var me = snakes.get(myId);
    if (me) {
      var tx = me.alive ? me.dispX : (me.tx || cam.x);
      var ty = me.alive ? me.dispY : (me.ty || cam.y);
      cam.x = lerp(cam.x, tx, Math.min(1, dt * 7));
      cam.y = lerp(cam.y, ty, Math.min(1, dt * 7));
    }
    var halfW = W / (2 * cam.s), halfH = H / (2 * cam.s);
    cam.x = clamp(cam.x, Math.min(halfW, world / 2), Math.max(world - halfW, world / 2));
    cam.y = clamp(cam.y, Math.min(halfH, world / 2), Math.max(world - halfH, world / 2));
  }

  function render(dt) {
    computeCam(dt);
    drawBase();

    // WebGL 身体 + 粒子
    if (glReady) {
      WormGL.begin();
      var list = [...snakes.values()];
      list.sort(function (a, b) { return (a.id === myId ? 1 : 0) - (b.id === myId ? 1 : 0); });
      for (var i = 0; i < list.length; i++) if (list[i].alive) addBodyGL(list[i]);
      for (var p = 0; p < particles.length; p++) {
        var q = particles[p];
        if (q.life <= 0) continue;
        var sp = worldToScreen(q.x, q.y);
        var al = Math.max(0, q.life / q.max);
        WormGL.add(sp.x, sp.y, q.r * cam.s * (q.star ? 1.6 : 1), q.rgb[0], q.rgb[1], q.rgb[2], al * 0.9);
      }
      WormGL.flush();
    } else {
      // 没 WebGL 就退回 2D 圆点（也有渐变）
      ctx.save();
      ctx.translate(W / 2, H / 2); ctx.scale(cam.s, cam.s); ctx.translate(-cam.x, -cam.y);
      for (var s2 of snakes.values()) {
        if (!s2.alive) continue;
        var pts = bodyPoints(s2);
        var col = SKIN_COLORS[s2.skin] || "#ff8fc0";
        if (pts.length > 1) {
          ctx.strokeStyle = shade(col, 0.7);
          ctx.lineWidth = BODY_R * 1.25;
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          for (var ci = 1; ci < pts.length; ci++) ctx.lineTo(pts[ci].x, pts[ci].y);
          ctx.stroke();
        }
        for (var k = pts.length - 1; k >= 1; k--) {
          var kk = 1 - (k / pts.length) * 0.42;
          ctx.fillStyle = shade(col, 0.62 + 0.38 * kk);
          ctx.beginPath();
          ctx.arc(pts[k].x, pts[k].y, BODY_R * (0.72 + 0.28 * kk), 0, 6.2832);
          ctx.fill();
        }
        if (pts.length > 1) {
          ctx.fillStyle = "rgba(255,240,170,.9)";
          ctx.beginPath(); ctx.arc(pts[pts.length - 1].x, pts[pts.length - 1].y, 4, 0, 6.2832); ctx.fill();
        }
      }
      for (var pi = 0; pi < particles.length; pi++) {
        var pq = particles[pi];
        if (pq.life <= 0) continue;
        ctx.globalAlpha = Math.max(0, pq.life / pq.max);
        ctx.fillStyle = "rgb(" + pq.rgb[0] + "," + pq.rgb[1] + "," + pq.rgb[2] + ")";
        ctx.beginPath(); ctx.arc(pq.x, pq.y, pq.r, 0, 6.2832); ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    // 顶层：头 / 名字 / 冲击波 / 摇杆 / 猫爪
    tctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    tctx.clearRect(0, 0, W, H);
    tctx.save();
    tctx.translate(W / 2, H / 2); tctx.scale(cam.s, cam.s); tctx.translate(-cam.x, -cam.y);
    for (var h of snakes.values()) if (h.alive) drawHeadFrame(h, h.id === myId);
    tctx.restore();

    drawShockwaves(dt);

    var meAlive = snakes.get(myId);
    if (meAlive && meAlive.alive) {
      var edge = 130;
      var dl = meAlive.dispX, dr = world - meAlive.dispX;
      var dtp = meAlive.dispY, db = world - meAlive.dispY;
      var sides = [
        { a: Math.max(0, 1 - dl / edge), g: tctx.createLinearGradient(0, 0, 90, 0), x: 0, y: 0, w: 90, h: H },
        { a: Math.max(0, 1 - dr / edge), g: tctx.createLinearGradient(W, 0, W - 90, 0), x: W - 90, y: 0, w: 90, h: H },
        { a: Math.max(0, 1 - dtp / edge), g: tctx.createLinearGradient(0, 0, 0, 90), x: 0, y: 0, w: W, h: 90 },
        { a: Math.max(0, 1 - db / edge), g: tctx.createLinearGradient(0, H, 0, H - 90), x: 0, y: H - 90, w: W, h: 90 }
      ];
      for (var sd = 0; sd < sides.length; sd++) {
        if (sides[sd].a <= 0.01) continue;
        var g2 = sides[sd].g;
        g2.addColorStop(0, "rgba(255,60,110," + (sides[sd].a * 0.5).toFixed(3) + ")");
        g2.addColorStop(1, "rgba(255,60,110,0)");
        tctx.fillStyle = g2;
        tctx.fillRect(sides[sd].x, sides[sd].y, sides[sd].w, sides[sd].h);
      }
    }

    drawJoystick();
    drawSlamBtn();
    if (screenFlash > 0) {
      screenFlash = Math.max(0, screenFlash - dt);
      tctx.save();
      tctx.globalCompositeOperation = "lighter";
      tctx.fillStyle = "rgba(" + flashCol + "," + (screenFlash * 0.35).toFixed(3) + ")";
      tctx.fillRect(0, 0, W, H);
      tctx.restore();
    }
    drawMini();
  }

  // 在顶层世界坐标里画头：drawHead 内部自己算屏幕坐标，所以这里只临时借用上下文
  function drawHeadFrame(s, isMe) {
    var saved = tctx;
    drawHeadOn(tctx, s, isMe);
  }

  function drawHeadOn(g, s, isMe) {
    // 复用 drawHead 的实现，但绘制到 g（外层已经做过世界变换，这里用世界坐标转屏幕的逆）
    var base = SKIN_COLORS[s.skin] || SKIN_COLORS.candy;
    var a = s.dispA || s.a || 0;
    g.save();
    g.translate(s.dispX, s.dispY);
    g.rotate(a + Math.PI / 2);
    // 猫耳
    for (var sgn = -1; sgn <= 1; sgn += 2) {
      g.fillStyle = shade(base, 0.68);
      g.beginPath();
      g.moveTo(sgn * 7, -10); g.lineTo(sgn * 11, -21); g.lineTo(sgn * 15, -9);
      g.closePath(); g.fill();
      g.strokeStyle = "rgba(30,10,30,.5)"; g.lineWidth = 0.8; g.stroke();
      g.fillStyle = shade(base, 0.42);
      g.beginPath();
      g.moveTo(sgn * 8.5, -11.5); g.lineTo(sgn * 11, -18.5); g.lineTo(sgn * 13, -10);
      g.closePath(); g.fill();
    }
    var hg = g.createRadialGradient(-4, -5, 1, 0, 0, HEAD_R * 1.25);
    hg.addColorStop(0, shade(base, 1.25));
    hg.addColorStop(0.55, base);
    hg.addColorStop(1, shade(base, 0.62));
    g.fillStyle = hg;
    g.beginPath(); g.arc(0, 0, HEAD_R * 1.15, 0, 6.2832); g.fill();
    if (isMe) {
      g.strokeStyle = "rgba(255,255,255,.32)";
      g.lineWidth = 1.1;
      g.setLineDash([3, 3]);
      g.beginPath(); g.arc(0, 0, HEAD_R * 0.95, 0, 6.2832); g.stroke();
      g.setLineDash([]);
    }
    g.fillStyle = "rgba(255,255,255,.28)";
    g.beginPath(); g.arc(-4.5, -5, 5.5, 0, 6.2832); g.fill();
    for (var e = -1; e <= 1; e += 2) {
      g.fillStyle = "#3a1830";
      g.beginPath(); g.arc(e * 5, -3, 3.6, 0, 6.2832); g.fill();
      g.fillStyle = "#ffffff";
      g.beginPath(); g.arc(e * 5 - 1.1, -4.2, 1.4, 0, 6.2832); g.fill();
    }
    g.fillStyle = "rgba(255,110,160,.55)";
    for (var b = -1; b <= 1; b += 2) {
      g.beginPath(); g.ellipse(b * 9, 4, 3.8, 2.3, 0, 0, 6.2832); g.fill();
    }
    g.strokeStyle = "rgba(255,255,255,.5)"; g.lineWidth = 0.9;
    for (var w = -1; w <= 1; w += 2) {
      for (var ww = 0; ww < 3; ww++) {
        g.beginPath(); g.moveTo(w * 9, 1 + ww * 2.2); g.lineTo(w * 18, ww * 2 - 1); g.stroke();
      }
    }
    g.strokeStyle = "rgba(90,30,50,.65)"; g.lineWidth = 1.4;
    g.beginPath(); g.arc(0, 2, 3.6, 0.2, Math.PI - 0.2); g.stroke();

    if (s.stun && s.stun > Date.now()) {
      g.strokeStyle = "rgba(255,220,120,.9)"; g.lineWidth = 1.6;
      for (var st = 0; st < 3; st++) {
        var aa = performance.now() * 0.006 + st * 2.1;
        g.beginPath();
        g.arc(Math.cos(aa) * 18, Math.sin(aa) * 8 - 12, 2.2, 0, 6.2832);
        g.stroke();
      }
    }
    g.restore();

    g.save();
    g.translate(s.dispX, s.dispY - 46 / cam.s);
    g.scale(1 / cam.s, 1 / cam.s);
    g.font = "800 10px -apple-system,'PingFang SC',sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    var nm = s.name || "";
    var tw = g.measureText(nm).width;
    g.fillStyle = "rgba(18,10,28,.5)";
    g.beginPath();
    g.ellipse(0, 0, tw / 2 + 7, 8.5, 0, 0, 6.2832);
    g.fill();
    g.fillStyle = isMe ? "#ffd1e3" : "rgba(230,210,255,.78)";
    g.fillText(nm, 0, 0);
    g.restore();
  }

  var mini = $("mini"), mctx = mini.getContext("2d");
  function drawMini() {
    var m = 180;
    mctx.clearRect(0, 0, m, m);
    mctx.fillStyle = "rgba(20,12,30,.8)";
    mctx.fillRect(0, 0, m, m);
    mctx.strokeStyle = "rgba(255,143,192,.55)";
    mctx.lineWidth = 2;
    mctx.strokeRect(4, 4, m - 8, m - 8);
    mctx.fillStyle = "rgba(255,143,192,.55)";
    for (var i = 0; i < foods.length; i += 3) {
      mctx.fillRect(4 + foods[i].x / world * (m - 8), 4 + foods[i].y / world * (m - 8), 2, 2);
    }
    for (var h = 0; h < holes.length; h++) {
      mctx.strokeStyle = "rgba(255,143,192,.7)";
      mctx.beginPath();
      mctx.arc(4 + holes[h].x / world * (m - 8), 4 + holes[h].y / world * (m - 8), 4, 0, 6.2832);
      mctx.stroke();
    }
    for (var s of snakes.values()) {
      if (!s.alive) continue;
      mctx.fillStyle = s.id === myId ? "#ffffff" : (SKIN_COLORS[s.skin] || "#ff8fc0");
      var r = s.id === myId ? 4 : 2.6;
      mctx.beginPath();
      mctx.arc(4 + s.dispX / world * (m - 8), 4 + s.dispY / world * (m - 8), r, 0, 6.2832);
      mctx.fill();
    }
  }

  /* ---------------- 主循环 ---------------- */
  function loop(ts) {
    requestAnimationFrame(loop);
    var dt = lastFrame ? Math.min(0.05, (ts - lastFrame) / 1000) : 0.016;
    lastFrame = ts;

    var na = angleLerp(aimS, aim, Math.min(1, dt * 9));
    if (Math.abs(na - aimS) > 0.004) { aimS = na; sendAim(); }

    // 平滑
    for (var s of snakes.values()) {
      if (s.dispX == null) { s.dispX = s.tx; s.dispY = s.ty; s.dispA = s.a; }
      if (!s.dispA && s.dispA !== 0) s.dispA = s.a || 0;
      var jump = Math.hypot(s.tx - s.dispX, s.ty - s.dispY);
      if (jump > 260) {
        s.dispX = s.tx; s.dispY = s.ty; s.path = [];
      } else {
        var spd = s.boost ? 158 * 1.85 : 158;
        s.dispX += Math.cos(s.dispA) * spd * dt;
        s.dispY += Math.sin(s.dispA) * spd * dt;
        s.dispX += (s.tx - s.dispX) * 0.22;
        s.dispY += (s.ty - s.dispY) * 0.22;
      }
      s.dispA = angleLerp(s.dispA, s.a || 0, Math.min(1, dt * 16));
      if (s.alive) {
        var last = s.path[0];
        if (!last || Math.hypot(s.dispX - last.x, s.dispY - last.y) > 2.2) {
          s.path.unshift({ x: s.dispX, y: s.dispY });
          var cap = Math.ceil(((s.len || 6) * SEG) / 2.2) + 30;
          if (s.path.length > cap) s.path.length = cap;
        }
      }
    }

    for (var sp of snakes.values()) {
      if (!sp.alive) continue;
      var lastS = sparkAt[sp.id] || 0;
      if (ts - lastS < 170) continue;
      sparkAt[sp.id] = ts;
      if (particles.length > 240) continue;
      var bp = bodyPoints(sp);
      var tl = bp[bp.length - 1];
      if (!tl) continue;
      particles.push({
        x: tl.x, y: tl.y + (Math.random() - 0.5) * 4,
        vx: (Math.random() - 0.5) * 18,
        vy: -14 - Math.random() * 18,
        life: 0.7 + Math.random() * 0.4, max: 1.1,
        rgb: hex2rgb(SKIN_COLORS[sp.skin] || "#ff8fc0"),
        r: 1.6 + Math.random() * 1.2, star: true
      });
    }

    render(dt);

    // 排行榜 & 复活倒计时
    if (ts - boardAt > 300) {
      boardAt = ts;
      drawBoard();
      var me = snakes.get(myId);
      if (me && !me.alive && state === "dead") updateRespawnHint(me);
    }
  }

  var boardCache = "";
  function drawBoard() {
    var arr = [...snakes.values()].filter(function (s) { return s.alive; })
      .sort(function (a, b) { return (b.score || 0) - (a.score || 0); }).slice(0, 5);
    var html = "";
    for (var i = 0; i < arr.length; i++) {
      var s = arr[i];
      var c = SKIN_COLORS[s.skin] || "#9bff5c";
      html += "<div class='brow" + (s.id === myId ? " me" : "") + "'><i style='color:" + c + ";background:" + c + "'></i><b>" +
        (i + 1) + ". " + (s.name || "") + "</b><span>" + (s.score || 0) + "</span></div>";
    }
    if (html !== boardCache) {
      $("board").innerHTML = html;
      boardCache = html;
    }
  }

  /* ---------------- 输入 ---------------- */
  function sendAim(force) {
    var now = performance.now();
    if (!force && now - lastSend < 70) return;
    lastSend = now;
    send({ t: "aim", a: aimS });
  }

  function setBoost(on) {
    if (boostOn === on) return;
    boostOn = on;
    send({ t: "boost", on: on });
  }

  function updateJoy(x, y) {
    var r = 54;
    var dx = (x - joy.x) / (r * 0.9);
    var dy = (y - joy.y) / (r * 0.9);
    var len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; len = 1; }
    joy.dx = dx; joy.dy = dy;
    if (len > 0.18) {
      aim = Math.atan2(dy, dx);
      sendAim();
    }
    setBoost(len > 0.86);
  }

  function slam() {
    var me = snakes.get(myId);
    if (!me || !me.alive) return;
    if ((me.slamCd || 0) > 0) { toast("猫爪还在冷却喵"); return; }
    if ((me.len || 0) < 9) { toast("身体太短了，先吃点草莓喵"); return; }
    send({ t: "slam" });
    toast("猫爪！");
    me.slamCd = 4200;
    shock.push({ x: me.dispX, y: me.dispY, r: 20, max: 0.5, life: 0.5 });
    beep(520, 0.12, "square", 0.08);
  }

  function isSlamHit(x, y) {
    return Math.hypot(x - (W - 62), y - (H - 200)) < 42;
  }

  cvs.addEventListener("pointerdown", function (e) {
    if (state !== "playing") return;
    initAudio();
    if (isSlamHit(e.clientX, e.clientY)) { slam(); e.preventDefault(); return; }
    joy.active = true;
    joy.pid = e.pointerId;
    joy.x = clamp(e.clientX, 70, W - 70);
    joy.y = clamp(e.clientY, 110, H - 70);
    try { cvs.setPointerCapture(e.pointerId); } catch (err) {}
    updateJoy(e.clientX, e.clientY);
    e.preventDefault();
  }, { passive: false });

  window.addEventListener("pointermove", function (e) {
    if (state !== "playing" || !joy.active) return;
    if (joy.pid != null && e.pointerId !== joy.pid) return;
    updateJoy(e.clientX, e.clientY);
  }, { passive: false });

  function endJoy(e) {
    if (!joy.active) return;
    if (e && joy.pid != null && e.pointerId !== joy.pid) return;
    joy.active = false;
    joy.pid = null;
    joy.dx = 0; joy.dy = 0;
    joy.x = 80; joy.y = H - 118;
    setBoost(false);
  }
  window.addEventListener("pointerup", endJoy);
  window.addEventListener("pointercancel", endJoy);
  window.addEventListener("keydown", function (e) {
    if (state !== "playing") return;
    var k = e.key;
    if (k === " " || k === "j" || k === "J") { slam(); e.preventDefault(); return; }
    if (k === "ArrowLeft" || k === "a" || k === "A") { aim -= 0.2; sendAim(true); e.preventDefault(); }
    if (k === "ArrowRight" || k === "d" || k === "D") { aim += 0.2; sendAim(true); e.preventDefault(); }
    if (k === "Shift") setBoost(true);
  });
  window.addEventListener("keyup", function (e) {
    if (e.key === "Shift") setBoost(false);
  });

  /* ---------------- UI ---------------- */
  function show(id, on) {
    var el = $(id);
    if (!el) return;
    el.classList.toggle("hide", !on);
  }
  var toastTimer = 0;
  function toast(msg) {
    var el = $("toast");
    el.textContent = msg;
    el.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("on"); }, 2000);
  }

  function buildSkins() {
    var row = $("skinRow");
    row.innerHTML = "";
    SKINS.forEach(function (k) {
      var d = document.createElement("div");
      d.className = "skin" + (k === mySkin ? " on" : "");
      d.style.background = SKIN_COLORS[k];
      d.style.color = SKIN_COLORS[k];
      d.onclick = function () {
        mySkin = k;
        localStorage.setItem("worm-skin", k);
        row.querySelectorAll(".skin").forEach(function (x) { x.classList.remove("on"); });
        d.classList.add("on");
        send({ t: "skin", skin: k });
        beep(720, 0.06);
      };
      row.appendChild(d);
    });
  }

  function join() {
    myName = ($("nameInput").value || "").trim().slice(0, 10) || ("毛毛" + (10 + Math.floor(Math.random() * 90)));
    try { localStorage.setItem("worm-name", myName); } catch (e) {}
    initAudio();
    connect();
    $("menuMsg").textContent = "正在钻草地…";
  }

  $("joinBtn").addEventListener("click", join);
  $("respawnBtn").addEventListener("click", function () {
    send({ t: "respawn" });
    $("respawnHint").textContent = "马上复活…";
  });
  $("muteBtn").addEventListener("click", function () {
    soundOn = !soundOn;
    localStorage.setItem("worm-sound", soundOn ? "1" : "0");
    $("muteBtn").classList.toggle("on", soundOn);
    $("muteBtn").textContent = soundOn ? "♪" : "×";
  });
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", function () { setTimeout(resize, 200); });

  /* ---------------- 启动 ---------------- */
  function boot() {
    try { glReady = WormGL.init(glCvs); } catch (e) { glReady = false; }
    resize();
    buildGrass();
    makeBg();
    buildSkins();
    $("nameInput").value = myName;
    $("menuMsg").textContent = "";
    $("muteBtn").classList.toggle("on", soundOn);
    $("muteBtn").textContent = soundOn ? "♪" : "×";
    aim = -Math.PI / 2;
    requestAnimationFrame(loop);

    if (/[?&]dev=1/.test(location.search)) {
      window.__worm = {
        get state() { return state; },
        get me() { return snakes.get(myId); },
        get count() { return snakes.size; },
        get foods() { return foods.length; },
        get aim() { return aim; },
        setAim: function (a) { aim = a; sendAim(true); },
        join: join,
        kill: function () { send({ t: "aim", a: aim }); },
        setBoost: function (on) { setBoost(!!on); },
        slam: slam,
        get holes() { return holes; },
        nearest: function () {
          var me = snakes.get(myId);
          if (!me) return null;
          var best = null, bd = 1e9;
          for (var i = 0; i < foods.length; i++) {
            var d = Math.hypot(foods[i].x - me.dispX, foods[i].y - me.dispY);
            if (d < bd) { bd = d; best = foods[i]; }
          }
          return best;
        },
        aimTo: function (x, y) {
          var me = snakes.get(myId);
          if (!me) return;
          aim = Math.atan2(y - me.dispY, x - me.dispX);
          sendAim(true);
        }
      };
    }
  }

  boot();
})();
