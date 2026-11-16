from playwright.sync_api import sync_playwright
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[3]
PAGE = (ROOT / 'preflight' / '_shot_menu_aes.html').resolve().as_uri()
OUT = ROOT / 'preflight' / 'artifacts' / 'd94'

JOBS = []
for v in ['menu-help', 'menu-settings', 'menu-confirm', 'menu-about']:
    JOBS.append((v, 1280, 800))
    JOBS.append((v, 320, 640))

with sync_playwright() as pw:
    b = pw.chromium.launch(channel='msedge')
    for view, w, h in JOBS:
        pg = b.new_page(viewport={'width': w, 'height': h})
        pg.goto(PAGE + '?view=' + view)
        pg.wait_for_timeout(2600)
        # 强制按当前 cssW 重画一帧，避免初始化尺寸与窗口尺寸错位
        pg.evaluate('Game.Core.Render.drawMainMenu(Game.Core.Main._menuSpec())')
        pg.wait_for_timeout(250)
        name = 'c-%s-%d.png' % (view, w)
        pg.screenshot(path=str(OUT / name))
        print(name, pg.evaluate('[Game.Core.Render.cssW, Game.Core.Main.getMenuState().page]'))
        pg.close()
    b.close()
