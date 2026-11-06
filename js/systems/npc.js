/* js/systems/npc.js — 大模型 NPC 对话（M5）
 * 在线：DeepSeek API（配置 Game.Data.CONFIG.deepseekKey 后启用）
 * 离线：data/dialogue.js 规则兜底
 * 接口：open / close / ask / isOpen（见 PLAN.md §4.4）
 * 事件：npc:open / npc:close
 * 来源：自写（在线对话调 DeepSeek 官方 API） */
(function () {
  'use strict';
  var Game = window.Game = window.Game || {};
  Game.Systems = Game.Systems || {};

  var open = false;
  var history = [];
  var logEl = null;
  var inputEl = null;

  function fallback(text) {
    var rules = Game.Data.NPC.fallback;
    for (var i = 0; i < rules.length; i++) {
      if (rules[i].match.test(text)) return rules[i].reply;
    }
    return Game.Data.NPC.defaultReply;
  }

  /* S-02b：L1 离线反应库接入（PLAN.md §20）。取句顺序：react 按 tag 抽 → 关键词表兜底。
   * bag 去重：同一 role+tag 一轮内不重复，抽完自动重置。
   * 场景过滤：shop 是商店专用 tag，非商店场景直接不取，避免守门人说掌柜台词。 */
  var RECENT = {};
  var SCENE_ONLY = { shop: 'shop' };

  function currentScene() {
    var M = Game.Core && Game.Core.Main;
    return (M && M._scene) || '';
  }

  /* 关键词 → tag。顺序敏感：boss 先于普通击杀，低血先于受伤，shop 先于买卖。 */
  function pickTag(text) {
    var s = String(text || '');
    if (/boss|首领|魔王|巨龙|酋长|僵尸王/.test(s)) return 'kill_boss';
    if (/快死|没血|残血|要死了|命不久/.test(s)) return 'low_hp';
    if (/受伤|疼|流血|挨打|被打/.test(s)) return 'hurt';
    if (/杀|打怪|怪物|战斗|砍/.test(s)) return 'kill';
    if (/买东西|货物|货架|看货|进货/.test(s)) return 'shop';
    if (/金币|钱|价格|贵|便宜/.test(s)) return 'gold';
    if (/捡|道具|物品|装备|宝箱/.test(s)) return 'pickup_item';
    if (/通关|胜利|赢了/.test(s)) return 'victory';
    if (/死了|阵亡/.test(s)) return 'death';
    if (/你好|您好|嗨|在吗|幸会/.test(s)) return 'greeting';
    return 'idle';
  }

  function pickReaction(role, tag) {
    var R = Game.Data.REACTIONS;
    if (!R || !R[role]) return '';
    if (SCENE_ONLY[tag] && currentScene() !== SCENE_ONLY[tag]) return '';
    var list = R[role][tag];
    if (!list || !list.length) return '';
    var key = role + ':' + tag;
    var bag = RECENT[key];
    if (!bag || bag.pool !== list.length) { bag = RECENT[key] = { pool: list.length, used: [] }; }
    if (bag.used.length >= list.length) bag.used = [];
    var idx = Math.floor(Math.random() * list.length);
    var guard = 0;
    while (bag.used.indexOf(idx) >= 0 && guard++ < list.length) idx = (idx + 1) % list.length;
    bag.used.push(idx);
    return list[idx];
  }

  /* 商店场景换商人语料；无对应 tag 时退回守门人，再退回关键词表 */
  function replyFor(text) {
    var scene = currentScene();
    var tag = pickTag(text);
    var role = scene === 'shop' ? 'merchant' : 'guard';
    var line = pickReaction(role, tag);
    if (!line && role !== 'guard') line = pickReaction('guard', tag);
    return line || fallback(text);
  }

  function appendLog(role, text) {
    if (!logEl) return;
    var div = document.createElement('div');
    div.className = 'npc-line npc-' + role;
    div.textContent = (role === 'user' ? '勇者: ' : Game.Data.NPC.name + ': ') + text;
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function doAsk(text) {
    history.push({ role: 'user', content: text });
    appendLog('user', text);
    var key = (Game.Data.CONFIG && Game.Data.CONFIG.deepseekKey) || '';
    if (!key) {
      var off = replyFor(text);
      history.push({ role: 'assistant', content: off });
      appendLog('assistant', off);
      return;
    }
    /* 在线 DeepSeek（走系统代理；失败自动兜底） */
    try {
      var messages = [{ role: 'system', content: Game.Data.NPC.systemPrompt }];
      for (var i = 0; i < history.length; i++) messages.push(history[i]);
      fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
        body: JSON.stringify({ model: 'deepseek-chat', messages: messages, max_tokens: 120 })
      }).then(function (res) {
        return res.json();
      }).then(function (data) {
        var reply = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || replyFor(text);
        history.push({ role: 'assistant', content: reply });
        appendLog('assistant', reply);
      }).catch(function () {
        var off2 = replyFor(text);
        history.push({ role: 'assistant', content: off2 });
        appendLog('assistant', off2);
      });
    } catch (e) {
      var off3 = replyFor(text);
      history.push({ role: 'assistant', content: off3 });
      appendLog('assistant', off3);
    }
  }

  function onInputKey(e) {
    if (e.key === 'Enter' && e.target.value.trim()) {
      var text = e.target.value.trim();
      e.target.value = '';
      doAsk(text);
    }
  }

  Game.Systems.NPC = {
    bind: function () {
      logEl = document.getElementById('npc-log');
      inputEl = document.getElementById('npc-input');
      if (inputEl) inputEl.addEventListener('keydown', onInputKey);
    },

    open: function () {
      open = true;
      var panel = document.getElementById('npc');
      if (panel) panel.style.display = 'block';
      if (inputEl) setTimeout(function () { inputEl.focus(); }, 30);
      Game.Core.EventBus.emit('npc:open', {});
    },

    close: function () {
      open = false;
      var panel = document.getElementById('npc');
      if (panel) panel.style.display = 'none';
      Game.Core.EventBus.emit('npc:close', {});
    },

    isOpen: function () { return open; },

    /* 测试/脚本用：直接取一句（反应库优先，关键词表兜底） */
    ask: function (text) {
      return replyFor(text);
    }
  };
})();
