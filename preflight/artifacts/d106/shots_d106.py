# -*- coding: utf-8 -*-
"""D-106 主菜单高度档 / 右栏宽度实拍。
用法：python shots_d106.py
产物：preflight/artifacts/d106/d106-<view>-<W>x<H>.png
"""
import pathlib
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[3]
PAGE = (ROOT / 'preflight' / '_shot_menu_aes.html').resolve().as_uri()
OUT = ROOT / 'preflight' / 'artifacts' / 'd106'
OUT.mkdir(parents=True, exist_ok=True)

ROOTS = [(320, 568), (390, 844), (800, 540), (900, 540), (960, 540), (975, 540), (1024, 640), (1280, 800)]
SUBS = ['menu-help', 'menu-settings', 'menu-confirm', 'menu-about']

JOBS = [('menu-root-save', w, h) for w, h in ROOTS]
JOBS += [(v, 960, 540) for v in SUBS]
JOBS += [('menu-about', 320, 568), ('menu-help', 320, 568)]

with sync_playwright() as pw:
    b = pw.chromium.launch(channel='msedge')
    for view, w, h in JOBS:
        pg = b.new_page(viewport={'width': w, 'height': h})
        pg.goto(PAGE + '?view=' + view + '&floor=3')
        pg.wait_for_timeout(2600)
        pg.evaluate('Game.Core.Render.drawMainMenu(Game.Core.Main._menuSpec())')
        pg.wait_for_timeout(250)
        name = 'd106-%s-%dx%d.png' % (view, w, h)
        pg.screenshot(path=str(OUT / name))
        print(name, pg.evaluate('[Game.Core.Render.cssW, Game.Core.Render.cssH]'))
        pg.close()
    b.close()
