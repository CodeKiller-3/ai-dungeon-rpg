# -*- coding: utf-8 -*-
"""D-89 证据批量实拍：同一 Edge 实例、同一视口（1024x640 逻辑 / 1280x800 设备）。"""
import os
import time
from playwright.sync_api import sync_playwright

BASE = 'file:///D:/桌面/工作/人工智能大作业/preflight/artifacts/d89/shot.html'
OUT = r'd:\桌面\工作\人工智能大作业\preflight\artifacts\d89'

JOBS = [
    ('bg-f1', '?f=1&m=slime&w=1024&h=640'),
    ('bg-f2', '?f=2&m=orc_warrior&w=1024&h=640'),
    ('bg-f3', '?f=3&m=wogol&w=1024&h=640'),
    ('bg-f4', '?f=4&m=necromancer&w=1024&h=640'),
    ('bg-f5', '?f=5&m=dragon&w=1024&h=640'),
    ('hit-monster-t000', '?f=2&m=orc_warrior&mode=hit&t=0&w=1024&h=640'),
    ('hit-monster-t025', '?f=2&m=orc_warrior&mode=hit&t=25&w=1024&h=640'),
    ('hit-monster-t050', '?f=2&m=orc_warrior&mode=hit&t=50&w=1024&h=640'),
    ('hit-monster-t060', '?f=2&m=orc_warrior&mode=hit&t=60&w=1024&h=640'),
    ('hit-monster-t075', '?f=2&m=orc_warrior&mode=hit&t=75&w=1024&h=640'),
    ('hit-monster-t090', '?f=2&m=orc_warrior&mode=hit&t=90&w=1024&h=640'),
    ('counter-t100', '?f=2&m=orc_warrior&mode=counter&t=0&w=1024&h=640'),
    ('counter-t125', '?f=2&m=orc_warrior&mode=counter&t=25&w=1024&h=640'),
    ('counter-t150', '?f=2&m=orc_warrior&mode=counter&t=50&w=1024&h=640'),
    ('counter-t160', '?f=2&m=orc_warrior&mode=counter&t=60&w=1024&h=640'),
    ('counter-t175', '?f=2&m=orc_warrior&mode=counter&t=75&w=1024&h=640'),
    ('counter-t190', '?f=2&m=orc_warrior&mode=counter&t=90&w=1024&h=640'),
]

with sync_playwright() as p:
    b = p.chromium.launch(channel='msedge', headless=True,
                          args=['--allow-file-access-from-files', '--disable-gpu'])
    pg = b.new_page(viewport={'width': 1024, 'height': 640}, device_scale_factor=1.25)
    for name, qs in JOBS:
        pg.goto(BASE + qs)
        t0 = time.time()
        while time.time() - t0 < 12:
            if pg.title().startswith('READY'):
                break
            pg.wait_for_timeout(100)
        pg.wait_for_timeout(260)
        path = os.path.join(OUT, name + '.png')
        pg.screenshot(path=path)
        print(path)
    b.close()
