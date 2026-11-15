# -*- coding: utf-8 -*-
"""D-90 实拍：Playwright 驱动本机 Edge（CDP），逻辑视口 1024x640、DSF=1.25 → 1280x800。
用法：python shots_d90.py
"""
import time
from playwright.sync_api import sync_playwright

ROOT = r'd:\桌面\工作\人工智能大作业\preflight\artifacts\d90'
BASE = 'file:///d:/%E6%A1%8C%E9%9D%A2/%E5%B7%A5%E4%BD%9C/%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD%E5%A4%A7%E4%BD%9C%E4%B8%9A/preflight/artifacts/d90/shot.html'


def wait_ready(pg, limit=20):
    t0 = time.time()
    while time.time() - t0 < limit:
        s = pg.title()
        if s.startswith('READY') or s.startswith('ERR'):
            return s
        pg.wait_for_timeout(120)
    return pg.title()


with sync_playwright() as p:
    b = p.chromium.launch(channel='msedge', headless=True,
                          args=['--allow-file-access-from-files', '--disable-gpu'])

    # 入层测绘：同一次加载、同一张地图，只改注入时钟 → 分阶段帧可比
    for attempt in range(8):
        ctx = b.new_context(viewport={'width': 1024, 'height': 640}, device_scale_factor=1.25)
        pg = ctx.new_page()
        pg.goto(BASE + '?view=survey&f=3&t=0')
        title = wait_ready(pg)
        print('survey boot try%d | %s' % (attempt + 1, title))
        if 'rooms=0' not in title and title.startswith('READY'):
            break
        ctx.close()
    for t in (0, 120, 260, 460):
        pg.evaluate('(t)=>window.__d90DrawAt(t)', t)
        pg.wait_for_timeout(180)
        pg.screenshot(path=ROOT + '\\survey-t%03d.png' % t)
    # 改前对照：同一张地图、同一 t=260，只关掉系统测量层
    pg.evaluate('(t)=>window.__d90DrawAt(t)', 260)
    pg.evaluate('window.__d90SysOff()')
    pg.wait_for_timeout(180)
    pg.screenshot(path=ROOT + '\\before-survey-t260.png')
    print('survey frames |', pg.title())
    ctx.close()

    shots = [
        ('explore-f1.png', '?view=explore&f=1', 1024, 640),
        ('explore-f5.png', '?view=explore&f=5', 1024, 640),
        ('hud-wide.png', '?view=hud&f=3', 1024, 640),
        ('hud-narrow320.png', '?view=hud&f=3&w=320&h=640', 320, 640),
        ('key-before.png', '?view=key&f=1&phase=before', 1024, 640),
        ('key-during-survey.png', '?view=key&f=1&phase=after', 1024, 640),
        ('target-bracket.png', '?view=target&f=1', 1024, 640),
    ]
    for name, qs, w, h in shots:
        ctx = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=1.25)
        pg = ctx.new_page()
        pg.goto(BASE + qs)
        title = wait_ready(pg)
        pg.wait_for_timeout(350)
        pg.screenshot(path=ROOT + '\\' + name)
        # 改前对照：同一页面同一地图，关掉系统层再拍一张
        pg.evaluate('window.__d90SysOff()')
        pg.wait_for_timeout(200)
        pg.screenshot(path=ROOT + '\\before-' + name)
        print('%s | %s' % (name, title))
        ctx.close()
    b.close()
