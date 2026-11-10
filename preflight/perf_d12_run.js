/* preflight/perf_d12_run.js — D-12 压测驱动器（一次性脚本，不进 run-all）
 * 为什么需要它：run-all 用 --virtual-time-budget 跑页，虚拟时钟会接管 performance.now，
 * 测不到真实 CPU 耗时。这里用 CDP 在真实时钟下打开 perf_d12.html、等素材就绪、
 * 执行 window.__D12.run() 并把结果写成 JSON，供改前/改后同一口径对比。
 * 用法：node preflight/perf_d12_run.js [输出 json 路径] */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PAGE = 'file:///' + path.join(__dirname, 'perf_d12.html').replace(/\\/g, '/');
const outFile = process.argv[2] || path.join(__dirname, 'selfcheck', 'd12-perf.json');
const port = 9400 + Math.floor(Math.random() * 200);
const ud = path.join(os.tmpdir(), 'd12_edge_' + Date.now());
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

async function evalJs(cdp, expression, awaitPromise) {
  const r = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: !!awaitPromise,
    timeout: 600000
  });
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

    let ready = false;
    for (let i = 0; i < 150; i++) {
      await sleep(200);
      try {
        ready = await evalJs(cdp, '!!(window.__D12 && window.__D12.run)', false);
      } catch (e) { /* 导航中 */ }
      if (ready) break;
    }
    if (!ready) throw new Error('perf 页未就绪（__D12 未定义）');

    const res = await evalJs(cdp, 'window.__D12.run()', true);
    const payload = {
      at: new Date().toISOString(),
      page: 'preflight/perf_d12.html',
      commit: (process.env.D12_COMMIT || ''),
      result: res
    };
    fs.writeFileSync(outFile, JSON.stringify(payload, null, 2), 'utf8');

    const r = res || {};
    const fmt = s => s && s.p50 !== null ? `P50=${s.p50} P95=${s.p95} max=${s.max}` : 'n/a';
    console.log('OK=' + r.ok + ' -> ' + outFile);
    console.log('env=' + JSON.stringify(r.env));
    for (const ph of ['static', 'staticBig', 'noLight', 'noMap', 'noVignette', 'move', 'battle']) {
      if (!r[ph]) continue;
      const x = r[ph];
      console.log(`[${ph}] frames=${x.frames} total(${fmt(x.total)}) draw(${fmt(x.draw)}) update(${fmt(x.update)}) drawImage=${x.drawImage.p50} fillRect=${x.fillRect.p50} sprites=${x.spriteGet.p50 + x.spriteGetFrame.p50} over50=${x.over50}`);
    }
    if (r.latency) {
      const L = r.latency;
      console.log(`[latency] tap drops=${L.tapDrop}/${L.tapApplied + L.tapDrop} ${fmt(L.tap)} | hold drops=${L.holdDrop}/${L.holdApplied + L.holdDrop} ${fmt(L.hold)}`);
    }
    if (r.error) console.log('PAGE_ERROR=' + r.error);
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
