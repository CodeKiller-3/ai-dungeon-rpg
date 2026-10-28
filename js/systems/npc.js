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
      var off = fallback(text);
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
        var reply = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || fallback(text);
        history.push({ role: 'assistant', content: reply });
        appendLog('assistant', reply);
      }).catch(function () {
        var off2 = fallback(text);
        history.push({ role: 'assistant', content: off2 });
        appendLog('assistant', off2);
      });
    } catch (e) {
      var off3 = fallback(text);
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

    /* 测试/脚本用：直接提问返回兜底文本 */
    ask: function (text) {
      return fallback(text);
    }
  };
})();
