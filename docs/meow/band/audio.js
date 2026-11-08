/* =========================================================
   猫猫乐队 · 演奏引擎（无伴奏版）
   没有背景音乐：只有玩家打中的音才会响。
   合成曲 = 四声部实时合成；导入曲 = 四条 stem 门控播放。
   ========================================================= */
(function (root) {
  "use strict";

  var AC = root.AudioContext || root.webkitAudioContext;
  var ctx = null, master = null, comp = null, music = null, sfx = null;
  var partGain = [], analysers = [], freqBuf = null, noiseBuf = null;
  var levels = [0, 0, 0, 0];
  var startAt = 0, running = false, muted = false;
  var clickOn = true, beatDur = 0.5, nextBeat = 0, clickTimer = null, beatIndex = 0;
  var stems = null, stemRate = 22050, stemSrc = [], stemGain = [];
  var stemMode = false;

  function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  function init() {
    if (ctx) { if (ctx.state === "suspended") ctx.resume(); return; }
    if (!AC) return;
    ctx = new AC();
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 20;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;

    master = ctx.createGain();
    master.gain.value = 0.85;
    comp.connect(master);
    master.connect(ctx.destination);

    music = ctx.createGain();
    music.gain.value = 0.9;
    music.connect(comp);

    sfx = ctx.createGain();
    sfx.gain.value = 0.55;
    sfx.connect(comp);

    for (var i = 0; i < 4; i++) {
      var g = ctx.createGain();
      g.gain.value = 0.95;
      var a = ctx.createAnalyser();
      a.fftSize = 64;
      a.smoothingTimeConstant = 0.7;
      g.connect(a);
      a.connect(music);
      partGain.push(g);
      analysers.push(a);
    }
    freqBuf = new Uint8Array(32);

    var len = Math.floor(ctx.sampleRate * 1.0);
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var k = 0; k < len; k++) d[k] = Math.random() * 2 - 1;

    if (!clickTimer) clickTimer = setInterval(tick, 25);
  }

  /* ---------------- 音色 ---------------- */
  function drum(kind, t, vel, out) {
    out = out || music;
    if (kind === "kick") {
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(155, t);
      o.frequency.exponentialRampToValueAtTime(44, t + 0.12);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.95 * vel, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      o.connect(g); g.connect(out);
      o.start(t); o.stop(t + 0.24);
      return;
    }
    if (kind === "snare") {
      var s = ctx.createBufferSource(); s.buffer = noiseBuf;
      var f = ctx.createBiquadFilter();
      f.type = "bandpass"; f.frequency.value = 1900; f.Q.value = 0.8;
      var sg = ctx.createGain();
      sg.gain.setValueAtTime(0.5 * vel, t);
      sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
      s.connect(f); f.connect(sg); sg.connect(out);
      s.start(t); s.stop(t + 0.16);
      var body = ctx.createOscillator(), bg = ctx.createGain();
      body.type = "triangle"; body.frequency.value = 190;
      bg.gain.setValueAtTime(0.18 * vel, t);
      bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
      body.connect(bg); bg.connect(out);
      body.start(t); body.stop(t + 0.1);
      return;
    }
    var h = ctx.createBufferSource(); h.buffer = noiseBuf;
    var hf = ctx.createBiquadFilter();
    hf.type = "highpass"; hf.frequency.value = 7200;
    var hg = ctx.createGain();
    hg.gain.setValueAtTime(0.16 * vel, t);
    hg.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    h.connect(hf); hf.connect(hg); hg.connect(out);
    h.start(t); h.stop(t + 0.06);
  }

  function bassNote(midi, t, dur, vel, out) {
    var o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = "sawtooth";
    o.frequency.value = midiToFreq(midi);
    f.type = "lowpass"; f.Q.value = 5;
    f.frequency.setValueAtTime(950, t);
    f.frequency.exponentialRampToValueAtTime(250, t + Math.min(0.5, dur));
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.44 * vel, t + 0.01);
    g.gain.setTargetAtTime(0.24 * vel, t + 0.05, Math.max(0.05, dur * 0.5));
    g.gain.setTargetAtTime(0.0001, t + dur, 0.05);
    o.connect(f); f.connect(g); g.connect(out);
    o.start(t); o.stop(t + dur + 0.3);
  }

  function chordNotes(midis, t, dur, vel, out) {
    for (var i = 0; i < midis.length; i++) {
      var o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      o.type = "triangle";
      o.frequency.value = midiToFreq(midis[i]);
      o.detune.value = (i - 1) * 5;
      f.type = "lowpass"; f.frequency.value = 1500;
      var peak = 0.11 * vel;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(peak, t + Math.min(0.25, dur * 0.3));
      g.gain.setTargetAtTime(0.0001, t + dur, 0.12);
      o.connect(f); f.connect(g); g.connect(out);
      o.start(t); o.stop(t + dur + 0.4);
    }
  }

  function leadNote(midi, t, dur, vel, out) {
    for (var k = 0; k < 2; k++) {
      var o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      o.type = "square";
      o.frequency.value = midiToFreq(midi);
      o.detune.value = k === 0 ? -6 : 6;
      f.type = "lowpass"; f.frequency.value = 2800;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.12 * vel, t + 0.01);
      g.gain.setTargetAtTime(0.06 * vel, t + 0.04, Math.max(0.04, dur * 0.5));
      g.gain.setTargetAtTime(0.0001, t + dur, 0.07);
      o.connect(f); f.connect(g); g.connect(out);
      o.start(t); o.stop(t + dur + 0.25);
    }
  }

  /* ---------------- 一次性音符 ---------------- */
  function play(snd) {
    if (!ctx || muted || !snd) return;
    var t = ctx.currentTime + 0.002;
    var out = partGain[snd.lane == null ? 3 : snd.lane] || music;
    if (snd.k === "kick" || snd.k === "snare" || snd.k === "hat") drum(snd.k, t, snd.vel || 0.9, out);
    else if (snd.k === "bass") bassNote(snd.v, t, Math.min(0.5, snd.dur || 0.2), snd.vel || 0.9, out);
    else if (snd.k === "chord") chordNotes(snd.chord || [snd.v], t, Math.min(1.2, snd.dur || 0.5), snd.vel || 0.7, out);
    else if (snd.k === "arp") leadNote(snd.v, t, 0.18, 0.55, out);
    else leadNote(snd.v, t, Math.min(0.8, snd.dur || 0.3), snd.vel || 0.8, out);
  }

  /* ---------------- 长按：持续发声 ---------------- */
  function hold(snd) {
    if (!ctx || !snd) return { release: function () {} };
    var t = ctx.currentTime + 0.002;
    var out = partGain[snd.lane == null ? 1 : snd.lane] || music;
    var nodes = [], gains = [];
    var dur = Math.max(0.2, snd.dur || 0.5);

    function addOsc(type, midi, level, cutoff) {
      var o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      o.type = type; o.frequency.value = midiToFreq(midi);
      f.type = "lowpass"; f.frequency.value = cutoff;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(level, t + 0.03);
      o.connect(f); f.connect(g); g.connect(out);
      o.start(t);
      nodes.push(o); gains.push(g);
    }

    if (snd.k === "chord") {
      var ch = snd.chord || [snd.v];
      for (var i = 0; i < ch.length; i++) addOsc("triangle", ch[i], 0.075, 1500);
    } else if (snd.k === "bass") {
      addOsc("sawtooth", snd.v, 0.3, 700);
    } else if (snd.k === "lead") {
      addOsc("square", snd.v, 0.1, 2600);
    } else {
      addOsc("triangle", snd.v, 0.14, 2000);
    }

    var released = false;
    function release(atTime) {
      if (released) return;
      released = true;
      var when = atTime || ctx.currentTime;
      for (var k = 0; k < gains.length; k++) {
        try {
          gains[k].gain.cancelScheduledValues(when);
          gains[k].gain.setTargetAtTime(0.0001, when, 0.06);
        } catch (e) {}
        try { nodes[k].stop(when + 0.35); } catch (e) {}
      }
    }

    // 自动收尾兜底
    var safe = setTimeout(function () { release(); }, (dur + 1.2) * 1000);
    return {
      release: function () { clearTimeout(safe); release(); }
    };
  }

  /* ---------------- 节拍器 / 时钟 ---------------- */
  function click(at, strong) {
    if (!clickOn) return;
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = strong ? 1500 : 1000;
    g.gain.setValueAtTime(strong ? 0.12 : 0.06, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
    o.connect(g); g.connect(sfx);
    o.start(at); o.stop(at + 0.06);
  }

  function tick() {
    if (!running || !ctx || !clickOn) return;
    var horizon = ctx.currentTime + 0.12;
    while (nextBeat < horizon) {
      click(nextBeat, beatIndex % 4 === 0);
      nextBeat += beatDur;
      beatIndex++;
    }
  }

  function begin(delay, bpm) {
    init();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume();
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setTargetAtTime(muted ? 0 : 0.85, ctx.currentTime, 0.02);
    startAt = ctx.currentTime + Math.max(0.12, delay || 0);
    beatDur = 60 / (bpm || 120);
    nextBeat = startAt;
    beatIndex = 0;
    running = true;
    if (stems) startStems(startAt);
  }

  function now() { return running ? ctx.currentTime - startAt : 0; }

  function pause() { if (ctx && running) { try { ctx.suspend(); } catch (e) {} } }
  function resume() { if (ctx) { try { ctx.resume(); } catch (e) {} } }

  function stop() {
    running = false;
    if (ctx && master) master.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
    for (var i = 0; i < stemSrc.length; i++) { try { stemSrc[i].stop(); } catch (e) {} }
    stemSrc = [];
  }

  /* ---------------- 导入曲：四条 stem ---------------- */
  function loadStems(list, rate) {
    stems = list;
    stemRate = rate || 22050;
    stemMode = true;
  }

  function startStems(at) {
    if (!stems) return;
    for (var i = 0; i < stemSrc.length; i++) { try { stemSrc[i].stop(); } catch (e) {} }
    stemSrc = []; stemGain = [];
    for (var k = 0; k < 4; k++) {
      var data = stems[k];
      if (!data) continue;
      var buf = ctx.createBuffer(1, data.length, stemRate);
      buf.copyToChannel(data, 0);
      var src = ctx.createBufferSource();
      src.buffer = buf;
      var g = ctx.createGain();
      g.gain.value = 0;
      src.connect(g); g.connect(partGain[k] || music);
      src.start(at);
      stemSrc[k] = src;
      stemGain[k] = g;
    }
  }

  function gate(lane, open) {
    if (!stemMode || !ctx || !stemGain[lane]) return;
    stemGain[lane].gain.setTargetAtTime(open ? 1 : 0, ctx.currentTime, open ? 0.015 : 0.06);
  }

  function gateReset() {
    for (var i = 0; i < 4; i++) gate(i, false);
  }

  /* ---------------- 其它 ---------------- */
  function hitFx(perfect) {
    if (!ctx || muted) return;
    var t = ctx.currentTime + 0.001;
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "triangle";
    o.frequency.value = perfect ? 1760 : 1320;
    g.gain.setValueAtTime(perfect ? 0.035 : 0.022, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(g); g.connect(sfx);
    o.start(t); o.stop(t + 0.07);
  }

  function toggleMute() {
    muted = !muted;
    if (master) master.gain.setTargetAtTime(muted ? 0 : 0.85, ctx.currentTime, 0.02);
    return muted;
  }

  function toggleClick() {
    clickOn = !clickOn;
    return clickOn;
  }

  function readLevels() {
    if (!ctx) return levels;
    for (var i = 0; i < 4; i++) {
      analysers[i].getByteFrequencyData(freqBuf);
      var sum = 0;
      for (var k = 0; k < freqBuf.length; k++) sum += freqBuf[k];
      var v = sum / (freqBuf.length * 255);
      levels[i] += (v - levels[i]) * 0.35;
    }
    return levels;
  }

  function probe() {
    if (!ctx || !stems || !stems[0]) return false;
    var b = ctx.createBuffer(1, stems[0].length, stemRate);
    b.copyToChannel(stems[0], 0);
    var src = ctx.createBufferSource(); src.buffer = b;
    var g = ctx.createGain(); g.gain.value = 0.8;
    var an = ctx.createAnalyser(); an.fftSize = 64;
    src.connect(g); g.connect(an); an.connect(ctx.destination);
    src.start();
    root.__probe = an;
    return true;
  }

  function probeLevel() {
    if (!root.__probe) return -1;
    var d = new Uint8Array(32);
    root.__probe.getByteFrequencyData(d);
    var sum = 0;
    for (var i = 0; i < d.length; i++) sum += d[i];
    return sum;
  }

  function renderTest() {
    if (!stems || !stems[0]) return Promise.resolve(-1);
    var oc = new OfflineAudioContext(1, 22050, 22050);
    var b = oc.createBuffer(1, stems[0].length, 22050);
    b.copyToChannel(stems[0], 0);
    var src = oc.createBufferSource(); src.buffer = b;
    src.connect(oc.destination); src.start();
    return oc.startRendering().then(function (r) {
      var d = r.getChannelData(0), m = 0;
      for (var i = 0; i < d.length; i++) { var v = Math.abs(d[i]); if (v > m) m = v; }
      return m;
    });
  }

  root.BandAudio = {
    init: init, begin: begin, now: now, stop: stop, pause: pause, resume: resume,
    blip: hitFx,
    play: play, hold: hold, hitFx: hitFx,
    loadStems: loadStems, gate: gate, gateReset: gateReset,
    toggleMute: toggleMute, toggleClick: toggleClick,
    levels: readLevels,
    get clickOn() { return clickOn; },
    probe: probe, probeLevel: probeLevel, renderTest: renderTest,
    debugInfo: function () {
      return {
        stemMode: stemMode,
        hasStems: !!stems,
        len: stems && stems[0] ? stems[0].length : 0,
        gains: stemGain.map(function (g) { return g ? +g.gain.value.toFixed(3) : null; }),
        srcs: stemSrc.map(function (x) { return !!x; }),
        peak: stems && stems[0] ? (function () { var m = 0; for (var i = 0; i < Math.min(stems[0].length, 200000); i++) { var v = Math.abs(stems[0][i]); if (v > m) m = v; } return +m.toFixed(4); })() : 0,
        running: running,
        ctx: ctx ? ctx.state : "none"
      };
    },
    get state() { return running ? "playing" : "idle"; },
    get ctx() { return ctx; }
  };
})(window);
