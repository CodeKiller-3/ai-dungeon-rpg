# -*- coding: utf-8 -*-
"""D-91 实拍：Playwright 驱动本机 Edge，逻辑视口 1024x640、DSF=1.25 → 1280x800。
用法：python shots_d91.py
"""
import time
from playwright.sync_api import sync_playwright

ROOT = r'd:\桌面\工作\人工智能大作业\preflight\artifacts\d91'
BASE = 'file:///d:/%E6%A1%8C%E9%9D%A2/%E5%B7%A5%E4%BD%9C/%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD%E5%A4%A7%E4%BD%9C%E4%B8%9A/preflight/artifacts/d91/shot.html'

SHOTS = [
    ('menu-root-save.png', '?view=menu-root-save'),
    ('confirm-new.png', '?view=confirm-new'),
    ('menu-settings.png', '?view=menu-settings'),
    ('pause-settings.png', '?view=pause-settings'),
    ('pause-confirm-clear.png', '?view=pause-confirm-clear'),
]

with sync_playwright() as p:
    b = p.chromium.launch(channel='msedge', headless=True,
                          args=['--allow-file-access-from-files', '--disable-gpu'])
    for name, qs in SHOTS:
        ctx = b.new_context(viewport={'width': 1024, 'height': 640}, device_scale_factor=1.25)
        pg = ctx.new_page()
        pg.goto(BASE + qs)
        pg.wait_for_timeout(1200)
        pg.screenshot(path=ROOT + '\\' + name)
        print(name, '|', pg.title())
        ctx.close()
    b.close()
