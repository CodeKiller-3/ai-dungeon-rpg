# -*- coding: utf-8 -*-
"""D-93 首屏实拍：Playwright + 本机 Edge，DSF=1，视口即画布真实尺寸。
用法：python shots_d93.py [before|after|all]
  before → before-*.png（改动前，D-91 版式）
  after  → after-*.png （A 版式 + 2px 门缝光）
两轮都从同一页面（shot.html）取图，保证只有 render.js 变了。
"""
import os
import sys
from playwright.sync_api import sync_playwright

ROOT = r'd:\桌面\工作\人工智能大作业\preflight\artifacts\d93'
BASE = ('file:///d:/%E6%A1%8C%E9%9D%A2/%E5%B7%A5%E4%BD%9C/%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD%E5%A4%A7%E4%BD%9C%E4%B8%9A'
        '/preflight/artifacts/d93/shot.html')

# (输出名, 视口宽, 视口高, 查询串)
SIZES = [(1024, 640), (500, 700), (320, 640)]
SHOTS = []
for w, h in SIZES:
    SHOTS.append(('%dx%d-save' % (w, h), w, h, '?save=1'))
    SHOTS.append(('%dx%d-empty' % (w, h), w, h, '?save=0'))

# 选择态（1024×640，有档）：sel=0..4
for i in range(5):
    SHOTS.append(('sel-%d' % i, 1024, 640, '?save=1&sel=%d' % i))

# 进度点：开局 / 中层 / 接近第 5 层 / 已抵达
SHOTS.append(('prog-start', 1024, 640, '?save=1&floor=1&level=1'))
SHOTS.append(('prog-mid', 1024, 640, '?save=1&floor=3&level=7'))
SHOTS.append(('prog-near', 1024, 640, '?save=1&floor=4&level=11'))
SHOTS.append(('prog-final', 1024, 640, '?save=1&floor=5&level=13'))


def main():
    mode = (sys.argv[1] if len(sys.argv) > 1 else 'all').lower()
    prefix = {'before': 'before-', 'after': 'after-'}.get(mode, '')
    shots = SHOTS if prefix else SHOTS
    with sync_playwright() as p:
        b = p.chromium.launch(channel='msedge', headless=True,
                              args=['--allow-file-access-from-files', '--disable-gpu'])
        for name, w, h, qs in shots:
            ctx = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=1)
            pg = ctx.new_page()
            pg.goto(BASE + qs)
            pg.wait_for_timeout(1500)
            out = os.path.join(ROOT, prefix + name + '.png')
            pg.screenshot(path=out)
            print(prefix + name, '|', w, 'x', h, '|', pg.title())
            ctx.close()
        b.close()


if __name__ == '__main__':
    main()
