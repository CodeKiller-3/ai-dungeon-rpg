# -*- coding: utf-8 -*-
"""D-118 实拍：320/390 探索全屏（读数带含 ATK）+ 读数带 3× 裁切 + 系统页档案完整词。"""
import json
import os
from playwright.sync_api import sync_playwright
from PIL import Image

ROOT = r'd:\桌面\工作\人工智能大作业\preflight\artifacts\d118'
BASE = ('file:///d:/%E6%A1%8C%E9%9D%A2/%E5%B7%A5%E4%BD%9C/%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD%E5%A4%A7%E4%BD%9C%E4%B8%9A'
        '/preflight/artifacts/d118/shot.html')
TIERS = [(320, 568), (390, 844)]


def shot(b, w, h, mode):
    name = 'd118-%d-%s.png' % (w, mode)
    ctx = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=1)
    pg = ctx.new_page()
    pg.goto('%s?mode=%s&floor=1' % (BASE, mode))
    pg.wait_for_function('document.title.indexOf("READY D118") === 0', timeout=30000)
    pg.wait_for_timeout(2600)
    out = os.path.join(ROOT, name)
    pg.screenshot(path=out)
    info = pg.evaluate('() => window.__D118')
    print(name, {'scale': info['scale'], 'band': info['band']}, flush=True)
    ctx.close()
    return {'file': name, 'w': w, 'h': h, 'mode': mode}


def band_crop(w, tag):
    src = Image.open(os.path.join(ROOT, 'd118-%d-explore.png' % w)).convert('RGB')
    c = src.crop((0, 26, w, 46)).resize((w * 3, 60), Image.NEAREST)
    name = 'd118-%d-band3x.png' % w
    c.save(os.path.join(ROOT, name))
    print('crop', name, c.size, flush=True)
    return {'file': name, 'w': c.size[0], 'h': c.size[1], 'mode': 'band3x'}


def main():
    os.makedirs(ROOT, exist_ok=True)
    shots = []
    with sync_playwright() as p:
        b = p.chromium.launch(channel='msedge', headless=True,
                              args=['--allow-file-access-from-files', '--disable-gpu'])
        for (w, h) in TIERS:
            shots.append(shot(b, w, h, 'explore'))
            shots.append(shot(b, w, h, 'sys'))
        b.close()
    for (w, h) in TIERS:
        shots.append(band_crop(w, w))
    with open(os.path.join(ROOT, 'd118-shots.json'), 'w', encoding='utf-8') as fh:
        json.dump({'shots': shots}, fh, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
