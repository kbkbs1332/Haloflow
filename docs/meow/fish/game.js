(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const canvas = $("c");
  const ctx = canvas.getContext("2d", { alpha: false });
  const ci = $("ci");
  const ciCtx = ci.getContext("2d");
  const glCanvas = $("gl");
  let gl = null, glOk = false, glProgram = null, glBuf = null, glTex = null;
  let glLoc = {}, glBurst = null, lastTexUpload = 0;
  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  const GL_VS = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main(){
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

  const GL_FS = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_res;
uniform float u_time;
uniform float u_ts;
uniform vec2 u_center;
uniform float u_radius;
uniform float u_aspect;
uniform vec2 u_burstCenter;
uniform vec3 u_burstColor;
uniform float u_burstAge;
uniform float u_burstScale;

float hash(float n){ return fract(sin(n) * 43758.5453); }

void main(){
  vec2 uv = vec2(v_uv.x, 1.0 - v_uv.y);
  vec3 col = vec3(0.0);
  float alpha = 0.0;

  if (u_ts > 0.5) {
    vec3 scene = texture2D(u_tex, uv).rgb;
    vec2 p = (uv - u_center) * vec2(u_aspect, 1.0);
    float d = length(p);
    vec2 dir = d > 0.0001 ? p / d : vec2(0.0);

    float ee = (d - u_radius) / 0.013;
    float edgeBand = exp(-ee * ee);
    float ripple = sin((d - u_radius) * 90.0 - u_time * 22.0) * 0.012 * edgeBand;
    vec2 duv = uv + dir * ripple;

    float ca = 0.0042 * edgeBand;
    vec3 base;
    base.r = texture2D(u_tex, duv + dir * ca).r;
    base.g = texture2D(u_tex, duv).g;
    base.b = texture2D(u_tex, duv - dir * ca).b;

    float inside = 1.0 - smoothstep(u_radius - 0.0035, u_radius + 0.0035, d);
    vec3 inv = 1.0 - base;
    float scan = 0.93 + 0.07 * sin(uv.y * u_res.y * 1.6 + u_time * 38.0);
    inv *= scan;

    float gline = step(0.988, hash(floor(uv.y * 90.0) + floor(u_time * 10.0)));
    inv.r += gline * 0.12;
    inv.b -= gline * 0.08;

    col = mix(scene, inv, inside);

    float re = (d - u_radius) / 0.006;
    float fe = (d - u_radius - 0.010) / 0.005;
    col += vec3(0.20, 0.82, 1.0) * exp(-re * re) * 1.5;
    col += vec3(1.0, 0.18, 0.55) * exp(-fe * fe) * 0.85;
    alpha = 1.0;
  }

  if (u_burstAge >= 0.0) {
    vec2 bp = (uv - u_burstCenter) * vec2(u_aspect, 1.0);
    float bd = length(bp);
    float t = clamp(u_burstAge, 0.0, 1.0);
    float bs = max(0.25, u_burstScale);
    float rr = t * 0.85 * bs;
    float be = (bd - rr) / (0.022 * bs);
    float ring = exp(-be * be) * (1.0 - t);
    float rays = pow(max(0.0, 1.0 - abs(sin(atan(bp.y, bp.x) * 9.0 + u_time * 3.0))), 16.0) * exp(-bd * 4.5 / bs) * (1.0 - t);
    float core = exp(-bd * 30.0 / bs) * (1.0 - t);
    vec3 fx = u_burstColor * (ring * 2.4 + rays * 1.5 + core * 1.8);
    col += fx;
    alpha = max(alpha, clamp(max(fx.r, max(fx.g, fx.b)), 0.0, 1.0));
  }

  gl_FragColor = vec4(col, alpha);
}`;

  function compileShader(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(s) || "shader compile failed");
    }
    return s;
  }

  function initGL() {
    try {
      gl = glCanvas.getContext("webgl", { alpha: true, antialias: false, premultipliedAlpha: false })
        || glCanvas.getContext("experimental-webgl", { alpha: true, antialias: false, premultipliedAlpha: false });
      if (!gl) return;
      const vs = compileShader(gl.VERTEX_SHADER, GL_VS);
      const fs = compileShader(gl.FRAGMENT_SHADER, GL_FS);
      glProgram = gl.createProgram();
      gl.attachShader(glProgram, vs);
      gl.attachShader(glProgram, fs);
      gl.linkProgram(glProgram);
      if (!gl.getProgramParameter(glProgram, gl.LINK_STATUS)) throw new Error("program link failed");
      gl.useProgram(glProgram);

      glBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, glBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
      const aPos = gl.getAttribLocation(glProgram, "a_pos");
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

      glTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, glTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0,0,0,255]));

      ["u_tex","u_res","u_time","u_ts","u_center","u_radius","u_aspect","u_burstCenter","u_burstColor","u_burstAge","u_burstScale"].forEach((n) => {
        glLoc[n] = gl.getUniformLocation(glProgram, n);
      });
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.clearColor(0, 0, 0, 0);
      glOk = true;
      ci.style.display = "none";
      const edge = $("tsEdge");
      if (edge) edge.style.display = "none";
      glCanvas.addEventListener("webglcontextlost", (ev) => {
        ev.preventDefault();
        glOk = false;
        gl = null;
        ci.style.display = "";
        if (edge) edge.style.display = "";
        glCanvas.style.opacity = "0";
      });
    } catch (e) {
      glOk = false;
      gl = null;
    }
  }

  function hexToRgb(hex) {
    const h = hex.replace("#", "");
    const s = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    return [parseInt(s.slice(0,2),16)/255, parseInt(s.slice(2,4),16)/255, parseInt(s.slice(4,6),16)/255];
  }

  function glBurstFx(nx, ny, color, strength) {
    if (!glOk) return;
    glBurst = {
      start: performance.now(), dur: 680,
      x: clamp(nx, 0, 1), y: clamp(ny, 0, 1),
      color: hexToRgb(color || "#ffd166"),
      strength: strength || 1
    };
  }

  function drawGL(now) {
    if (!glOk) return;
    const tsOn = tsEndAt > now;
    const burstOn = glBurst && now < glBurst.start + glBurst.dur;
    if (!tsOn && !burstOn) {
      glCanvas.style.opacity = "0";
      return;
    }
    if (glCanvas.width !== canvas.width || glCanvas.height !== canvas.height) {
      glCanvas.width = canvas.width;
      glCanvas.height = canvas.height;
    }
    glCanvas.style.opacity = "1";
    gl.viewport(0, 0, glCanvas.width, glCanvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(glProgram);

    let centerX = tsX;
    let centerY = (H - 56) / H;
    let radius = 0;
    if (tsOn) {
      const aspect = W / H;
      const maxR = Math.hypot(Math.max(centerX * aspect, (1 - centerX) * aspect), Math.max(centerY, 1 - centerY)) + 0.04;
      const elapsed = now - tsStartAt;
      const remain = tsEndAt - now;
      if (elapsed < 620) radius = maxR * Math.pow(clamp(elapsed / 620, 0, 1), 3);
      else if (remain < 650) radius = maxR * clamp(remain / 650, 0, 1);
      else radius = maxR;
      if (remain <= 0) {
        radius = 0;
        tsEndAt = 0;
        tsStartAt = 0;
        timeStopIn = 0;
      }
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, glTex);
      if (now - lastTexUpload > 33) {
        lastTexUpload = now;
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
      }
      gl.uniform1i(glLoc.u_tex, 0);
    }

    gl.uniform2f(glLoc.u_res, glCanvas.width, glCanvas.height);
    gl.uniform1f(glLoc.u_time, now / 1000);
    gl.uniform1f(glLoc.u_ts, tsOn ? 1 : 0);
    gl.uniform2f(glLoc.u_center, centerX, centerY);
    gl.uniform1f(glLoc.u_radius, radius);
    gl.uniform1f(glLoc.u_aspect, W / H);

    if (burstOn && glBurst) {
      gl.uniform2f(glLoc.u_burstCenter, glBurst.x, glBurst.y);
      gl.uniform3f(glLoc.u_burstColor, glBurst.color[0], glBurst.color[1], glBurst.color[2]);
      gl.uniform1f(glLoc.u_burstAge, clamp((now - glBurst.start) / glBurst.dur, 0, 1));
      gl.uniform1f(glLoc.u_burstScale, glBurst.strength || 1);
    } else {
      gl.uniform2f(glLoc.u_burstCenter, 0, 0);
      gl.uniform3f(glLoc.u_burstColor, 1, 1, 1);
      gl.uniform1f(glLoc.u_burstAge, -1);
      gl.uniform1f(glLoc.u_burstScale, 1);
    }

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  const SKIN_DEFS = {
    pink:    { label: "樱花",   body: "#ffd9e6", ear: "#ff9ec4", belly: "#fff0f6", bowl: ["#ffd0e0", "#f08ab2"], name: "#ff9ec4" },
    mint:    { label: "薄荷",   body: "#d9fff6", ear: "#63d9cf", belly: "#f0fffb", bowl: ["#c8f7ee", "#4fc3b8"], name: "#63d9cf" },
    gold:    { label: "金渐层", body: "#ffe9b8", ear: "#ffd166", belly: "#fff8e1", bowl: ["#ffe3a3", "#e0a83a"], name: "#ffd166" },
    lavender:{ label: "薰衣草", body: "#e6dcff", ear: "#b49aff", belly: "#f7f2ff", bowl: ["#d9ccff", "#9a7fe0"], name: "#b49aff" },
    midnight:{ label: "午夜",   body: "#c9d4f5", ear: "#7f8fc9", belly: "#eef2ff", bowl: ["#aab8e0", "#6675a8"], name: "#9fb0ff" },
    rainbow: { label: "彩虹",   body: "#ffd9e6", ear: "#ff9ec4", belly: "#fff0f6", bowl: ["#ffd0e0", "#f08ab2"], name: "#ff9ec4", rainbow: true }
  };

  const RELIC_SHORT = {
    necklace: "项链", glove: "手套", armor: "锅盖", lens: "墨镜", boots: "电靴"
  };

  let FISH_DEFS = {
    sardine: { points: 10, size: 0.018 }, clown: { points: 20, size: 0.017 },
    puffer: { points: 15, size: 0.027 }, lightning: { points: 30, size: 0.016 },
    gold: { points: 50, size: 0.021 }, rainbow: { points: 100, size: 0.023 },
    bomb: { points: 0, size: 0.023 }
  };

  let W = 0, H = 0, DPR = 1;
  const bgCanvas = document.createElement("canvas");
  const bgCtx = bgCanvas.getContext("2d");
  let stars = [], buildings = [], bokeh = [], meteor = null, meteorNext = 0;
  let ws = null;
  let myId = null;
  let reconnecting = false;

  // 每个标签页一个稳定 id：刷新/断线重连时服务端能认出是同一只猫
  function getCid() {
    try {
      let c = sessionStorage.getItem("meowfish-cid");
      if (!c) {
        c = "c" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
        sessionStorage.setItem("meowfish-cid", c);
      }
      return c;
    } catch (e) {
      return "c" + Math.random().toString(36).slice(2, 12);
    }
  }
  const CID = getCid();
  let joined = false;
  let wantJoin = false;
  let myName = "无名猫";
  let mySkin = "pink";
  let players = new Map();
  let fishes = new Map();
  let particles = [];
  let fx = [];
  let flyFish = [];
  let flyStart = 0;
  let flyToX = 0.5;
  let timeLeft = 180;
  let slowIn = 0;
  let timeStopIn = 0;
  let tsEndAt = 0;
  let tsStartAt = 0;
  let tsX = 0.5;
  let lastFallbackCopy = 0;
  let online = 0;
  let targetX = 0.5;
  let localX = 0.5;
  let lastMoveSent = 0;
  let lastFrame = performance.now();
  let lastBoard = 0;
  let lastHud = 0;
  let soundOn = true;
  let audio = null;
  let toastTimer = null;
  let roundInfo = null;

  try {
    myName = (localStorage.getItem("meowName") || "").slice(0, 12) || "无名猫";
    const s = localStorage.getItem("meowSkin");
    if (s && SKIN_DEFS[s]) mySkin = s;
  } catch (e) {}

  /* ---------- DOM ---------- */
  $("name").value = myName;
  buildSkinGrid($("skinGrid"), mySkin, pickLobbySkin);
  buildSkinGrid($("skinGrid2"), mySkin, pickPanelSkin);

  function pickLobbySkin(id) {
    mySkin = id;
    saveSkin();
    buildSkinGrid($("skinGrid"), mySkin, pickLobbySkin);
  }
  function pickPanelSkin(id) {
    mySkin = id;
    saveSkin();
    buildSkinGrid($("skinGrid2"), mySkin, pickPanelSkin);
    if (joined && ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "skin", skin: mySkin }));
  }

  function saveSkin() {
    try { localStorage.setItem("meowSkin", mySkin); } catch (e) {}
  }
  function saveName() {
    try { localStorage.setItem("meowName", myName); } catch (e) {}
  }

  function buildSkinGrid(el, selected, onPick) {
    if (!el) return;
    el.innerHTML = "";
    for (const [id, def] of Object.entries(SKIN_DEFS)) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "skinBtn" + (id === selected ? " on" : "");
      const dot = document.createElement("span");
      dot.className = "dot";
      dot.style.background = def.rainbow
        ? "conic-gradient(#ff9ec4,#ffd166,#63d9cf,#b49aff,#ff9ec4)"
        : `linear-gradient(160deg, ${def.body}, ${def.ear})`;
      const label = document.createElement("span");
      label.textContent = def.label;
      b.append(dot, label);
      b.addEventListener("click", () => onPick(id));
      el.appendChild(b);
    }
  }

  /* ---------- sound ---------- */
  function initAudio() {
    if (audio) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audio = new AC();
    } catch (e) {}
  }
  function beep(freq, dur = 0.07, type = "sine", vol = 0.04) {
    if (!soundOn || !audio) return;
    try {
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(vol, audio.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + dur);
      o.connect(g); g.connect(audio.destination);
      o.start(); o.stop(audio.currentTime + dur);
    } catch (e) {}
  }
  $("soundBtn").addEventListener("click", () => {
    soundOn = !soundOn;
    $("soundBtn").textContent = soundOn ? "♪" : "静";
    if (soundOn) { initAudio(); beep(660, 0.05); }
  });

  /* ---------- websocket ---------- */
  function wsUrl() {
    if (window.MEOW_WS_BASE) return window.MEOW_WS_BASE.replace(/\/$/, "") + "/ws/fish";
    return (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws/fish";
  }

  function connect() {
    try { ws = new WebSocket(wsUrl()); } catch (e) { setTimeout(connect, 1800); return; }
    ws.addEventListener("open", () => {
      setLobbyMsg("");
      if (wantJoin || joined) sendJoin();
    });
    ws.addEventListener("message", (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      onMessage(m);
    });
    ws.addEventListener("close", (ev) => {
      const replaced = ev && ev.code === 4000;
      if (joined && !replaced) toast("掉线了，重连中…");
      timeStopIn = 0;
      tsEndAt = 0;
      tsStartAt = 0;
      flyFish = [];
      glBurst = null;
      ci.style.clipPath = "circle(0px at 50% 50%)";
      updateTimeStop();
      if (replaced) {
        joined = false;
        wantJoin = false;
        setLobbyMsg("这只猫在别处上线了喵");
        toast("这只猫在别处上线了喵");
        return;
      }
      if (reconnecting) return;
      reconnecting = true;
      setTimeout(() => { reconnecting = false; connect(); }, 1800);
    });
    ws.addEventListener("error", () => {});
  }

  function sendJoin() {
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ type: "join", name: myName, skin: mySkin, cid: CID }));
  }

  function onMessage(m) {
    if (!m || typeof m !== "object") return;
    switch (m.type) {
      case "welcome": {
        if (m.fishTypes) FISH_DEFS = m.fishTypes;
        online = m.online || 0;
        $("online").textContent = online;
        if (joined || wantJoin) sendJoin();
        break;
      }
      case "joined": {
        myId = m.id;
        myName = m.name || myName;
        mySkin = m.skin || mySkin;
        joined = true;
        wantJoin = false;
        $("lobby").classList.add("hide");
        $("lobbyMsg").textContent = "";
        $("hud").style.opacity = "1";
        initAudio();
        toast(m.resumed ? `回来了喵，${myName}，分还在` : `上码头了喵，${myName}`);
        beep(620, 0.06, "triangle", 0.04);
        break;
      }
      case "state": onState(m); break;
      case "catch": {
        burst(m.x, m.y, fishColor(m.fish), m.fish === "rainbow" || m.fish === "gold" ? 22 : 12, 180);
        if (m.fish === "treasure") {
          ringFx(m.x, m.y, "#ffd166", Math.min(W, H) * 0.5, 0.7, 4);
          for (let i = 0; i < 6; i++) coinFx(m.x + rand(-0.025, 0.025), m.y, m.x + rand(-0.05, 0.05), 0.93);
          textFx(m.x, m.y - 0.04, "宝箱!", "#ffe6a3", 1.1, 17);
        } else if (m.fish === "rainbow" || m.fish === "gold") {
          ringFx(m.x, m.y, fishColor(m.fish), Math.min(W, H) * 0.3, 0.5, 2.5);
          starFx(m.x, m.y, fishColor(m.fish), 6);
        }
        beep(m.fish === "gold" || m.fish === "rainbow" ? 1040 : 740, 0.06, "triangle", 0.04);
        glBurstFx(m.x, m.y, fishColor(m.fish), m.fish === "treasure" ? 1.15 : (m.fish === "gold" || m.fish === "rainbow" ? 0.7 : 0.35));
        break;
      }
      case "bomb": {
        burst(m.x, m.y, m.t === "bombFast" ? "#ff9f43" : "#ff6b6b", 24, 250);
        ringFx(m.x, m.y, m.t === "bombFast" ? "#ff9f43" : "#ff6b6b", Math.min(W, H) * 0.42, 0.5, 4);
        glBurstFx(m.x, m.y, m.t === "bombFast" ? "#ff9f43" : "#ff6b6b", 1.4);
        beep(m.t === "bombFast" ? 140 : 110, 0.22, "sawtooth", 0.06);
        if (m.id === myId) {
          if (m.penalty > 0) toast(`被${m.t === "bombFast" ? "高速炸弹" : "炸弹"}击中 -${m.penalty} 分`);
          else toast("被炸弹击中，分数已经见底喵");
        }
        break;
      }
      case "power": {
        const label = {
          star: "星星鱼！双倍积分 10 秒",
          shield: "泡泡护盾！挡一次炸弹",
          shieldBreak: "护盾挡住了炸弹！",
          ice: "冰鱼！全场减速 6 秒",
          magnet: "磁铁鱼！8 秒吸鱼",
          lucky: "幸运鱼！接下来 5 条鱼 +50%"
        }[m.kind];
        if (label && (m.id === myId || m.kind === "ice" || m.kind === "shieldBreak")) toast(label);
        const pc = { star: "#ffd166", shield: "#63d9cf", ice: "#9fe8ff", magnet: "#ff6b9a", lucky: "#7dff9a", shieldBreak: "#63d9cf" }[m.kind] || "#ffffff";
        const ex = typeof m.x === "number" ? m.x : 0.5;
        const ey = typeof m.y === "number" ? m.y : 0.9;
        ringFx(ex, ey, pc, Math.min(W, H) * 0.4, 0.62, 3);
        if (m.kind === "star") {
          starFx(ex, ey, "#ffd166", 14);
          textFx(ex, ey - 0.03, "双倍!", "#ffd166", 1.0, 16);
        } else if (m.kind === "shield") {
          ringFx(ex, ey, "#b8fff4", Math.min(W, H) * 0.28, 0.5, 2);
          textFx(ex, ey - 0.03, "护盾!", "#b8fff4", 0.9, 14);
        } else if (m.kind === "ice") {
          for (let i = 0; i < 10; i++) {
            const a = Math.random() * TAU, sp = rand(30, 130);
            fx.push({ kind: "star", x: ex * W, y: ey * H, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.7, max: 0.7, size: 3, rot: 0, spin: 2, color: "#dff8ff" });
          }
          textFx(ex, ey - 0.03, "减速!", "#9fe8ff", 0.9, 14);
        } else if (m.kind === "magnet") {
          for (let i = 0; i < 3; i++) {
            fx.push({ kind: "ring", x: ex * W, y: ey * H, r0: 10 + i * 14, r1: Math.min(W, H) * (0.28 + i * 0.08), life: 0.55 + i * 0.12, max: 0.55 + i * 0.12, color: "#ff6b9a", width: 2 });
          }
          textFx(ex, ey - 0.03, "磁!", "#ff9ec4", 0.9, 14);
        } else if (m.kind === "lucky") {
          starFx(ex, ey, "#7dff9a", 12);
          textFx(ex, ey - 0.03, "+50%", "#7dff9a", 1.0, 16);
        } else if (m.kind === "shieldBreak") {
          textFx(ex, ey - 0.03, "挡住了!", "#b8fff4", 0.8, 13);
        }
        burst(ex, ey, pc, 20, 200);
        glBurstFx(ex, ey, pc, 1.2);
        beep(m.kind === "star" ? 980 : m.kind === "ice" ? 520 : 760, 0.08, "triangle", 0.045);
        break;
      }
      case "timestop": {
        tsStartAt = performance.now();
        tsEndAt = tsStartAt + 3500;
        tsX = typeof m.byX === "number" ? m.byX : 0.5;
        timeStopIn = 3500;
        flyToX = tsX;
        flyStart = performance.now();
        flyFish = (m.fish || []).map((f, i) => ({
          t: f.t, x: f.x, y: f.y,
          id: i + 1,
          delay: i * 0.035,
          dur: 0.7 + Math.random() * 0.25
        }));
        glBurstFx(tsX, (H - 56) / H, "#ffe6a3", 1.6);
        updateTimeStop();
        if (m.by === myId) toast(`你停住了时间！收走 ${m.count} 条鱼 +${m.total} 分`);
        else toast(`${m.name} 停住了时间！`);
        beep(80, 0.5, "sawtooth", 0.08);
        setTimeout(() => beep(140, 0.3, "triangle", 0.05), 120);
        break;
      }
      case "relic": {
        if (m.id === myId) toast(`宝箱开出「${m.relic.name}」：${m.relic.desc}`);
        burst(m.x, m.y, "#ffd166", 24, 230);
        ringFx(m.x, m.y, "#ffd166", Math.min(W, H) * 0.46, 0.7, 3);
        for (let i = 0; i < 8; i++) coinFx(m.x + rand(-0.03, 0.03), m.y, m.x + rand(-0.06, 0.06), 0.93);
        textFx(m.x, m.y - 0.04, m.relic.name, "#ffe6a3", 1.2, 13);
        glBurstFx(m.x, m.y, "#ffd166", 1.3);
        beep(1120, 0.1, "triangle", 0.05);
        break;
      }
      case "grief": {
        let text = "";
        if (m.kind === "ink") {
          if (m.toId === myId) text = `${m.fromName} 把墨汁糊你脸上了！`;
          else if (m.fromId === myId) text = `你把墨汁甩给了 ${m.toName}`;
        } else if (m.kind === "thief") {
          const mine = (m.victims || []).find((v) => v.id === myId);
          if (mine) text = `被 ${m.fromName} 的偷钱蟹偷走 ${mine.amount} 分（5%）！`;
          else if (m.fromId === myId) text = `偷钱蟹从全场偷了 ${m.total} 分`;
        } else if (m.kind === "jelly") {
          if (m.toId === myId) text = `被 ${m.fromName} 的水母电麻了 2 秒`;
          else if (m.fromId === myId) text = `你把 ${m.toName} 电麻了 2 秒`;
        }
        if (text) toast(text);
        const gc = m.kind === "ink" ? "#7b5cff" : m.kind === "thief" ? "#ffd166" : "#9fe8ff";
        ringFx(m.x, m.y, gc, Math.min(W, H) * 0.36, 0.55, 3);
        if (m.kind === "ink") {
          textFx(m.x, m.y - 0.03, "墨!", "#b49aff", 0.9, 14);
        } else if (m.kind === "jelly") {
          const target = players.get(m.toId);
          const tx = target ? target.rx : m.x;
          boltFx(tx, 0.9, "#ffe066");
          boltFx(tx + 0.045, 0.9, "#9fe8ff");
          textFx(tx, 0.76, "麻!", "#9fe8ff", 0.9, 14);
        } else if (m.kind === "thief") {
          const to = players.get(m.fromId);
          const tx = to ? to.rx : m.x;
          for (const v of (m.victims || [])) {
            const from = players.get(v.id);
            coinFx(from ? from.rx : m.x, 0.9, tx, 0.9, "#ffd166");
          }
          textFx(tx, 0.78, `+${m.total}`, "#ffd166", 1.0, 15);
        }
        burst(m.x, m.y, gc, 18, 210);
        glBurstFx(m.x, m.y, gc, 1.25);
        beep(m.kind === "thief" ? 880 : m.kind === "jelly" ? 300 : 420, 0.1, "triangle", 0.045);
        break;
      }
      case "feed": toast(m.text); break;
      case "skin": {
        const p = players.get(m.id);
        if (p) p.skin = m.skin;
        if (m.id === myId) { mySkin = m.skin; saveSkin(); }
        break;
      }
      case "emote": {
        const p = players.get(m.id);
        if (p) { p.emote = m.text; p.emoteUntil = m.until; }
        break;
      }
      case "online": {
        online = m.count || 0;
        $("online").textContent = online;
        break;
      }
      case "roundStart": {
        roundInfo = null;
        $("roundBox").classList.add("hide");
        timeLeft = m.time || 180;
        particles = [];
        fx = [];
        flyFish = [];
        toast("新一局开始喵！");
        beep(780, 0.1, "triangle", 0.05);
        break;
      }
      case "roundEnd": {
        roundInfo = m;
        showRoundEnd(m);
        break;
      }
      case "error": {
        setLobbyMsg(m.message || "进不去喵");
        toast(m.message || "进不去喵");
        break;
      }
    }
  }

  function onState(m) {
    timeLeft = m.time;
    slowIn = m.slowIn || 0;
    timeStopIn = m.timeStopIn || 0;
    if (timeStopIn > 0) {
      if (!tsEndAt) {
        tsStartAt = performance.now();
        tsEndAt = tsStartAt + timeStopIn;
      }
      if (typeof m.timeStopX === "number") tsX = m.timeStopX;
    }
    updateTimeStop();
    online = m.online;
    const seen = new Set();
    for (const sp of m.players || []) {
      seen.add(sp.id);
      let p = players.get(sp.id);
      if (!p) {
        p = Object.assign({}, sp, { rx: sp.x });
        players.set(sp.id, p);
      } else {
        Object.assign(p, sp);
      }
      p.tx = sp.x;
    }
    for (const id of [...players.keys()]) if (!seen.has(id)) players.delete(id);

    const fseen = new Set();
    for (const sf of m.fish || []) {
      fseen.add(sf.id);
      let f = fishes.get(sf.id);
      if (!f) {
        f = Object.assign({}, sf, { rx: sf.x, ry: sf.y });
        fishes.set(sf.id, f);
      } else {
        f.t = sf.t;
        f.x = sf.x;
        f.y = sf.y;
      }
    }
    for (const id of [...fishes.keys()]) if (!fseen.has(id)) fishes.delete(id);

    const me = players.get(myId);
    if (me && me.dead) showDead(me.respawnIn); else hideDead();

    const now = performance.now();
    if (now - lastHud > 100) { lastHud = now; updateHud(); }
    if (now - lastBoard > 160) { lastBoard = now; updateBoard(); }
  }

  /* ---------- ui ---------- */
  function updateTimeStop(force) {
    const on = force === 1 || tsEndAt > performance.now() || timeStopIn > 0;
    $("timeStopFx").classList.toggle("on", on);
  }

  function syncInvert(now) {
    if (glOk) return;
    if (!tsEndAt) {
      ci.style.clipPath = "circle(0px at 50% 50%)";
      const edge = $("tsEdge");
      if (edge) edge.classList.remove("on");
      return;
    }
    const remain = tsEndAt - now;
    const elapsed = now - tsStartAt;
    const maxR = Math.hypot(Math.max(tsX * W, (1 - tsX) * W), H) + 24;
    let r = maxR;
    if (elapsed < 620) {
      const p = clamp(elapsed / 620, 0, 1);
      r = maxR * Math.pow(p, 3);
    } else if (remain < 650) {
      r = maxR * clamp(remain / 650, 0, 1);
    }
    if (remain <= 0) {
      r = 0;
      tsEndAt = 0;
      tsStartAt = 0;
      timeStopIn = 0;
    }
    if (now - lastFallbackCopy > 33) {
      lastFallbackCopy = now;
      ciCtx.setTransform(1, 0, 0, 1, 0, 0);
      ciCtx.clearRect(0, 0, ci.width, ci.height);
      ciCtx.drawImage(canvas, 0, 0);
    }
    ci.style.clipPath = `circle(${Math.max(0, r)}px at ${tsX * W}px ${H - 56}px)`;
    const edge = $("tsEdge");
    if (r > 2 && remain > 0) {
      edge.style.width = `${r * 2}px`;
      edge.style.height = `${r * 2}px`;
      edge.style.left = `${tsX * W - r}px`;
      edge.style.top = `${H - 56 - r}px`;
      edge.classList.add("on");
    } else {
      edge.classList.remove("on");
    }
    $("timeStopFx").classList.toggle("on", remain > 0);
  }

  function updateHud() {
    const me = players.get(myId);
    $("score").textContent = me ? me.score : 0;
    const s = Math.max(0, Math.ceil(timeLeft));
    $("time").textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    const lives = me ? me.lives : 3;
    $("lives").textContent = "♥".repeat(Math.max(0, lives)) + "♡".repeat(Math.max(0, 3 - lives));
    const cb = $("comboBadge");
    if (me && me.combo > 1) {
      cb.textContent = `×${me.combo} COMBO`;
      cb.classList.add("on");
    } else {
      cb.classList.remove("on");
    }
    const effects = [];
    if (me && me.doubleIn > 0) effects.push(`双倍 ${Math.ceil(me.doubleIn / 1000)}s`);
    if (me && me.shield) effects.push("护盾");
    if (me && me.magnetIn > 0) effects.push(`磁 ${Math.ceil(me.magnetIn / 1000)}s`);
    if (me && me.luckyCharges > 0) effects.push(`运 ×${me.luckyCharges}`);
    if (me && me.inkIn > 0) effects.push(`墨 ${Math.ceil(me.inkIn / 1000)}s`);
    if (me && me.stunIn > 0) effects.push(`麻 ${Math.ceil(me.stunIn / 1000)}s`);
    if (slowIn > 0) effects.push(`减速 ${Math.ceil(slowIn / 1000)}s`);
    const eb = $("effectBadge");
    if (effects.length) {
      eb.textContent = effects.join(" · ");
      eb.classList.add("on");
    } else {
      eb.classList.remove("on");
    }
    const panel = $("buffPanel");
    const hasRelic = !!(me && me.relics && me.relics.length);
    panel.classList.toggle("hide", effects.length === 0 && !hasRelic);

    const rb = $("relicBar");
    const key = me && me.relics ? me.relics.join(",") : "";
    if (rb.dataset.key !== key) {
      rb.dataset.key = key;
      rb.innerHTML = "";
      if (me && me.relics) {
        for (const r of me.relics) {
          const chip = document.createElement("span");
          chip.className = "relicChip";
          chip.textContent = RELIC_SHORT[r] || r;
          rb.appendChild(chip);
        }
      }
    }
  }

  function updateBoard() {
    const list = [...players.values()].sort((a, b) => b.score - a.score || b.caught - a.caught);
    const box = $("board");
    const top = box.scrollTop;
    box.innerHTML = "";
    list.forEach((p, i) => {
      const row = document.createElement("div");
      row.className = "brow" + (p.id === myId ? " me" : "");
      const rk = document.createElement("span");
      rk.className = "rk r" + (i + 1);
      rk.textContent = i + 1;
      const nm = document.createElement("span");
      nm.className = "nm";
      nm.textContent = p.name;
      const sc = document.createElement("span");
      sc.className = "sc";
      sc.textContent = p.score;
      row.append(rk, nm, sc);
      box.appendChild(row);
    });
    box.scrollTop = top;
    $("online").textContent = online || players.size;
  }

  function setLobbyMsg(text) {
    $("lobbyMsg").textContent = text;
  }

  function toast(text) {
    const el = $("toast");
    el.textContent = text;
    el.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("on"), 2400);
  }

  function showDead(sec) {
    $("deadBox").classList.remove("hide");
    $("deadText").textContent = `${Math.max(0, sec || 0)} 秒后自动复活`;
  }
  function hideDead() {
    $("deadBox").classList.add("hide");
  }

  function showRoundEnd(m) {
    const board = m.board || [];
    const box = $("roundBoard");
    box.innerHTML = "";
    for (let i = 0; i < board.length; i++) {
      const p = board[i];
      const row = document.createElement("div");
      row.className = "rrow" + (p.id === myId ? " me" : "");
      const nm = document.createElement("span");
      nm.className = "nm";
      nm.textContent = `${i + 1}. ${p.name}${p.id === myId ? "（你）" : ""}`;
      const sc = document.createElement("span");
      sc.className = "sc";
      sc.textContent = p.score;
      row.append(nm, sc);
      box.appendChild(row);
    }
    $("roundTitle").textContent = board.length && board[0].id === myId ? "码头冠军喵！" : "收工喵！";
    $("roundHint").textContent = `${m.nextIn || 8} 秒后自动开下一局`;
    $("roundBox").classList.remove("hide");
    beep(880, 0.12, "sine", 0.05);
  }

  /* ---------- input ---------- */
  function setTarget(clientX) {
    const r = canvas.getBoundingClientRect();
    targetX = clamp((clientX - r.left) / Math.max(1, r.width), 0.06, 0.94);
    sendMove();
  }
  function sendMove(force) {
    if (!joined || !ws || ws.readyState !== 1) return;
    const now = performance.now();
    if (!force && now - lastMoveSent < 45) return;
    lastMoveSent = now;
    ws.send(JSON.stringify({ type: "move", x: targetX }));
  }

  canvas.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (!joined) return;
    canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
    setTarget(e.clientX);
  }, { passive: false });
  canvas.addEventListener("pointermove", (e) => {
    if (!joined) return;
    setTarget(e.clientX);
    e.preventDefault();
  }, { passive: false });
  window.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") targetX = clamp(targetX - 0.035, 0.06, 0.94);
    else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") targetX = clamp(targetX + 0.035, 0.06, 0.94);
    else return;
    sendMove(true);
  });

  $("joinBtn").addEventListener("click", () => {
    myName = ($("name").value || "").trim().slice(0, 12) || "无名猫";
    saveName();
    wantJoin = true;
    setLobbyMsg("正在进码头喵…");
    sendJoin();
    if (!ws || ws.readyState !== 1) setLobbyMsg("还在连服务器，等一下喵");
  });

  $("skinBtn").addEventListener("click", () => {
    buildSkinGrid($("skinGrid2"), mySkin, pickPanelSkin);
    $("skinPanel").classList.remove("hide");
  });
  $("skinClose").addEventListener("click", () => $("skinPanel").classList.add("hide"));
  $("guideBtn").addEventListener("click", () => $("guide").classList.remove("hide"));
  $("guideClose").addEventListener("click", () => $("guide").classList.add("hide"));

  document.querySelectorAll(".emo").forEach((b) => {
    b.addEventListener("click", () => {
      if (!joined || !ws || ws.readyState !== 1) return;
      ws.send(JSON.stringify({ type: "emote", id: Number(b.dataset.emote) }));
    });
  });

  /* ---------- scene ---------- */
  function resize() {
    const r = canvas.getBoundingClientRect();
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(300, r.width);
    H = Math.max(320, r.height);
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ci.width = canvas.width;
    ci.height = canvas.height;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    stars = Array.from({ length: 92 }, () => ({
      x: Math.random() * W, y: Math.random() * H * 0.72,
      r: rand(0.35, 1.7), p: Math.random() * TAU, s: rand(0.4, 1.8)
    }));
    buildings = [];
    let x = -20;
    while (x < W + 30) {
      const w = rand(24, 52), h = rand(24, 88);
      buildings.push({ x, w, h });
      x += w + rand(3, 9);
    }
    bokeh = Array.from({ length: 14 }, () => ({
      x: Math.random() * W, y: rand(H * 0.35, H * 0.85),
      r: rand(0.8, 2.6), s: rand(4, 12), a: rand(0.12, 0.35), p: Math.random() * TAU
    }));
    meteor = null;
    meteorNext = performance.now() + rand(3500, 8000);
    buildBackground();
    if (!joined) { localX = 0.5; targetX = 0.5; }
  }
  window.addEventListener("resize", resize);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);

  function buildBackground() {
    bgCanvas.width = canvas.width;
    bgCanvas.height = canvas.height;
    bgCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const base = H - 86;

    const g = bgCtx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#070b1c");
    g.addColorStop(0.42, "#101a38");
    g.addColorStop(0.72, "#1a2a4e");
    g.addColorStop(1, "#10162b");
    bgCtx.fillStyle = g;
    bgCtx.fillRect(0, 0, W, H);

    const neb = bgCtx.createRadialGradient(W * 0.28, H * 0.12, 8, W * 0.28, H * 0.12, W * 0.95);
    neb.addColorStop(0, "rgba(96,120,220,.16)");
    neb.addColorStop(0.45, "rgba(120,90,200,.07)");
    neb.addColorStop(1, "rgba(10,16,38,0)");
    bgCtx.fillStyle = neb;
    bgCtx.fillRect(0, 0, W, H * 0.9);

    const mx = W * 0.8, my = H * 0.17, mr = Math.min(40, W * 0.09);
    const halo = bgCtx.createRadialGradient(mx, my, mr * 0.4, mx, my, mr * 4.2);
    halo.addColorStop(0, "rgba(255,240,200,.26)");
    halo.addColorStop(0.4, "rgba(255,220,160,.08)");
    halo.addColorStop(1, "rgba(255,220,160,0)");
    bgCtx.fillStyle = halo;
    bgCtx.beginPath(); bgCtx.arc(mx, my, mr * 4.2, 0, TAU); bgCtx.fill();

    const moon = bgCtx.createRadialGradient(mx - mr * 0.3, my - mr * 0.35, mr * 0.2, mx, my, mr);
    moon.addColorStop(0, "#fffdf2");
    moon.addColorStop(0.55, "#ffe9b8");
    moon.addColorStop(1, "#f2d49a");
    bgCtx.fillStyle = moon;
    bgCtx.beginPath(); bgCtx.arc(mx, my, mr, 0, TAU); bgCtx.fill();
    bgCtx.fillStyle = "rgba(160,130,90,.16)";
    bgCtx.beginPath(); bgCtx.arc(mx - mr * 0.3, my - mr * 0.15, mr * 0.19, 0, TAU); bgCtx.fill();
    bgCtx.beginPath(); bgCtx.arc(mx + mr * 0.25, my + mr * 0.3, mr * 0.12, 0, TAU); bgCtx.fill();

    bgCtx.fillStyle = "rgba(12,20,44,.55)";
    for (const b of buildings) {
      const fh = b.h * rand(0.6, 0.9);
      bgCtx.fillRect(b.x + b.w * 0.15, base - fh, b.w * 0.85, fh + 86);
    }

    for (const b of buildings) {
      bgCtx.fillStyle = "rgba(7,11,24,.94)";
      bgCtx.fillRect(b.x, base - b.h, b.w, b.h + 86);
      bgCtx.fillStyle = "rgba(255,209,102,.16)";
      for (let wy = base - b.h + 8; wy < base - 8; wy += 13) {
        for (let wx = b.x + 6; wx < b.x + b.w - 6; wx += 11) {
          if (((wx * 7 + wy * 13) % 29) < 6) bgCtx.fillRect(wx, wy, 3, 4);
        }
      }
      bgCtx.fillStyle = "rgba(150,190,255,.08)";
      bgCtx.fillRect(b.x, base - b.h, b.w, 1);
    }

    const dg = bgCtx.createLinearGradient(0, H - 86, 0, H);
    dg.addColorStop(0, "#2b2038");
    dg.addColorStop(0.4, "#20172c");
    dg.addColorStop(1, "#120d1c");
    bgCtx.fillStyle = dg;
    bgCtx.fillRect(0, H - 86, W, 86);
    bgCtx.fillStyle = "rgba(255,158,196,.16)";
    bgCtx.fillRect(0, H - 86, W, 1.4);

    const refl = bgCtx.createLinearGradient(mx - 26, H - 86, mx + 26, H);
    refl.addColorStop(0, "rgba(255,230,170,.12)");
    refl.addColorStop(1, "rgba(255,230,170,0)");
    bgCtx.fillStyle = refl;
    bgCtx.beginPath();
    bgCtx.ellipse(mx, H - 54, 42, 12, 0, 0, TAU);
    bgCtx.fill();

    // little plant on the left of the rooftop
    bgCtx.save();
    bgCtx.translate(24, H - 58);
    bgCtx.fillStyle = "rgba(0,0,0,.25)";
    bgCtx.beginPath(); bgCtx.ellipse(0, 16, 18, 5, 0, 0, TAU); bgCtx.fill();
    bgCtx.fillStyle = "#5a3f3a";
    bgCtx.beginPath();
    bgCtx.roundRect ? bgCtx.roundRect(-12, -2, 24, 20, 5) : bgCtx.rect(-12, -2, 24, 20);
    bgCtx.fill();
    bgCtx.strokeStyle = "#7a5b4f"; bgCtx.lineWidth = 2;
    bgCtx.beginPath(); bgCtx.moveTo(-4, -2); bgCtx.quadraticCurveTo(-8, -18, -16, -24); bgCtx.stroke();
    bgCtx.beginPath(); bgCtx.moveTo(3, -2); bgCtx.quadraticCurveTo(8, -20, 16, -25); bgCtx.stroke();
    bgCtx.fillStyle = "rgba(90,170,130,.7)";
    bgCtx.beginPath(); bgCtx.ellipse(-17, -25, 7, 4, -0.7, 0, TAU); bgCtx.fill();
    bgCtx.beginPath(); bgCtx.ellipse(17, -26, 7, 4, 0.7, 0, TAU); bgCtx.fill();
    bgCtx.beginPath(); bgCtx.ellipse(1, -30, 6, 5, 0, 0, TAU); bgCtx.fill();
    bgCtx.restore();

    // warm paper lantern on the right
    bgCtx.save();
    bgCtx.translate(W - 26, H - 70);
    const lg = bgCtx.createRadialGradient(0, 0, 2, 0, 0, 26);
    lg.addColorStop(0, "rgba(255,200,120,.42)");
    lg.addColorStop(1, "rgba(255,180,90,0)");
    bgCtx.fillStyle = lg;
    bgCtx.beginPath(); bgCtx.arc(0, 0, 26, 0, TAU); bgCtx.fill();
    bgCtx.fillStyle = "#ffd9a0";
    bgCtx.beginPath(); bgCtx.ellipse(0, 0, 7, 10, 0, 0, TAU); bgCtx.fill();
    bgCtx.fillStyle = "#3a2a2a";
    bgCtx.fillRect(-4, -12, 8, 2);
    bgCtx.fillRect(-4, 10, 8, 2);
    bgCtx.restore();

    const vig = bgCtx.createRadialGradient(W * 0.5, H * 0.42, Math.min(W, H) * 0.25, W * 0.5, H * 0.5, Math.max(W, H) * 0.78);
    vig.addColorStop(0, "rgba(0,0,0,0)");
    vig.addColorStop(1, "rgba(0,0,0,.42)");
    bgCtx.fillStyle = vig;
    bgCtx.fillRect(0, 0, W, H);
  }

  /* ---------- drawing helpers ---------- */
  function skinColors(id, t) {
    const s = SKIN_DEFS[id] || SKIN_DEFS.pink;
    if (s.rainbow) {
      const h = (t * 48) % 360;
      return {
        body: `hsl(${h}, 82%, 86%)`,
        ear: `hsl(${(h + 60) % 360}, 75%, 70%)`,
        belly: `hsl(${(h + 120) % 360}, 95%, 96%)`,
        bowl: [`hsl(${h}, 80%, 84%)`, `hsl(${(h + 30) % 360}, 65%, 62%)`],
        name: `hsl(${h}, 85%, 78%)`
      };
    }
    return s;
  }

  function fishColor(type) {
    return {
      sardine: "#63d9cf", clown: "#ff9f43", puffer: "#b49aff",
      lightning: "#ffe066", gold: "#ffd166", rainbow: "#ff9ec4",
      bomb: "#ff6b6b", bombFast: "#ff9f43",
      star: "#ffd166", shield: "#63d9cf", ice: "#9fe8ff",
      lantern: "#ffe066", flying: "#7fd8ff", eel: "#b49aff", treasure: "#ffd166",
      ink: "#7b5cff", thief: "#ff9f43", jelly: "#9fe8ff",
      magnet: "#ff6b9a", lucky: "#7dff9a", timestop: "#ffe6a3"
    }[type] || "#63d9cf";
  }
  function drawSky(t) {
    if (bgCanvas.width) ctx.drawImage(bgCanvas, 0, 0, W, H);

    // aurora ribbons
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    const aur = [
      ["96,230,210", 0.13],
      ["160,120,255", 0.10],
      ["255,130,195", 0.07]
    ];
    for (let i = 0; i < aur.length; i++) {
      const y = H * (0.12 + i * 0.055);
      const gr = ctx.createLinearGradient(0, y, W, y + 50);
      gr.addColorStop(0, `rgba(${aur[i][0]},0)`);
      gr.addColorStop(0.45, `rgba(${aur[i][0]},${aur[i][1]})`);
      gr.addColorStop(1, `rgba(${aur[i][0]},0)`);
      ctx.strokeStyle = gr;
      ctx.lineWidth = 30 + i * 14;
      ctx.beginPath();
      ctx.moveTo(-40, y + Math.sin(t * 0.25 + i) * 12);
      ctx.bezierCurveTo(W * 0.25, y - 34 + i * 9, W * 0.58, y + 42 - i * 7, W + 40, y - 8 + Math.cos(t * 0.2 + i) * 12);
      ctx.stroke();
    }
    ctx.restore();

    // drifting soft clouds
    for (let i = 0; i < 3; i++) {
      const cx = ((i * 0.41 * W + t * (5 + i * 2)) % (W + 180)) - 90;
      const cy = H * (0.24 + i * 0.11);
      ctx.fillStyle = `rgba(150,180,230,${0.035 + i * 0.008})`;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 90 + i * 22, 16 + i * 3, 0, 0, TAU);
      ctx.ellipse(cx + 38, cy - 8, 52 + i * 12, 12 + i * 2, 0, 0, TAU);
      ctx.fill();
    }

    // stars
    for (const st of stars) {
      st.p += 0.01;
      const a = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(st.p));
      ctx.fillStyle = `rgba(235,245,255,${a * 0.85})`;
      ctx.beginPath(); ctx.arc(st.x, st.y, st.r, 0, TAU); ctx.fill();
      if (st.r > 1.45) {
        ctx.strokeStyle = `rgba(220,240,255,${a * 0.28})`;
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(st.x - st.r * 3, st.y); ctx.lineTo(st.x + st.r * 3, st.y);
        ctx.moveTo(st.x, st.y - st.r * 3); ctx.lineTo(st.x, st.y + st.r * 3);
        ctx.stroke();
      }
    }

    // floating dust / bokeh
    for (const b of bokeh) {
      const bx = b.x + Math.sin(t * 0.35 + b.p) * 9;
      const by = b.y + Math.cos(t * 0.22 + b.p) * 7;
      const g = ctx.createRadialGradient(bx, by, 0, bx, by, b.r * 4);
      g.addColorStop(0, `rgba(255,235,190,${b.a})`);
      g.addColorStop(1, "rgba(255,235,190,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(bx, by, b.r * 4, 0, TAU); ctx.fill();
    }

    // rare shooting star
    const now = performance.now();
    if (!meteor && now > meteorNext) {
      meteor = {
        start: now, x: rand(W * 0.08, W * 0.7), y: rand(H * 0.06, H * 0.28),
        vx: rand(130, 230), vy: rand(45, 85), life: rand(0.55, 0.95)
      };
      meteorNext = now + rand(5000, 11000);
    }
    if (meteor) {
      const age = (now - meteor.start) / 1000;
      if (age > meteor.life) {
        meteor = null;
      } else {
        const x = meteor.x + meteor.vx * age;
        const y = meteor.y + meteor.vy * age;
        const a = Math.sin(Math.PI * Math.min(1, age / meteor.life));
        const grad = ctx.createLinearGradient(x, y, x - meteor.vx * 0.12, y - meteor.vy * 0.12);
        grad.addColorStop(0, `rgba(255,250,230,${a})`);
        grad.addColorStop(1, "rgba(255,250,230,0)");
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - meteor.vx * 0.12, y - meteor.vy * 0.12);
        ctx.stroke();
      }
    }
  }

  const FISH_INTENT = {
    bomb:     { icon: "!",  color: "#ff6b6b", cat: "bomb" },
    bombFast: { icon: "!!", color: "#ff9f43", cat: "bomb" },
    star:     { icon: "星", color: "#ffd166", cat: "power" },
    shield:   { icon: "盾", color: "#63d9cf", cat: "power" },
    ice:      { icon: "冰", color: "#9fe8ff", cat: "power" },
    ink:      { icon: "墨", color: "#9b7cff", cat: "grief" },
    thief:    { icon: "偷", color: "#ffb066", cat: "grief" },
    jelly:    { icon: "电", color: "#9fe8ff", cat: "grief" },
    magnet:   { icon: "磁", color: "#ff6b9a", cat: "power" },
    lucky:    { icon: "运", color: "#7dff9a", cat: "power" },
    timestop: { icon: "停", color: "#ffe6a3", cat: "power" },
    treasure: { icon: "宝", color: "#ffd166", cat: "treasure" }
  };

  function drawFish(f, t) {
    drawFishBody(f, t);
    drawFishIntent(f, t);
  }

  function drawFishIntent(f, t) {
    const meta = FISH_INTENT[f.t];
    if (!meta) return;
    const def = FISH_DEFS[f.t] || { size: 0.02 };
    const r = Math.max(9, Math.min(26, def.size * Math.min(W, H) * 2.2));
    const x = f.rx * W, y = f.ry * H;
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = 0.62;
    ctx.strokeStyle = meta.color;
    ctx.lineWidth = 1.7;
    if (meta.cat === "grief") ctx.setLineDash([4, 4]);
    if (meta.cat === "bomb") {
      const pulse = 2 + Math.sin(t * 7 + f.id) * 1.5;
      ctx.globalAlpha = 0.45 + 0.2 * (0.5 + 0.5 * Math.sin(t * 7 + f.id));
      ctx.beginPath(); ctx.arc(0, 0, r + 6 + pulse, 0, TAU); ctx.stroke();
    } else if (meta.cat === "treasure") {
      ctx.beginPath(); ctx.arc(0, 0, r + 6, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 0.28;
      ctx.beginPath(); ctx.arc(0, 0, r + 12, 0, TAU); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(0, 0, r + 6, 0, TAU); ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    ctx.font = "800 9px -apple-system, 'PingFang SC', 'Noto Sans CJK SC', sans-serif";
    const tw = ctx.measureText(meta.icon).width;
    const bw = Math.max(18, tw + 10), bh = 16;
    const bx = -bw / 2, by = -r - 23;
    ctx.fillStyle = "rgba(8,12,26,.86)";
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, by, bw, bh, 8);
    else ctx.rect(bx, by, bw, bh);
    ctx.fill();
    ctx.strokeStyle = meta.color;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.fillStyle = meta.color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(meta.icon, 0, by + bh / 2 + 0.5);
    ctx.restore();
  }

  function drawFishBody(f, t) {
    const def = FISH_DEFS[f.t] || { size: 0.02 };
    const r = Math.max(9, Math.min(26, def.size * Math.min(W, H) * 2.2));
    const x = f.rx * W, y = f.ry * H;
    const col = fishColor(f.t);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.sin(t * 1.8 + f.id) * 0.18);

    if (f.t === "gold") {
      ctx.shadowColor = "rgba(255,209,102,.9)";
      ctx.shadowBlur = 18;
    } else if (f.t === "rainbow") {
      ctx.shadowColor = "rgba(255,158,196,.8)";
      ctx.shadowBlur = 14;
    }

    if (f.t === "bomb" || f.t === "bombFast") {
      const fast = f.t === "bombFast";
      if (fast) {
        ctx.shadowColor = "rgba(255,120,80,.85)";
        ctx.shadowBlur = 16;
        ctx.strokeStyle = "rgba(255,160,90,.55)";
        ctx.lineWidth = 2;
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.moveTo(-r - 8 - i * 6, -r * 0.45 + i * 6);
          ctx.lineTo(-r - 2 - i * 6, -r * 0.45 + i * 6);
          ctx.stroke();
        }
      }
      ctx.fillStyle = fast ? "#3a2230" : "#2b2f45";
      ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
      ctx.strokeStyle = fast ? "rgba(255,140,90,.8)" : "rgba(255,255,255,.18)";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(-4, -4, r * 0.5, 0, TAU); ctx.stroke();
      ctx.strokeStyle = "#c9a36b"; ctx.lineWidth = 3; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(3, -r + 2); ctx.quadraticCurveTo(12, -r - 8, 7, -r - 15); ctx.stroke();
      ctx.fillStyle = fast ? "#ff8a5c" : "#ffb347";
      ctx.beginPath(); ctx.arc(7, -r - 16, 4 + Math.sin(t * 18) * 1.2, 0, TAU); ctx.fill();
      ctx.fillStyle = "#ff6b6b";
      ctx.beginPath(); ctx.arc(7, -r - 16, 2, 0, TAU); ctx.fill();
      ctx.restore();
      return;
    }

    if (f.t === "star") {
      ctx.shadowColor = "rgba(255,209,102,.95)";
      ctx.shadowBlur = 20;
      ctx.rotate(t * 1.4 + f.id);
      ctx.fillStyle = "#ffd166";
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + i * Math.PI / 5;
        const rr = i % 2 === 0 ? r * 1.18 : r * 0.52;
        if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
        else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,.9)";
      ctx.beginPath(); ctx.arc(-r * 0.15, -r * 0.15, r * 0.16, 0, TAU); ctx.fill();
      ctx.restore();
      return;
    }

    if (f.t === "shield") {
      ctx.shadowColor = "rgba(99,217,207,.8)";
      ctx.shadowBlur = 16;
      const g = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.2, 0, 0, r * 1.15);
      g.addColorStop(0, "rgba(235,255,252,.9)");
      g.addColorStop(0.55, "rgba(99,217,207,.55)");
      g.addColorStop(1, "rgba(60,160,170,.18)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, r * 1.12, 0, TAU); ctx.fill();
      ctx.strokeStyle = "rgba(220,255,252,.85)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, r * 1.12, 0, TAU); ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,.65)"; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(-r * 0.25, -r * 0.25, r * 0.55, 3.4, 4.6); ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,.8)";
      ctx.beginPath(); ctx.arc(-r * 0.35, -r * 0.4, r * 0.14, 0, TAU); ctx.fill();
      ctx.restore();
      return;
    }

    if (f.t === "ice") {
      ctx.shadowColor = "rgba(159,232,255,.95)";
      ctx.shadowBlur = 18;
      ctx.strokeStyle = "#bff4ff"; ctx.lineWidth = Math.max(2, r * 0.18); ctx.lineCap = "round";
      for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a) * r * 1.1, Math.sin(a) * r * 1.1);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55);
        ctx.lineTo(Math.cos(a + 0.5) * r * 0.85, Math.sin(a + 0.5) * r * 0.85);
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(159,232,255,.28)";
      ctx.beginPath(); ctx.arc(0, 0, r * 0.38, 0, TAU); ctx.fill();
      ctx.restore();
      return;
    }

    if (f.t === "lantern") {
      ctx.shadowColor = "rgba(255,220,120,.9)";
      ctx.shadowBlur = 16;
      ctx.fillStyle = "#2f5d7c";
      ctx.beginPath(); ctx.ellipse(0, 0, r * 1.2, r * 0.82, 0, 0, TAU); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(r * 1.02, 0); ctx.lineTo(r * 1.85, -r * 0.65); ctx.lineTo(r * 1.85, r * 0.65);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "rgba(200,240,255,.7)"; ctx.lineWidth = 2; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(0, -r * 0.65); ctx.quadraticCurveTo(r * 0.55, -r * 1.25, r * 0.72, -r * 1.55); ctx.stroke();
      const lg = ctx.createRadialGradient(r * 0.72, -r * 1.6, 1, r * 0.72, -r * 1.6, r * 0.55);
      lg.addColorStop(0, "rgba(255,255,220,.95)");
      lg.addColorStop(1, "rgba(255,220,100,0)");
      ctx.fillStyle = lg;
      ctx.beginPath(); ctx.arc(r * 0.72, -r * 1.6, r * 0.55, 0, TAU); ctx.fill();
      ctx.fillStyle = "#ffe066";
      ctx.beginPath(); ctx.arc(r * 0.72, -r * 1.6, r * 0.2, 0, TAU); ctx.fill();
      ctx.fillStyle = "#16203a";
      ctx.beginPath(); ctx.arc(-r * 0.55, -r * 0.15, r * 0.15, 0, TAU); ctx.fill();
      ctx.restore();
      return;
    }

    if (f.t === "flying") {
      ctx.fillStyle = "#7fd8ff";
      ctx.beginPath(); ctx.ellipse(0, 0, r * 1.15, r * 0.7, 0, 0, TAU); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-r * 0.15, -r * 0.2); ctx.lineTo(-r * 1.55, -r * 1.15); ctx.lineTo(-r * 0.95, r * 0.1);
      ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-r * 0.15, r * 0.2); ctx.lineTo(-r * 1.45, r * 0.95); ctx.lineTo(-r * 0.85, -r * 0.05);
      ctx.closePath(); ctx.globalAlpha = 0.75; ctx.fill(); ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.moveTo(r * 1.0, 0); ctx.lineTo(r * 1.8, -r * 0.55); ctx.lineTo(r * 1.8, r * 0.55);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#16203a";
      ctx.beginPath(); ctx.arc(-r * 0.45, -r * 0.12, r * 0.15, 0, TAU); ctx.fill();
      ctx.strokeStyle = "rgba(200,245,255,.75)"; ctx.lineWidth = 2; ctx.lineCap = "round";
      for (let i = 0; i < 2; i++) {
        ctx.beginPath(); ctx.moveTo(-r * 1.0 - i * 8, -r * 0.35 + i * 8); ctx.lineTo(-r * 1.35 - i * 8, -r * 0.35 + i * 8); ctx.stroke();
      }
      ctx.restore();
      return;
    }

    if (f.t === "eel") {
      ctx.shadowColor = "rgba(180,154,255,.85)";
      ctx.shadowBlur = 14;
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = i === 3 ? "#d9ccff" : "#b49aff";
        ctx.beginPath();
        ctx.ellipse(-r * 0.95 + i * r * 0.58, Math.sin(t * 5 + i * 1.3) * r * 0.34, r * 0.55, r * 0.3, 0, 0, TAU);
        ctx.fill();
      }
      ctx.fillStyle = "#3a2440";
      ctx.beginPath(); ctx.arc(r * 0.85, Math.sin(t * 5 + 3.9) * r * 0.34 - r * 0.08, r * 0.12, 0, TAU); ctx.fill();
      ctx.strokeStyle = "rgba(255,255,180,.9)"; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(r * 1.0, -r * 0.75); ctx.lineTo(r * 1.2, -r * 0.4); ctx.lineTo(r * 1.05, -r * 0.3); ctx.stroke();
      ctx.restore();
      return;
    }

    if (f.t === "treasure") {
      ctx.shadowColor = "rgba(255,209,102,.95)";
      ctx.shadowBlur = 22;
      ctx.fillStyle = "#8a5a2b";
      if (ctx.roundRect) {
        ctx.beginPath(); ctx.roundRect(-r * 1.15, -r * 0.55, r * 2.3, r * 1.15, 4); ctx.fill();
      } else {
        ctx.fillRect(-r * 1.15, -r * 0.55, r * 2.3, r * 1.15);
      }
      ctx.fillStyle = "#b9793a";
      ctx.beginPath(); ctx.arc(0, -r * 0.5, r * 1.05, Math.PI, TAU); ctx.fill();
      ctx.strokeStyle = "#ffd166"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-r * 0.45, -r * 0.55); ctx.lineTo(-r * 0.45, r * 0.6); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(r * 0.45, -r * 0.55); ctx.lineTo(r * 0.45, r * 0.6); ctx.stroke();
      ctx.fillStyle = "#ffd166";
      ctx.beginPath(); ctx.arc(0, r * 0.05, r * 0.2, 0, TAU); ctx.fill();
      ctx.fillStyle = "#5a3518";
      ctx.beginPath(); ctx.arc(0, r * 0.05, r * 0.09, 0, TAU); ctx.fill();
      ctx.fillStyle = "rgba(255,255,210,.95)";
      for (let i = 0; i < 3; i++) {
        const a = t * 2 + i * 2.1;
        ctx.beginPath(); ctx.arc(Math.cos(a) * r * 1.4, Math.sin(a) * r * 0.7, 1.6, 0, TAU); ctx.fill();
      }
      ctx.restore();
      return;
    }

    if (f.t === "ink") {
      ctx.shadowColor = "rgba(120,90,255,.8)";
      ctx.shadowBlur = 16;
      ctx.fillStyle = "#4a2a6a";
      ctx.beginPath(); ctx.ellipse(0, -r * 0.1, r * 0.88, r * 0.75, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = "#6b3f96";
      ctx.beginPath(); ctx.moveTo(-r * 0.55, r * 0.35); ctx.quadraticCurveTo(-r * 1.1, r * 1.0, -r * 0.65, r * 1.25); ctx.quadraticCurveTo(-r * 0.3, r * 0.8, -r * 0.2, r * 0.45); ctx.fill();
      ctx.beginPath(); ctx.moveTo(0, r * 0.45); ctx.quadraticCurveTo(0, r * 1.15, r * 0.35, r * 1.35); ctx.quadraticCurveTo(r * 0.5, r * 0.8, r * 0.3, r * 0.45); ctx.fill();
      ctx.beginPath(); ctx.moveTo(r * 0.5, r * 0.3); ctx.quadraticCurveTo(r * 1.05, r * 0.9, r * 0.9, r * 1.2); ctx.quadraticCurveTo(r * 0.6, r * 0.75, r * 0.35, r * 0.4); ctx.fill();
      ctx.fillStyle = "#f6f3ff";
      ctx.beginPath(); ctx.arc(-r * 0.25, -r * 0.18, r * 0.16, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(r * 0.25, -r * 0.18, r * 0.16, 0, TAU); ctx.fill();
      ctx.fillStyle = "#1a1028";
      ctx.beginPath(); ctx.arc(-r * 0.22, -r * 0.16, r * 0.07, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(r * 0.28, -r * 0.16, r * 0.07, 0, TAU); ctx.fill();
      ctx.restore();
      return;
    }

    if (f.t === "thief") {
      ctx.shadowColor = "rgba(255,190,90,.85)";
      ctx.shadowBlur = 14;
      ctx.fillStyle = "#ff9f43";
      ctx.beginPath(); ctx.ellipse(0, 0, r * 0.95, r * 0.72, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = "#e07a25"; ctx.lineWidth = 2.5; ctx.lineCap = "round";
      for (let s = -1; s <= 1; s += 2) {
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.moveTo(s * r * 0.55, r * 0.25 + i * r * 0.15);
          ctx.lineTo(s * r * 1.15, r * 0.55 + i * r * 0.18);
          ctx.stroke();
        }
      }
      ctx.fillStyle = "#ffb066";
      ctx.beginPath(); ctx.arc(-r * 0.95, -r * 0.35, r * 0.28, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(r * 0.95, -r * 0.35, r * 0.28, 0, TAU); ctx.fill();
      ctx.fillStyle = "#ffd166";
      ctx.beginPath(); ctx.arc(0, r * 0.05, r * 0.3, 0, TAU); ctx.fill();
      ctx.fillStyle = "#b9793a";
      ctx.font = `900 ${Math.max(8, r * 0.55)}px -apple-system, sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("¥", 0, r * 0.08);
      ctx.fillStyle = "#3a2440";
      ctx.beginPath(); ctx.arc(-r * 0.3, -r * 0.3, r * 0.12, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(r * 0.3, -r * 0.3, r * 0.12, 0, TAU); ctx.fill();
      ctx.restore();
      return;
    }

    if (f.t === "jelly") {
      ctx.shadowColor = "rgba(159,232,255,.95)";
      ctx.shadowBlur = 20;
      const jg = ctx.createRadialGradient(-r * 0.2, -r * 0.5, 1, 0, -r * 0.2, r * 1.25);
      jg.addColorStop(0, "rgba(240,255,255,.9)");
      jg.addColorStop(0.6, "rgba(159,232,255,.55)");
      jg.addColorStop(1, "rgba(120,200,255,.15)");
      ctx.fillStyle = jg;
      ctx.beginPath(); ctx.arc(0, -r * 0.2, r * 0.95, Math.PI, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(0, -r * 0.2, r * 0.95, r * 0.28, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = "rgba(220,250,255,.8)"; ctx.lineWidth = 1.6;
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(i * r * 0.28, r * 0.05);
        ctx.quadraticCurveTo(i * r * 0.28 + Math.sin(t * 4 + i) * r * 0.2, r * 0.55, i * r * 0.22, r * 0.95);
        ctx.stroke();
      }
      ctx.strokeStyle = "rgba(255,240,120,.85)"; ctx.lineWidth = 1.8;
      for (let i = 0; i < 2; i++) {
        const a = t * 5 + i * 3;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r * 0.9, -r * 0.2 + Math.sin(a) * r * 0.7);
        ctx.lineTo(Math.cos(a + 0.4) * r * 1.15, -r * 0.2 + Math.sin(a + 0.4) * r * 0.9);
        ctx.stroke();
      }
      ctx.restore();
      return;
    }

    if (f.t === "magnet") {
      ctx.shadowColor = "rgba(255,107,154,.85)";
      ctx.shadowBlur = 16;
      ctx.rotate(-0.15);
      ctx.strokeStyle = "#ff6b9a";
      ctx.lineWidth = Math.max(4, r * 0.52);
      ctx.lineCap = "round";
      ctx.beginPath(); ctx.arc(0, -r * 0.08, r * 0.62, Math.PI * 0.05, Math.PI * 0.95); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-r * 0.6, -r * 0.08); ctx.lineTo(-r * 0.6, r * 0.62); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(r * 0.6, -r * 0.08); ctx.lineTo(r * 0.6, r * 0.62); ctx.stroke();
      ctx.strokeStyle = "#d9e6ff"; ctx.lineWidth = Math.max(3, r * 0.3);
      ctx.beginPath(); ctx.moveTo(-r * 0.6, r * 0.52); ctx.lineTo(-r * 0.6, r * 0.78); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(r * 0.6, r * 0.52); ctx.lineTo(r * 0.6, r * 0.78); ctx.stroke();
      ctx.strokeStyle = "rgba(255,220,235,.8)"; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(-r * 0.2, -r * 0.72); ctx.lineTo(r * 0.18, -r * 1.0); ctx.stroke();
      ctx.restore();
      return;
    }

    if (f.t === "lucky") {
      ctx.shadowColor = "rgba(125,255,154,.9)";
      ctx.shadowBlur = 18;
      ctx.fillStyle = "#7dff9a";
      for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        ctx.beginPath();
        ctx.arc(dx * r * 0.38, dy * r * 0.38, r * 0.38, 0, TAU);
        ctx.fill();
      }
      ctx.fillStyle = "#ffe066";
      ctx.beginPath(); ctx.arc(0, 0, r * 0.18, 0, TAU); ctx.fill();
      ctx.strokeStyle = "#3f9a57"; ctx.lineWidth = 2; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(0, r * 0.55); ctx.quadraticCurveTo(r * 0.25, r * 0.95, -r * 0.1, r * 1.15); ctx.stroke();
      ctx.fillStyle = "rgba(255,255,220,.95)";
      for (let i = 0; i < 3; i++) {
        const a = t * 2 + i * 2.1;
        ctx.beginPath(); ctx.arc(Math.cos(a) * r * 1.35, Math.sin(a) * r * 1.05, 1.5, 0, TAU); ctx.fill();
      }
      ctx.restore();
      return;
    }

    if (f.t === "timestop") {
      ctx.shadowColor = "rgba(255,230,163,.95)";
      ctx.shadowBlur = 24;
      ctx.fillStyle = "rgba(18,14,34,.92)";
      ctx.beginPath(); ctx.arc(0, 0, r * 1.12, 0, TAU); ctx.fill();
      ctx.strokeStyle = "#ffe6a3"; ctx.lineWidth = Math.max(2.4, r * 0.14);
      ctx.beginPath(); ctx.arc(0, 0, r * 1.1, 0, TAU); ctx.stroke();
      ctx.strokeStyle = "rgba(255,230,163,.55)"; ctx.lineWidth = 1.2;
      for (let i = 0; i < 12; i++) {
        const a = i * Math.PI / 6;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r * 0.82, Math.sin(a) * r * 0.82);
        ctx.lineTo(Math.cos(a) * r * 0.97, Math.sin(a) * r * 0.97);
        ctx.stroke();
      }
      ctx.strokeStyle = "#fff4c8"; ctx.lineWidth = 2.2; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -r * 0.62); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(r * 0.48, r * 0.12); ctx.stroke();
      ctx.fillStyle = "#ffe6a3";
      ctx.beginPath(); ctx.arc(0, 0, r * 0.12, 0, TAU); ctx.fill();
      ctx.restore();
      return;
    }

    let body = col, belly = "#ffffff";
    if (f.t === "rainbow") body = `hsl(${(t * 90 + f.id * 40) % 360}, 85%, 72%)`;
    if (f.t === "sardine") belly = "#b8fff4";
    if (f.t === "clown") belly = "#ffe0b2";
    if (f.t === "puffer") belly = "#e6dcff";
    if (f.t === "lightning") belly = "#fff8c0";
    if (f.t === "gold") belly = "#fff0b8";

    if (f.t === "puffer") {
      ctx.fillStyle = body;
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * TAU;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9);
        ctx.lineTo(Math.cos(a + 0.18) * r * 1.25, Math.sin(a + 0.18) * r * 1.25);
        ctx.lineTo(Math.cos(a + 0.36) * r * 0.9, Math.sin(a + 0.36) * r * 0.9);
        ctx.closePath(); ctx.fill();
      }
      ctx.beginPath(); ctx.arc(0, 0, r * 0.95, 0, TAU); ctx.fill();
    } else {
      ctx.fillStyle = body;
      ctx.beginPath(); ctx.ellipse(0, 0, r * 1.25, r * 0.82, 0, 0, TAU); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(r * 1.05, 0); ctx.lineTo(r * 1.9, -r * 0.7); ctx.lineTo(r * 1.9, r * 0.7);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = belly;
      ctx.beginPath(); ctx.ellipse(-2, r * 0.22, r * 0.78, r * 0.38, 0, 0, TAU); ctx.fill();
    }

    if (f.t === "clown") {
      ctx.strokeStyle = "rgba(255,255,255,.85)"; ctx.lineWidth = r * 0.22;
      ctx.beginPath(); ctx.arc(0, 0, r * 0.82, -1.2, 1.2); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, r * 0.82, 1.9, 4.3); ctx.stroke();
    }
    if (f.t === "lightning") {
      ctx.strokeStyle = "rgba(255,255,255,.9)"; ctx.lineWidth = 2.2; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(-r * 0.5, -r * 0.4); ctx.lineTo(0, 0); ctx.lineTo(-r * 0.3, r * 0.15); ctx.lineTo(r * 0.4, r * 0.55); ctx.stroke();
    }

    ctx.fillStyle = "#16203a";
    ctx.beginPath(); ctx.arc(-r * 0.5, -r * 0.18, Math.max(1.6, r * 0.16), 0, TAU); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,.9)";
    ctx.beginPath(); ctx.arc(-r * 0.54, -r * 0.23, Math.max(0.6, r * 0.055), 0, TAU); ctx.fill();
    ctx.restore();
  }

  function drawCat(p, t, isMe) {
    if (!p) return;
    const x = (isMe ? localX : p.rx) * W;
    const y = H - 56;
    const skin = skinColors(p.skin, t);
    const bob = Math.sin(t * 3.2 + (p.id.charCodeAt(0) || 0)) * 2;
    const seed = p.id ? p.id.charCodeAt(0) : 0;
    const sway = Math.sin(t * 2.45 + seed) * 7;
    const twitch = Math.sin(t * 3.1 + seed) > 0.955 ? 2.4 : 0;
    const look = clamp(((isMe ? targetX : p.tx) - (isMe ? localX : p.rx)) * 90, -1.8, 1.8);
    ctx.save();
    ctx.translate(x, y + bob);
    if (p.dead) ctx.globalAlpha = 0.35;

    ctx.fillStyle = "rgba(0,0,0,.28)";
    ctx.beginPath(); ctx.ellipse(0, 22, 44, 8, 0, 0, TAU); ctx.fill();

    ctx.strokeStyle = skin.ear; ctx.lineWidth = 7; ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-32, 6);
    ctx.quadraticCurveTo(-62 + sway * 0.35, 2, -54 + sway, -22);
    ctx.quadraticCurveTo(-50 + sway * 0.55, -34, -40 + sway * 0.25, -28);
    ctx.stroke();

    const g = ctx.createLinearGradient(0, -28, 0, 26);
    g.addColorStop(0, skin.body);
    g.addColorStop(1, skin.bowl[1]);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(-46, -6); ctx.quadraticCurveTo(-43, 25, 0, 27); ctx.quadraticCurveTo(43, 25, 46, -6); ctx.quadraticCurveTo(0, 4, -46, -6); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = skin.belly; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(0, -6, 46, 8, 0, 0, TAU); ctx.stroke();

    // ears (behind the head)
    ctx.fillStyle = skin.body;
    ctx.strokeStyle = "rgba(60,35,50,.16)";
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(-27, -43); ctx.lineTo(-35, -70 + twitch); ctx.lineTo(-8, -53); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(27, -43); ctx.lineTo(35, -70 + twitch); ctx.lineTo(8, -53); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = skin.ear;
    ctx.beginPath(); ctx.moveTo(-24, -46); ctx.lineTo(-29, -61 + twitch * 0.7); ctx.lineTo(-14, -51); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(24, -46); ctx.lineTo(29, -61 + twitch * 0.7); ctx.lineTo(14, -51); ctx.closePath(); ctx.fill();

    // head with a soft top-left highlight
    const hg = ctx.createRadialGradient(-11, -38, 4, 0, -23, 34);
    hg.addColorStop(0, skin.belly);
    hg.addColorStop(0.55, skin.body);
    hg.addColorStop(1, skin.bowl[0]);
    ctx.fillStyle = hg;
    ctx.beginPath(); ctx.arc(0, -23, 30, 0, TAU); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.35)";
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(0, -23, 29.5, 0, TAU); ctx.stroke();

    // faint forehead stripes
    ctx.strokeStyle = "rgba(120,70,90,.16)";
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    [-9, 0, 9].forEach((dx, i) => {
      ctx.beginPath();
      ctx.moveTo(dx * 0.55, -49 + Math.abs(dx) * 0.12);
      ctx.lineTo(dx * 0.85, -40 + (i === 1 ? -2 : 0));
      ctx.stroke();
    });

    // eyes: blink / dizzy when dead
    const blink = Math.sin(t * 2.15 + seed) > 0.968;
    if (p.dead) {
      ctx.strokeStyle = "#3a2440";
      ctx.lineWidth = 2;
      [-12, 12].forEach((ex) => {
        ctx.beginPath(); ctx.moveTo(ex - 4, -29); ctx.lineTo(ex + 4, -21); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(ex + 4, -29); ctx.lineTo(ex - 4, -21); ctx.stroke();
      });
    } else if (blink) {
      ctx.strokeStyle = "#3a2440";
      ctx.lineWidth = 2;
      [-12, 12].forEach((ex) => {
        ctx.beginPath(); ctx.arc(ex + look * 0.5, -25, 5.2, 0.18, Math.PI - 0.18); ctx.stroke();
      });
    } else {
      const exL = -12 + look * 0.55;
      const exR = 12 + look * 0.55;
      ctx.fillStyle = "#2b1c2e";
      ctx.beginPath(); ctx.ellipse(exL, -25, 4.6, 5.2, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(exR, -25, 4.6, 5.2, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,.95)";
      ctx.beginPath(); ctx.arc(exL - 1.6, -27, 1.55, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(exR - 1.6, -27, 1.55, 0, TAU); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,.55)";
      ctx.beginPath(); ctx.arc(exL + 1.6, -23.6, 0.75, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(exR + 1.6, -23.6, 0.75, 0, TAU); ctx.fill();
      ctx.strokeStyle = "rgba(80,45,65,.25)";
      ctx.lineWidth = 1.1;
      ctx.beginPath(); ctx.arc(exL, -27.5, 5.4, Math.PI + 0.35, TAU - 0.35); ctx.stroke();
      ctx.beginPath(); ctx.arc(exR, -27.5, 5.4, Math.PI + 0.35, TAU - 0.35); ctx.stroke();
    }

    // muzzle + blush
    ctx.fillStyle = "rgba(255,255,255,.42)";
    ctx.beginPath(); ctx.ellipse(-6.8, -14.5, 6.4, 4.6, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(6.8, -14.5, 6.4, 4.6, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = "rgba(255,132,166,.26)";
    ctx.beginPath(); ctx.ellipse(-19, -17, 4.2, 2.5, -0.15, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(19, -17, 4.2, 2.5, 0.15, 0, TAU); ctx.fill();

    // nose + little "w" mouth
    ctx.fillStyle = "#e86f9d";
    ctx.beginPath();
    ctx.moveTo(0, -17);
    ctx.quadraticCurveTo(-4, -15.2, 0, -13.4);
    ctx.quadraticCurveTo(4, -15.2, 0, -17);
    ctx.fill();
    ctx.strokeStyle = "#c95f88";
    ctx.lineWidth = 1.5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(0, -13.4);
    ctx.quadraticCurveTo(-3.2, -9.6, -6.8, -11.9);
    ctx.moveTo(0, -13.4);
    ctx.quadraticCurveTo(3.2, -9.6, 6.8, -11.9);
    ctx.stroke();

    // whisker dots + whiskers
    ctx.fillStyle = "rgba(100,55,80,.38)";
    [-1, 1].forEach((s) => {
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(s * (11 + i * 1.4), -16 + i * 1.6, 0.75, 0, TAU);
        ctx.fill();
      }
    });
    ctx.strokeStyle = "rgba(90,50,70,.30)";
    ctx.lineWidth = 1.05;
    [-1, 1].forEach((s) => {
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(s * 16, -19 + i * 4);
        ctx.lineTo(s * 33, -23 + i * 5);
        ctx.stroke();
      }
    });

    // cheek fluff + rim light
    ctx.fillStyle = skin.body;
    ctx.beginPath(); ctx.moveTo(-29, -21); ctx.lineTo(-36, -16.5); ctx.lineTo(-29, -12); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(29, -21); ctx.lineTo(36, -16.5); ctx.lineTo(29, -12); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.22)";
    ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.arc(0, -23, 25.5, -2.75, -1.55); ctx.stroke();

    // collar + bell
    ctx.strokeStyle = skin.ear;
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(-22, -2); ctx.quadraticCurveTo(0, 5, 22, -2); ctx.stroke();
    ctx.fillStyle = "#ffd166";
    ctx.beginPath(); ctx.arc(0, 2.5, 3.6, 0, TAU); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,.75)";
    ctx.beginPath(); ctx.arc(-1.2, 1.2, 1.1, 0, TAU); ctx.fill();
    ctx.strokeStyle = "rgba(120,80,20,.4)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(0, 2.5, 3.6, 0, TAU); ctx.stroke();

    // paws on the bowl rim
    ctx.fillStyle = skin.belly;
    ctx.beginPath(); ctx.ellipse(-28, -4, 7, 5, -0.2, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(28, -4, 7, 5, 0.2, 0, TAU); ctx.fill();

    // shield bubble
    if (p.shield) {
      const sg = ctx.createRadialGradient(-14, -34, 5, 0, -18, 55);
      sg.addColorStop(0, "rgba(235,255,252,.22)");
      sg.addColorStop(0.7, "rgba(120,220,255,.10)");
      sg.addColorStop(1, "rgba(120,220,255,.02)");
      ctx.fillStyle = sg;
      ctx.beginPath(); ctx.arc(0, -16, 54, 0, TAU); ctx.fill();
      ctx.strokeStyle = "rgba(150,235,255,.65)";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, -16, 54, 0, TAU); ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,.55)";
      ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.arc(0, -16, 45, 3.7, 4.6); ctx.stroke();
    }

    // stun sparks
    if (p.stunIn > 0) {
      ctx.strokeStyle = "rgba(255,238,120,.9)";
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      for (let i = 0; i < 3; i++) {
        const a = t * 9 + i * 2.1;
        const sx = Math.cos(a) * 50, sy = -18 + Math.sin(a) * 36;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + Math.cos(a + 0.5) * 10, sy + Math.sin(a + 0.5) * 10);
        ctx.lineTo(sx + Math.cos(a + 0.2) * 18, sy + Math.sin(a + 0.2) * 18);
        ctx.stroke();
      }
      ctx.strokeStyle = "rgba(120,220,255,.35)";
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, -16, 48, 0, TAU); ctx.stroke();
    }

    if (isMe) {
      ctx.strokeStyle = "rgba(255,255,255,.55)"; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.ellipse(0, 20, 47, 10, 0, 0, TAU); ctx.stroke();
    }
    ctx.restore();

    // name tag
    const name = p.name + (isMe ? "（你）" : "");
    ctx.font = "700 10px -apple-system, 'PingFang SC', sans-serif";
    const tw = ctx.measureText(name).width;
    const nx = x - tw / 2 - 5, ny = y - 88;
    ctx.fillStyle = "rgba(8,12,26,.72)";
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(nx, ny, tw + 10, 15, 7);
    else ctx.rect(nx, ny, tw + 10, 15);
    ctx.fill();
    ctx.fillStyle = skin.name || "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(name, x, ny + 8);

    if (p.emote && p.emoteUntil && Date.now() < p.emoteUntil) {
      ctx.font = "700 11px -apple-system, 'PingFang SC', sans-serif";
      const ew = ctx.measureText(p.emote).width;
      ctx.fillStyle = "rgba(255,255,255,.94)";
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x - ew / 2 - 7, y - 122, ew + 14, 20, 9);
      else ctx.rect(x - ew / 2 - 7, y - 122, ew + 14, 20);
      ctx.fill();
      ctx.fillStyle = "#2a2036";
      ctx.fillText(p.emote, x, y - 111);
    }
  }

  function burst(nx, ny, color, n = 12, power = 160) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, sp = rand(0.25, 1) * power;
      particles.push({
        x: nx * W, y: ny * H,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40,
        life: rand(0.35, 0.8), max: 0.8,
        size: rand(1.5, 4), color
      });
    }
  }

  function ringFx(nx, ny, color, maxR, dur = 0.55, width = 3) {
    fx.push({
      kind: "ring", x: clamp(nx, 0, 1) * W, y: clamp(ny, 0, 1) * H,
      r0: 6, r1: maxR, life: dur, max: dur, color, width
    });
  }
  function textFx(nx, ny, text, color, dur = 0.9, size = 14) {
    fx.push({
      kind: "text", x: nx * W, y: ny * H, vy: -46,
      text, color, life: dur, max: dur, size
    });
  }
  function coinFx(nx0, ny0, nx1, ny1, color = "#ffd166") {
    fx.push({
      kind: "coin", x0: nx0 * W, y0: ny0 * H, x1: nx1 * W, y1: ny1 * H,
      life: 0.75, max: 0.75, color
    });
  }
  function starFx(nx, ny, color, n = 10) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, sp = rand(0.2, 0.9) * 170;
      fx.push({
        kind: "star", x: nx * W, y: ny * H,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 50,
        life: rand(0.45, 0.9), max: 0.9,
        size: rand(2.5, 5.5), rot: Math.random() * TAU, spin: rand(-6, 6), color
      });
    }
  }
  function boltFx(nx, ny, color = "#ffe066") {
    fx.push({ kind: "bolt", x: nx * W, y: ny * H, life: 0.45, max: 0.45, color, seed: Math.random() * 100 });
  }

  function drawStarShape(x, y, r, rot, color, alpha) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5;
      const rr = i % 2 === 0 ? r : r * 0.45;
      const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawFx(dt) {
    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i];
      f.life -= dt;
      if (f.life <= 0) { fx.splice(i, 1); continue; }
      const t = 1 - f.life / f.max;
      if (f.kind === "ring") {
        const p = 1 - Math.pow(1 - t, 2);
        const r = f.r0 + (f.r1 - f.r0) * p;
        ctx.globalAlpha = 1 - t;
        ctx.strokeStyle = f.color;
        ctx.lineWidth = f.width;
        ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, TAU); ctx.stroke();
      } else if (f.kind === "text") {
        f.y += f.vy * dt;
        ctx.globalAlpha = Math.min(1, f.life / f.max * 1.8);
        ctx.font = `900 ${f.size}px -apple-system, 'PingFang SC', sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = f.color;
        ctx.fillText(f.text, f.x, f.y);
      } else if (f.kind === "coin") {
        const e = 1 - Math.pow(1 - t, 3);
        const x = f.x0 + (f.x1 - f.x0) * e;
        const y = f.y0 + (f.y1 - f.y0) * e - Math.sin(Math.PI * t) * 64;
        ctx.globalAlpha = 1 - t * 0.35;
        ctx.fillStyle = f.color;
        ctx.beginPath(); ctx.arc(x, y, 4.5, 0, TAU); ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,.8)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(x, y, 4.5, 0, TAU); ctx.stroke();
      } else if (f.kind === "star") {
        f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 200 * dt; f.rot += f.spin * dt;
        drawStarShape(f.x, f.y, f.size, f.rot, f.color, Math.max(0, f.life / f.max));
      } else if (f.kind === "bolt") {
        ctx.globalAlpha = Math.max(0, f.life / f.max);
        ctx.strokeStyle = f.color;
        ctx.lineWidth = 2.2;
        ctx.lineCap = "round";
        for (let j = 0; j < 2; j++) {
          const x0 = f.x - 26 + j * 52 + Math.sin(f.seed + j) * 8;
          ctx.beginPath();
          ctx.moveTo(x0, f.y - 92);
          ctx.lineTo(x0 + 14, f.y - 58);
          ctx.lineTo(x0 - 8, f.y - 32);
          ctx.lineTo(x0 + 16, f.y);
          ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vy += 260 * dt; p.vx *= 0.985;
      const a = clamp(p.life / p.max, 0, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size * a + 0.6, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawInk(ms, t) {
    const a = Math.min(1, ms / 600) * 0.86;
    const blob = (x, y, r) => {
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.78, 0.2, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(x + r * 0.35, y + r * 0.28, r * 0.55, r * 0.42, -0.3, 0, TAU);
      ctx.fill();
    };
    ctx.fillStyle = `rgba(8,5,18,${a})`;
    for (let i = 0; i < 8; i++) {
      const x = (i * 173 + Math.sin(t * 0.7 + i) * 38 + W * 0.43) % W;
      const y = (i * 111 + Math.cos(t * 0.5 + i) * 30) % H;
      blob(x, y, 26 + (i % 4) * 10);
    }
    ctx.strokeStyle = `rgba(120,90,220,${a * 0.45})`;
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      const x = (i * 241 + 80) % W, y = (i * 167 + 140) % H;
      ctx.beginPath();
      ctx.arc(x, y, 20 + i * 4, 0.3, 2.2);
      ctx.stroke();
    }
  }

  function drawFlyFish(now, t) {
    if (!flyFish.length) return;
    const alive = [];
    for (const f of flyFish) {
      const p = (now - flyStart - f.delay * 1000) / (f.dur * 1000);
      if (p < 0) { alive.push(f); continue; }
      if (p > 1.05) continue;
      alive.push(f);
      const e = 1 - Math.pow(1 - Math.min(1, p), 3);
      const x = f.x + (flyToX - f.x) * e;
      const y = f.y + (0.93 - f.y) * e - Math.sin(Math.PI * Math.min(1, p)) * 0.085;
      const sc = 1 - 0.55 * Math.min(1, p);
      const alpha = p < 0.72 ? 1 : Math.max(0, 1 - (p - 0.72) / 0.33);
      const temp = { t: f.t, rx: x, ry: y, id: f.id };
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(x * W, y * H);
      ctx.scale(sc, sc);
      ctx.translate(-x * W, -y * H);
      drawFishBody(temp, t);
      ctx.restore();
      ctx.globalAlpha = 1;
    }
    flyFish = alive;
  }

  function draw(t, dt) {
    drawSky(t);
    for (const f of fishes.values()) {
      f.rx += (f.x - f.rx) * Math.min(1, dt * 12);
      f.ry += (f.y - f.ry) * Math.min(1, dt * 12);
      drawFish(f, t);
    }
    for (const p of players.values()) {
      if (!p) continue;
      if (p.id !== myId) p.rx += (p.tx - p.rx) * Math.min(1, dt * 10);
      drawCat(p, t, p.id === myId);
    }
    drawFlyFish(performance.now(), t);
    if (slowIn > 0) {
      ctx.fillStyle = "rgba(120,210,255,.055)";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "rgba(200,248,255,.55)";
      for (let i = 0; i < 18; i++) {
        const sx = (i * 97 + t * 28) % W;
        const sy = (i * 53 + t * 74) % H;
        ctx.beginPath(); ctx.arc(sx, sy, 1 + (i % 3) * 0.55, 0, TAU); ctx.fill();
      }
    }
    drawParticles(dt);
    drawFx(dt);
    const me = players.get(myId);
    if (me && me.inkIn > 0) drawInk(me.inkIn, t);
    const nowMs = performance.now();
    drawGL(nowMs);
    syncInvert(nowMs);
  }

  function updateLocal(dt) {
    localX += (targetX - localX) * Math.min(1, dt * 16);
    if (joined) sendMove();
  }

  function frame(now) {
    const dt = Math.min(0.05, Math.max(0.001, (now - lastFrame) / 1000 || 0.016));
    lastFrame = now;
    updateLocal(dt);
    draw(now / 1000, dt);
    requestAnimationFrame(frame);
  }

  document.addEventListener("visibilitychange", () => { lastFrame = performance.now(); });
  window.addEventListener("pagehide", () => { try { if (ws) ws.close(); } catch (e) {} });

  /* ---------- boot ---------- */
  resize();
  initGL();
  updateHud();
  updateBoard();
  connect();
  requestAnimationFrame(frame);
})();
