# -*- coding: utf-8 -*-
"""D-115 楼梯实拍：320 全屏 + 1 格 24px 的 2x 裁切；另出 1024 对照。"""
import json
import os
from playwright.sync_api import sync_playwright
from PIL import Image

ROOT = r'd:\桌面\工作\人工智能大作业\preflight\artifacts\d115'
BASE = ('file:///d:/%E6%A1%8C%E9%9D%A2/%E5%B7%A5%E4%BD%9C/%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD%E5%A4%A7%E4%BD%9C%E4%B8%9A'
        '/preflight/artifacts/d115/shot.html')


def shot(b, w, h, floor, kind, name, crop=False):
    ctx = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=1)
    pg = ctx.new_page()
    pg.goto('%s?floor=%d&kind=%s' % (BASE, floor, kind))
    pg.wait_for_function('document.title.indexOf("READY D115") === 0', timeout=30000)
    pg.wait_for_timeout(3200)  # 等 T1 测绘与开局提示（"新冒险开始"）都退去
    info = pg.evaluate('''() => {
      var R = Game.Core.Render, cam = R._getCam(), s = R.scale, p = window.__D115.pos;
      return { sx: (p.x * 24 - cam.x) * s, sy: (p.y * 24 - cam.y) * s, tile: 24 * s, pos: p,
               scale: s, cssW: R.cssW, cssH: R.cssH };
    }''')
    out = os.path.join(ROOT, name)
    if not crop:
        pg.screenshot(path=out)
    else:
        half = 60  # 以楼梯为中心取 120×120 CSS px（约 5 格），再 2× 缩放
        x0 = max(0, min(w - half * 2, info['sx'] - half))
        y0 = max(0, min(h - half * 2, info['sy'] - half))
        bw = min(half * 2, w - x0)
        bh = min(half * 2, h - y0)
        pg.screenshot(path=out + '.tmp.png', clip={'x': x0, 'y': y0, 'width': bw, 'height': bh})
        im = Image.open(out + '.tmp.png')
        im.resize((bw * 2, bh * 2), Image.NEAREST).save(out)
        os.remove(out + '.tmp.png')
    print(name, info, flush=True)
    info['file'] = name
    ctx.close()
    return info


def main():
    os.makedirs(ROOT, exist_ok=True)
    out = []
    with sync_playwright() as p:
        b = p.chromium.launch(channel='msedge', headless=True,
                              args=['--allow-file-access-from-files', '--disable-gpu'])
        out.append(shot(b, 320, 568, 1, 'down', 'd115-320-f1-down.png'))
        out.append(shot(b, 320, 568, 1, 'down', 'd115-320-f1-down-2x.png', True))
        out.append(shot(b, 320, 568, 1, 'up', 'd115-320-f1-up-2x.png', True))
        out.append(shot(b, 320, 568, 5, 'down', 'd115-320-f5-down-2x.png', True))
        out.append(shot(b, 1024, 640, 1, 'down', 'd115-1024-f1-down.png'))
        b.close()
    with open(os.path.join(ROOT, 'd115-shots.json'), 'w', encoding='utf-8') as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
