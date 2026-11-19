/* js/systems/music.js — D-124 五层 BGM 与曲目状态机
 * 依据：docs/系统视觉语言-规范.md §19（调中心 / 动机 / BPM / 配器 / 转场 / 留白）
 * 引擎：Web Audio 程序化合成。零音频文件、零 fetch/XHR、零 Math.random。
 * 总线由 audio.js 提供：musicBus(0.5) → duckGain → musicLP → master。
 *   - 循环曲目接 musicLP（会被 ducking 压）
 *   - jingle（victory/death）接 musicBus，绕过 duckGain（§19.5.1）
 * 关键约束：
 *   - 曲目键必须是 f{floor}（f1..f5），explore 只是 audio.js 里的场景别名
 *   - 换层：旧 900 ms 淡出 → 150 ms 全静默 → 新 1200 ms 淡入（§19.4.1）
 *   - 战斗：旧 700 ms / 新 500 ms，交叉 300 ms，equal-power
 *   - 调度：setInterval 25 ms + 120 ms lookahead；起播/恢复时把 nextNoteTime 钳到当前时间
 *   - 换层/转场用独立的 track gain 节点与曲线，不用 setInterval 硬切
 * 来源：自写 */

(function () {
  'use strict';
  var Game = window.Game = window.Game || {};
  Game.Systems = Game.Systems || {};

  var SPEC = {
    buses: { sfx: 1.0, music: 0.5, duck: 1.0 },
    floor: { fadeOutMs: 900, silenceMs: 150, fadeInMs: 1200 },
    battle: { fadeOutMs: 700, fadeInMs: 500, crossMs: 300 },
    menu: { fadeOutMs: 800, fadeInMs: 800 },
    generic: { fadeOutMs: 300, fadeInMs: 300 },
    victory: { fadeOutMs: 300, stingMs: 2400, tailMs: 3000 },
    death: { cutMs: 150, stingMs: 1400, silenceMs: 2000, padFadeMs: 1500 },
    equalPower: true,
    schedulerMs: 25,
    scheduleAhead: 0.12
  };

  /* ---------- 曲目表（§19.3） ----------
   * root：调中心 / drone 根音；base：动机基频（让 220–880 Hz 音域成立）
   * motif：相对调中心的半音偏移；statements：16 小节内的动机陈述位置
   * noise：只在重音位出现的确定性噪声层（LCG，不用 Math.random） */
  var TRACKS = {
    f1: {
      id: 'f1', floor: 1, name: '石厅', root: 55.00, mode: 'natural-minor',
      bpm: 64, motif: [0, 7, 8, 7, 0, -5, 0], base: 440.00,
      timbre: 'triangle', attack: 0.008, decay: 0.90, vol: 0.050,
      drones: [[55.00, 0.025], [82.41, 0.012]],
      statements: [{ at: 0, stride: 2, gain: 1.0, oct: 0 }, { at: 16, stride: 3, gain: 0.70, oct: 1 }],
      noise: null
    },
    f2: {
      id: 'f2', floor: 2, name: '兽人营地', root: 73.42, mode: 'phrygian',
      bpm: 84, motif: [0, 1, 5, 8, 7, 0], base: 293.66,
      timbre: 'square', filter: 1200, attack: 0.008, decay: 0.55, vol: 0.045,
      drones: [[73.42, 0.020], [55.00, 0.012]],
      statements: [{ at: 0, stride: 1, gain: 1.0, oct: 0 }, { at: 16, stride: 1, gain: 0.65, oct: 1 }, { at: 32, stride: 2, gain: 0.80, oct: 0 }],
      noise: { every: 8, band: 900, gain: 0.012, dur: 0.06 }
    },
    f3: {
      id: 'f3', floor: 3, name: '熔岩裂谷', root: 49.00, mode: 'minor-tritone',
      bpm: 72, motif: [0, 6, 7, 6, 0, -1], base: 392.00,
      timbre: 'sawtooth', filter: { from: 320, to: 900 }, attack: 0.010, decay: 0.70, vol: 0.045,
      drones: [[49.00, 0.026], [73.42, 0.012]],
      statements: [{ at: 0, stride: 2, gain: 1.0, oct: 0 }, { at: 16, stride: 2, gain: 0.70, oct: 0 }, { at: 32, stride: 3, gain: 0.60, oct: 1 }],
      noise: { every: 4, band: 3200, gain: 0.008, dur: 0.05 }
    },
    f4: {
      id: 'f4', floor: 4, name: '冰霜墓穴', root: 65.41, mode: 'aeolian-major7',
      bpm: 56, motif: [0, 0, -1, -2, 0, 12], base: 261.63,
      timbre: 'sine', attack: 0.002, decay: 2.40, vol: 0.060,
      drones: [[65.41, 0.010], [49.00, 0.006]],
      statements: [{ at: 0, stride: 4, gain: 1.0, oct: 0 }, { at: 32, stride: 4, gain: 0.55, oct: 1 }],
      noise: null
    },
    f5: {
      id: 'f5', floor: 5, name: '王座前厅', root: 43.65, mode: 'minor-harmonic',
      bpm: 88, motif: [0, -2, -3, -5, -7], base: 349.23,
      timbre: 'sawtooth', filter: 700, attack: 0.120, decay: 0.70, vol: 0.050,
      drones: [[43.65, 0.030], [65.41, 0.014]],
      statements: [{ at: 0, stride: 2, gain: 1.0, oct: 0 }, { at: 16, stride: 2, gain: 0.75, oct: 0 }],
      noise: { every: 4, band: 120, gain: 0.020, dur: 0.12 }
    },
    menu: {
      id: 'menu', floor: 0, name: '主菜单', root: 55.00, mode: 'natural-minor',
      bpm: 60, motif: [0, 7, 3, 7, 0, -5], base: 440.00,
      timbre: 'triangle', attack: 0.010, decay: 1.20, vol: 0.040,
      drones: [[55.00, 0.018]],
      statements: [{ at: 0, stride: 4, gain: 0.60, oct: 0 }, { at: 16, stride: 4, gain: 0.50, oct: 0 }],
      noise: null
    },
    battle: {
      id: 'battle', floor: 0, name: '战斗骨架', root: 110.00, mode: 'percussive',
      bpm: 140, motif: [0, 0, 7, 0, 3, 5, 7, 3], base: 220.00,
      timbre: 'square', filter: 1600, attack: 0.006, decay: 0.18, vol: 0.055,
      drones: [[110.00, 0.010]],
      statements: [{ at: 0, stride: 0.5, gain: 1.0, oct: 0 }, { at: 4, stride: 0.5, gain: 0.85, oct: 0 },
        { at: 8, stride: 0.5, gain: 1.0, oct: 0 }, { at: 12, stride: 0.5, gain: 0.85, oct: 0 },
        { at: 16, stride: 0.5, gain: 1.0, oct: 1 }, { at: 20, stride: 0.5, gain: 0.85, oct: 0 },
        { at: 24, stride: 0.5, gain: 1.0, oct: 0 }, { at: 28, stride: 0.5, gain: 0.85, oct: 0 }],
      noise: { every: 2, band: 1800, gain: 0.006, dur: 0.03 }
    },
    elite: {
      id: 'elite', floor: 0, name: '精英层', root: 110.00, mode: 'percussive-detuned',
      bpm: 140, motif: [0, 0, 7, 0, 3, 5, 7, 3], base: 220.00,
      timbre: 'sawtooth', filter: 1400, attack: 0.006, decay: 0.18, vol: 0.052,
      drones: [[110.00, 0.012], [165.00, 0.008]], detune: 18,
      statements: [{ at: 0, stride: 0.5, gain: 1.0, oct: 0 }, { at: 4, stride: 0.5, gain: 0.85, oct: 0 },
        { at: 8, stride: 0.5, gain: 1.0, oct: 0 }, { at: 12, stride: 0.5, gain: 0.85, oct: 0 },
        { at: 16, stride: 0.5, gain: 1.0, oct: 0 }, { at: 20, stride: 0.5, gain: 0.85, oct: 0 },
        { at: 24, stride: 0.5, gain: 1.0, oct: 0 }, { at: 28, stride: 0.5, gain: 0.85, oct: 0 }],
      noise: { every: 4, band: 1600, gain: 0.008, dur: 0.04 }
    },
    boss: {
      id: 'boss', floor: 0, name: 'Boss 龙战', root: 55.00, mode: 'boss',
      bpm: 96, motif: [0, -1, -5, -6, 0, -1], base: 220.00,
      timbre: 'sawtooth', filter: 700, attack: 0.120, decay: 0.70, vol: 0.050,
      drones: [[55.00, 0.030], [82.41, 0.015]],
      statements: [{ at: 0, stride: 2, gain: 1.0, oct: 0 }, { at: 16, stride: 2, gain: 0.85, oct: 0 },
        { at: 32, stride: 2, gain: 1.0, oct: 0 }, { at: 48, stride: 2, gain: 0.85, oct: 0 }],
      noise: { every: 4, band: 100, gain: 0.012, dur: 0.10 }
    }
  };

  var SCHEDULE_AHEAD = SPEC.scheduleAhead;
  var CYCLE_BEATS = 64; /* 16 小节 × 4 拍 */
  var active = [];      /* 正在发声的循环曲目（交叉淡化时可能 2 条） */
  var timer = null;
  var nextNoteTime = 0;
  var noteLog = [];
  var transitionLog = [];
  var timers = [];
  var lastRequestAt = {};
  var jingle = null;    /* { gain, nodes } */
  var deathPad = null;  /* { osc, gain } */
  var dreadTier = 0;
  var tempoLog = [];     /* D-125：Boss 换档只在循环边界改 BPM 的记录 */
  var seq = 0;

  function Audio() { return Game.Systems && Game.Systems.Audio; }
  function ctx() { var A = Audio(); return A && typeof A._ctx === 'function' ? A._ctx() : null; }
  function musicRoot() {
    var A = Audio();
    var b = A && typeof A._buses === 'function' ? A._buses() : null;
    return b ? (b.musicLP || b.musicBus) : null;
  }
  function musicBus() {
    var A = Audio();
    var b = A && typeof A._buses === 'function' ? A._buses() : null;
    return b ? b.musicBus : null;
  }
  function wallMs() { return Date.now(); }
  function r3(x) { return Math.round(x * 1000) / 1000; }

  /* ---------- 确定性噪声（固定种子 LCG，绝不使用 Math.random） ---------- */
  var noiseBufCache = {};
  function noiseBuffer(seed) {
    var c = ctx();
    if (!c || typeof c.createBuffer !== 'function') return null;
    if (noiseBufCache[seed]) return noiseBufCache[seed];
    var len = Math.max(64, Math.floor((c.sampleRate || 8000) * 0.25));
    var buf = c.createBuffer(1, len, c.sampleRate || 8000);
    var data = buf.getChannelData(0);
    var s = (seed >>> 0) || 1;
    for (var i = 0; i < len; i++) {
      s = (1664525 * s + 1013904223) >>> 0;
      data[i] = (s / 4294967296) * 2 - 1;
    }
    noiseBufCache[seed] = buf;
    return buf;
  }

  /* ---------- 曲线（equal-power） ---------- */
  function curveIn(n) {
    n = n || 32;
    var a = new Float32Array(n);
    for (var i = 0; i < n; i++) a[i] = Math.sin((i / (n - 1)) * Math.PI / 2);
    return a;
  }
  function curveOut(n) {
    n = n || 32;
    var a = new Float32Array(n);
    for (var i = 0; i < n; i++) a[i] = Math.cos((i / (n - 1)) * Math.PI / 2);
    return a;
  }

  /* ---------- 曲目构建 ---------- */
  function buildTrack(def) {
    var events = [];
    (def.statements || []).forEach(function (st) {
      for (var i = 0; i < def.motif.length; i++) {
        var semi = def.motif[i] + (st.oct || 0) * 12;
        var freq = def.base * Math.pow(2, semi / 12);
        while (freq < 220) freq *= 2;
        while (freq > 880) freq /= 2;
        events.push({
          type: 'note', beat: st.at + i * st.stride, freq: r3(freq), semi: semi,
          gain: def.vol * (st.gain || 1), dur: def.decay,
          timbre: def.timbre, filter: def.filter, attack: def.attack,
          detune: def.detune || 0
        });
      }
    });
    if (def.noise) {
      for (var b = 0; b < CYCLE_BEATS; b += def.noise.every) {
        events.push({
          type: 'noise', beat: b, band: def.noise.band,
          gain: def.noise.gain, dur: def.noise.dur
        });
      }
    }
    events.sort(function (a, b2) {
      if (a.beat !== b2.beat) return a.beat - b2.beat;
      return (a.type === 'note' ? 0 : 1) - (b2.type === 'note' ? 0 : 1);
    });
    var beatSec = 60 / def.bpm;
    var cycleDur = CYCLE_BEATS * beatSec;
    var sounding = 0;
    events.forEach(function (e) { sounding += (e.dur || 0); });
    return {
      def: def,
      events: events,
      beatSec: beatSec,
      cycleDur: cycleDur,
      restRatio: Math.max(0, Math.min(1, 1 - sounding / cycleDur))
    };
  }

  var BUILT = {};
  Object.keys(TRACKS).forEach(function (k) { BUILT[k] = buildTrack(TRACKS[k]); });

  /* ---------- 指纹（§19.3.1 七维） ---------- */
  function fingerprint(id) {
    var d = TRACKS[id];
    if (!d) return null;
    var b = BUILT[id];
    return {
      id: id,
      root: d.root,
      mode: d.mode,
      bpm: d.bpm,
      motif4: d.motif.slice(0, 4).join(','),
      timbre: d.timbre,
      drone: d.drones.map(function (x) { return x[0]; }).join('+'),
      rest: Math.round(b.restRatio * 100) / 100
    };
  }

  /* ---------- 调度器 ---------- */
  function ensureTimer() {
    if (timer) return;
    timer = setInterval(scheduler, SPEC.schedulerMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
  }
  function stopTimerIfIdle() {
    if (timer && active.length === 0) { clearInterval(timer); timer = null; }
  }

  function seek(tr, t) {
    var evs = tr.events;
    if (!evs.length) return;
    if (tr.cycleStart < t) {
      var k = Math.floor((t - tr.cycleStart) / tr.cycleDur);
      if (k > 0) tr.cycleStart += k * tr.cycleDur;
    }
    var pos = (t - tr.cycleStart) / tr.beatSec;
    var idx = 0;
    while (idx < evs.length && evs[idx].beat < pos) idx++;
    tr.idx = idx;
    nextNoteTime = Math.max(nextNoteTime, t + 0.02);
  }

  function scheduler() {
    var c = ctx();
    if (!c || c.state !== 'running') return; /* §19.6.1：暂停/挂起时不排程 */
    for (var i = active.length - 1; i >= 0; i--) {
      var tr = active[i];
      if (!tr || !tr.alive) continue;
      /* 淡出结束的旧曲目在这里回收，不额外注册 setTimeout */
      if (tr.killAt && c.currentTime >= tr.killAt) { killInstance(tr); continue; }
      scheduleTrack(tr);
    }
    if (nextNoteTime < c.currentTime) nextNoteTime = c.currentTime + 0.02;
  }

  function scheduleTrack(tr) {
    var c = ctx();
    if (!c) return;
    var evs = tr.events;
    if (!evs.length) return;
    var guard = 0;
    while (guard++ < 512) {
      if (tr.idx >= evs.length) {
        /* D-125：只在循环边界重算 beatSec/cycleDur。
         * 先用旧 cycleDur 推进到新 cycle 起点，再应用 pendingTier；
         * 已排入 nextNoteTime 队列的音符一律不动。 */
        var prevBeatSec = tr.beatSec;
        tr.cycleStart += tr.cycleDur;
        tr.idx = 0;
        var changed = applyPendingTempo(tr);
        if (changed) {
          var firstT = tr.cycleStart + evs[0].beat * tr.beatSec;
          tempoLog.push({
            at: r3(c.currentTime),
            track: tr.id,
            fromBpm: changed.fromBpm,
            toBpm: changed.toBpm,
            prevBeatSec: r3(prevBeatSec),
            newBeatSec: r3(tr.beatSec),
            boundaryAt: r3(tr.cycleStart),
            firstNoteAt: r3(firstT)
          });
          if (tempoLog.length > 20) tempoLog.shift();
        }
      }
      var ev = evs[tr.idx];
      var t = tr.cycleStart + ev.beat * tr.beatSec;
      if (t < c.currentTime) { /* 过期音符直接跳过，绝不追补 */ tr.idx++; continue; }
      if (t > c.currentTime + SCHEDULE_AHEAD) { nextNoteTime = t; break; }
      scheduleEvent(tr, ev, t);
      tr.idx++;
    }
    if (nextNoteTime < c.currentTime) nextNoteTime = c.currentTime + 0.02;
  }

  function scheduleEvent(tr, ev, t) {
    var c = ctx();
    if (!c) return;
    try {
      if (ev.type === 'noise') {
        var src = c.createBufferSource();
        var bp = c.createBiquadFilter();
        var ng = c.createGain();
        src.buffer = noiseBuffer(0x5eed);
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(ev.band, t);
        bp.Q.value = 1.2;
        ng.gain.setValueAtTime(0, t);
        ng.gain.linearRampToValueAtTime(ev.gain, t + 0.005);
        ng.gain.exponentialRampToValueAtTime(0.0001, t + ev.dur);
        src.connect(bp); bp.connect(ng); ng.connect(tr.gain);
        if (src.start) src.start(t);
        if (src.stop) src.stop(t + ev.dur + 0.02);
        tr.nodes.push(src);
      } else {
        var osc = c.createOscillator();
        var g = c.createGain();
        osc.type = ev.timbre || 'sine';
        osc.frequency.setValueAtTime(ev.freq, t);
        if (ev.detune && osc.detune) osc.detune.setValueAtTime(ev.detune, t);
        var tail = osc;
        if (ev.filter) {
          var f = c.createBiquadFilter();
          f.type = 'lowpass';
          if (typeof ev.filter === 'number') {
            f.frequency.setValueAtTime(ev.filter, t);
          } else {
            f.frequency.setValueAtTime(ev.filter.from, t);
            f.frequency.linearRampToValueAtTime(ev.filter.to, t + ev.dur);
          }
          f.Q.value = Math.SQRT1_2;
          osc.connect(f);
          tail = f;
        }
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(ev.gain, t + Math.max(0.002, ev.attack || 0.008));
        g.gain.exponentialRampToValueAtTime(0.0001, t + ev.dur);
        tail.connect(g);
        g.connect(tr.gain);
        osc.start(t);
        osc.stop(t + ev.dur + 0.02);
        tr.nodes.push(osc);
      }
      noteLog.push({ track: tr.id, at: r3(t), type: ev.type, beat: ev.beat, freq: ev.freq || null, gain: r3(ev.gain) });
      if (noteLog.length > 600) noteLog.shift();
    } catch (e) { /* 单个音符失败不影响调度器 */ }
  }

  /* ---------- 创建 / 淡出 ---------- */
  function newGainNode(target) {
    var c = ctx();
    var g = c.createGain();
    g.gain.value = 0;
    g.connect(target);
    return g;
  }

  function startInstance(defId, fadeInMs, delayMs) {
    var c = ctx();
    var root = musicRoot();
    if (!c || !root || c.state !== 'running') return null;
    var b = BUILT[defId];
    if (!b) return null;
    var delay = Math.max(0, delayMs || 0);
    var g = newGainNode(root);
    var tr = {
      id: defId, gain: g, nodes: [], drones: [], def: b.def,
      events: b.events, bpm: b.def.bpm, beatSec: b.beatSec, cycleDur: b.cycleDur,
      cycleStart: c.currentTime + delay / 1000 + 0.05, idx: 0, alive: true,
      startAt: c.currentTime + delay / 1000, dreadBoost: 1,
      /* D-125：pendingTier 只登记；BPM 在下一个循环边界才应用 */
      pendingTier: dreadTier, appliedTier: dreadTier, tempoTier: 0, layers: {}
    };
    /* drone：每层最多两个固定音，接本曲目 gain */
    (b.def.drones || []).forEach(function (d) {
      var osc = c.createOscillator();
      var dg = c.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(d[0], c.currentTime);
      dg.gain.setValueAtTime(d[1], c.currentTime);
      osc.connect(dg); dg.connect(g);
      osc.start(c.currentTime);
      tr.nodes.push(osc);
      tr.drones.push({ osc: osc, gain: dg, base: d[1] });
    });
    if (defId === 'boss') applyLayers(tr, dreadTier); /* 层可以立刻叠；BPM 仍等边界 */
    nextNoteTime = Math.max(c.currentTime + 0.02, tr.cycleStart);
    seek(tr, tr.cycleStart);
    active.push(tr);
    fadeGain(g, 'in', fadeInMs, delay);
    ensureTimer();
    return tr;
  }

  function fadeGain(gainNode, dir, ms, delayMs) {
    var c = ctx();
    if (!c || !gainNode) return;
    var t = c.currentTime + Math.max(0, delayMs || 0) / 1000;
    try {
      gainNode.gain.cancelScheduledValues(c.currentTime);
      gainNode.gain.setValueAtTime(gainNode.gain.value, c.currentTime);
      if (ms <= 0) {
        gainNode.gain.setValueAtTime(dir === 'in' ? 1 : 0, t);
        return;
      }
      if (typeof gainNode.gain.setValueCurveAtTime === 'function') {
        gainNode.gain.setValueCurveAtTime(dir === 'in' ? curveIn(32) : curveOut(32), t, ms / 1000);
      } else if (dir === 'in') {
        gainNode.gain.linearRampToValueAtTime(1, t + ms / 1000);
      } else {
        gainNode.gain.linearRampToValueAtTime(0, t + ms / 1000);
      }
    } catch (e) { /* 降级 */ }
  }

  function killInstance(tr) {
    if (!tr) return;
    tr.alive = false;
    tr.nodes.forEach(function (n) {
      try { if (n.stop) n.stop(); } catch (e) {}
      try { if (n.disconnect) n.disconnect(); } catch (e) {}
    });
    tr.drones.forEach(function (d) {
      try { if (d.osc.stop) d.osc.stop(); } catch (e) {}
      try { if (d.osc.disconnect) d.osc.disconnect(); } catch (e) {}
      try { if (d.gain.disconnect) d.gain.disconnect(); } catch (e) {}
    });
    Object.keys(tr.layers || {}).forEach(function (name) {
      var L = tr.layers[name];
      if (L && L.gain) { try { L.gain.disconnect(); } catch (e) {} }
    });
    try { if (tr.gain.disconnect) tr.gain.disconnect(); } catch (e) {}
    for (var i = active.length - 1; i >= 0; i--) if (active[i] === tr) active.splice(i, 1);
    stopTimerIfIdle();
  }

  function fadeOutAndKill(tr, ms, delayMs) {
    if (!tr) return;
    fadeGain(tr.gain, 'out', ms, delayMs);
    var c = ctx();
    tr.killAt = (c ? c.currentTime : 0) + (Math.max(0, ms + (delayMs || 0))) / 1000 + 0.02;
    /* 由 25 ms 调度器回收，避免新增 setTimeout 参与战斗时钟 */
  }

  function clearTimers() {
    timers.forEach(function (id) { clearTimeout(id); });
    timers = [];
  }

  function currentLoop() {
    /* 最后加入且已到 startAt 的循环曲目是"当前"；淡出中的旧曲目不算 */
    var c = ctx();
    var t = c ? c.currentTime : 0;
    for (var i = active.length - 1; i >= 0; i--) {
      var tr = active[i];
      if (tr && tr.alive && (!tr.startAt || tr.startAt <= t + 0.001)) return tr;
    }
    return null;
  }

  function cancelPendingStarts() {
    var c = ctx();
    if (!c) return;
    for (var i = active.length - 1; i >= 0; i--) {
      var tr = active[i];
      if (tr && tr.startAt && tr.startAt > c.currentTime + 0.001) killInstance(tr);
    }
  }

  function stopAll(fadeMs) {
    clearTimers();
    var list = active.slice(0);
    list.forEach(function (tr) { fadeOutAndKill(tr, fadeMs || 0, 0); });
    if (fadeMs <= 0) list.forEach(killInstance);
    stopJingle(fadeMs);
    stopDeathPad(fadeMs);
    nextNoteTime = 0;
  }

  /* ---------- 转场 ---------- */
  function isFloorId(id) { return /^f[1-5]$/.test(id || ''); }

  function playTrack(id, opts) {
    opts = opts || {};
    var c = ctx();
    var A = Audio();
    if (!c || !A) return false;
    if (c.state !== 'running') return false;
    if (id === 'victory') return playVictory();
    if (id === 'death') return playDeath();
    if (!TRACKS[id]) return false;

    var nowW = wallMs();
    if (!opts.force && lastRequestAt[id] && (nowW - lastRequestAt[id]) < 800) {
      var curSame = currentLoop();
      if (curSame && curSame.id === id) return true;
    }
    lastRequestAt[id] = nowW;
    cancelPendingStarts();

    var cur = currentLoop();
    if (cur && cur.id === id && !opts.force) return true;

    var log = {
      at: r3(c.currentTime), from: cur ? cur.id : null, to: id,
      kind: 'generic', fadeOutMs: SPEC.generic.fadeOutMs, silenceMs: 0,
      fadeInMs: SPEC.generic.fadeInMs, crossMs: 0, equalPower: true
    };

    if (!cur) {
      log.kind = 'start';
      log.fadeInMs = isFloorId(id) ? 400 : 300;
      startInstance(id, log.fadeInMs, 0);
    } else if (isFloorId(cur.id) && isFloorId(id)) {
      /* §19.4.1：旧 900 / 静默 150 / 新 1200；双 gain 节点，equal-power。
       * 新曲目的周期从静默结束后起算，淡入曲线也用 AudioParam 延时启动，不注册 setTimeout。 */
      log.kind = 'floor';
      log.fadeOutMs = SPEC.floor.fadeOutMs;
      log.silenceMs = SPEC.floor.silenceMs;
      log.fadeInMs = SPEC.floor.fadeInMs;
      fadeOutAndKill(cur, SPEC.floor.fadeOutMs, 0);
      startInstance(id, SPEC.floor.fadeInMs, SPEC.floor.fadeOutMs + SPEC.floor.silenceMs);
    } else {
      /* 战斗 / 菜单 / 通用：交叉淡化；battle 旧 700 / 新 500（重叠 300） */
      var isBattle = /^(battle|elite|boss)$/.test(id) || (cur && /^(battle|elite|boss)$/.test(cur.id));
      var sp = isBattle ? SPEC.battle : (id === 'menu' ? SPEC.menu : SPEC.generic);
      log.kind = isBattle ? 'battle' : 'generic';
      log.fadeOutMs = sp.fadeOutMs;
      log.fadeInMs = sp.fadeInMs;
      log.crossMs = isBattle ? SPEC.battle.crossMs : Math.max(0, Math.min(sp.fadeOutMs, sp.fadeInMs) - 100);
      fadeOutAndKill(cur, sp.fadeOutMs, 0);
      var overlapStart = Math.max(0, sp.fadeOutMs - log.crossMs);
      startInstance(id, sp.fadeInMs, overlapStart);
    }
    transitionLog.push(log);
    if (transitionLog.length > 30) transitionLog.shift();
    return true;
  }

  /* ---------- jingle：victory（绕过 duckGain） ---------- */
  function playVictory() {
    var c = ctx();
    var bus = musicBus();
    if (!c || !bus) return false;
    clearTimers();
    var loops = active.slice(0);
    loops.forEach(function (tr) { fadeOutAndKill(tr, SPEC.victory.fadeOutMs, 0); });
    stopDeathPad(100);
    var g = c.createGain();
    g.gain.value = 1;
    g.connect(bus); /* 绕过 duckGain */
    var notes = [523.25, 659.25, 783.99, 1046.50, 783.99, 1046.50];
    var nodes = [];
    notes.forEach(function (f, i) {
      var t = c.currentTime + 0.2 + i * 0.34;
      var osc = c.createOscillator();
      var ng = c.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, t);
      ng.gain.setValueAtTime(0, t);
      ng.gain.linearRampToValueAtTime(0.06, t + 0.01);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.30);
      osc.connect(ng); ng.connect(g);
      osc.start(t); osc.stop(t + 0.34);
      nodes.push(osc);
    });
    /* 2.4 s sting 后 3.0 s 淡至静音（§19.4.1） */
    try {
      var t0 = c.currentTime + 0.2 + SPEC.victory.stingMs / 1000;
      g.gain.setValueAtTime(1, t0);
      g.gain.linearRampToValueAtTime(0.0001, t0 + SPEC.victory.tailMs / 1000);
    } catch (e) {}
    jingle = { gain: g, nodes: nodes, kind: 'victory' };
    transitionLog.push({ at: r3(c.currentTime), from: loops.length ? loops[loops.length - 1].id : null, to: 'victory', kind: 'jingle', fadeOutMs: SPEC.victory.fadeOutMs, silenceMs: 0, fadeInMs: 0, crossMs: 0, equalPower: true });
    return true;
  }

  /* ---------- death：150 ms 切 → 1.4 s 下行 → 2.0 s 静音 → pad 1.5 s 淡入 ---------- */
  function playDeath() {
    var c = ctx();
    var bus = musicBus();
    if (!c || !bus) return false;
    clearTimers();
    var loops = active.slice(0);
    loops.forEach(function (tr) { fadeOutAndKill(tr, SPEC.death.cutMs, 0); });
    stopJingle(100);

    var g = c.createGain();
    g.gain.value = 1;
    g.connect(bus); /* 绕过 duckGain */
    var notes = [220.00, 196.00, 174.61, 146.83];
    var nodes = [];
    var stingStart = SPEC.death.cutMs / 1000;
    notes.forEach(function (f, i) {
      var t = c.currentTime + stingStart + i * 0.35; /* 4 × 0.35 = 1.4 s */
      var osc = c.createOscillator();
      var ng = c.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f, t);
      ng.gain.setValueAtTime(0, t);
      ng.gain.linearRampToValueAtTime(0.07, t + 0.01);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
      osc.connect(ng); ng.connect(g);
      osc.start(t); osc.stop(t + 0.35);
      nodes.push(osc);
    });
    var padAt = stingStart + SPEC.death.stingMs / 1000 + SPEC.death.silenceMs / 1000;
    var padId = setTimeout(function () {
      var osc = c.createOscillator();
      var pg = c.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(55, c.currentTime);
      pg.gain.setValueAtTime(0, c.currentTime);
      pg.gain.linearRampToValueAtTime(0.03, c.currentTime + SPEC.death.padFadeMs / 1000);
      osc.connect(pg); pg.connect(bus);
      osc.start(c.currentTime);
      deathPad = { osc: osc, gain: pg };
    }, Math.round(padAt * 1000));
    timers.push(padId);
    jingle = { gain: g, nodes: nodes, kind: 'death' };
    transitionLog.push({ at: r3(c.currentTime), from: loops.length ? loops[loops.length - 1].id : null, to: 'death', kind: 'death', fadeOutMs: SPEC.death.cutMs, silenceMs: SPEC.death.silenceMs, fadeInMs: SPEC.death.padFadeMs, crossMs: 0, equalPower: true });
    return true;
  }

  function stopJingle(fadeMs) {
    if (!jingle) return;
    var j = jingle;
    jingle = null;
    try {
      if (fadeMs > 0) {
        j.gain.gain.cancelScheduledValues(ctx().currentTime);
        j.gain.gain.setValueAtTime(j.gain.gain.value, ctx().currentTime);
        j.gain.gain.linearRampToValueAtTime(0.0001, ctx().currentTime + fadeMs / 1000);
      } else {
        j.gain.gain.value = 0;
      }
    } catch (e) {}
    var id = setTimeout(function () {
      j.nodes.forEach(function (n) { try { n.stop(); } catch (e) {} });
      try { j.gain.disconnect(); } catch (e) {}
    }, fadeMs || 0);
    timers.push(id);
  }
  function stopDeathPad(fadeMs) {
    if (!deathPad) return;
    var d = deathPad;
    deathPad = null;
    try {
      var t = ctx().currentTime;
      d.gain.gain.cancelScheduledValues(t);
      d.gain.gain.setValueAtTime(d.gain.gain.value, t);
      d.gain.gain.linearRampToValueAtTime(0.0001, t + (fadeMs || 0) / 1000);
    } catch (e) {}
    var id = setTimeout(function () {
      try { d.osc.stop(); } catch (e) {}
      try { d.gain.disconnect(); } catch (e) {}
    }, fadeMs || 0);
    timers.push(id);
  }

  /* ---------- Boss 龙威（§19.4.2） ----------
   * D-125：BPM 96→100 只登记 pendingTier；调度器推进到新 cycle 起点时
   * 才 applyPendingTempo() 重算 beatSec/cycleDur。已排音符不动。
   * 层（低频 / 失谐五度 / 40 Hz sub）可以立即叠，tier3 ⊇ tier2。 */
  function applyPendingTempo(tr) {
    if (!tr || tr.id !== 'boss') return null;
    var want = (tr.pendingTier >= 3) ? 100 : 96;
    if (want === tr.bpm) {
      tr.tempoTier = (want === 100) ? 3 : 0;
      return null;
    }
    var from = tr.bpm;
    tr.bpm = want;
    tr.beatSec = 60 / want;
    tr.cycleDur = CYCLE_BEATS * tr.beatSec;
    tr.tempoTier = (want === 100) ? 3 : 0;
    return { fromBpm: from, toBpm: want };
  }

  function removeLayer(tr, name) {
    var L = tr.layers && tr.layers[name];
    if (!L) return;
    try { if (L.osc && L.osc.stop) L.osc.stop(); } catch (e) {}
    try { if (L.osc && L.osc.disconnect) L.osc.disconnect(); } catch (e) {}
    try { if (L.gain && L.gain.disconnect) L.gain.disconnect(); } catch (e) {}
    delete tr.layers[name];
  }

  function applyLayers(tr, tier) {
    if (!tr || tr.id !== 'boss') return;
    var c = ctx();
    if (!c) return;
    /* tier1：低频层 +35% */
    if (tier >= 1) {
      if (!tr.layers.lowBoost) {
        tr.drones.forEach(function (d) {
          try { d.gain.gain.linearRampToValueAtTime(d.base * 1.35, c.currentTime + 0.4); } catch (e) {}
        });
        tr.layers.lowBoost = { boost: 1.35 };
      }
    } else if (tr.layers.lowBoost) {
      tr.drones.forEach(function (d) {
        try { d.gain.gain.linearRampToValueAtTime(d.base, c.currentTime + 0.4); } catch (e) {}
      });
      delete tr.layers.lowBoost;
    }
    /* tier2：五度 −18 cent 失谐层 */
    if (tier >= 2) {
      if (!tr.layers.detuneFifth) {
        try {
          var o2 = c.createOscillator();
          var g2 = c.createGain();
          o2.type = 'sine';
          o2.frequency.setValueAtTime(tr.def.root * 1.5, c.currentTime);
          if (o2.detune) o2.detune.setValueAtTime(-18, c.currentTime);
          g2.gain.setValueAtTime(0.015, c.currentTime);
          o2.connect(g2); g2.connect(tr.gain);
          o2.start(c.currentTime);
          tr.nodes.push(o2);
          tr.layers.detuneFifth = { osc: o2, gain: g2 };
        } catch (e) {}
      }
    } else {
      removeLayer(tr, 'detuneFifth');
    }
    /* tier3：40 Hz sub 脉冲（层，不换曲） */
    if (tier >= 3) {
      if (!tr.layers.subPulse) {
        try {
          var o3 = c.createOscillator();
          var g3 = c.createGain();
          o3.type = 'sine';
          o3.frequency.setValueAtTime(40, c.currentTime);
          g3.gain.setValueAtTime(0.012, c.currentTime);
          o3.connect(g3); g3.connect(tr.gain);
          o3.start(c.currentTime);
          tr.nodes.push(o3);
          tr.layers.subPulse = { osc: o3, gain: g3 };
        } catch (e) {}
      }
    } else {
      removeLayer(tr, 'subPulse');
    }
    tr.appliedTier = tier;
  }

  function setDreadTier(tier) {
    dreadTier = Math.max(0, Math.min(3, tier | 0));
    var tr = currentLoop();
    if (!tr || tr.id !== 'boss') return;
    tr.pendingTier = dreadTier;  /* 只登记；BPM 等循环边界 */
    applyLayers(tr, dreadTier);  /* 层立即生效，tier3 包含 tier2 全部层 */
  }

  /* ---------- 模块 ---------- */
  Game.Systems.Music = {
    SPEC: SPEC,
    TRACKS: TRACKS,
    playTrack: playTrack,
    stop: function (fadeMs) { stopAll(fadeMs == null ? 150 : fadeMs); },
    onResume: function () {
      var c = ctx();
      if (!c) return;
      active.forEach(function (tr) {
        if (tr.cycleStart < c.currentTime) seek(tr, c.currentTime);
      });
      nextNoteTime = Math.max(nextNoteTime, c.currentTime + 0.02);
    },
    setDreadTier: setDreadTier,
    fingerprint: fingerprint,
    _curveIn: curveIn,
    _curveOut: curveOut,
    /* 验证页只读钩子：把 Boss 推进到下一个循环边界，走与调度器相同的分支 */
    _testCrossCycle: function () {
      var tr = currentLoop();
      var c = ctx();
      if (!tr || !c || tr.id !== 'boss') return null;
      tr.idx = tr.events.length;
      tr.cycleStart = c.currentTime - tr.cycleDur + 0.02;
      scheduler();
      return Game.Systems.Music._dbg();
    },
    _dbg: function () {
      var c = ctx();
      var cur = currentLoop();
      return {
        spec: SPEC,
        tracks: Object.keys(TRACKS),
        fingerprints: Object.keys(TRACKS).filter(isFloorId).map(fingerprint),
        current: cur ? cur.id : null,
        active: active.map(function (tr) {
          return { id: tr.id, alive: tr.alive, cycleStart: r3(tr.cycleStart), idx: tr.idx, bpm: tr.bpm || tr.def.bpm };
        }),
        position: cur ? { idx: cur.idx, cycleStart: r3(cur.cycleStart), beatSec: r3(cur.beatSec), cycleDur: r3(cur.cycleDur), bpm: cur.bpm || cur.def.bpm } : null,
        boss: (cur && cur.id === 'boss') ? {
          bpm: cur.bpm,
          beatSec: r3(cur.beatSec),
          cycleDur: r3(cur.cycleDur),
          pendingTier: cur.pendingTier,
          appliedTier: cur.appliedTier,
          tempoTier: cur.tempoTier,
          layers: Object.keys(cur.layers || {})
        } : null,
        nextNoteTime: r3(nextNoteTime),
        now: c ? r3(c.currentTime) : null,
        timerOn: !!timer,
        noteLog: noteLog.slice(-40),
        noteTotal: noteLog.length,
        transitions: transitionLog.slice(-12),
        tempoLog: tempoLog.slice(-8),
        dreadTier: dreadTier,
        looping: active.length
      };
    }
  };

  /* 事件驱动：Boss 龙威换档 / 新战斗归零；不做每帧读取 */
  if (Game.Core && Game.Core.EventBus) {
    Game.Core.EventBus.on('battle:start', function () { setDreadTier(0); });
    Game.Core.EventBus.on('battle:turn', function () {
      var B = Game.Systems && Game.Systems.Battle;
      if (!B || typeof B.dragonDread !== 'function') return;
      var d = B.dragonDread();
      if (d) setDreadTier(d.tier);
    });
  }
})();
