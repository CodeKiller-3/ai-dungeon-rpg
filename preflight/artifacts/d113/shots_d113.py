# -*- coding: utf-8 -*-
"""D-113 实拍：五层 × 四档（320x568 / 390x844 / 960x540 / 1280x800）。

每层每档两张：
  d113-F<f>-<w>x<h>-full.png   全屏
  d113-F<f>-<w>x<h>-corr.png   "一段走廊带墙"裁切（2x）
"""
import json
import os
from playwright.sync_api import sync_playwright

ROOT = r'd:\桌面\工作\人工智能大作业\preflight\artifacts\d113'
BASE = ('file:///d:/%E6%A1%8C%E9%9D%A2/%E5%B7%A5%E4%BD%9C/%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD%E5%A4%A7%E4%BD%9C%E4%B8%9A'
        '/preflight/artifacts/d113/shot.html')
SIZES = [(320, 568), (390, 844), (960, 540), (1280, 800)]
FLOORS = [1, 2, 3, 4, 5]


def main():
    os.makedirs(ROOT, exist_ok=True)
    out = {}
    with sync_playwright() as p:
        b = p.chromium.launch(channel='msedge', headless=True,
                              args=['--allow-file-access-from-files', '--disable-gpu'])
        for f in FLOORS:
            for w, h in SIZES:
                url = '%s?f=%d' % (BASE, f)
                ctx = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=1)
                pg = ctx.new_page()
                pg.goto(url)
                pg.wait_for_function('document.title.indexOf("READY D113") === 0', timeout=30000)
                info = pg.evaluate('window.__D113')
                tag = 'd113-F%d-%dx%d' % (f, w, h)
                pg.screenshot(path=os.path.join(ROOT, tag + '-full.png'))
                c = info.get('crop')
                if c and c[2] > 0 and c[3] > 0:
                    ctx2 = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2)
                    pg2 = ctx2.new_page()
                    pg2.goto(url)
                    pg2.wait_for_function('document.title.indexOf("READY D113") === 0', timeout=30000)
                    pg2.screenshot(path=os.path.join(ROOT, tag + '-corr.png'),
                                   clip={'x': c[0], 'y': c[1], 'width': c[2], 'height': c[3]})
                    info['corr'] = c
                    ctx2.close()
                out[tag] = info
                print(tag, flush=True)
                ctx.close()
        b.close()
    with open(os.path.join(ROOT, 'd113-shots.json'), 'w', encoding='utf-8') as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1)
    print('done', len(out))


if __name__ == '__main__':
    main()
