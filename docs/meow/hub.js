(function () {
  "use strict";

  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var DPR = Math.min(window.devicePixelRatio || 1, 2);

  /* ---------------- 背景星海 ---------------- */
  var bg = document.getElementById("bg");
  var bx = bg.getContext("2d");
  var stars = [], dust = [], bw = 0, bh = 0;

  function sizeBG() {
    bw = bg.clientWidth; bh = bg.clientHeight;
    bg.width = Math.floor(bw * DPR); bg.height = Math.floor(bh * DPR);
    bx.setTransform(DPR, 0, 0, DPR, 0, 0);
    var n = Math.round((bw * bh) / 14000);
    stars = [];
    for (var i = 0; i < n; i++) {
      stars.push({
        x: Math.random() * bw, y: Math.random() * bh,
        r: Math.random() * 1.25 + .28,
        a: Math.random() * .55 + .18,
        tw: Math.random() * Math.PI * 2,
        sp: Math.random() * .045 + .012,
        hue: Math.random() < .16 ? "mint" : (Math.random() < .3 ? "pink" : "white")
      });
    }
    dust = [];
    for (var j = 0; j < 16; j++) {
      dust.push({ x: Math.random() * bw, y: Math.random() * bh, r: Math.random() * 90 + 40, a: Math.random() * .05 + .02, vy: -(Math.random() * .25 + .08), vx: (Math.random() - .5) * .18 });
    }
  }

  function drawBG(t) {
    bx.clearRect(0, 0, bw, bh);
    for (var d = 0; d < dust.length; d++) {
      var u = dust[d];
      u.y += u.vy; u.x += u.vx;
      if (u.y < -u.r) { u.y = bh + u.r; u.x = Math.random() * bw; }
      var g = bx.createRadialGradient(u.x, u.y, 0, u.x, u.y, u.r);
      g.addColorStop(0, "rgba(130,160,255," + u.a + ")");
      g.addColorStop(1, "rgba(130,160,255,0)");
      bx.fillStyle = g;
      bx.beginPath(); bx.arc(u.x, u.y, u.r, 0, 6.2832); bx.fill();
    }
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      s.y += s.sp; if (s.y > bh + 2) { s.y = -2; s.x = Math.random() * bw; }
      var tw = reduce ? 1 : (.6 + .4 * Math.sin(t * .0016 + s.tw));
      bx.globalAlpha = s.a * tw;
      bx.fillStyle = s.hue === "mint" ? "#8ffbe6" : s.hue === "pink" ? "#ffa9cd" : "#ffffff";
      bx.beginPath(); bx.arc(s.x, s.y, s.r, 0, 6.2832); bx.fill();
    }
    bx.globalAlpha = 1;
  }

  /* ---------------- 小预览：接鱼 ---------------- */
  function fishShape(c, x, y, s, col, dir, wag) {
    c.save(); c.translate(x, y); c.rotate(dir);
    c.fillStyle = col;
    // 尾巴
    c.beginPath();
    c.moveTo(-s * .82, 0);
    c.quadraticCurveTo(-s * 1.45, -s * .62 + wag * s * .3, -s * 1.62, -s * .18 + wag * s * .5);
    c.quadraticCurveTo(-s * 1.34, 0, -s * 1.62, s * .18 + wag * s * .5);
    c.quadraticCurveTo(-s * 1.45, s * .62 + wag * s * .3, -s * .82, 0);
    c.fill();
    // 身体
    c.beginPath();
    c.ellipse(0, 0, s, s * .56, 0, 0, 6.2832);
    c.fill();
    // 背鳍
    c.globalAlpha = .8;
    c.beginPath();
    c.moveTo(-s * .1, -s * .5); c.quadraticCurveTo(s * .12, -s * .95, s * .5, -s * .44);
    c.fill();
    c.globalAlpha = 1;
    // 眼睛
    c.fillStyle = "rgba(6,10,20,.9)";
    c.beginPath(); c.arc(s * .46, -s * .11, s * .09, 0, 6.2832); c.fill();
    c.fillStyle = "rgba(255,255,255,.95)";
    c.beginPath(); c.arc(s * .49, -s * .14, s * .035, 0, 6.2832); c.fill();
    c.restore();
  }

  function makeFishPreview(canvas) {
    var c = canvas.getContext("2d");
    var W = 0, H = 0, list = [], bubbles = [], u = 1;
    var cols = ["#6ff0d8", "#ff9ec4", "#ffcf6b", "#a99bff", "#8fd6ff", "#ffb38a"];

    function reset() {
      u = Math.max(0.75, H / 220);
      list = [];
      var n = Math.max(7, Math.round(W / 58));
      for (var i = 0; i < n; i++) {
        var s = (7 + Math.random() * 6.5) * u;
        list.push({
          x: Math.random() * (W + 120) - 60, y: Math.random() * H,
          s: s, vy: (Math.random() - .5) * 16 * u,
          sp: -(16 + Math.random() * 30) * u * (s / (10 * u)),
          col: cols[i % cols.length], ph: Math.random() * 6.28,
          amp: (7 + Math.random() * 15) * u
        });
      }
      bubbles = [];
      for (var j = 0; j < 18; j++) bubbles.push({ x: Math.random() * W, y: Math.random() * H, r: (0.8 + Math.random() * 2.2) * u, sp: (9 + Math.random() * 28) * u, ph: Math.random() * 6.28 });
    }

    function resize() {
      W = canvas.clientWidth || 320; H = canvas.clientHeight || 200;
      canvas.width = Math.floor(W * DPR); canvas.height = Math.floor(H * DPR);
      c.setTransform(DPR, 0, 0, DPR, 0, 0);
      reset();
    }

    function draw(t, dt) {
      var g = c.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, "#071c2c"); g.addColorStop(.5, "#08212e"); g.addColorStop(1, "#04121c");
      c.fillStyle = g; c.fillRect(0, 0, W, H);

      c.save(); c.globalCompositeOperation = "lighter";
      for (var k = 0; k < 4; k++) {
        var lx = W * (.14 + k * .24) + Math.sin(t * .0002 + k) * 18 * u;
        var lg = c.createLinearGradient(lx, 0, lx + 70 * u, H);
        lg.addColorStop(0, "rgba(120,240,220,.11)"); lg.addColorStop(1, "rgba(120,240,220,0)");
        c.fillStyle = lg;
        c.beginPath(); c.moveTo(lx - 22 * u, 0); c.lineTo(lx + 34 * u, 0); c.lineTo(lx + 120 * u, H); c.lineTo(lx + 10 * u, H); c.fill();
      }
      c.restore();

      c.strokeStyle = "rgba(180,240,255,.26)"; c.lineWidth = 1;
      for (var b = 0; b < bubbles.length; b++) {
        var o = bubbles[b];
        o.y -= o.sp * dt; o.x += Math.sin(t * .0012 + o.ph) * .24;
        if (o.y < -8) { o.y = H + 8; o.x = Math.random() * W; }
        c.beginPath(); c.arc(o.x, o.y, o.r, 0, 6.2832); c.stroke();
      }

      for (var i = 0; i < list.length; i++) {
        var f = list[i];
        f.x += f.sp * dt;
        f.y += Math.sin(t * .0011 + f.ph) * f.amp * dt * 2.2 + f.vy * dt * .25;
        if (f.x < -80) { f.x = W + 80; f.y = Math.random() * H; }
        if (f.y < 10 * u) f.y = 10 * u;
        if (f.y > H - 10 * u) f.y = H - 10 * u;
        c.globalAlpha = .1; c.fillStyle = f.col;
        c.beginPath(); c.arc(f.x, f.y, f.s * 1.7, 0, 6.2832); c.fill(); c.globalAlpha = 1;
        fishShape(c, f.x, f.y, f.s, f.col, Math.PI, Math.sin(t * .005 + f.ph));
      }
    }

    return { resize: resize, draw: draw };
  }

  /* ---------------- 小预览：弹幕 ---------------- */
  function makeBlasterPreview(canvas) {
    var c = canvas.getContext("2d");
    var W = 0, H = 0, stars = [], bolts = [], foes = [], parts = [], px = 0, fire = 0, spawn = 0, u = 1;

    function resize() {
      W = canvas.clientWidth || 320; H = canvas.clientHeight || 200;
      canvas.width = Math.floor(W * DPR); canvas.height = Math.floor(H * DPR);
      c.setTransform(DPR, 0, 0, DPR, 0, 0);
      u = Math.max(0.8, H / 200);
      stars = [];
      var n = Math.max(40, Math.round(W * H / 5200));
      for (var i = 0; i < n; i++) stars.push({ x: Math.random() * W, y: Math.random() * H, sp: (14 + Math.random() * 70) * u, r: (Math.random() * 1.1 + 0.2) * u });
      bolts = []; foes = []; parts = []; px = W / 2;
    }

    function cat(x, y, s) {
      c.save(); c.translate(x, y);
      c.fillStyle = "#ffd7e6";
      c.beginPath();
      c.moveTo(0, -s);
      c.lineTo(s * .62, -s * .42); c.lineTo(s * .86, s * .34);
      c.quadraticCurveTo(0, s * .78, -s * .86, s * .34);
      c.lineTo(-s * .62, -s * .42); c.closePath(); c.fill();
      c.fillStyle = "#ff9ec4";
      c.beginPath(); c.moveTo(-s * .62, -s * .42); c.lineTo(-s * .34, -s * .98); c.lineTo(-s * .06, -s * .48); c.fill();
      c.beginPath(); c.moveTo(s * .62, -s * .42); c.lineTo(s * .34, -s * .98); c.lineTo(s * .06, -s * .48); c.fill();
      c.fillStyle = "#2a1030";
      c.beginPath(); c.arc(-s * .22, -s * .16, s * .1, 0, 6.2832); c.fill();
      c.beginPath(); c.arc(s * .22, -s * .16, s * .1, 0, 6.2832); c.fill();
      c.fillStyle = "rgba(111,240,216,.9)";
      c.beginPath(); c.ellipse(0, s * .3, s * .26, s * .3, 0, 0, 6.2832); c.fill();
      // 尾焰
      c.fillStyle = "rgba(255,214,240,.8)";
      c.beginPath(); c.moveTo(-s * .2, s * .55); c.lineTo(0, s * (1.1 + Math.sin(performance.now() * .02) * .15)); c.lineTo(s * .2, s * .55); c.fill();
      c.restore();
    }

    function draw(t, dt) {
      var g = c.createLinearGradient(0, 0, W * .6, H);
      g.addColorStop(0, "#0a0620"); g.addColorStop(.55, "#0d0a26"); g.addColorStop(1, "#1c0a24");
      c.fillStyle = g; c.fillRect(0, 0, W, H);

      // 星云
      var neb = c.createRadialGradient(W * .78, H * .18, 0, W * .78, H * .18, W * .5);
      neb.addColorStop(0, "rgba(140,80,220,.26)"); neb.addColorStop(1, "rgba(140,80,220,0)");
      c.fillStyle = neb; c.fillRect(0, 0, W, H);
      var neb2 = c.createRadialGradient(W * .2, H * .8, 0, W * .2, H * .8, W * .45);
      neb2.addColorStop(0, "rgba(0,200,180,.16)"); neb2.addColorStop(1, "rgba(0,200,180,0)");
      c.fillStyle = neb2; c.fillRect(0, 0, W, H);

      c.fillStyle = "rgba(255,255,255,.75)";
      for (var i = 0; i < stars.length; i++) {
        var s = stars[i]; s.y += s.sp * dt; if (s.y > H) { s.y = 0; s.x = Math.random() * W; }
        c.globalAlpha = .16 + Math.min(.7, s.r * .45 + .1);
        c.fillRect(s.x, s.y, s.r, s.r * 2.6);
      }
      c.globalAlpha = 1;

      px = W / 2 + Math.sin(t * .0009) * W * .3;
      fire -= dt;
      if (fire <= 0) {
        fire = .075;
        bolts.push({ x: px - 4 * u, y: H - 30 * u }, { x: px + 4 * u, y: H - 30 * u });
      }
      c.save(); c.globalCompositeOperation = "lighter";
      for (var b = bolts.length - 1; b >= 0; b--) {
        var o = bolts[b]; o.y -= 280 * u * dt;
        var bg = c.createLinearGradient(0, o.y, 0, o.y + 14 * u);
        bg.addColorStop(0, "rgba(123,255,230,0)"); bg.addColorStop(1, "rgba(220,255,250,.95)");
        c.fillStyle = bg;
        c.fillRect(o.x - 1.1 * u, o.y, 2.2 * u, 14 * u);
        if (o.y < -20 * u) bolts.splice(b, 1);
      }
      c.restore();

      spawn -= dt;
      if ((spawn <= 0 || foes.length < 2) && foes.length < 4) {
        spawn = .55;
        var r = (7 + Math.random() * 6) * u;
        foes.push({ x: 26 * u + Math.random() * (W - 52 * u), y: -20 * u, hp: 3, ph: Math.random() * 6.28, r: r });
      }
      for (var f = foes.length - 1; f >= 0; f--) {
        var e = foes[f]; e.y += 36 * u * dt; e.x += Math.sin(t * .002 + e.ph) * .55;
        c.save(); c.translate(e.x, e.y);
        var grad = c.createRadialGradient(0, 0, 0, 0, 0, e.r * 1.9);
        grad.addColorStop(0, "rgba(255,150,220,.55)"); grad.addColorStop(1, "rgba(255,150,220,0)");
        c.fillStyle = grad; c.beginPath(); c.arc(0, 0, e.r * 1.9, 0, 6.2832); c.fill();
        c.fillStyle = "#ffb6dd"; c.beginPath(); c.arc(0, 0, e.r, Math.PI, 0); c.fill();
        c.strokeStyle = "rgba(255,182,221,.7)"; c.lineWidth = 1;
        for (var tt = 0; tt < 3; tt++) { c.beginPath(); c.moveTo(-e.r * .5 + tt * e.r * .5, 0); c.quadraticCurveTo(-e.r * .5 + tt * e.r * .5 + Math.sin(t * .004 + tt) * 3, e.r, -e.r * .5 + tt * e.r * .5, e.r * 1.7); c.stroke(); }
        c.restore();
        var hit = false;
        for (var q = bolts.length - 1; q >= 0; q--) {
          var bo = bolts[q];
          if (Math.abs(bo.x - e.x) < e.r && Math.abs(bo.y - e.y) < e.r) { bolts.splice(q, 1); hit = true; break; }
        }
        if (hit) {
          e.hp--;
          if (e.hp <= 0) {
            for (var p = 0; p < 10; p++) parts.push({ x: e.x, y: e.y, vx: (Math.random() - .5) * 110 * u, vy: (Math.random() - .5) * 110 * u, l: .5 + Math.random() * .3, c: p % 2 ? "#ff9ec4" : "#fff2b8" });
            foes.splice(f, 1);
          }
        } else if (e.y > H + 24 * u) foes.splice(f, 1);
      }
      for (var k = parts.length - 1; k >= 0; k--) {
        var pp = parts[k]; pp.x += pp.vx * dt; pp.y += pp.vy * dt; pp.l -= dt;
        if (pp.l <= 0) { parts.splice(k, 1); continue; }
        c.globalAlpha = Math.max(0, pp.l * 1.6); c.fillStyle = pp.c;
        c.fillRect(pp.x, pp.y, 2.2 * u, 2.2 * u);
      }
      c.globalAlpha = 1;
      cat(px, H - 24 * u, 12 * u);
    }
    return { resize: resize, draw: draw };
  }


  /* ---------------- 小预览：乐队 ---------------- */
  function makeBandPreview(canvas) {
    var c = canvas.getContext("2d");
    var W = 0, H = 0, u = 1, notes = [], rings = [], spawn = 0, px = 0;
    var cols = ["#ffb066", "#b6a6ff", "#7bffe6", "#ff9ec4"];
    function resize() {
      W = canvas.clientWidth || 320; H = canvas.clientHeight || 200;
      canvas.width = Math.floor(W * DPR); canvas.height = Math.floor(H * DPR);
      c.setTransform(DPR, 0, 0, DPR, 0, 0);
      u = Math.max(0.75, H / 200);
    }
    function draw(t, dt) {
      var g = c.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, "#08061a"); g.addColorStop(1, "#150a24");
      c.fillStyle = g; c.fillRect(0, 0, W, H);

      var lineY = H * 0.8, laneW = W / 4;
      c.strokeStyle = "rgba(255,255,255,.06)";
      c.lineWidth = 1;
      for (var i = 1; i < 4; i++) {
        c.beginPath(); c.moveTo(i * laneW, 0); c.lineTo(i * laneW, H); c.stroke();
      }

      spawn -= dt;
      if (spawn <= 0) {
        spawn = 0.19;
        notes.push({ lane: Math.floor(Math.random() * 4), y: -16 * u, hit: false });
      }
      c.save();
      c.globalCompositeOperation = "lighter";
      for (var k = rings.length - 1; k >= 0; k--) {
        var r = rings[k];
        r.life -= dt; r.r += 90 * u * dt;
        if (r.life <= 0) { rings.splice(k, 1); continue; }
        c.globalAlpha = Math.max(0, r.life * 3);
        c.strokeStyle = cols[r.lane]; c.lineWidth = 2 * u;
        c.beginPath(); c.arc(r.x, r.y, r.r, 0, 6.2832); c.stroke();
      }
      c.restore();

      for (var j = notes.length - 1; j >= 0; j--) {
        var n = notes[j];
        n.y += (lineY + 20 * u) / 1.25 * dt;
        if (n.y > lineY && !n.hit) {
          n.hit = true;
          rings.push({ x: n.lane * laneW + laneW / 2, y: lineY, r: 3 * u, life: 0.45, lane: n.lane });
        }
        if (n.y > H + 20 * u) { notes.splice(j, 1); continue; }
        var x = n.lane * laneW + laneW / 2;
        var w = laneW * 0.56, h = 7 * u;
        c.globalAlpha = n.hit ? 0.18 : 0.95;
        c.fillStyle = cols[n.lane];
        c.shadowColor = cols[n.lane]; c.shadowBlur = 8 * u;
        c.beginPath();
        var rr = h / 2;
        c.moveTo(x - w / 2 + rr, n.y - h / 2);
        c.lineTo(x + w / 2 - rr, n.y - h / 2);
        c.quadraticCurveTo(x + w / 2, n.y - h / 2, x + w / 2, n.y);
        c.quadraticCurveTo(x + w / 2, n.y + h / 2, x + w / 2 - rr, n.y + h / 2);
        c.lineTo(x - w / 2 + rr, n.y + h / 2);
        c.quadraticCurveTo(x - w / 2, n.y + h / 2, x - w / 2, n.y);
        c.quadraticCurveTo(x - w / 2, n.y - h / 2, x - w / 2 + rr, n.y - h / 2);
        c.fill();
        c.shadowBlur = 0;
      }
      c.globalAlpha = 1;

      // 判定线
      var lg = c.createLinearGradient(0, 0, W, 0);
      lg.addColorStop(0, cols[0]); lg.addColorStop(0.34, cols[1]);
      lg.addColorStop(0.67, cols[2]); lg.addColorStop(1, cols[3]);
      c.globalAlpha = 0.65;
      c.fillStyle = lg;
      c.fillRect(0, lineY, W, 1.6 * u);
      c.globalAlpha = 1;

      // 小猫
      px = W / 2 + Math.sin(t * 0.0012) * W * 0.18;
      c.save();
      c.translate(px, H - 14 * u);
      c.fillStyle = "#ffd7e6";
      c.beginPath(); c.arc(0, 0, 9 * u, 0, 6.2832); c.fill();
      c.fillStyle = "#ff9ec4";
      c.beginPath(); c.moveTo(-8 * u, -5 * u); c.lineTo(-6 * u, -13 * u); c.lineTo(-1 * u, -8 * u); c.fill();
      c.beginPath(); c.moveTo(8 * u, -5 * u); c.lineTo(6 * u, -13 * u); c.lineTo(1 * u, -8 * u); c.fill();
      c.fillStyle = "#2a1030";
      c.beginPath(); c.arc(-3 * u, -1 * u, 1.4 * u, 0, 6.2832); c.fill();
      c.beginPath(); c.arc(3 * u, -1 * u, 1.4 * u, 0, 6.2832); c.fill();
      c.restore();
    }
    return { resize: resize, draw: draw };
  }


  /* ---------------- 小预览：毛毛虫 ---------------- */
  function makeWormPreview(canvas) {
    var c = canvas.getContext("2d");
    var W = 0, H = 0, u = 1, t0 = 0;
    var worms = [
      { col: "#ff8fc0", ph: 0, sp: 0.55, rx: .26, ry: .22, cx: .36, cy: .48, len: 7 },
      { col: "#ffcf5c", ph: 2.1, sp: -0.42, rx: .2, ry: .26, cx: .7, cy: .38, len: 5 },
      { col: "#6fe0c0", ph: 4.2, sp: 0.33, rx: .22, ry: .18, cx: .58, cy: .7, len: 6 }
    ];
    var leaves = [];
    for (var i = 0; i < 12; i++) leaves.push({ x: Math.random(), y: Math.random(), r: Math.random() * .5 + .7, ph: Math.random() * 6.28 });

    function resize() {
      W = canvas.clientWidth || 320; H = canvas.clientHeight || 200;
      canvas.width = Math.floor(W * DPR); canvas.height = Math.floor(H * DPR);
      c.setTransform(DPR, 0, 0, DPR, 0, 0);
      u = Math.max(0.75, H / 200);
    }

    function draw(t, dt) {
      var g = c.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, "#f8f4ff"); g.addColorStop(1, "#efe8ff");
      c.fillStyle = g; c.fillRect(0, 0, W, H);

      c.strokeStyle = "rgba(190,140,220,.16)"; c.lineWidth = 1;
      for (var gx = 0; gx < W; gx += 34 * u) { c.beginPath(); c.moveTo(gx, 0); c.lineTo(gx, H); c.stroke(); }
      for (var gy = 0; gy < H; gy += 34 * u) { c.beginPath(); c.moveTo(0, gy); c.lineTo(W, gy); c.stroke(); }

      for (var l = 0; l < leaves.length; l++) {
        var lf = leaves[l];
        var bob = Math.sin(t * .0018 + lf.ph) * 2 * u;
        c.save();
        c.translate(lf.x * W, lf.y * H + bob);
        c.rotate(Math.sin(t * .0012 + lf.ph) * .35);
        c.fillStyle = "#ff6d9c";
        c.beginPath(); c.ellipse(0, 0, 6 * u * lf.r, 5 * u * lf.r, 0, 0, 6.2832); c.fill();
        c.fillStyle = "#7fe3c4";
        c.beginPath(); c.ellipse(0, -5 * u * lf.r, 3 * u * lf.r, 1.8 * u * lf.r, 0, 0, 6.2832); c.fill();
        c.restore();
      }

      worms.forEach(function (w) {
        var baseA = t * .001 * w.sp + w.ph;
        var pts = [];
        for (var k = 0; k < w.len; k++) {
          var a = baseA - k * .17;
          pts.push({
            x: (w.cx + Math.cos(a) * w.rx) * W,
            y: (w.cy + Math.sin(a) * w.ry) * H
          });
        }
        c.strokeStyle = w.col; c.globalAlpha = .75;
        c.lineWidth = 8 * u; c.lineCap = "round"; c.lineJoin = "round";
        c.beginPath(); c.moveTo(pts[0].x, pts[0].y);
        for (var q = 1; q < pts.length; q++) c.lineTo(pts[q].x, pts[q].y);
        c.stroke();
        c.globalAlpha = 1;
        for (var m = pts.length - 1; m >= 1; m--) {
          c.fillStyle = w.col;
          c.beginPath(); c.arc(pts[m].x, pts[m].y, (5.5 - m * .45) * u, 0, 6.2832); c.fill();
        }
        var h = pts[0];
        c.fillStyle = w.col;
        c.beginPath(); c.arc(h.x, h.y, 7.5 * u, 0, 6.2832); c.fill();
        c.fillStyle = "#5a2a44";
        c.beginPath(); c.arc(h.x - 2.4 * u, h.y - 1.5 * u, 1.3 * u, 0, 6.2832); c.fill();
        c.beginPath(); c.arc(h.x + 2.4 * u, h.y - 1.5 * u, 1.3 * u, 0, 6.2832); c.fill();
      });
    }
    return { resize: resize, draw: draw };
  }

  /* ---------------- 循环 ---------------- */
  var fishPv = null, blastPv = null, bandPv = null, wormPv = null, lastT = 0, acc = 0, accB = 0, accC = 0, accD = 0;
  function loop(t) {
    requestAnimationFrame(loop);
    var dt = Math.min(.05, (t - lastT) / 1000 || .016);
    lastT = t;
    if (document.hidden) return;
    if (!reduce) drawBG(t);
    if (fishPv) { acc += dt; if (acc > 1 / 30) { fishPv.draw(t, acc); acc = 0; } }
    if (blastPv) { accB += dt; if (accB > 1 / 30) { blastPv.draw(t, accB); accB = 0; } }
    if (bandPv) { accC += dt; if (accC > 1 / 30) { bandPv.draw(t, accC); accC = 0; } }
    if (wormPv) { accD += dt; if (accD > 1 / 30) { wormPv.draw(t, accD); accD = 0; } }
  }

  function boot() {
    sizeBG();
    if (!reduce) requestAnimationFrame(loop); else drawBG(0);
    var fc = document.querySelector('[data-pv="fish"]');
    var bc = document.querySelector('[data-pv="blaster"]');
    var nc = document.querySelector('[data-pv="band"]');
    if (fc) { fishPv = makeFishPreview(fc); fishPv.resize(); }
    if (bc) { blastPv = makeBlasterPreview(bc); blastPv.resize(); }
    if (nc) { bandPv = makeBandPreview(nc); bandPv.resize(); }
    var wc = document.querySelector('[data-pv="worm"]');
    if (wc) { wormPv = makeWormPreview(wc); wormPv.resize(); }
    if (window.ResizeObserver) {
      var ro = new ResizeObserver(function () {
        sizeBG();
        if (fishPv) fishPv.resize();
        if (blastPv) blastPv.resize();
        if (bandPv) bandPv.resize();
        if (wormPv) wormPv.resize();
      });
      ro.observe(document.body);
    } else {
      addEventListener("resize", function () {
        sizeBG(); if (fishPv) fishPv.resize(); if (blastPv) blastPv.resize(); if (bandPv) bandPv.resize(); if (wormPv) wormPv.resize();
      });
    }
  }

  /* ---------------- 音效 ---------------- */
  var soundOn = localStorage.getItem("hub-sound") !== "0";
  var actx = null;
  var sBtn = document.getElementById("soundHub");
  function syncBtn() { if (sBtn) { sBtn.classList.toggle("on", soundOn); sBtn.textContent = soundOn ? "♪" : "×"; } }
  function blip(freq, dur, vol, type) {
    if (!soundOn) return;
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === "suspended") actx.resume();
      var o = actx.createOscillator(), g = actx.createGain();
      o.type = type || "triangle"; o.frequency.value = freq;
      g.gain.setValueAtTime(0, actx.currentTime);
      g.gain.linearRampToValueAtTime(vol || .05, actx.currentTime + .01);
      g.gain.exponentialRampToValueAtTime(.0001, actx.currentTime + dur);
      o.connect(g); g.connect(actx.destination); o.start(); o.stop(actx.currentTime + dur + .02);
    } catch (e) {}
  }
  syncBtn();
  if (sBtn) sBtn.addEventListener("click", function () {
    soundOn = !soundOn;
    localStorage.setItem("hub-sound", soundOn ? "1" : "0");
    syncBtn(); blip(880, .09, .05, "sine");
  });

  /* ---------------- 交互 ---------------- */
  var toastEl = document.getElementById("toastHub"), toastTimer = 0;
  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg; toastEl.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("on"); }, 1900);
  }

  document.querySelectorAll(".card").forEach(function (card) {
    card.addEventListener("pointermove", function (e) {
      var r = card.getBoundingClientRect();
      card.style.setProperty("--mx", (e.clientX - r.left) + "px");
      card.style.setProperty("--my", (e.clientY - r.top) + "px");
    });
    card.addEventListener("pointerenter", function () { blip(1320, .04, .018, "sine"); });
    if (card.classList.contains("locked")) {
      card.addEventListener("click", function (e) {
        e.preventDefault();
        toast("还在装修喵…先玩码头和炮台啦");
        blip(220, .12, .04, "square");
      });
    } else {
      card.addEventListener("click", function (e) {
        if (e.metaKey || e.ctrlKey || e.shiftKey) return;
        blip(990, .08, .04, "triangle");
        e.preventDefault();
        var href = card.querySelector(".go").getAttribute("href");
        card.style.transition = "transform .18s ease, opacity .18s ease";
        card.style.transform = "scale(.965)";
        card.style.opacity = ".72";
        setTimeout(function () { location.href = href; }, 150);
      });
    }
  });

  /* ---------------- 在线状态 ---------------- */
  function refreshStatus() {
    fetch("/api/hub", { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d || !d.games) return;
      var total = 0;
      d.games.forEach(function (g) {
        total += g.players || 0;
        if (g.id === "worm") {
          var we = document.getElementById("wormStat");
          if (we) we.textContent = (g.players || 0) > 0 ? (g.players + " 条在草地") : "草地空着";
        }
        if (g.id === "band") {
          var be = document.getElementById("bandStat");
          if (be) be.textContent = (g.players || 0) > 0 ? (g.players + " 人在合奏") : "排练室空着";
        }
        if (g.id === "fish") {
          var el = document.getElementById("fishStat");
          if (el) el.textContent = (g.players || 0) > 0 ? (g.players + " 只在码头") : "空着，来当第一位";
        }
      });
      var tot = document.getElementById("onlineTotal");
      if (tot) tot.textContent = String(total);
    }).catch(function () {});
  }
  refreshStatus();
  setInterval(refreshStatus, 7000);

  var fh = document.getElementById("footHost");
  if (fh) fh.textContent = location.host;

  boot();
})();
