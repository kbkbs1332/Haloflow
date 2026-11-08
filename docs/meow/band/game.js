/* =========================================================
   猫猫乐队 · 判定 / 渲染 / 房间
   ========================================================= */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var LANE_COLORS = ["#ffb066", "#b6a6ff", "#7bffe6", "#ff9ec4"];
  var LANE_NAMES = ["鼓", "贝斯", "和弦", "旋律"];
  var LANE_KEYS = ["D", "F", "J", "K"];
  var KEYMAP = { d: 0, f: 1, j: 2, k: 3 };

  /* ---------------- 画布 ---------------- */
  var cvs = $("stage");
  var ctx = cvs.getContext("2d", { alpha: false });
  var W = 0, H = 0, DPR = 1, VW = 0, OX = 0, laneW = 0, judgeY = 0, speed = 0;

  function resize() {
    W = Math.max(300, window.innerWidth);
    H = Math.max(420, window.innerHeight);
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    cvs.width = Math.round(W * DPR);
    cvs.height = Math.round(H * DPR);
    cvs.style.width = W + "px";
    cvs.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    VW = Math.min(W, 520);
    OX = (W - VW) / 2;
    laneW = VW / 4;
    judgeY = H * 0.82;
    speed = judgeY / 1.15;
  }

  /* ---------------- 状态 ---------------- */
  var state = "menu";            // menu | lobby | countdown | playing | paused | result
  var chart = null;
  var lanesMine = [0, 1, 2, 3];
  var songId = "tide", diff = "normal";
  var score = 0, combo = 0, maxCombo = 0;
  var counts = { p: 0, g: 0, good: 0, miss: 0 };
  var gauge = 50;
  var feverUntil = 0, badUntil = 0, feverStart = 0;
  var offsetMs = parseFloat(localStorage.getItem("band-offset") || "0") || 0;
  var debugTime = null, freezeJudge = false;
  var runStartWall = 0;
  var finished = false;
  var laneHeld = [0, 0, 0, 0];
  var lanePtr = [0, 0, 0, 0];
  var laneQueue = [[], [], [], []];
  var activeHolds = [];
  var customMode = false;
  var customData = null;
  var gateAt = [-9, -9, -9, -9];
  var fx = [];
  var judgeText = null;
  var lastT = 0;

  var myName = localStorage.getItem("band-name") || ("猫猫" + (10 + Math.floor(Math.random() * 90)));
  var CID = (function () {
    try {
      var c = sessionStorage.getItem("band-cid");
      if (!c) { c = "b" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); sessionStorage.setItem("band-cid", c); }
      return c;
    } catch (e) { return "b" + Math.random().toString(36).slice(2, 12); }
  })();

  var ws = null, myId = null, online = false, ready = false, clockOffset = 0;
  var lobbyPlayers = [];
  var room = { state: "lobby", song: "tide", diff: "normal", startAt: 0 };
  var netTimer = null, reconnectTimer = 0;
  var lastProgress = 0;
  var teamFinish = null;
  var remoteVoices = {};

  /* ---------------- 工具 ---------------- */
  function fmt(n) { return String(Math.max(0, Math.floor(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function acc() {
    var total = counts.p + counts.g + counts.good + counts.miss;
    if (!total) return 100;
    return ((counts.p * 1000 + counts.g * 700 + counts.good * 400) / (total * 1000)) * 100;
  }
  function songTime() {
    if (debugTime != null) return debugTime;
    return BandAudio.now() - offsetMs / 1000;
  }
  function serverNow() { return Date.now() + clockOffset; }
  function toast(msg) {
    var el = $("toast");
    el.textContent = msg;
    el.classList.add("on");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.remove("on"); }, 2100);
  }
  function show(id, on) {
    var el = $(id);
    if (!el) return;
    el.classList.toggle("hide", !on);
    if (on) { el.classList.remove("show"); void el.offsetWidth; el.classList.add("show"); }
  }

  /* ---------------- 曲目列表 ---------------- */
  var SONGS = window.BandSongs.list();
  function renderSongList(el, small) {
    el.innerHTML = "";
    SONGS.forEach(function (s) {
      var b = document.createElement("button");
      b.className = "song" + (s.id === songId ? " on" : "");
      b.style.setProperty("--c", s.color);
      b.innerHTML = "<i></i><div><b>" + s.title + "</b><small>" + s.sub + " · " + s.bpm + " BPM</small></div><u>" + Math.round(s.duration) + "s</u>";
      b.onclick = function () {
        songId = s.id;
        BandAudio.blip(760);
        renderAllSongLists();
        if (online) send({ t: "pick", song: songId, diff: diff });
      };
      el.appendChild(b);
    });
    if (small) el.classList.add("small");
  }
  function renderAllSongLists() {
    renderSongList($("songList"), false);
    if ($("songList2")) renderSongList($("songList2"), true);
  }
  function renderDiff(el) {
    el.querySelectorAll("button").forEach(function (b) {
      b.classList.toggle("on", b.dataset.diff === diff);
      b.onclick = function () {
        diff = b.dataset.diff;
        BandAudio.blip(680);
        renderAllDiff();
        if (online) send({ t: "pick", song: songId, diff: diff });
      };
    });
  }
  function renderAllDiff() {
    renderDiff($("diffRow"));
    if ($("diffRow2")) renderDiff($("diffRow2"));
  }

  /* ---------------- 开始一局 ---------------- */
  function prepareChart(customChart) {
    chart = customChart || BandSongs.build(songId, diff);
    score = 0; combo = 0; maxCombo = 0;
    counts = { p: 0, g: 0, good: 0, miss: 0 };
    gauge = 50; feverUntil = 0; badUntil = 0; feverStart = 0;
    finished = false; debugTime = null;
    lanePtr = [0, 0, 0, 0];
    laneHeld = [0, 0, 0, 0];
    laneQueue = [[], [], [], []];
    activeHolds = [];
    chart.notes.forEach(function (n, i) {
      n.hit = false; n.judged = false; n.holding = false; n.tailDone = false;
      n.idx = i;
      laneQueue[n.lane].push(n);
    });
    fx = [];
    judgeText = null;
    syncHUD(true);
    renderTeam();
  }

  function beginCountdown(delaySec, atEpoch) {
    state = "countdown";
    show("menu", false);
    show("lobby", false);
    show("result", false);
    show("pauseScr", false);
    show("countdown", true);
    $("countSong").textContent = chart.meta.title + " · " + ({ easy: "轻松", normal: "普通", hard: "硬核" }[diff]);

    var lead = delaySec;
    if (atEpoch) lead = Math.max(0.2, (atEpoch - serverNow()) / 1000);
    BandAudio.begin(lead, chart.meta.bpm);

    var startWall = performance.now() + lead * 1000;
    var cdTimer = setInterval(function () {
      var left = (startWall - performance.now()) / 1000;
      if (left <= 0) {
        clearInterval(cdTimer);
        $("countNum").textContent = "开演!";
        setTimeout(function () {
          show("countdown", false);
          state = "playing";
          runStartWall = performance.now();
        }, 420);
        return;
      }
      $("countNum").textContent = Math.ceil(left);
      BandAudio.blip(520 + Math.ceil(left) * 60);
    }, 90);
  }

  function startCustom() {
    if (!customData) return;
    var d = (new URLSearchParams(location.search)).get("diff") || "normal";
    var src = customData.notes[d] || customData.notes.normal;
    var notes = src.map(function (n) {
      return { t: n.t, lane: n.lane, type: "tap", dur: 0, v: 60, snd: null };
    });
    var stems = customData.stems.map(function (i16) {
      var f = new Float32Array(i16.length);
      for (var i = 0; i < i16.length; i++) f[i] = i16[i] / 32768;
      return f;
    });
    BandAudio.loadStems(stems, customData.rate);
    customMode = true;
    lanesMine = [0, 1, 2, 3];
    prepareChart({
      meta: {
        id: "custom", title: customData.name, sub: "LOCAL STEMS",
        bpm: customData.bpm, beatsPerBar: 4, bars: 0,
        duration: customData.duration, diff: d, color: "#ffe27a"
      },
      notes: notes,
      events: []
    });
    beginCountdown(2.6, 0);
  }

  function startSolo() {
    online = false;
    lanesMine = [0, 1, 2, 3];
    prepareChart();
    beginCountdown(2.8, 0);
  }

  /* ---------------- 判定 ---------------- */
  var WINDOW = { perfect: 0.045, great: 0.09, good: 0.135 };

  function gradeFor(ad) {
    if (ad <= WINDOW.perfect) return "perfect";
    if (ad <= WINDOW.great) return "great";
    if (ad <= WINDOW.good) return "good";
    return "miss";
  }

  function noteScore(base) {
    var mult = 1 + Math.min(combo, 100) * 0.002;
    return Math.round(base * mult);
  }

  function addCombo() {
    combo++;
    if (combo > maxCombo) maxCombo = combo;
    $("combo").classList.add("on");
    $("combo").classList.toggle("hot", combo >= 30);
    $("combo").querySelector("b").textContent = combo;
  }

  function breakCombo() {
    combo = 0;
    $("combo").classList.remove("on");
  }

  function gateOn(lane) {
    gateAt[lane] = performance.now();
    if (!laneGate[lane]) { laneGate[lane] = true; BandAudio.gate(lane, true); }
  }
  function gateOff(lane) {
    gateAt[lane] = -9;
    if (laneGate[lane]) { laneGate[lane] = false; BandAudio.gate(lane, false); }
  }
  var laneGate = [false, false, false, false];

  function beatFx(lane, grade) {
    var x = OX + lane * laneW + laneW / 2;
    fx.push({ x: x, y: judgeY, r: 8, max: grade === "perfect" ? 78 : 58, life: 0.36, maxLife: 0.36, color: LANE_COLORS[lane] });
    var n = grade === "perfect" ? 7 : 4;
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2;
      fx.push({
        x: x, y: judgeY, vx: Math.cos(a) * (60 + Math.random() * 120), vy: Math.sin(a) * (50 + Math.random() * 100) - 60,
        life: 0.35 + Math.random() * 0.25, maxLife: 0.6, r: 1.6 + Math.random() * 2, color: LANE_COLORS[lane], dot: true
      });
    }
  }

  function applyJudge(note, grade, isTail) {
    var base = grade === "perfect" ? 1000 : grade === "great" ? 700 : grade === "good" ? 400 : 0;
    if (isTail) base = Math.round(base * 0.45);
    score += noteScore(base);

    if (grade === "perfect") counts.p++;
    else if (grade === "great") counts.g++;
    else if (grade === "good") counts.good++;
    else counts.miss++;

    if (grade === "miss") {
      breakCombo();
      gauge = clamp(gauge - 1.1, 0, 100);
      if (customMode) gateOff(note.lane);
      judgeText = { text: "MISS", color: "#ff6f9c", time: 0.45 };
    } else {
      addCombo();
      BandAudio.hitFx(grade === "perfect");
      gauge = clamp(gauge + (grade === "perfect" ? 0.55 : grade === "great" ? 0.3 : 0.08), 0, 100);
      judgeText = {
        text: grade === "perfect" ? "PERFECT" : grade === "great" ? "GREAT" : "GOOD",
        color: grade === "perfect" ? "#7bffe6" : grade === "great" ? "#ffe27a" : "#ffb066",
        time: 0.4
      };
    }
    beatFx(note.lane, grade);
    syncHUD();
  }

  function hitLane(lane) {
    if (state !== "playing") return;
    laneHeld[lane]++;
    var t = songTime();
    var q = laneQueue[lane];
    for (var i = lanePtr[lane]; i < q.length; i++) {
      var n = q[i];
      if (n.judged) { if (i === lanePtr[lane]) lanePtr[lane]++; continue; }
      var dt = t - n.t;
      if (dt < -WINDOW.good) break;
      if (dt > WINDOW.good) { lanePtr[lane] = i + 1; continue; }
      n.judged = true;
      n.hit = true;
      if (i === lanePtr[lane]) lanePtr[lane] = i + 1;
      applyJudge(n, gradeFor(Math.abs(dt)), false);
      if (n.type === "hold") {
        n.holding = true;
        n.holdFrom = t;
        activeHolds.push(n);
        if (!customMode && n.snd) {
          n.voice = BandAudio.hold(n.snd);
          if (online) { n.voiceId = "v" + Math.random().toString(36).slice(2, 7); send({ t: "hold", lane: lane, snd: n.snd, voice: n.voiceId }); }
        }
      } else {
        n.tailDone = true;
        if (!customMode && n.snd) {
          BandAudio.play(n.snd);
          if (online) send({ t: "hit", lane: lane, snd: n.snd });
        }
      }
      if (customMode) gateOn(lane);
      return;
    }
  }

  function releaseLane(lane) {
    laneHeld[lane] = Math.max(0, laneHeld[lane] - 1);
    if (state !== "playing") return;
    var q = laneQueue[lane], t = songTime();
    for (var i = 0; i < q.length; i++) {
      var n = q[i];
      if (n.holding && !n.tailDone) {
        if (t >= n.t + n.dur - 0.16) {
          n.tailDone = true;
          n.judged = true;
          applyJudge(n, "perfect", true);
          if (n.voice) { n.voice.release(); n.voice = null; }
          if (online && n.voiceId) { send({ t: "holdEnd", lane: lane, voice: n.voiceId }); n.voiceId = null; }
          BeatTailFx(lane);
          var hi = activeHolds.indexOf(n);
          if (hi >= 0) activeHolds.splice(hi, 1);
        } else if (t < n.t + n.dur - 0.16 && laneHeld[lane] === 0) {
          n.tailDone = true;
          n.judged = true;
          applyJudge(n, "miss", true);
          if (n.voice) { n.voice.release(); n.voice = null; }
          var hj = activeHolds.indexOf(n);
          if (hj >= 0) activeHolds.splice(hj, 1);
        }
      }
    }
  }

  function BeatTailFx(lane) {
    var x = OX + lane * laneW + laneW / 2;
    fx.push({ x: x, y: judgeY, r: 6, max: 46, life: 0.3, maxLife: 0.3, color: "#ffffff" });
  }

  function updateJudge(t) {
    // 长条：按住到尾巴自动完成（不依赖 lanePtr）
    for (var h = activeHolds.length - 1; h >= 0; h--) {
      var hn = activeHolds[h];
      if (hn.tailDone) { activeHolds.splice(h, 1); continue; }
      if (t >= hn.t + hn.dur - 0.02) {
        hn.tailDone = true;
        hn.judged = true;
        applyJudge(hn, "perfect", true);
        if (hn.voice) { hn.voice.release(); hn.voice = null; }
        if (online && hn.voiceId) { send({ t: "holdEnd", lane: hn.lane, voice: hn.voiceId }); hn.voiceId = null; }
        BeatTailFx(hn.lane);
        activeHolds.splice(h, 1);
      }
    }

    for (var lane = 0; lane < 4; lane++) {
      var q = laneQueue[lane];
      for (var i = lanePtr[lane]; i < q.length; i++) {
        var n = q[i];
        if (n.judged) { if (i === lanePtr[lane]) lanePtr[lane]++; continue; }
        if (n.holding && !n.tailDone && t >= n.t + n.dur - 0.02) {
          n.tailDone = true;
          n.judged = true;
          applyJudge(n, "perfect", true);
          BeatTailFx(lane);
          continue;
        }
        if (!n.holding && t - n.t > WINDOW.good) {
          n.judged = true;
          n.tailDone = true;
          applyJudge(n, "miss", false);
          if (i === lanePtr[lane]) lanePtr[lane] = i + 1;
          continue;
        }
        break;
      }
    }
  }

  /* ---------------- 分数 / HUD ---------------- */
  var hudCache = { score: -1, acc: -1, gauge: -1, combo: -1 };

  function syncHUD(force) {
    if (force || hudCache.score !== score) {
      $("score").textContent = fmt(score);
      hudCache.score = score;
    }
    var a = acc();
    if (force || Math.abs(hudCache.acc - a) > 0.01) {
      $("accTxt").textContent = a.toFixed(2) + "%";
      hudCache.acc = a;
    }
    if (force || hudCache.gauge !== Math.round(gauge)) {
      $("gaugeFill").style.width = gauge.toFixed(0) + "%";
      $("gaugeNum").textContent = Math.round(gauge);
      $("gaugeBox").classList.toggle("fever", gauge >= 100);
      $("gaugeBox").classList.toggle("bad", gauge <= 0);
      hudCache.gauge = Math.round(gauge);
    }
  }

  function renderTeam() {
    var el = $("teamStrip");
    el.innerHTML = "";
    if (!online) {
      el.innerHTML = "<div class='tchip'><i style='color:#7bffe6;background:#7bffe6'></i><b>单人</b> 全声部</div>";
      return;
    }
    lobbyPlayers.forEach(function (p) {
      var d = document.createElement("div");
      d.className = "tchip" + (p.online === false ? " off" : "");
      var c = LANE_COLORS[(p.lanes && p.lanes[0]) || 0];
      d.innerHTML = "<i style='color:" + c + ";background:" + c + "'></i>" + p.name + " <b>" + (p.score || 0) + "</b>";
      el.appendChild(d);
    });
  }

  /* ---------------- 结束 ---------------- */
  function rankOf(a) {
    if (a >= 98) return "S";
    if (a >= 94) return "A";
    if (a >= 88) return "B";
    if (a >= 78) return "C";
    return "D";
  }

  function finishRun() {
    if (finished) return;
    finished = true;
    state = "result";
    BandAudio.stop();
    for (var q = 0; q < 4; q++) gateOff(q);
    show("countdown", false);
    var a = acc();
    $("finalScore").textContent = fmt(score);
    $("finalAcc").textContent = a.toFixed(2) + "%";
    $("finalCombo").textContent = maxCombo;
    $("finalMiss").textContent = counts.miss;
    $("rankBig").textContent = rankOf(a);
    $("resultTag").textContent = online ? "ONLINE RESULT" : "SOLO RESULT";
    $("resultTitle").textContent = a >= 94 ? "演出大成功喵！" : a >= 80 ? "还不错，再来一遍？" : "唔…再练练喵";
    $("resultPlayers").innerHTML = "";

    if (online) {
      send({ t: "result", score: score, acc: a, maxCombo: maxCombo, miss: counts.miss });
      $("lobbyMsg").textContent = "等队友结算…";
    }
    show("result", true);
    syncHUD(true);
  }

  /* ---------------- 渲染 ---------------- */
  function roundRect(g, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
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

  function drawField(t) {
    var bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#0a0820");
    bg.addColorStop(0.55, "#0b0a24");
    bg.addColorStop(1, "#140b26");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // 场外暗角
    if (OX > 2) {
      ctx.fillStyle = "rgba(4,3,12,.6)";
      ctx.fillRect(0, 0, OX, H);
      ctx.fillRect(OX + VW, 0, W - OX - VW, H);
    }

    var levels = BandAudio.levels();
    for (var i = 0; i < 4; i++) {
      var x = OX + i * laneW;
      var mine = lanesMine.indexOf(i) >= 0;
      var g = ctx.createLinearGradient(0, judgeY - 260, 0, judgeY);
      g.addColorStop(0, "rgba(255,255,255,0)");
      g.addColorStop(1, LANE_COLORS[i]);
      ctx.globalAlpha = (mine ? 0.07 : 0.03) + levels[i] * 0.16;
      ctx.fillStyle = g;
      ctx.fillRect(x + 2, judgeY - 300, laneW - 4, 300);
      ctx.globalAlpha = 1;

      ctx.strokeStyle = "rgba(255,255,255,.06)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, H);
      ctx.stroke();
    }

    // 判定线
    var lg = ctx.createLinearGradient(OX, 0, OX + VW, 0);
    for (var k = 0; k < 4; k++) lg.addColorStop(k / 4 + 0.02, LANE_COLORS[k]);
    lg.addColorStop(1, LANE_COLORS[3]);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = lg;
    ctx.fillRect(OX, judgeY - 1, VW, 2);
    ctx.globalAlpha = 0.12;
    ctx.fillRect(OX, judgeY - 10, VW, 20);
    ctx.restore();

    // 键位 / 声部名
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (var j = 0; j < 4; j++) {
      var cx = OX + j * laneW + laneW / 2;
      var active = laneHeld[j] > 0;
      ctx.globalAlpha = active ? 0.95 : 0.42;
      ctx.fillStyle = LANE_COLORS[j];
      ctx.font = "800 10px ui-monospace,Menlo,monospace";
      ctx.fillText(LANE_KEYS[j], cx, judgeY + 26);
      ctx.globalAlpha = active ? 0.8 : 0.3;
      ctx.font = "700 8px -apple-system,'PingFang SC',sans-serif";
      ctx.fillText(LANE_NAMES[j], cx, judgeY + 42);
    }
    ctx.globalAlpha = 1;
  }

  function drawNotes(t) {
    if (!chart) return;
    var visibleFrom = t - 0.15;
    var visibleTo = t + 1.25;

    for (var lane = 0; lane < 4; lane++) {
      var q = laneQueue[lane];
      var mine = lanesMine.indexOf(lane) >= 0;
      for (var i = lanePtr[lane]; i < q.length; i++) {
        var n = q[i];
        if (n.t > visibleTo) break;
        if (n.judged && !n.holding) continue;
        if (n.t + (n.dur || 0) < visibleFrom) continue;
        var x = OX + lane * laneW + laneW / 2;
        var y = judgeY - (n.t - t) * speed;
        var w = laneW * 0.66;
        var h = 13;

        ctx.save();
        ctx.globalAlpha = mine ? 1 : 0.22;

        if (n.type === "hold") {
          var endY = judgeY - (n.t + n.dur - t) * speed;
          var top = Math.min(y, endY);
          var bot = Math.max(y, endY);
          if (bot > -30) {
            top = Math.max(top, -24);
            ctx.fillStyle = LANE_COLORS[lane];
            ctx.globalAlpha *= 0.26;
            roundRect(ctx, x - w * 0.3, top, w * 0.6, Math.max(h, bot - top), w * 0.3);
            ctx.fill();
            ctx.globalAlpha = mine ? 1 : 0.22;
            if (endY > -12) {
              ctx.fillStyle = "#ffffff";
              ctx.globalAlpha *= 0.55;
              roundRect(ctx, x - w * 0.3, endY - 4, w * 0.6, 7, 3.5);
              ctx.fill();
              ctx.globalAlpha = mine ? 1 : 0.22;
            }
          }
        }

        if (n.holding) { ctx.restore(); continue; }

        ctx.shadowColor = LANE_COLORS[lane];
        ctx.shadowBlur = 12;
        var ng = ctx.createLinearGradient(0, y - h / 2, 0, y + h / 2);
        ng.addColorStop(0, "#ffffff");
        ng.addColorStop(0.45, LANE_COLORS[lane]);
        ng.addColorStop(1, LANE_COLORS[lane]);
        ctx.fillStyle = ng;
        roundRect(ctx, x - w / 2, y - h / 2, w, h, 6.5);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = "rgba(255,255,255,.75)";
        roundRect(ctx, x - w / 2 + 3, y - h / 2 + 2, w - 6, 2.4, 1.2);
        ctx.fill();
        ctx.restore();
      }
    }
  }

  function drawFx(dt) {
    for (var i = fx.length - 1; i >= 0; i--) {
      var p = fx[i];
      p.life -= dt;
      if (p.life <= 0) { fx.splice(i, 1); continue; }
      var a = p.life / p.maxLife;
      if (p.dot) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 260 * dt;
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      } else {
        var r = p.r + (p.max - p.r) * (1 - a);
        ctx.globalAlpha = a * 0.7;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2 + a * 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    if (judgeText && judgeText.time > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, judgeText.time * 4);
      ctx.textAlign = "center";
      ctx.font = "900 14px ui-monospace,Menlo,monospace";
      ctx.fillStyle = judgeText.color;
      ctx.fillText(judgeText.text, OX + VW / 2, judgeY - 54);
      ctx.restore();
    }
  }

  function render(dt) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    var t = chart && (state === "playing" || state === "paused" || state === "countdown") ? songTime() : 0;
    drawField(t);
    drawNotes(t);

    // 顶部渐隐：音符从海面雾里落下来
    var fade = ctx.createLinearGradient(0, 0, 0, 190);
    fade.addColorStop(0, "rgba(8,7,22,1)");
    fade.addColorStop(0.55, "rgba(8,7,22,.72)");
    fade.addColorStop(1, "rgba(8,7,22,0)");
    ctx.fillStyle = fade;
    ctx.fillRect(OX, 0, VW, 190);

    drawFx(dt);

    if (judgeText) {
      judgeText.time -= dt;
      if (judgeText.time <= 0) judgeText = null;
    }
  }

  /* ---------------- 主循环 ---------------- */
  function loop(ts) {
    requestAnimationFrame(loop);
    var dt = lastT ? Math.min(0.05, (ts - lastT) / 1000) : 0.016;
    lastT = ts;

    if (state === "playing") {
      var t = songTime();
      if (!freezeJudge) updateJudge(t);

      if (gauge >= 100 && feverUntil <= t) {
        feverUntil = t + 10;
        gauge = 45;
        toast("FEVER! 全队 ×1.5");
        BandAudio.blip(1180);
      } else if (gauge <= 0 && badUntil <= t) {
        badUntil = t + 8;
        gauge = 28;
        toast("走音了…稳一下喵");
      }
      if (feverUntil > t) gauge = Math.min(100, gauge + 0.05);

      if (online && performance.now() - lastProgress > 600) {
        lastProgress = performance.now();
        send({ t: "progress", score: score, combo: combo, acc: acc(), gauge: gauge });
      }

      if (customMode) {
        for (var gl = 0; gl < 4; gl++) {
          if (laneGate[gl] && performance.now() - gateAt[gl] > 450) gateOff(gl);
        }
      }

      if (t > chart.meta.duration + 0.35) finishRun();
    }
    render(dt);
  }

  /* ---------------- 输入 ---------------- */
  var pointerLane = {};
  function laneFromX(x) {
    var lane = Math.floor((x - OX) / laneW);
    return clamp(lane, 0, 3);
  }
  cvs.addEventListener("pointerdown", function (e) {
    if (state !== "playing") return;
    var lane = laneFromX(e.clientX);
    if (lanesMine.indexOf(lane) < 0) return;
    pointerLane[e.pointerId] = lane;
    try { cvs.setPointerCapture(e.pointerId); } catch (err) {}
    hitLane(lane);
    e.preventDefault();
  }, { passive: false });
  function endPointer(e) {
    var lane = pointerLane[e.pointerId];
    if (lane == null) return;
    delete pointerLane[e.pointerId];
    releaseLane(lane);
  }
  cvs.addEventListener("pointerup", endPointer);
  cvs.addEventListener("pointercancel", endPointer);
  window.addEventListener("keydown", function (e) {
    var k = e.key.toLowerCase();
    if (k === " " || k === "escape") {
      if (state === "playing") pauseGame();
      else if (state === "paused") resumeGame();
      return;
    }
    if (k in KEYMAP) {
      if (e.repeat) return;
      var lane = KEYMAP[k];
      if (lanesMine.indexOf(lane) < 0) return;
      hitLane(lane);
      e.preventDefault();
    }
  });
  window.addEventListener("keyup", function (e) {
    var k = e.key.toLowerCase();
    if (k in KEYMAP) releaseLane(KEYMAP[k]);
  });

  /* ---------------- 暂停 ---------------- */
  function pauseGame() {
    if (state !== "playing") return;
    if (online) { toast("联机合奏不能暂停喵"); return; }
    state = "paused";
    BandAudio.pause();
    show("pauseScr", true);
  }
  function resumeGame() {
    if (state !== "paused") return;
    state = "playing";
    BandAudio.resume();
    show("pauseScr", false);
  }

  /* ---------------- 网络 ---------------- */
  function send(obj) {
    if (ws && ws.readyState === 1) {
      try { ws.send(JSON.stringify(obj)); } catch (e) {}
    }
  }

  function wsUrl() {
    if (window.MEOW_WS_BASE) return window.MEOW_WS_BASE.replace(/\/$/, "") + "/ws/band";
    return (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws/band";
  }

  function connect() {
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
    try { ws = new WebSocket(wsUrl()); } catch (e) { scheduleReconnect(); return; }
    ws.addEventListener("open", function () {
      send({ t: "join", name: myName, cid: CID });
      ping();
      clearInterval(netTimer);
      netTimer = setInterval(ping, 6000);
      $("lobbyMsg").textContent = "已连上排练室喵";
    });
    ws.addEventListener("message", function (ev) {
      var m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      onNet(m);
    });
    ws.addEventListener("close", function () {
      clearInterval(netTimer);
      if (state === "lobby") {
        $("lobbyMsg").textContent = "掉线了，重连中…";
        scheduleReconnect();
      }
    });
    ws.addEventListener("error", function () {});
  }

  function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(function () {
      if (state === "lobby" || state === "menu") connect();
    }, 2000);
  }

  function ping() {
    send({ t: "ping", t0: Date.now() });
  }

  function onNet(m) {
    if (m.t === "pong") {
      var rtt = Date.now() - m.t0;
      var off = m.ts - (m.t0 + rtt / 2);
      if (!clockOffset || rtt < (onNet._rtt || 1e9)) {
        clockOffset = off;
        onNet._rtt = rtt;
      }
      return;
    }
    if (m.t === "welcome") {
      myId = m.id;
      if (m.serverTime) clockOffset = m.serverTime - Date.now();
      lobbyPlayers = m.players || [];
      if (m.room) room = m.room;
      songId = room.song || songId;
      diff = room.diff || diff;
      renderAllSongLists();
      renderAllDiff();
      renderLobby();
      renderTeam();
      return;
    }
    if (m.t === "picked") {
      songId = m.song; diff = m.diff;
      renderAllSongLists();
      renderAllDiff();
      $("lobbyMsg").textContent = (m.by || "有人") + " 点了《" + (SONGS.find(function (s) { return s.id === songId; }) || {}).title + "》";
      return;
    }
    if (m.t === "remote") {
      if (customMode || !m.snd) return;
      if (m.kind === "hold") {
        var rv0 = BandAudio.hold(m.snd);
        remoteVoices[m.voice || m.id] = rv0;
      } else if (m.kind === "holdEnd") {
        var rv1 = remoteVoices[m.voice || m.id];
        if (rv1) { rv1.release(); delete remoteVoices[m.voice || m.id]; }
      } else {
        BandAudio.play(m.snd);
      }
      return;
    }

    if (m.t === "state") {
      lobbyPlayers = m.players || [];
      if (m.room) room = m.room;
      renderLobby();
      renderTeam();
      return;
    }
    if (m.t === "start") {
      songId = m.song; diff = m.diff;
      var assign = (m.assign || {})[myId] || [0, 1, 2, 3];
      lanesMine = assign;
      if (m.players) lobbyPlayers = m.players;
      prepareChart();
      beginCountdown(3, m.startAt);
      return;
    }
    if (m.t === "finish") {
      teamFinish = m;
      var tp = $("resultPlayers");
      tp.innerHTML = "";
      (m.players || []).forEach(function (p) {
        var d = document.createElement("div");
        d.innerHTML = "<span>" + p.name + "</span><span>" + fmt(p.score) + " · " + (p.acc || 0).toFixed(1) + "%</b></span>";
        tp.appendChild(d);
      });
      if (m.rank) $("rankBig").textContent = m.rank;
      $("resultTag").textContent = "TEAM " + (m.rank || "");
      return;
    }
    if (m.t === "error") {
      toast(m.message || "出错了喵");
      $("lobbyMsg").textContent = m.message || "";
    }
  }

  function renderLobby() {
    var el = $("lobbyPlayers");
    if (!el) return;
    el.innerHTML = "";
    lobbyPlayers.forEach(function (p) {
      var d = document.createElement("div");
      d.className = "prow" + (p.ready ? " ready" : "") + (p.online === false ? " off" : "");
      var c = LANE_COLORS[(p.lanes && p.lanes[0]) || 0];
      d.innerHTML = "<i style='color:" + c + ";background:" + c + "'></i><b>" + p.name + (p.id === myId ? "（你）" : "") + "</b><span>" + (p.ready ? "READY" : "WAIT") + "</span>";
      el.appendChild(d);
    });
    if (!lobbyPlayers.length) {
      el.innerHTML = "<div class='lobbyMsg'>还没有人，等一只队友喵…</div>";
    }
  }

  function enterLobby() {
    online = true;
    state = "lobby";
    show("menu", false);
    show("result", false);
    show("lobby", true);
    $("nameInput").value = myName;
    renderAllSongLists();
    renderAllDiff();
    renderLobby();
    renderTeam();
    if (ws && ws.readyState === 1) {
      send({ t: "join", name: myName, cid: CID });
    } else {
      connect();
    }
  }

  function leaveLobby() {
    online = false;
    ready = false;
    state = "menu";
    show("lobby", false);
    show("menu", true);
    if (ws) { try { ws.close(); } catch (e) {} ws = null; }
  }

  /* ---------------- 校准 ---------------- */
  var calib = { active: false, beats: [], taps: [], start: 0, timer: null, idx: 0 };
  function openCalib() {
    show("menu", false);
    show("calib", true);
    calib.taps = [];
    $("calibCount").textContent = "0 / 12";
    $("calibResult").textContent = offsetMs.toFixed(0) + "ms";
    BandAudio.init();
    BandAudio.blip(660);
  }
  function startCalib() {
    if (calib.active) return;
    BandAudio.init();
    calib.active = true;
    calib.beats = [];
    calib.taps = [];
    var ac = BandAudio.ctx;
    var t0 = ac.currentTime + 0.6;
    calib.start = t0;
    calib.beatDur = 0.6;
    for (var i = 0; i < 12; i++) calib.beats.push(t0 + i * 0.6);
    calib.idx = 0;
    clearInterval(calib.timer);
    calib.timer = setInterval(function () {
      var now = ac.currentTime;
      while (calib.idx < calib.beats.length && calib.beats[calib.idx] <= now + 0.03) {
        BandAudio.blip(920);
        flapDot();
        calib.idx++;
      }
      if (calib.idx >= calib.beats.length) {
        clearInterval(calib.timer);
        calib.active = false;
      }
    }, 20);
  }
  function flapDot() {
    var d = $("calibDot");
    d.classList.add("on");
    setTimeout(function () { d.classList.remove("on"); }, 90);
  }
  function tapCalib() {
    if (!calib.active && calib.taps.length === 0) startCalib();
    if (!calib.beats.length) return;
    var ac = BandAudio.ctx;
    var now = ac.currentTime;
    var best = null;
    for (var i = 0; i < calib.beats.length; i++) {
      var d = now - calib.beats[i];
      if (d > -0.3 && d < 0.3 && (best === null || Math.abs(d) < Math.abs(best))) best = d;
    }
    if (best === null) return;
    calib.taps.push(best);
    $("calibCount").textContent = calib.taps.length + " / 12";
    if (calib.taps.length >= 12) {
      var arr = calib.taps.slice().sort(function (a, b) { return a - b; });
      var med = arr[Math.floor(arr.length / 2)];
      offsetMs = clamp(med * 1000, -150, 150);
      $("calibResult").textContent = offsetMs.toFixed(0) + "ms";
      $("calibBtn").querySelector("small").textContent = offsetMs.toFixed(0) + "ms";
      toast("校准好了喵：" + offsetMs.toFixed(0) + "ms");
    }
  }

  /* ---------------- 绑定 ---------------- */
  $("soloBtn").addEventListener("click", function () {
    BandAudio.init();
    if (customData) startCustom();
    else startSolo();
  });
  $("onlineBtn").addEventListener("click", function () {
    BandAudio.init();
    enterLobby();
  });
  $("calibBtn").addEventListener("click", openCalib);
  $("calibTap").addEventListener("click", tapCalib);
  $("calibSave").addEventListener("click", function () {
    localStorage.setItem("band-offset", String(offsetMs));
    show("calib", false);
    show("menu", true);
    BandAudio.blip(880);
  });
  $("readyBtn").addEventListener("click", function () {
    if (online && room && room.state !== "lobby") { toast("这一场还在收尾，等一下喵"); return; }
    ready = !ready;
    $("readyBtn").textContent = ready ? "取 消 准 备" : "准 备 好 了";
    send({ t: "ready" });
  });
  $("leaveBtn").addEventListener("click", leaveLobby);
  $("nameBtn").addEventListener("click", function () {
    var v = ($("nameInput").value || "").trim().slice(0, 12);
    if (!v) return;
    myName = v;
    localStorage.setItem("band-name", myName);
    send({ t: "name", name: myName });
    toast("改名成功喵");
  });
  $("pauseBtn").addEventListener("click", function () {
    if (state === "playing") pauseGame();
    else if (state === "paused") resumeGame();
  });
  $("resumeBtn").addEventListener("click", resumeGame);
  $("quitBtn").addEventListener("click", function () {
    BandAudio.stop();
    show("pauseScr", false);
    state = "menu";
    chart = null;
    show("menu", true);
  });
  $("againBtn").addEventListener("click", function () {
    show("result", false);
    if (online) { enterLobby(); }
    else if (customMode) { startCustom(); }
    else { startSolo(); }
  });
  $("backBtn").addEventListener("click", function () {
    show("result", false);
    if (online) enterLobby();
    else { state = "menu"; show("menu", true); }
  });
  $("clickBtn").addEventListener("click", function () {
    var on = BandAudio.toggleClick();
    $("clickBtn").classList.toggle("on", on);
    toast(on ? "节拍器开" : "节拍器关");
  });
  $("muteBtn").addEventListener("click", function () {
    var muted = BandAudio.toggleMute();
    $("muteBtn").classList.toggle("on", !muted);
    $("muteBtn").textContent = muted ? "×" : "♪";
  });

  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", function () { setTimeout(resize, 200); });
  document.addEventListener("visibilitychange", function () {
    if (document.hidden && state === "playing") pauseGame();
  });

  /* ---------------- 启动 ---------------- */
  function boot() {
    resize();
    renderAllSongLists();
    renderAllDiff();
    $("offsetTxt").textContent = offsetMs.toFixed(0) + "ms";
    syncHUD(true);
    renderTeam();
    requestAnimationFrame(loop);

    if (/[?&]custom=1/.test(location.search)) {
      window.BandSep && BandSep.loadCustom().then(function (d) {
        if (!d) { toast("还没有导入的曲子喵"); return; }
        customData = d;
        $("soloBtn").textContent = "演 奏：" + d.name.slice(0, 10);
        toast("本地曲已就绪，点「开始」喵");
      }).catch(function () { toast("读取本地曲失败喵"); });
    }

    if (/[?&]dev=1/.test(location.search)) {
      window.__band = {
        get state() { return state; },
        get score() { return score; },
        get acc() { return acc(); },
        get counts() { return counts; },
        get gauge() { return gauge; },
        get lanes() { return lanesMine; },
        get notes() { return chart ? chart.notes : []; },
        get songTime() { return songTime(); },
        start: startSolo,
        skipTo: function (s) { debugTime = s; },
        freeze: function (s) { debugTime = s; freezeJudge = true; },
        stepTo: function (s) { debugTime = s; updateJudge(s); },
        unfreeze: function () { freezeJudge = false; debugTime = null; },
        judge: function (lane) { hitLane(lane); },
        release: function (lane) { releaseLane(lane); },
        hitBest: function (lane) {
          var q = laneQueue[lane], best = null;
          for (var i = lanePtr[lane]; i < q.length; i++) {
            if (q[i].judged) continue;
            if (!best || Math.abs(q[i].t - songTime()) < Math.abs(best.t - songTime())) best = q[i];
          }
          if (best) debugTime = best.t;
          hitLane(lane);
        },
        finish: finishRun,
        setOffset: function (ms) { offsetMs = ms; },
        audioInfo: function () {
          return {
            customMode: customMode,
            gate: laneGate.slice(),
            state: BandAudio.state,
            ctx: BandAudio.ctx ? BandAudio.ctx.state : "none",
            counts: counts
          };
        }
      };
    }
  }

  boot();
})();
