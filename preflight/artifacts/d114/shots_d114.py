# -*- coding: utf-8 -*-
"""D-114 实拍：四档（320x568 / 390x844 / 960x540 / 1024x640）+ 系统页四页签。"""
import json
import os
from playwright.sync_api import sync_playwright

ROOT = r'd:\桌面\工作\人工智能大作业\preflight\artifacts\d114'
BASE = ('file:///d:/%E6%A1%8C%E9%9D%A2/%E5%B7%A5%E4%BD%9C/%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD%E5%A4%A7%E4%BD%9C%E4%B8%9A'
        '/preflight/artifacts/d114/shot.html')
SIZES = [(320, 568), (390, 844), (960, 540), (1024, 640)]
TABS = [(0, '任务'), (1, '怪物'), (2, '物品'), (3, '系统')]


def main():
    os.makedirs(ROOT, exist_ok=True)
    out = {}
    with sync_playwright() as p:
        b = p.chromium.launch(channel='msedge', headless=True,
                              args=['--allow-file-access-from-files', '--disable-gpu'])
        for w, h in SIZES:
            ctx = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=1)
            pg = ctx.new_page()
            pg.goto(BASE)
            pg.wait_for_function('document.title.indexOf("READY D114") === 0', timeout=30000)
            pg.wait_for_timeout(1300)  # 等 T1 入层测绘（520ms）结束，拍到稳定态
            name = 'd114-%dx%d.png' % (w, h)
            pg.screenshot(path=os.path.join(ROOT, name))
            out[name] = pg.evaluate('window.__D114')
            print(name, flush=True)
            ctx.close()
        for k, label in TABS:
            ctx = b.new_context(viewport={'width': 1024, 'height': 640}, device_scale_factor=1)
            pg = ctx.new_page()
            pg.goto(BASE + '?tab=%d' % k)
            pg.wait_for_function('document.title.indexOf("READY D114") === 0', timeout=30000)
            pg.wait_for_timeout(400)
            name = 'd114-tab%d-%s.png' % (k + 1, label)
            pg.screenshot(path=os.path.join(ROOT, name))
            out[name] = pg.evaluate('window.__D114')
            print(name, flush=True)
            ctx.close()
        b.close()
    with open(os.path.join(ROOT, 'd114-shots.json'), 'w', encoding='utf-8') as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1)
    print('done', len(out))


if __name__ == '__main__':
    main()
