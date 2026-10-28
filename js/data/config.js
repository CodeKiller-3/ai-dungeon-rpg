/* js/data/config.js — 运行时配置
 * deepseekKey：填入 DeepSeek API Key 后启用在线 NPC 对话（本地使用，勿提交真实 Key）
 * 来源：自写 */
(function () {
  'use strict';
  var Game = window.Game = window.Game || {};
  Game.Data = Game.Data || {};

  Game.Data.CONFIG = {
    deepseekKey: ''
  };
})();
