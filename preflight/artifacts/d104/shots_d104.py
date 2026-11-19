# -*- coding: utf-8 -*-
"""D-104 四档 x 横竖实拍：before = D-102 after（D-103 未改战斗视觉），after = D-104 当前代码。
用法：python shots_d104.py
产物：preflight/artifacts/d104/{before,after}-<w>x<h>-f1-slime-<layout>.png + geo-d104.json
"""
import json
import os
import shutil
from playwright.sync_api import sync_playwright

ROOT = r'd:\桌面\工作\人工智能大作业\preflight\artifacts\d104'
D102 = r'd:\桌面\工作\人工智能大作业\preflight\artifacts\d102'
BASE = ('file:///d:/%E6%A1%8C%E9%9D%A2/%E5%B7%A5%E4%BD%9C/%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD%E5%A4%A7%E4%BD%9C%E4%B8%9A'
        '/preflight/artifacts/d94/shot.html')
SIZES = [(320, 568), (390, 844), (960, 540), (1280, 800)]


def shots():
    out = []
    for w, h in SIZES:
        for layout in ('horizontal', 'vertical'):
            out.append(('%dx%d-f1-slime-%s' % (w, h, layout), w, h, 1, 'slime', layout))
    return out


def main():
    if not os.path.isdir(ROOT):
        os.makedirs(ROOT)
    copied = []
    for name, w, h, f, mid, layout in shots():
        src = os.path.join(D102, 'after-%s.png' % name)
        note = ''
        if not os.path.isfile(src):
            src = os.path.join(D102, 'after-%dx%d-f%d-%s-vertical.png' % (w, h, f, mid))
            note = 'fallback-vertical'
        if os.path.isfile(src):
            shutil.copyfile(src, os.path.join(ROOT, 'before-%s%s.png' % (name, '-fb' if note else '')))
            copied.append((name, note))
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
            geo[name] = {'viewport': [w, h], 'ask': layout, 'geo': g, 'box': box}
            pg.screenshot(path=os.path.join(ROOT, 'after-%s.png' % name))
            print('after', name, '| resolved=', (g or {}).get('resolved'), flush=True)
            ctx.close()
        b.close()
    with open(os.path.join(ROOT, 'geo-d104.json'), 'w', encoding='utf-8') as fh:
        json.dump(geo, fh, ensure_ascii=False, indent=2)
    print('-> before copied:', len(copied), '| after shots:', len(geo))


if __name__ == '__main__':
    main()
