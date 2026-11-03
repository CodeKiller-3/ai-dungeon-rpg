/* js/systems/leaderboard.js — 本地排行榜（M8-5，纯新增模块）
 * 契约（docs/tasks/M8-5-leaderboard.md §2.1）：
 *   Game.Systems.Leaderboard.submit(entry) -> array   // 写入并返回最新列表（新→旧）
 *   Game.Systems.Leaderboard.get() -> array           // 最近 10 条（新→旧）
 *   Game.Systems.Leaderboard.clear() -> void
 *   entry: { timeSec, gold, level, floor, date }
 * 存储：localStorage 键 aiDungeon_leaderboard，JSON 数组，最多 10 条（超出丢最旧）
 * 降级：读写均 try/catch——存储禁用时 submit 不写入、get 返回空数组，全程不抛错
 * 来源：自写 */
(function () {
  'use strict';
  var Game = window.Game = window.Game || {};
  Game.Systems = Game.Systems || {};

  var KEY = 'aiDungeon_leaderboard';
  var MAX = 10;
  var cache = null; /* 运行时缓存：渲染层每帧取榜单不反复读 localStorage */

  /* 读取并规范化：仅保留对象条目、最多 MAX 条；解析失败/存储禁用返回空数组 */
  function readStore() {
    if (cache) return cache;
    var out = [];
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (var i = 0; i < parsed.length && out.length < MAX; i++) {
            if (parsed[i] && typeof parsed[i] === 'object') out.push(parsed[i]);
          }
        }
      }
    } catch (e) { out = []; }
    cache = out;
    return cache;
  }

  function writeStore(list) {
    try {
      localStorage.setItem(KEY, JSON.stringify(list));
      return true;
    } catch (e) { return false; }
  }

  Game.Systems.Leaderboard = {
    MAX: MAX,

    /* 新记录插到最前（新→旧）；超出 10 条丢最旧（数组末尾）；写入成功才更新缓存 */
    submit: function (entry) {
      if (!entry || typeof entry !== 'object') return this.get();
      var list = readStore().slice(0, MAX);
      list.unshift(entry);
      if (list.length > MAX) list = list.slice(0, MAX);
      if (writeStore(list)) cache = list;
      return this.get();
    },

    get: function () { return readStore().slice(); },

    clear: function () {
      cache = [];
      try { localStorage.removeItem(KEY); } catch (e) { /* 存储禁用静默降级 */ }
    }
  };
})();
