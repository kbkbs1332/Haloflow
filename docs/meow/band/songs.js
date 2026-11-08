/* =========================================================
   猫猫乐队 · 曲目与谱面生成
   同一份事件流，既喂给合成器，也生成玩家 note。
   ========================================================= */
(function (root) {
  "use strict";

  var PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function midi(name) {
    var m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
    if (!m) return 60;
    var v = PC[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
    return (parseInt(m[3], 10) + 1) * 12 + v;
  }

  var CHORDS = {
    Am: [57, 60, 64], F: [53, 57, 60], C: [60, 64, 67], G: [55, 59, 62],
    Dm: [50, 53, 57], Bb: [58, 62, 65], Em: [52, 55, 59], D: [50, 54, 57],
    A: [57, 61, 64], E: [52, 56, 59], Gm: [55, 58, 62], Eb: [51, 55, 58]
  };

  // 小调五声音阶（相对根音的半音）
  var PENTA = [0, 2, 3, 7, 9, 12, 14, 15];

  var DEFS = [
    {
      id: "tide", title: "涨潮小夜曲", sub: "TIDE NOCTURNE",
      bpm: 112, beatsPerBar: 4, bars: 32, color: "#7bffe6",
      chords: ["Am", "F", "C", "G"],
      sections: [
        { to: 4, kind: "intro" }, { to: 16, kind: "verse" },
        { to: 28, kind: "chorus" }, { to: 32, kind: "outro" }
      ],
      drums: {
        intro: { kick: [0, 8], snare: [], hat: [0, 4, 8, 12] },
        verse: { kick: [0, 8], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14] },
        chorus: { kick: [0, 3, 6, 8, 11, 14], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14] },
        outro: { kick: [0], snare: [], hat: [0, 4, 8, 12] }
      },
      bass: {
        intro: [0, 8], verse: [0, 3, 6, 8, 11, 14],
        chorus: [0, 2, 4, 6, 8, 10, 12, 14], outro: [0, 8]
      },
      chordsPat: {
        intro: { steps: [0], len: 14 }, verse: { steps: [0, 8], len: 6 },
        chorus: { steps: [0, 4, 8, 12], len: 3 }, outro: { steps: [0], len: 14 }
      },
      lead: {
        motifs: [
          [[0, 0, 2], [2, 2, 2], [4, 4, 4], [8, 3, 2], [10, 2, 2], [12, 0, 4]],
          [[0, 4, 2], [2, 3, 2], [4, 2, 2], [6, 4, 2], [8, 5, 4], [12, 2, 4]],
          [[0, 2, 2], [3, 4, 1], [4, 5, 2], [8, 4, 2], [10, 2, 2], [12, 0, 4]],
          [[0, 0, 3], [4, 2, 3], [8, 4, 3], [12, 5, 3]]
        ]
      }
    },
    {
      id: "neon", title: "霓虹鱼群", sub: "NEON SHOAL",
      bpm: 128, beatsPerBar: 4, bars: 32, color: "#ff9ec4",
      chords: ["Dm", "Bb", "F", "C"],
      sections: [
        { to: 4, kind: "intro" }, { to: 14, kind: "verse" },
        { to: 26, kind: "chorus" }, { to: 32, kind: "outro" }
      ],
      drums: {
        intro: { kick: [0, 6, 10], snare: [], hat: [2, 6, 10, 14] },
        verse: { kick: [0, 3, 8, 11], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14] },
        chorus: { kick: [0, 2, 4, 8, 10, 12], snare: [4, 12], hat: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] },
        outro: { kick: [0, 8], snare: [4], hat: [0, 4, 8, 12] }
      },
      bass: {
        intro: [0, 6, 10], verse: [0, 3, 6, 8, 11, 14],
        chorus: [0, 2, 4, 6, 8, 10, 12, 14], outro: [0, 8]
      },
      chordsPat: {
        intro: { steps: [0, 8], len: 6 }, verse: { steps: [0, 6], len: 5 },
        chorus: { steps: [0, 4, 8, 12], len: 3 }, outro: { steps: [0], len: 14 }
      },
      lead: {
        motifs: [
          [[0, 4, 1], [1, 3, 1], [2, 4, 2], [6, 5, 2], [8, 4, 1], [9, 2, 1], [10, 0, 2], [14, 2, 2]],
          [[0, 0, 2], [4, 2, 1], [5, 3, 1], [6, 4, 2], [10, 5, 2], [12, 4, 2], [14, 2, 2]],
          [[0, 5, 1], [2, 4, 1], [4, 3, 2], [8, 2, 1], [9, 3, 1], [10, 4, 2], [12, 5, 2], [14, 4, 2]],
          [[0, 3, 2], [3, 4, 1], [4, 5, 2], [8, 6, 2], [10, 5, 2], [12, 3, 4]]
        ]
      }
    },
    {
      id: "waltz", title: "深海圆舞曲", sub: "ABYSS WALTZ",
      bpm: 150, beatsPerBar: 3, bars: 48, color: "#b6a6ff",
      chords: ["Em", "C", "G", "D"],
      sections: [
        { to: 6, kind: "intro" }, { to: 22, kind: "verse" },
        { to: 40, kind: "chorus" }, { to: 48, kind: "outro" }
      ],
      drums: {
        intro: { kick: [0], snare: [], hat: [0, 4, 8] },
        verse: { kick: [0, 6], snare: [4, 8], hat: [0, 2, 4, 6, 8, 10] },
        chorus: { kick: [0, 3, 6, 9], snare: [4, 8], hat: [0, 2, 4, 6, 8, 10] },
        outro: { kick: [0], snare: [4], hat: [0, 4, 8] }
      },
      bass: {
        intro: [0, 6], verse: [0, 4, 8], chorus: [0, 2, 4, 6, 8, 10], outro: [0, 6]
      },
      chordsPat: {
        intro: { steps: [0], len: 10 }, verse: { steps: [0, 6], len: 5 },
        chorus: { steps: [0, 4, 8], len: 3 }, outro: { steps: [0], len: 10 }
      },
      lead: {
        motifs: [
          [[0, 0, 2], [2, 2, 2], [4, 4, 2], [6, 5, 2], [8, 4, 4]],
          [[0, 4, 2], [2, 3, 2], [4, 2, 2], [6, 0, 2], [8, 2, 4]],
          [[0, 2, 2], [3, 4, 1], [4, 5, 2], [6, 4, 2], [8, 2, 4]],
          [[0, 5, 2], [2, 4, 2], [4, 3, 2], [6, 2, 2], [8, 0, 4]]
        ]
      }
    }
  ];

  function sectionOf(def, bar) {
    for (var i = 0; i < def.sections.length; i++) {
      if (bar < def.sections[i].to) return def.sections[i].kind;
    }
    return "outro";
  }

  function durationOf(def) {
    return (def.bars * def.beatsPerBar * 60) / def.bpm;
  }

  /* 生成完整事件流 + 某难度的谱面 */
  function build(id, diff) {
    var def = null;
    for (var i = 0; i < DEFS.length; i++) if (DEFS[i].id === id) def = DEFS[i];
    if (!def) def = DEFS[0];
    if (diff !== "easy" && diff !== "normal" && diff !== "hard") diff = "normal";

    var spb = def.beatsPerBar * 4;
    var stepDur = 60 / def.bpm / 4;
    var barDur = spb * stepDur;
    var events = [];
    var at = function (bar, step) { return (bar * spb + step) * stepDur; };

    for (var bar = 0; bar < def.bars; bar++) {
      var sec = sectionOf(def, bar);
      var chord = CHORDS[def.chords[bar % def.chords.length]] || CHORDS.Am;
      var root = chord[0];

      var d = def.drums[sec] || def.drums.verse;
      d.kick.forEach(function (s) {
        events.push({ p: 0, t: at(bar, s), k: "kick", v: 36, dur: 0.18, w: s % 8 === 0 ? 1 : 0.9, vel: 1 });
      });
      d.snare.forEach(function (s) {
        events.push({ p: 0, t: at(bar, s), k: "snare", v: 38, dur: 0.16, w: s % 8 === 4 ? 1 : 0.92, vel: 0.9 });
      });
      d.hat.forEach(function (s) {
        events.push({ p: 0, t: at(bar, s), k: "hat", v: 42, dur: 0.06, w: 0.25, vel: 0.5 });
      });

      var bp = def.bass[sec] || def.bass.verse;
      bp.forEach(function (s, idx) {
        var lift = (idx === bp.length - 1 && bar % 4 === 3) ? 7 : 0;
        events.push({ p: 1, t: at(bar, s), k: "bass", v: root - 12 + lift, dur: stepDur * 1.7, w: idx === 0 ? 1 : (idx % 2 === 0 ? 0.8 : 0.55), vel: 0.9 });
      });

      var cp = def.chordsPat[sec] || def.chordsPat.verse;
      cp.steps.forEach(function (s, idx) {
        events.push({
          p: 2, t: at(bar, s), k: "chord", v: chord[0],
          dur: Math.max(stepDur * 2, cp.len * stepDur), w: idx === 0 ? 1 : 0.78, vel: 0.7, chord: chord
        });
      });

      // 和弦琶音：让和弦手也有活干，同时把 pad 铺满
      if (sec !== "intro" && sec !== "outro") {
        var arpSteps = [2, 6, 10, 14].filter(function (x) { return x < spb; });
        arpSteps.forEach(function (st, ai) {
          events.push({
            p: 2, t: at(bar, st), k: "arp",
            v: chord[ai % chord.length],
            dur: stepDur * 1.2, w: 0.8, vel: 0.45
          });
        });
      }

      var motif = def.lead.motifs[bar % def.lead.motifs.length];
      motif.forEach(function (n, idx) {
        var deg = PENTA[n[1] % PENTA.length] + (n[1] >= PENTA.length ? 12 : 0);
        events.push({
          p: 3, t: at(bar, n[0]), k: "lead",
          v: Math.min(86, root + 12 + deg),
          dur: Math.max(stepDur, n[2] * stepDur),
          w: idx < 1 ? 1 : (idx < 3 ? 0.85 : 0.6), vel: 0.8
        });
      });
    }

    // 谱面：按声部筛 note
    var thresh = diff === "easy" ? 0.95 : diff === "normal" ? 0.75 : 0.3;
    var gap = diff === "easy" ? 0.3 : diff === "normal" ? 0.135 : 0.08;
    var notes = [];

    for (var lane = 0; lane < 4; lane++) {
      var pool = events.filter(function (e) { return e.p === lane && e.w >= thresh; });
      pool.sort(function (a, b) { return a.t - b.t; });
      var last = -9;
      for (var j = 0; j < pool.length; j++) {
        var e = pool[j];
        if (e.t < barDur - 0.001) continue;   // 第一小节只留音乐，不落音符
        if (e.t - last < gap) continue;
        last = e.t;
        notes.push({
          t: e.t,
          lane: lane,
          type: e.dur >= 0.42 ? "hold" : "tap",
          dur: e.dur >= 0.42 ? e.dur : 0,
          v: e.v,
          w: e.w,
          kind: e.k,
          snd: { k: e.k, v: e.v, dur: e.dur, chord: e.chord, lane: lane, vel: e.vel }
        });
      }
    }
    notes.sort(function (a, b) { return a.t - b.t; });

    // 总密度封顶：超了就优先丢弱拍（w 小的），保留强拍
    var capNps = diff === "easy" ? 3.0 : diff === "normal" ? 5.2 : 8.5;
    var maxCount = Math.floor(capNps * durationOf(def));
    if (notes.length > maxCount) {
      var order = notes.map(function (_, i) { return i; });
      order.sort(function (a, b) {
        var d = notes[a].w - notes[b].w;
        if (d !== 0) return d;
        return notes[a].t - notes[b].t;
      });
      var drop = {};
      for (var k = 0; k < notes.length - maxCount; k++) drop[order[k]] = 1;
      notes = notes.filter(function (_, i) { return !drop[i]; });
    }

    // 每条轨单独封顶，避免鼓手累死、和弦手闲死
    var laneCap = Math.ceil((capNps * durationOf(def) / 4) * 1.55);
    for (var ln = 0; ln < 4; ln++) {
      var mine = notes.filter(function (n) { return n.lane === ln; });
      if (mine.length <= laneCap) continue;
      mine.sort(function (a, b) { return a.w - b.w || a.t - b.t; });
      var kill = {};
      for (var q = 0; q < mine.length - laneCap; q++) kill[mine[q].t + ":" + mine[q].lane] = 1;
      notes = notes.filter(function (n) { return n.lane !== ln || !kill[n.t + ":" + n.lane]; });
    }

    return {
      meta: {
        id: def.id, title: def.title, sub: def.sub, bpm: def.bpm,
        beatsPerBar: def.beatsPerBar, bars: def.bars, color: def.color,
        duration: durationOf(def), diff: diff
      },
      events: events.sort(function (a, b) { return a.t - b.t; }),
      notes: notes
    };
  }

  function list() {
    return DEFS.map(function (d) {
      return {
        id: d.id, title: d.title, sub: d.sub, bpm: d.bpm,
        bars: d.bars, beatsPerBar: d.beatsPerBar, color: d.color,
        duration: durationOf(d), chords: d.chords.slice()
      };
    });
  }

  var api = { build: build, list: list, CHORDS: CHORDS, PENTA: PENTA };
  root.BandSongs = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
