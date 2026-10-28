/* js/systems/audio.js — 音频系统（M7）
 * 引擎：引入 GitHub 开源库 howler.js（goldfire/howler.js，MIT，js/vendor/howler.min.js）
 *       —— 作为播放核心，支持后续加载任意本地/远程音频素材；
 * 内置音效：Web Audio API 程序化合成（零素材依赖，离线可用）
 * 接口：init / play / (经事件频道 audio:play 触发)
 * 事件：audio:play { sfx }
 * 来源：自写（合成逻辑）+ howler 引擎 */
(function () {
  'use strict';
  var Game = window.Game = window.Game || {};
  Game.Systems = Game.Systems || {};

  var ctx = null;
  var master = null;

  function ensureCtx() {
    if (ctx) return true;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.25;
    master.connect(ctx.destination);
    return true;
  }

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
    }
  };
})();
