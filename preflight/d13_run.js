/* preflight/d13_run.js — D-13 证据采集驱动器（一次性脚本，不进 run-all）
 * 做三件事：用 CDP 打开 d13_harness.html → 等四组口径跑完 → 把结果写成 selfcheck/d13-evidence.json。
 * 用 CDP 而不是 run-all 的原因：run-all 的 --virtual-time-budget 会接管时钟且只 dump DOM，
 * 这里需要拿到页面里的完整数值对象（逐图原始值 / 汇总 / TD 断言 / 负例）。
 * 用法：node preflight/d13_run.js [输出 json 路径] */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PAGE = 'file:///' + path.join(__dirname, 'd13_harness.html').replace(/\\/g, '/');
const outFile = process.argv[2] || path.join(__dirname, 'selfcheck', 'd13-evidence.json');
const port = 9500 + Math.floor(Math.random() * 200);
const ud = path.join(os.tmpdir(), 'd13_edge_' + Date.now());
const sleep = ms => new Promise(r => setTimeout(r, ms));

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    let seq = 0;
    ws.onopen = () => resolve({
      send(method, params) {
        return new Promise((res, rej) => {
          const id = ++seq;
          pending.set(id, { res, rej });
          ws.send(JSON.stringify({ id, method, params }));
        });
      },
      close() { try { ws.close(); } catch (e) { /* ignore */ } }
    });
    ws.onerror = e => reject(new Error('ws error: ' + (e && e.message)));
    ws.onmessage = m => {
      let msg;
      try { msg = JSON.parse(m.data); } catch (e) { return; }
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) p.rej(new Error(JSON.stringify(msg.error)));
        else p.res(msg.result);
      }
    };
  });
}

async function waitForTarget() {
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch (e) { /* not ready */ }
    await sleep(100);
  }
  throw new Error('devtools target 未就绪');
}

async function evalJs(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, timeout: 600000 });
  if (r.exceptionDetails) {
    throw new Error('页面异常：' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails.text));
  }
  return r.result && r.result.value;
}

(async () => {
  const child = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--allow-file-access-from-files', '--mute-audio', '--window-size=1280,800',
    '--remote-allow-origins=*',
    `--user-data-dir=${ud}`, `--remote-debugging-port=${port}`, 'about:blank'
  ], { stdio: 'ignore' });

  let cdp = null;
  try {
    const wsUrl = await waitForTarget();
    cdp = await connect(wsUrl);
    await cdp.send('Runtime.enable', {});
    await cdp.send('Page.enable', {});
    await cdp.send('Page.navigate', { url: PAGE });

    let done = false;
    for (let i = 0; i < 300; i++) {
      await sleep(200);
      try { done = await evalJs(cdp, '!!window.__D13_DONE__'); } catch (e) { /* 导航中 */ }
      if (done) break;
    }
    if (!done) throw new Error('d13_harness 未在 60s 内完成');

    const res = await evalJs(cdp, 'window.__D13_RESULT__');
    const payload = {
      at: new Date().toISOString(),
      page: 'preflight/d13_harness.html',
      commit: (process.env.D13_COMMIT || ''),
      result: res
    };
    fs.writeFileSync(outFile, JSON.stringify(payload, null, 2), 'utf8');

    const r = res || {};
    const sum = r.summary || {};
    console.log('OK=' + r.ok + ' -> ' + outFile);
    (r.maps || []).forEach(m => {
      console.log(`seed=${m.seed} eps=${m.episodes} training=${m.training.rate}% greedy=${m.greedy.rate}% R1=${m.R1.rate}% R2=${m.R2.rate}%`);
    });
    ['training', 'greedy', 'R1', 'R2'].forEach(k => {
      const s = sum[k] || {};
      console.log(`[${k}] median=${s.median}% range=${s.min}%~${s.max}% values=${(s.values || []).join('/')}`);
    });
    console.log('td.correct=' + (r.td && r.td.correct && r.td.correct.ok) +
      ' td.mutant=' + (r.td && r.td.mutant && r.td.mutant.result && r.td.mutant.result.ok));
    if (r.err) console.log('PAGE_ERROR=' + r.err);
  } catch (e) {
    console.error('FAILED: ' + (e && e.stack || e));
    process.exitCode = 1;
  } finally {
    if (cdp) cdp.close();
    try { child.kill(); } catch (e) { /* ignore */ }
    await sleep(300);
    try { fs.rmSync(ud, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }
})();
