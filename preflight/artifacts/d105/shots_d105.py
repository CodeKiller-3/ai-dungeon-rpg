# -*- coding: utf-8 -*-
"""D-105 实拍：四档 x 横竖 x 蝙蝠/史莱姆（各 8 张，共 16 张）。
产物：preflight/artifacts/d105/{mid}-<w>x<h>-<layout>.png + geo-d105.json
"""
import json
import os
from playwright.sync_api import sync_playwright

ROOT = r'd:\桌面\工作\人工智能大作业\preflight\artifacts\d105'
BASE = ('file:///d:/%E6%A1%8C%E9%9D%A2/%E5%B7%A5%E4%BD%9C/%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD%E5%A4%A7%E4%BD%9C%E4%B8%9A'
        '/preflight/artifacts/d94/shot.html')
SIZES = [(320, 568), (390, 844), (960, 540), (1280, 800)]


def main():
    if not os.path.isdir(ROOT):
        os.makedirs(ROOT)
    geo = {}
    with sync_playwright() as p:
        b = p.chromium.launch(channel='msedge', headless=True,
                              args=['--allow-file-access-from-files', '--disable-gpu'])
        for mid in ('bat', 'slime'):
            for w, h in SIZES:
                for layout in ('horizontal', 'vertical'):
                    name = '%s-%dx%d-%s' % (mid, w, h, layout)
                    ctx = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=1)
                    pg = ctx.new_page()
                    pg.goto(BASE + '?w=%d&h=%d&f=1&m=%s&layout=%s' % (w, h, mid, layout))
                    pg.wait_for_function('document.title === "READY D94"', timeout=30000)
                    g = pg.evaluate('window.__D94_GEO')
                    box = pg.evaluate('window.Game.Core.Render._lastBattleBox')
                    geo[name] = {'viewport': [w, h], 'ask': layout, 'resolved': (g or {}).get('resolved'),
                                 'monster': [box['monster']['w'], box['monster']['h']],
                                 'player': [box['player']['w'], box['player']['h']]}
                    pg.screenshot(path=os.path.join(ROOT, name + '.png'))
                    print(name, 'resolved=', (g or {}).get('resolved'), flush=True)
                    ctx.close()
        b.close()
    with open(os.path.join(ROOT, 'geo-d105.json'), 'w', encoding='utf-8') as fh:
        json.dump(geo, fh, ensure_ascii=False, indent=2)
    print('shots', len(geo))


if __name__ == '__main__':
    main()
