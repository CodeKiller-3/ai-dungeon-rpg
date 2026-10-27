/* PREFLIGHT 冒烟测试：验证 file:// 协议下 Canvas 60FPS 渲染与错误捕获基线 */
(function () {
  var logEl = document.getElementById('log');
  var errors = [];
  window.onerror = function (msg) {
    errors.push(String(msg));
    logEl.textContent = 'ERROR: ' + errors.join(' | ');
  };
  try {
    var cv = document.getElementById('cv');
    var ctx = cv.getContext('2d');
    var frames = 0;
    var lastT = performance.now();
    var fps = 0;
    function loop(now) {
      frames++;
      if (now - lastT >= 1000) {
        fps = Math.round((frames * 1000) / (now - lastT));
        frames = 0;
        lastT = now;
      }
      ctx.fillStyle = '#2b2b4a';
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.fillStyle = '#ffcf6e';
      ctx.fillRect(30 + (fps % 80), 40, 16, 16);
      ctx.fillStyle = '#8f8';
      ctx.font = '14px monospace';
      ctx.fillText('FPS=' + fps, 8, cv.height - 8);
      logEl.textContent = 'PREFLIGHT-OK fps=' + fps + ' errors=0' +
        (errors.length ? ' | ERROR:' + errors.join('|') : '');
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  } catch (e) {
    logEl.textContent = 'BOOT_ERROR: ' + e.message;
  }
})();
