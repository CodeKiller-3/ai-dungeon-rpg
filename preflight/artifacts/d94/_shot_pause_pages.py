from playwright.sync_api import sync_playwright
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[3]
PAGE = (ROOT / 'preflight' / '_shot_menu_aes.html').resolve().as_uri()
OUT = ROOT / 'preflight' / 'artifacts' / 'd94'

CONFIRM = {
    'kind': 'abandon', 'danger': True,
    'title': '放弃本局',
    'lines': [
        '放弃后本次进度不会写入存档。',
        '若已有存档，继续游戏将回到最近一次自动存档。',
        '确定要放弃本局吗？'
    ],
    'opts': ['取消', '放弃本局']
}

HALT = "window.requestAnimationFrame = function () { return 0; }; 'halt'"

DRAW = """
(function (kind) {
  var sp = Game.Core.Main._pauseSpec();
  sp.active = true;
  if (kind === 'confirm') {
    sp.page = 'confirmAbandon';
    sp.confirmSel = 0;
    sp.confirm = %s;
  } else {
    sp.page = 'settings';
    sp.settingsSel = 1;
  }
  Game.Core.Render.drawPause(sp);
  return sp.page + '/' + sp.settings.length;
})(%s)
""" % (json.dumps(CONFIRM, ensure_ascii=False), '%s')

with sync_playwright() as pw:
    b = pw.chromium.launch(channel='msedge')
    for kind in ['settings', 'confirm']:
        for w, h in [(1280, 800), (320, 640)]:
            pg = b.new_page(viewport={'width': w, 'height': h})
            pg.goto(PAGE + '?view=menu-root-nosave')
            pg.wait_for_timeout(2400)
            pg.evaluate(HALT)
            pg.wait_for_timeout(300)   # 等最后一帧挂起的 rAF 跑完，再画
            state = pg.evaluate(DRAW % ("'%s'" % kind))
            pg.wait_for_timeout(150)
            name = 'c-pause-%s-%d.png' % (kind, w)
            pg.screenshot(path=str(OUT / name))
            print(name, state)
            pg.close()
    b.close()
