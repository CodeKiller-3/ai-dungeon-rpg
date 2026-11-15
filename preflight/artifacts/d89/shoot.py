# -*- coding: utf-8 -*-
"""D-89 实拍：Playwright 驱动本机 Edge（CDP），逻辑视口 1024x640、DSF=1.25 → 1280x800。
用法：python shoot.py <name> <url> [wait_title_prefix]
"""
import sys
import time
from playwright.sync_api import sync_playwright

name = sys.argv[1]
url = sys.argv[2]
wait_prefix = sys.argv[3] if len(sys.argv) > 3 else 'READY'
out = r'd:\桌面\工作\人工智能大作业\preflight\artifacts\d89\%s.png' % name

with sync_playwright() as p:
    b = p.chromium.launch(channel='msedge', headless=True,
                          args=['--allow-file-access-from-files', '--disable-gpu'])
    pg = b.new_page(viewport={'width': 1024, 'height': 640}, device_scale_factor=1.25)
    pg.goto(url)
    t0 = time.time()
    title = ''
    while time.time() - t0 < 12:
        title = pg.title()
        if title.startswith(wait_prefix):
            break
        pg.wait_for_timeout(120)
    pg.wait_for_timeout(300)
    pg.screenshot(path=out)
    print('%s | title=%s' % (out, pg.title()))
    b.close()
