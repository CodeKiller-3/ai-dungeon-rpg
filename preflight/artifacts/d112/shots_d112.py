# -*- coding: utf-8 -*-
"""D-112 实拍：四档尺寸（320x568 / 390x844 竖屏，960x540 / 1280x800 横屏）。

每档两张：
  d112-<w>x<h>-full.png  全屏
  d112-<w>x<h>-row.png   怪物行 2x 裁切（史莱姆/蝙蝠/哥布林/骷髅/兽人 + 下一行骑士）
同时把真实落屏盒写进 d112-boxes.json，供报告核对。
"""
import json
import os
from playwright.sync_api import sync_playwright

ROOT = r'd:\桌面\工作\人工智能大作业\preflight\artifacts\d112'
URL = ('file:///d:/%E6%A1%8C%E9%9D%A2/%E5%B7%A5%E4%BD%9C/%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD%E5%A4%A7%E4%BD%9C%E4%B8%9A'
       '/preflight/artifacts/d112/shot.html')
SIZES = [(320, 568), (390, 844), (960, 540), (1280, 800)]


def main():
    if not os.path.isdir(ROOT):
        os.makedirs(ROOT)
    out = {}
    with sync_playwright() as p:
        b = p.chromium.launch(channel='msedge', headless=True,
                              args=['--allow-file-access-from-files', '--disable-gpu'])
        for w, h in SIZES:
            name = '%dx%d' % (w, h)
            ctx = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=1)
            pg = ctx.new_page()
            pg.goto(URL)
            pg.wait_for_function('document.title.indexOf("READY D112") === 0', timeout=30000)
            info = pg.evaluate('window.__D112')
            out[name] = info
            pg.screenshot(path=os.path.join(ROOT, 'd112-%s-full.png' % name))

            # 怪物行裁切：y 取怪物头顶 -8 到骑士脚下 +4，x 取最左怪物 -8 到最右怪 +8
            bs = [b for b in info['boxes'] if not b['n'].startswith('knight_m_')]
            if bs:
                x0 = max(0, min(b['x'] for b in bs) - 8)
                x1 = min(info['cssW'], max(b['x'] + b['w'] for b in bs) + 8)
                y0 = max(0, min(b['y'] for b in bs) - 8)
                y1 = min(info['cssH'], max(b['y'] + b['h'] for b in bs) + 34)
                ctx2 = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2)
                pg2 = ctx2.new_page()
                pg2.goto(URL)
                pg2.wait_for_function('document.title.indexOf("READY D112") === 0', timeout=30000)
                pg2.screenshot(path=os.path.join(ROOT, 'd112-%s-row.png' % name),
                               clip={'x': x0, 'y': y0, 'width': x1 - x0, 'height': y1 - y0})
                out[name]['crop'] = [x0, y0, x1 - x0, y1 - y0]
                ctx2.close()
            print(name, 'boxes=', len(info['boxes']), flush=True)
            ctx.close()
        b.close()
    with open(os.path.join(ROOT, 'd112-boxes.json'), 'w', encoding='utf-8') as fh:
        json.dump(out, fh, ensure_ascii=False, indent=2)
    print('shots', len(out) * 2)


if __name__ == '__main__':
    main()
