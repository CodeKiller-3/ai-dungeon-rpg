/* js/systems/audio.js — 音频系统（M7 + M9-4）
 * 引擎：引入 GitHub 开源库 howler.js（goldfire/howler.js，MIT，js/vendor/howler.min.js）
 *       —— 作为播放核心，支持后续加载任意本地/远程音频素材；
 * 内置音效：Web Audio API 程序化合成（零素材依赖，离线可用）
 * M9-4 扩展：BGM 三场景旋律合成器 + 静音 + 音量持久化
 * 接口（M7 既有）：init / bind / play / 经事件频道 audio:play 触发
 * 接口（M9-4 新增）：
 *   bgmPlay(scene)   scene: 'explore'|'battle'|'victory'|null(停)
 *   bgmStop()
 *   getBgmScene() -> string|null
 *   setMuted(bool)   一键静音（含音效与 BGM），emit 'audio:muted'（纯新增频道）
 *   isMuted() -> bool
 *   setVolume(v)     0..1 钳制；写 localStorage 键 'aiDungeon_volume'
 *   getVolume() -> number  启动时从 localStorage 读（无记录默认 0.7）
 * 约束：
 *   - 不改既有音效触发点与事件频道（audio:muted 为纯新增）
 *   - 静音与音量作用于同一个主 Gain 节点（音效+BGM 一并控制）
 *   - 无 AudioContext 时全部静默降级，不抛错
 * 来源：自写（合成逻辑）+ howler 引擎 */
(function () {
  'use strict';
  var Game = window.Game = window.Game || {};
  Game.Systems = Game.Systems || {};

  var ctx = null;
  var master = null;
  var BASE_GAIN = 0.25;          /* 主增益基准（M7 原有） */
  var volume = 0.7;              /* 用户音量 0..1（localStorage 持久化，默认 0.7） */
  var muted = false;
  var LS_KEY = 'aiDungeon_volume';

  /* ---------- M9-4：BGM 状态机 ---------- */
  var bgmScene = null;           /* 当前 BGM 场景：'explore'|'battle'|'victory'|null */
  var bgmTimer = null;           /* lookahead 调度定时器 */
  var nextNoteTime = 0;          /* 下一个音符的 AudioContext 时间 */
  var bgmStep = 0;               /* 当前音符步进 */
  var SCHEDULE_AHEAD = 0.12;     /* 预调度窗口（秒） */

  /* 三场景旋律：探索低沉、战斗快节奏、通关明亮上行（零外部音频，Web Audio 合成） */
  var BGM_PATTERNS = {
    explore: {
      notes: [110.00, 130.81, 146.83, 130.81, 110.00, 164.81, 146.83, 130.81],
      stepMs: 520, type: 'sine', vol: 0.05,
      drone: { freq: 55, vol: 0.025 }  /* 低频持续 drone，营造地牢氛围 */
    },
    battle: {
      notes: [220.00, 277.18, 329.63, 277.18, 220.00, 196.00, 246.94, 293.66],
      stepMs: 180, type: 'square', vol: 0.045,
      drone: null
    },
    victory: {
      notes: [523.25, 659.25, 783.99, 1046.50, 783.99, 1046.50],
      stepMs: 320, type: 'triangle', vol: 0.06,
      drone: null
    }
  };

  var droneOsc = null;
  var droneGain = null;

  function ensureCtx() {
    if (ctx) return true;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try {
      ctx = new AC();
      master = ctx.createGain();
      applyGain();
      master.connect(ctx.destination);
      return true;
    } catch (e) { return false; }
  }

  /* 根据 muted/volume 计算并设置 master gain */
  function applyGain() {
    if (!master) return;
    var v = muted ? 0 : BASE_GAIN * volume;
    try {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(v, ctx.currentTime);
    } catch (e) { /* 降级 */ }
  }

  /* 调度单个 BGM 音符 */
  function scheduleNote(pat, step, time) {
    if (!ctx || !master) return;
    var freq = pat.notes[step % pat.notes.length];
    var dur = pat.stepMs / 1000;
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.type = pat.type;
    osc.frequency.setValueAtTime(freq, time);
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(pat.vol, time + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur * 0.9);
    osc.connect(g);
    g.connect(master);
    osc.start(time);
    osc.stop(time + dur + 0.02);
  }

  /* lookahead 调度器：提前 SCHEDULE_AHEAD 秒排程音符 */
  function scheduler() {
    if (!ctx || !bgmScene) return;
    var pat = BGM_PATTERNS[bgmScene];
    if (!pat) return;
    while (nextNoteTime < ctx.currentTime + SCHEDULE_AHEAD) {
      scheduleNote(pat, bgmStep, nextNoteTime);
      nextNoteTime += pat.stepMs / 1000;
      bgmStep++;
    }
  }

  /* 启动低频 drone（仅 explore 场景） */
  function startDrone(pat) {
    stopDrone();
    if (!pat.drone || !ctx || !master) return;
    try {
      droneOsc = ctx.createOscillator();
      droneGain = ctx.createGain();
      droneOsc.type = 'sine';
      droneOsc.frequency.value = pat.drone.freq;
      droneGain.gain.value = pat.drone.vol;
      droneOsc.connect(droneGain);
      droneGain.connect(master);
      droneOsc.start();
    } catch (e) { /* 降级 */ }
  }
  function stopDrone() {
    if (droneOsc) {
      try { droneOsc.stop(); } catch (e) {}
      try { droneOsc.disconnect(); } catch (e) {}
      droneOsc = null;
    }
    if (droneGain) {
      try { droneGain.disconnect(); } catch (e) {}
      droneGain = null;
    }
  }

  function startBgm(scene) {
    stopBgm();
    var pat = BGM_PATTERNS[scene];
    if (!pat) return;
    if (!ensureCtx()) return;
    if (ctx.state === 'suspended') ctx.resume();
    bgmScene = scene;
    bgmStep = 0;
    nextNoteTime = ctx.currentTime + 0.05;
    startDrone(pat);
    bgmTimer = setInterval(scheduler, 25);
  }

  function stopBgm() {
    if (bgmTimer) { clearInterval(bgmTimer); bgmTimer = null; }
    stopDrone();
    bgmScene = null;
  }

  /* ---------- M7 既有 SFX ---------- */
  function tone(freq, dur, type, vol, slideTo) {
    if (!ctx || !master) return;
    var t = ctx.currentTime;
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.type = type || 'square';
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol || 0.12, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  var SFX = {
    move: function () { tone(200, 0.05, 'square', 0.05, 170); },
    attack: function () { tone(420, 0.12, 'sawtooth', 0.1, 90); tone(300, 0.08, 'square', 0.06, 120); },
    hit: function () { tone(160, 0.1, 'triangle', 0.14, 90); },
    defend: function () { tone(240, 0.08, 'sine', 0.08, 200); },
    run: function () { tone(500, 0.18, 'sine', 0.08, 250); },
    gold: function () { tone(660, 0.08, 'square', 0.08); setTimeout(function () { tone(880, 0.1, 'square', 0.08); }, 70); },
    stair: function () { tone(300, 0.25, 'sine', 0.1, 640); },
    buy: function () { tone(520, 0.07, 'square', 0.08); setTimeout(function () { tone(780, 0.09, 'square', 0.07); }, 60); },
    quest: function () { tone(523, 0.1, 'triangle', 0.1); setTimeout(function () { tone(659, 0.1, 'triangle', 0.1); }, 90); setTimeout(function () { tone(784, 0.14, 'triangle', 0.1); }, 180); },
    victory: function () { tone(523, 0.12, 'square', 0.09); setTimeout(function () { tone(659, 0.12, 'square', 0.09); }, 110); setTimeout(function () { tone(784, 0.12, 'square', 0.09); }, 220); setTimeout(function () { tone(1046, 0.2, 'square', 0.09); }, 330); },
    lose: function () { tone(300, 0.3, 'sawtooth', 0.08, 120); }
  };

  /* ---------- 音量持久化 ---------- */
  function loadVolume() {
    try {
      var v = localStorage.getItem(LS_KEY);
      if (v === null) return 0.7;
      var n = parseFloat(v);
      if (isNaN(n) || n < 0 || n > 1) return 0.7;
      return n;
    } catch (e) { return 0.7; }
  }
  function saveVolume(v) {
    try { localStorage.setItem(LS_KEY, String(v)); } catch (e) { /* 隐私模式等降级 */ }
  }

  /* 初始化时读取音量 */
  volume = loadVolume();

  Game.Systems.Audio = {
    /* 绑定事件频道：任何模块 emit audio:play 即发声 */
    bind: function () {
      Game.Core.EventBus.on('audio:play', function (evt) {
        Game.Systems.Audio.play(evt.sfx);
      });
    },
    init: function () {
      /* 浏览器自动播放策略：首次用户手势时解锁 */
      var self = this;
      var unlock = function () {
        ensureCtx();
        if (ctx && ctx.state === 'suspended') ctx.resume();
        window.removeEventListener('keydown', unlock);
      };
      window.addEventListener('keydown', unlock);
    },
    play: function (name) {
      ensureCtx();
      if (!ctx) return;
      if (ctx.state === 'suspended') ctx.resume();
      var fn = SFX[name];
      if (fn) fn();
    },

    /* ---------- M9-4：BGM ---------- */
    bgmPlay: function (scene) {
      if (!scene || !BGM_PATTERNS[scene]) return;  /* 非法 scene 忽略 */
      startBgm(scene);
    },
    bgmStop: function () {
      stopBgm();
    },
    getBgmScene: function () {
      return bgmScene;
    },

    /* ---------- M9-4：静音 ---------- */
    setMuted: function (bool) {
      muted = !!bool;
      ensureCtx();
      applyGain();
      if (Game.Core && Game.Core.EventBus) {
        Game.Core.EventBus.emit('audio:muted', { muted: muted });
      }
    },
    isMuted: function () {
      return muted;
    },

    /* ---------- M9-4：音量（0..1，localStorage 持久化） ---------- */
    setVolume: function (v) {
      var n = (typeof v === 'number') ? v : parseFloat(v);
      if (isNaN(n)) return;
      n = Math.min(Math.max(n, 0), 1);  /* 钳制到 0..1 */
      volume = n;
      saveVolume(n);
      ensureCtx();
      applyGain();
    },
    getVolume: function () {
      return volume;
    },

    /* 调试用：暴露内部状态（验证页） */
    _dbg: function () {
      return { volume: volume, muted: muted, bgmScene: bgmScene, hasCtx: !!ctx };
    }
  };
})();
