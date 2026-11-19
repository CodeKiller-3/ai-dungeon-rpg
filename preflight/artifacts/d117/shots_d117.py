# -*- coding: utf-8 -*-
"""D-117 层辨识实拍：F1/F2 × 四档全屏 + 两组并排对比。
复用 D-116 的探索实拍页（固定种子、镜头跟随玩家），只切 floor。"""
import json
import os
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw

ROOT = r'd:\桌面\工作\人工智能大作业\preflight\artifacts\d117'
BASE = ('file:///d:/%E6%A1%8C%E9%9D%A2/%E5%B7%A5%E4%BD%9C/%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD%E5%A4%A7%E4%BD%9C%E4%B8%9A'
        '/preflight/artifacts/d116/shot.html')
TIERS = [(320, 568), (390, 844), (960, 540), (1024, 640)]


def shot(b, w, h, floor):
    name = 'd117-%d-f%d.png' % (w, floor)
    ctx = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=1)
    pg = ctx.new_page()
    pg.goto('%s?floor=%d' % (BASE, floor))
    pg.wait_for_function('document.title.indexOf("READY D116") === 0', timeout=30000)
    pg.wait_for_timeout(3200)
    out = os.path.join(ROOT, name)
    pg.screenshot(path=out)
    info = pg.evaluate('() => ({scale: Game.Core.Render.scale, cam: Game.Core.Render._cam(), '
                       'floor: Game.Data.Player.floor, pos: window.__D116.pos})')
    info['file'] = name
    info['w'] = w
    info['h'] = h
    print(name, info, flush=True)
    ctx.close()
    return info


def compare(w, h, tag):
    a = Image.open(os.path.join(ROOT, 'd117-%d-f1.png' % w)).convert('RGB')
    b = Image.open(os.path.join(ROOT, 'd117-%d-f2.png' % w)).convert('RGB')
    out = Image.new('RGB', (w * 2 + 8, h + 22), (10, 10, 16))
    out.paste(a, (0, 22))
    out.paste(b, (w + 8, 22))
    d = ImageDraw.Draw(out)
    d.text((6, 5), 'F1 dungeon: coursed ashlar 48px', fill=(200, 214, 235))
    d.text((w + 14, 5), 'F2 camp: trampled 45deg scuffs', fill=(226, 198, 150))
    p = os.path.join(ROOT, 'd117-compare-%s.png' % tag)
    out.save(p)
    print('compare', p, out.size, flush=True)
    return {'file': os.path.basename(p), 'w': out.size[0], 'h': out.size[1]}


def main():
    os.makedirs(ROOT, exist_ok=True)
    out = []
    with sync_playwright() as p:
        b = p.chromium.launch(channel='msedge', headless=True,
                              args=['--allow-file-access-from-files', '--disable-gpu'])
        for (w, h) in TIERS:
            for f in (1, 2):
                out.append(shot(b, w, h, f))
        b.close()
    cmp = [compare(320, 568, '320'), compare(1024, 640, '1024')]
    with open(os.path.join(ROOT, 'd117-shots.json'), 'w', encoding='utf-8') as fh:
        json.dump({'shots': out, 'compare': cmp}, fh, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
