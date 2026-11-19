/* js/systems/audio.js — 音频总线、音效、解锁与 ducking（M7 + M9-4 + D-124）
 * 引擎：原生 Web Audio（程序化合成，零音频文件、零 fetch/XHR、零 Math.random）
 * D-124 总线结构（与 docs/系统视觉语言-规范.md §19.5.1 一致）：
 *   master (BASE_GAIN × volume，静音时 0)
 *   ├─ sfxBus   (1.00)          ← 既有 11 个 SFX，相对音量一字未改
 *   └─ musicBus (0.50 = −6 dB)  ← 「音乐」开关只切这一条
 *       └─ duckGain (1.00 → 按 §19.5.3 下压)
 *           └─ musicLP (低通；暂停 800 Hz / 学习者 1.2 kHz)
 *               └─ 各层曲目（js/systems/music.js）
 *   jingle（胜利/死亡）直接进 musicBus，绕过 duckGain。
 * 接口（M7/M9-4 既有，签名不变）：
 *   init / bind / play / bgmPlay / bgmStop / getBgmScene
 *   setMuted / isMuted / setVolume / getVolume
 * D-124 新增：
 *   getMusicTrack()             当前真实曲目键 f1..f5 / battle / elite / boss / menu / victory / death
 *   setMusicEnabled(bool) / isMusicEnabled() / getMusicEnabled()
 *   setFocusMode(mode,on)       mode: pause | subpage | learner（可叠加，取最深一档，不叠乘）
 *   _dbg / _buses / _ensure / _resetForTest（验证页只读/测试钩子）
 * 约束：
 *   - 解锁前只记 pendingTrack，绝不在 suspended 状态下起调度器
 *   - 音频代码零 Math.random；不发起任何网络请求
 *   - 调度仍由 music.js 的 25 ms lookahead 负责，本文件不做每帧音频工作
 * 来源：自写（合成与总线逻辑） */

(function () {
  'use strict';
  var Game = window.Game = window.Game || {};
  Game.Systems = Game.Systems || {};

  var ctx = null;
  var master = null;        /* 总增益：静音与音量滑块唯一作用点 */
  var sfxBus = null;        /* 音效总线，恒 1.0 */
  var musicBus = null;      /* 音乐总线，默认 0.5（−6 dB），音乐开关只切它 */
  var duckGain = null;      /* ducking 唯一增益级（不叠乘） */
  var musicLP = null;       /* 音乐低通（暂停/学习者用） */

  var BASE_GAIN = 0.25;     /* 主增益基准（M7 原有，不改） */
  var MUSIC_BUS_GAIN = 0.5; /* §19.5.2：musicBus 固定 −6 dB */
  var volume = 0.7;         /* 用户音量 0..1（localStorage 持久化，默认 0.7） */
  var muted = false;
  var musicEnabled = true;  /* 「音乐」开关，默认开；只切 musicBus */
  var LS_KEY = 'aiDungeon_volume';

  /* ---------- 场景/曲目状态 ---------- */
  var bgmScene = null;      /* 旧接口语义：explore / battle / victory / menu / death */
  var bgmTrack = null;      /* D-124 真实曲目键：f1..f5 / battle / elite / boss / menu / victory / death */
  var pendingTrack = null;  /* 首次手势前只记这里，不起调度器 */
  var unlocked = false;     /* 是否已收到过用户手势 */
  var unlockBound = false;

  /* ---------- ducking 状态 ---------- */
  var duckModes = { pause: false, subpage: false, learner: false };
  var duckReq = [];         /* 一次性请求：{id, db, attackMs, holdMs, releaseMs, until} */
  var duckSeq = 0;
  var duckTargetDb = 0;
  var duckLog = [];         /* 验证页读取的时间/增益记录 */
  var pauseSuspendTimer = null;
  var DUCK_RELEASE_DEFAULT = 260;

  /* §19.5.3：P0/P1 一次性 ducking 表。hold = 音效本体时长 + 120 ms（P0）/ 90 ms（P1）。 */
  var SFX_DUCK = {
    hit:     { db: -6, attackMs: 30, holdMs: 220, releaseMs: 260 }, /* 0.10 s + 120 */
    stair:   { db: -6, attackMs: 30, holdMs: 370, releaseMs: 260 }, /* 0.25 s + 120 */
    attack:  { db: -3, attackMs: 30, holdMs: 90,  releaseMs: 220 },
    defend:  { db: -3, attackMs: 30, holdMs: 90,  releaseMs: 220 },
    gold:    { db: -3, attackMs: 30, holdMs: 90,  releaseMs: 220 },
    buy:     { db: -3, attackMs: 30, holdMs: 90,  releaseMs: 220 },
    quest:   { db: -3, attackMs: 30, holdMs: 90,  releaseMs: 220 }
    /* move / run = P2（0）；victory / lose 是 jingle，不压音乐 */
  };

  /* 常驻 ducking 档（取最深一档；不叠乘） */
  var FOCUS_DUCK = {
    pause:   { db: -9,  attackMs: 40,  releaseMs: 200, lp: 800 },
    subpage: { db: -6,  attackMs: 120, releaseMs: 300, lp: 20000 },
    learner: { db: -12, attackMs: 120, releaseMs: 300, lp: 1200 }
  };
  var LP_OPEN = 20000;

  function now() { return (ctx && typeof ctx.currentTime === 'number') ? ctx.currentTime : 0; }
  function dbToGain(db) { return Math.pow(10, db / 20); }
  function safeResume() {
    if (!ctx || ctx.state !== 'suspended') return;
    try {
      var p = ctx.resume();
      if (p && typeof p.then === 'function' && typeof p.catch === 'function') p.catch(function () {});
    } catch (e) { /* 无手势/无实现：静默降级 */ }
  }

  function ensureCtx() {
    if (ctx) return true;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try {
      ctx = new AC();
      master = ctx.createGain();
      sfxBus = ctx.createGain();
      musicBus = ctx.createGain();
      duckGain = ctx.createGain();
      musicLP = ctx.createBiquadFilter();

      master.gain.value = BASE_GAIN;
      sfxBus.gain.value = 1;
      musicBus.gain.value = musicEnabled ? MUSIC_BUS_GAIN : 0;
      duckGain.gain.value = 1;
      musicLP.type = 'lowpass';
      musicLP.frequency.value = LP_OPEN;
      musicLP.Q.value = Math.SQRT1_2;

      sfxBus.connect(master);
      musicBus.connect(duckGain);
      duckGain.connect(musicLP);
      musicLP.connect(master);
      master.connect(ctx.destination);
      applyGain();
      applyMusicGain(0);
      return true;
    } catch (e) {
      ctx = null; master = null; sfxBus = null; musicBus = null; duckGain = null; musicLP = null;
      return false;
    }
  }

  /* master 增益：静音 → 0；否则 BASE_GAIN × volume（与 M9-4 完全一致） */
  function applyGain() {
    if (!master) return;
    var v = muted ? 0 : BASE_GAIN * volume;
    try {
      var t = now();
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(v, t);
    } catch (e) { /* 降级 */ }
  }

  /* musicBus 增益：音乐开关只改这里，不碰 master / sfxBus */
  function applyMusicGain(rampMs) {
    if (!musicBus) return;
    var target = musicEnabled ? MUSIC_BUS_GAIN : 0;
    try {
      var t = now();
      musicBus.gain.cancelScheduledValues(t);
      musicBus.gain.setValueAtTime(musicBus.gain.value, t);
      if (rampMs > 0) musicBus.gain.linearRampToValueAtTime(target, t + rampMs / 1000);
      else musicBus.gain.setValueAtTime(target, t);
    } catch (e) { /* 降级 */ }
  }

  /* ---------- ducking（只作用于 musicBus 之后的 duckGain） ---------- */
  function deepestMode() {
    var best = null;
    ['pause', 'subpage', 'learner'].forEach(function (m) {
      if (!duckModes[m]) return;
      var d = FOCUS_DUCK[m];
      if (!best || d.db < best.db) best = { mode: m, db: d.db, attackMs: d.attackMs, releaseMs: d.releaseMs, lp: d.lp };
    });
    return best;
  }

  function recomputeDuck(reason) {
    if (!ctx || !duckGain) return;
    var t = now();
    /* 清掉已过期的一次性请求（它们的 release 已在下面统一处理） */
    duckReq = duckReq.filter(function (r) { return r.until > t - 0.0001; });

    var mode = deepestMode();
    var target = mode ? mode.db : 0;
    var attackMs = mode ? mode.attackMs : 30;
    var releaseMs = mode ? mode.releaseMs : DUCK_RELEASE_DEFAULT;
    var holdMs = 0;
    var sources = mode ? ['mode:' + mode.mode] : [];

    for (var i = 0; i < duckReq.length; i++) {
      var r = duckReq[i];
      if (r.db < target) {
        target = r.db;
        attackMs = r.attackMs;
      }
      if (r.releaseMs > releaseMs) releaseMs = r.releaseMs;
      if (r.holdMs > holdMs) holdMs = r.holdMs;
      sources.push(r.id);
    }

    duckTargetDb = target;
    var g = (target === 0) ? 1 : dbToGain(target);
    try {
      duckGain.gain.cancelScheduledValues(t);
      duckGain.gain.setValueAtTime(duckGain.gain.value, t);
      if (g < 1) {
        duckGain.gain.linearRampToValueAtTime(g, t + Math.max(1, attackMs) / 1000);
        /* 一次性请求：hold 到最晚的 until，再按最长 release 回 1。
         * 全部用 AudioParam 自动化，不注册 setTimeout（不污染战斗时钟守卫）。 */
        if (!mode && duckReq.length) {
          var holdEnd = t;
          for (var h = 0; h < duckReq.length; h++) holdEnd = Math.max(holdEnd, duckReq[h].until);
          if (holdEnd > t) {
            duckGain.gain.setValueAtTime(g, holdEnd);
            duckGain.gain.linearRampToValueAtTime(1, holdEnd + Math.max(1, releaseMs) / 1000);
          }
        }
      } else {
        duckGain.gain.linearRampToValueAtTime(1, t + Math.max(1, releaseMs) / 1000);
      }
    } catch (e) { /* 降级 */ }

    /* 低通：常驻档取最深的那个（暂停 800 / 学习者 1200），一次性音效不改低通 */
    var lp = LP_OPEN;
    ['pause', 'learner'].forEach(function (m) {
      if (duckModes[m]) lp = Math.min(lp, FOCUS_DUCK[m].lp);
    });
    try {
      musicLP.frequency.cancelScheduledValues(t);
      musicLP.frequency.setValueAtTime(musicLP.frequency.value, t);
      var lpMs = mode ? mode.attackMs : 200;
      musicLP.frequency.linearRampToValueAtTime(lp, t + lpMs / 1000);
    } catch (e) { /* 降级 */ }

    duckLog.push({
      at: Math.round(t * 1000) / 1000,
      reason: reason || 'change',
      targetDb: target,
      attackMs: attackMs,
      holdMs: holdMs,
      releaseMs: releaseMs,
      recoveryMs: attackMs + holdMs + releaseMs,
      sources: sources.slice(0),
      multiplicative: false
    });
    if (duckLog.length > 40) duckLog.shift();
  }

  function duckForSfx(name) {
    var d = SFX_DUCK[name];
    if (!d || !ctx || !duckGain) return;
    duckSeq++;
    var t = now();
    duckReq.push({
      id: 'sfx:' + name + '#' + duckSeq,
      db: d.db,
      attackMs: d.attackMs,
      holdMs: d.holdMs,
      releaseMs: d.releaseMs,
      until: t + (d.attackMs + d.holdMs) / 1000
    });
    recomputeDuck('sfx:' + name);
  }

  /* ---------- SFX（11 个，波形/频率/包络与 M7/M9-4 逐字一致） ---------- */
  function tone(freq, dur, type, vol, slideTo) {
    if (!ctx || !sfxBus) return;
    var t = ctx.currentTime;
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.type = type || 'square';
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol || 0.12, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(sfxBus);   /* D-124：唯一改动——从 master 改到 sfxBus（其增益恒 1.0） */
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
  var SFX_NAMES = ['move', 'attack', 'hit', 'defend', 'run', 'gold', 'stair', 'buy', 'quest', 'victory', 'lose'];

  /* ---------- 解锁：keydown / pointerdown / touchstart，任一即解锁并移除全部 ---------- */
  function unlock() {
    if (unlocked) return;
    unlocked = true;
    removeUnlockListeners();
    ensureCtx();
    var after = function () { startPending(); };
    try {
      if (ctx && ctx.state === 'suspended') {
        var p = ctx.resume();
        if (p && typeof p.then === 'function') p.then(after, after);
        else after();
      } else {
        after();
      }
    } catch (e) { after(); }
  }

  function startPending() {
    var req = pendingTrack;
    pendingTrack = null;
    if (!req) return;
    var M = Game.Systems && Game.Systems.Music;
    if (M && typeof M.playTrack === 'function') M.playTrack(req.track, req);
  }

  function addUnlockListeners() {
    if (unlockBound) return;
    unlockBound = true;
    window.addEventListener('keydown', unlock);
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('touchstart', unlock, { passive: true });
  }
  function removeUnlockListeners() {
    if (!unlockBound) return;
    unlockBound = false;
    window.removeEventListener('keydown', unlock);
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('touchstart', unlock);
  }

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
  volume = loadVolume();

  /* ---------- 场景 → 曲目解析（§19.9 #7：explore 是场景别名） ---------- */
  function currentFloor() {
    var P = Game.Data && Game.Data.Player;
    var f = (P && P.floor) | 0;
    if (f < 1) f = 1;
    if (f > 5) f = 5;
    return f;
  }
  function floorTrack(f) { return 'f' + f; }
  function resolveRequest(scene) {
    if (!scene || typeof scene !== 'string') return null;
    if (scene === 'explore') {
      var f = currentFloor();
      return { scene: 'explore', track: floorTrack(f), floor: f };
    }
    if (scene === 'battle') {
      var st = (Game.Systems && Game.Systems.Battle && typeof Game.Systems.Battle.getState === 'function')
        ? Game.Systems.Battle.getState() : null;
      var id = st && st.monster && st.monster.id;
      var def = id && Game.Data && Game.Data.MONSTERS ? Game.Data.MONSTERS[id] : null;
      var track = (def && def.boss) ? 'boss' : ((def && def.elite) ? 'elite' : 'battle');
      return { scene: 'battle', track: track, monsterId: id || null };
    }
    if (scene === 'elite') return { scene: 'battle', track: 'elite' };
    if (scene === 'boss') return { scene: 'battle', track: 'boss' };
    if (scene === 'victory') return { scene: 'victory', track: 'victory' };
    if (scene === 'death') return { scene: 'death', track: 'death' };
    if (scene === 'menu') return { scene: 'menu', track: 'menu' };
    if (/^f[1-5]$/.test(scene)) return { scene: 'explore', track: scene, floor: parseInt(scene.slice(1), 10) };
    return null;
  }

  Game.Systems.Audio = {
    /* 绑定事件频道：任何模块 emit audio:play 即发声 */
    bind: function () {
      Game.Core.EventBus.on('audio:play', function (evt) {
        Game.Systems.Audio.play(evt.sfx);
      });
    },
    init: function () {
      ensureCtx();            /* 只建 suspended context 与总线，不起调度器 */
      addUnlockListeners();   /* keydown / pointerdown / touchstart 任一即解锁 */
    },
    play: function (name) {
      ensureCtx();
      if (!ctx) return;
      safeResume();
      var fn = SFX[name];
      if (fn) fn();
      duckForSfx(name);
    },

    /* ---------- BGM ---------- */
    bgmPlay: function (scene) {
      var req = resolveRequest(scene);
      if (!req) return;                  /* 非法 scene 忽略（M9-4 断言） */
      bgmScene = req.scene;
      if (bgmTrack === req.track) return; /* 同曲目不重启（换层因 track 不同而必换） */
      bgmTrack = req.track;
      if (!unlocked || !ctx || ctx.state !== 'running') {
        pendingTrack = req;              /* 首次手势前只记，不排程 */
        return;
      }
      pendingTrack = null;
      var M = Game.Systems && Game.Systems.Music;
      if (M && typeof M.playTrack === 'function') M.playTrack(req.track, req);
    },
    bgmStop: function () {
      bgmScene = null;
      bgmTrack = null;
      pendingTrack = null;
      var M = Game.Systems && Game.Systems.Music;
      if (M && typeof M.stop === 'function') M.stop(150);
    },
    getBgmScene: function () { return bgmScene; },
    getMusicTrack: function () { return bgmTrack; },

    /* ---------- 静音（master） ---------- */
    setMuted: function (bool) {
      muted = !!bool;
      ensureCtx();
      applyGain();
      if (Game.Core && Game.Core.EventBus) {
        Game.Core.EventBus.emit('audio:muted', { muted: muted });
      }
    },
    isMuted: function () { return muted; },

    /* ---------- 音量（master，0..1，localStorage 持久化） ---------- */
    setVolume: function (v) {
      var n = (typeof v === 'number') ? v : parseFloat(v);
      if (isNaN(n)) return;
      n = Math.min(Math.max(n, 0), 1);
      volume = n;
      saveVolume(n);
      ensureCtx();
      applyGain();
    },
    getVolume: function () { return volume; },

    /* ---------- 音乐开关（只切 musicBus） ---------- */
    setMusicEnabled: function (bool) {
      musicEnabled = !!bool;
      ensureCtx();
      applyMusicGain(80);
      return musicEnabled;
    },
    isMusicEnabled: function () { return musicEnabled; },
    getMusicEnabled: function () { return musicEnabled; },

    /* ---------- 常驻 ducking（pause / subpage / learner，可叠加但取最深） ---------- */
    setFocusMode: function (mode, on) {
      if (!(mode in duckModes)) return false;
      duckModes[mode] = !!on;
      if (mode === 'pause') schedulePauseSuspend(!!on);
      recomputeDuck('mode:' + mode + ':' + (on ? 'on' : 'off'));
      return true;
    },
    getFocusModes: function () {
      return { pause: !!duckModes.pause, subpage: !!duckModes.subpage, learner: !!duckModes.learner };
    },

    /* ---------- 验证页/调试只读 ---------- */
    _dbg: function () {
      var M = Game.Systems && Game.Systems.Music;
      var md = (M && typeof M._dbg === 'function') ? M._dbg() : null;
      return {
        volume: volume,
        muted: muted,
        musicEnabled: musicEnabled,
        bgmScene: bgmScene,
        bgmTrack: bgmTrack,
        pendingTrack: pendingTrack ? pendingTrack.track : null,
        unlocked: unlocked,
        hasCtx: !!ctx,
        ctxState: ctx ? ctx.state : null,
        sfxNames: SFX_NAMES.slice(0),
        buses: {
          master: master ? master.gain.value : null,
          sfx: sfxBus ? sfxBus.gain.value : null,
          music: musicBus ? musicBus.gain.value : null,
          duck: duckGain ? duckGain.gain.value : null,
          lowpass: musicLP ? musicLP.frequency.value : null
        },
        duck: {
          targetDb: duckTargetDb,
          modes: { pause: !!duckModes.pause, subpage: !!duckModes.subpage, learner: !!duckModes.learner },
          sources: duckReq.map(function (r) { return r.id; }),
          multiplicative: false,
          log: duckLog.slice(0)
        },
        music: md
      };
    },
    _buses: function () {
      return { master: master, sfxBus: sfxBus, musicBus: musicBus, duckGain: duckGain, musicLP: musicLP };
    },
    _ctx: function () { return ctx; },
    _ensure: function () { return ensureCtx(); },
    _unlock: unlock,
    _resetForTest: function () {
      removeUnlockListeners();
      if (pauseSuspendTimer) { clearTimeout(pauseSuspendTimer); pauseSuspendTimer = null; }
      var M = Game.Systems && Game.Systems.Music;
      if (M && typeof M.stop === 'function') { try { M.stop(0); } catch (e) {} }
      try { if (ctx && typeof ctx.close === 'function') ctx.close(); } catch (e) {}
      ctx = null; master = null; sfxBus = null; musicBus = null; duckGain = null; musicLP = null;
      bgmScene = null; bgmTrack = null; pendingTrack = null;
      unlocked = false;
      duckModes = { pause: false, subpage: false, learner: false };
      duckReq = []; duckLog = []; duckTargetDb = 0;
      return true;
    }
  };

  /* 暂停 > 60 s 主动 suspend（§19.4.1 / §19.6.1）；恢复时 resume 并让 music 钳 nextNoteTime */
  function schedulePauseSuspend(on) {
    if (pauseSuspendTimer) { clearTimeout(pauseSuspendTimer); pauseSuspendTimer = null; }
    if (on) {
      pauseSuspendTimer = setTimeout(function () {
        pauseSuspendTimer = null;
        if (!duckModes.pause || !ctx || ctx.state !== 'running') return;
        try {
          var p = ctx.suspend();
          if (p && typeof p.then === 'function' && typeof p.catch === 'function') p.catch(function () {});
        } catch (e) { /* 降级 */ }
      }, 60000);
      if (pauseSuspendTimer && typeof pauseSuspendTimer.unref === 'function') pauseSuspendTimer.unref();
    } else {
      if (ctx && ctx.state === 'suspended') safeResume();
      var M = Game.Systems && Game.Systems.Music;
      if (M && typeof M.onResume === 'function') M.onResume();
    }
  }
})();
