/* =========================================================
   本地分轨：把一首歌拆成 4 条可门控的 stem
   鼓 / 贝斯 / 和弦 / 旋律 —— 全部在浏览器里跑，不上传。
   ========================================================= */
(function (root) {
  "use strict";

  var TARGET_RATE = 22050;
  var MAX_SEC = 180;

  function yieldFrame() {
    return new Promise(function (r) { setTimeout(r, 0); });
  }

  async function decode(file) {
    var ab = await file.arrayBuffer();
    var ac = new AudioContext();
    var buf = await ac.decodeAudioData(ab);
    try { ac.close(); } catch (e) {}
    return buf;
  }

  async function renderMono(buffer, rate, seconds) {
    var dur = Math.min(buffer.duration, seconds);
    var len = Math.ceil(dur * rate);
    var oc = new OfflineAudioContext(1, len, rate);
    var src = oc.createBufferSource();
    src.buffer = buffer;
    src.connect(oc.destination);
    src.start(0);
    return oc.startRendering();
  }

  function toBuffer(data, rate) {
    var b = new AudioBuffer({ length: data.length, sampleRate: rate, numberOfChannels: 1 });
    b.copyToChannel(data, 0);
    return b;
  }

  async function filterData(data, rate, filters) {
    var oc = new OfflineAudioContext(1, data.length, rate);
    var src = oc.createBufferSource();
    src.buffer = toBuffer(data, rate);
    var node = src;
    filters.forEach(function (f) {
      var bq = oc.createBiquadFilter();
      bq.type = f.type;
      bq.frequency.value = f.freq;
      bq.Q.value = f.q == null ? 0.7 : f.q;
      node.connect(bq);
      node = bq;
    });
    node.connect(oc.destination);
    src.start(0);
    var out = await oc.startRendering();
    return out.getChannelData(0);
  }

  function normalize(data, peak) {
    var max = 0;
    for (var i = 0; i < data.length; i++) {
      var v = Math.abs(data[i]);
      if (v > max) max = v;
    }
    if (max < 1e-6) return data;
    var k = peak / max;
    for (var j = 0; j < data.length; j++) data[j] *= k;
    return data;
  }

  /* 用高频瞬态把鼓抠出来，剩下的按频段分三份 */
  async function split(buffer) {
    var rate = TARGET_RATE;
    var mono = await renderMono(buffer, rate, MAX_SEC);
    var x = mono.getChannelData(0);
    var N = x.length;

    var hpBuf = await filterData(x, rate, [{ type: "highpass", freq: 2200, q: 0.7 }]);
    var hpData = hpBuf;

    var hop = 256, win = 512;
    var frames = Math.max(1, Math.floor(N / hop));
    var energy = new Float32Array(frames);
    for (var f = 0; f < frames; f++) {
      var s = f * hop, e = Math.min(N, s + win), sum = 0;
      for (var i = s; i < e; i++) sum += hpData[i] * hpData[i];
      energy[f] = Math.sqrt(sum / Math.max(1, e - s));
    }

    var frameMask = new Uint8Array(frames);
    var avg = 0;
    for (var g = 0; g < frames; g++) {
      var v = energy[g];
      if (v > avg * 1.55 + 0.004 && v > 0.012) frameMask[g] = 1;
      avg = avg * 0.9 + v * 0.1;
    }

    // 平滑成样本级 mask，避免爆音
    var drums = new Float32Array(N);
    var rest = new Float32Array(N);
    var env = 0;
    for (var n = 0; n < N; n++) {
      var target = frameMask[Math.floor(n / hop)] ? 1 : 0;
      var k = target > env ? 0.03 : 0.0012;
      env += (target - env) * k;
      drums[n] = x[n] * env;
      rest[n] = x[n] * (1 - env);
    }

    var bass = await filterData(rest, rate, [{ type: "lowpass", freq: 220, q: 0.8 }]);
    var mid = await filterData(rest, rate, [
      { type: "highpass", freq: 220, q: 0.7 },
      { type: "lowpass", freq: 1400, q: 0.7 }
    ]);
    var lead = await filterData(rest, rate, [{ type: "highpass", freq: 1400, q: 0.7 }]);

    var stems = [drums, bass, mid, lead].map(function (d) {
      var copy = new Float32Array(d);
      return normalize(copy, 0.85);
    });

    return { stems: stems, rate: rate, duration: N / rate };
  }

  /* 帧能量 onset */
  function onsets(data, rate, minGap, sens) {
    var hop = Math.max(64, Math.round(rate * 0.012));
    var frames = Math.floor(data.length / hop);
    var env = new Float32Array(frames);
    for (var f = 0; f < frames; f++) {
      var s = f * hop, e = Math.min(data.length, s + hop), sum = 0;
      for (var i = s; i < e; i++) sum += data[i] * data[i];
      env[f] = Math.sqrt(sum / Math.max(1, e - s));
    }
    var out = [];
    var avg = 0, lastT = -9;
    for (var g = 1; g < frames - 1; g++) {
      var v = env[g];
      var t = g * hop / rate;
      if (v > avg * (sens || 1.5) + 0.006 && v >= env[g - 1] && v >= env[g + 1] && t - lastT >= minGap) {
        out.push({ t: t, e: v });
        lastT = t;
      }
      avg = avg * 0.9 + v * 0.1;
    }
    return out;
  }

  function guessBpm(drumOnsets) {
    if (drumOnsets.length < 8) return 120;
    var best = 120, bestScore = -1;
    for (var bpm = 70; bpm <= 180; bpm++) {
      var period = 60 / bpm, score = 0;
      for (var i = 0; i < drumOnsets.length; i++) {
        var ph = (drumOnsets[i].t % period) / period;
        score += Math.cos(ph * Math.PI * 2);
      }
      if (score > bestScore) { bestScore = score; best = bpm; }
    }
    return best;
  }

  function chartFor(stems, rate, diff) {
    var gaps = { easy: 0.34, normal: 0.2, hard: 0.12 };
    var sens = { easy: 1.9, normal: 1.55, hard: 1.3 };
    var gap = gaps[diff] || 0.2;
    var notes = [];
    for (var lane = 0; lane < 4; lane++) {
      var list = onsets(stems[lane], rate, gap, sens[diff]);
      for (var i = 0; i < list.length; i++) {
        notes.push({ t: list[i].t, lane: lane, type: "tap", dur: 0, v: 60, snd: null });
      }
    }
    notes.sort(function (a, b) { return a.t - b.t; });
    return notes;
  }

  async function analyze(file, onProgress) {
    onProgress && onProgress("解码音频…");
    var buffer = await decode(file);
    await yieldFrame();

    onProgress && onProgress("重采样 + 分离瞬态…");
    var res = await split(buffer);
    await yieldFrame();

    onProgress && onProgress("生成谱面…");
    var drums = onsets(res.stems[0], res.rate, 0.1, 1.3);
    var bpm = guessBpm(drums);
    var LEAD = 2.0;   // 空两秒，先让音符落下来

    var charts = {
      easy: chartFor(res.stems, res.rate, "easy"),
      normal: chartFor(res.stems, res.rate, "normal"),
      hard: chartFor(res.stems, res.rate, "hard")
    };
    ["easy", "normal", "hard"].forEach(function (k) {
      charts[k] = charts[k].map(function (n) { return { t: n.t + LEAD, lane: n.lane, type: "tap", dur: 0, v: 60, snd: null }; });
    });

    // 每条 stem 前面补 2 秒静音，和谱面对齐
    var pad = Math.floor(LEAD * res.rate);
    res.stems = res.stems.map(function (d) {
      var out = new Float32Array(d.length + pad);
      out.set(d, pad);
      return out;
    });

    onProgress && onProgress("打包…");
    var i16 = res.stems.map(function (d) {
      var out = new Int16Array(d.length);
      for (var i = 0; i < d.length; i++) {
        var v = Math.max(-1, Math.min(1, d[i]));
        out[i] = v * 32767;
      }
      return out;
    });

    return {
      name: file.name.replace(/\.[^.]+$/, "").slice(0, 30),
      bpm: bpm,
      rate: res.rate,
      duration: res.duration + 2,
      notes: charts,
      stems: i16,
      createdAt: Date.now()
    };
  }

  /* ---------------- IndexedDB ---------------- */
  function openDB() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open("band-db", 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains("custom")) db.createObjectStore("custom");
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  async function saveCustom(data) {
    var db = await openDB();
    return new Promise(function (resolve, reject) {
      var tx = db.transaction("custom", "readwrite");
      tx.objectStore("custom").put(data, "last");
      tx.oncomplete = function () { resolve(true); };
      tx.onerror = function () { reject(tx.error); };
    });
  }

  async function loadCustom() {
    var db = await openDB();
    return new Promise(function (resolve, reject) {
      var tx = db.transaction("custom", "readonly");
      var req = tx.objectStore("custom").get("last");
      req.onsuccess = function () { resolve(req.result || null); };
      req.onerror = function () { reject(req.error); };
    });
  }

  root.BandSep = { analyze: analyze, saveCustom: saveCustom, loadCustom: loadCustom };
})(window);
