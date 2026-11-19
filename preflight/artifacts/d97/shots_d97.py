# -*- coding: utf-8 -*-
"""D-97 纵置战斗布局实拍（改动前/后同一参数、同一固定时钟）
用法：python shots_d97.py before|after
  before → 改动前基线；after → 改动后对照
四档：320×568 / 390×844 / 960×540 / 1280×800
场景：纵置 F1 史莱姆、纵置 F5 龙；横置 F1/F5 只拍 960×540 与 1280×800（证明横置未动）
产物：preflight/artifacts/d97/<prefix>-<name>.png + geo-<prefix>.json
"""
import json
import os
import sys
from playwright.sync_api import sync_playwright

ROOT = r'd:\桌面\工作\人工智能大作业\preflight\artifacts\d97'
BASE = ('file:///d:/%E6%A1%8C%E9%9D%A2/%E5%B7%A5%E4%BD%9C/%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD%E5%A4%A7%E4%BD%9C%E4%B8%9A'
        '/preflight/artifacts/d94/shot.html')

SIZES = [(320, 568), (390, 844), (960, 540), (1280, 800)]
SCENES = [(1, 'slime'), (5, 'dragon')]


def shots():
    out = []
    for w, h in SIZES:
        for f, mid in SCENES:
            out.append(('%dx%d-f%d-%s-vertical' % (w, h, f, mid), w, h, f, mid, 'vertical'))
    for w, h in [(960, 540), (1280, 800)]:
        for f, mid in SCENES:
            out.append(('%dx%d-f%d-%s-horizontal' % (w, h, f, mid), w, h, f, mid, 'horizontal'))
    return out


def main():
    prefix = (sys.argv[1] if len(sys.argv) > 1 else 'before').lower()
    if not os.path.isdir(ROOT):
        os.makedirs(ROOT)
    geo = {}
    with sync_playwright() as p:
        b = p.chromium.launch(channel='msedge', headless=True,
                              args=['--allow-file-access-from-files', '--disable-gpu'])
        for name, w, h, f, mid, layout in shots():
            ctx = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=1)
            pg = ctx.new_page()
            pg.goto(BASE + '?w=%d&h=%d&f=%d&m=%s&layout=%s' % (w, h, f, mid, layout))
            pg.wait_for_function('document.title === "READY D94"', timeout=30000)
            g = pg.evaluate('window.__D94_GEO')
            box = pg.evaluate('window.Game.Core.Render._lastBattleBox')
            geo[name] = {'viewport': [w, h], 'floor': f, 'monster': mid, 'ask': layout, 'geo': g, 'box': box}
            pg.screenshot(path=os.path.join(ROOT, '%s-%s.png' % (prefix, name)))
            print(prefix, name, '|', w, 'x', h, '|', (g or {}).get('resolved'), flush=True)
            ctx.close()
        b.close()
    with open(os.path.join(ROOT, 'geo-%s.json' % prefix), 'w', encoding='utf-8') as fh:
        json.dump(geo, fh, ensure_ascii=False, indent=2)
    print('-> geo-%s.json  %d shots' % (prefix, len(geo)))


if __name__ == '__main__':
    main()
