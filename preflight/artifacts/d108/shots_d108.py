# -*- coding: utf-8 -*-
"""D-108 战斗装饰 S4 实拍：四档 × 横竖。

用法：python shots_d108.py
产物：preflight/artifacts/d108/
  d108-<asked>-<W>x<H>.png        全屏实拍（device_scale_factor=1）
  d108-bar-<asked>-<W>x<H>.png    指令条裁切 ×4 NEAREST（看 24×24 图标的像素棋盘格）
  d108-shots.json                 每张的实际布局 / 指令条矩形 / 七格图标矩形与素材名
"""
import json
import os
import pathlib
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parents[3]
PAGE = (ROOT / 'preflight' / '_shot_d108.html').resolve().as_uri()
OUT = ROOT / 'preflight' / 'artifacts' / 'd108'
OUT.mkdir(parents=True, exist_ok=True)

SIZES = [(320, 568), (390, 844), (960, 540), (1024, 640)]
LAYOUTS = ['vertical', 'horizontal']
ZOOM = 4


def font(size):
    for p in (r'C:\Windows\Fonts\msyh.ttc', r'C:\Windows\Fonts\simhei.ttf'):
        if os.path.isfile(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    return ImageFont.load_default()


def bar_crop(png_path, info, out_path):
    im = Image.open(png_path).convert('RGB')
    k = info.get('k') or 1
    b = info['bar']
    x0 = max(0, int(round(b['x'] * k)) - 8)
    y0 = max(0, int(round(b['y'] * k)) - 8)
    x1 = min(im.width, int(round((b['x'] + b['w']) * k)) + 8)
    y1 = min(im.height, int(round((b['y'] + b['h']) * k)) + 8)
    crop = im.crop((x0, y0, x1, y1))
    big = crop.resize((crop.width * ZOOM, crop.height * ZOOM), Image.NEAREST)
    big.save(out_path)
    return big.size


def main():
    rows = {}
    with sync_playwright() as pw:
        b = pw.chromium.launch(channel='msedge', headless=True,
                               args=['--allow-file-access-from-files', '--disable-gpu'])
        for (w, h) in SIZES:
            for lay in LAYOUTS:
                key = '%s-%dx%d' % (lay, w, h)
                ctx = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=1)
                pg = ctx.new_page()
                pg.goto('%s?w=%d&h=%d&layout=%s&m=slime&f=1' % (PAGE, w, h, lay))
                pg.wait_for_function('document.title === "READY D108"', timeout=60000)
                info = pg.evaluate('window.__D108')
                full = OUT / ('d108-%s.png' % key)
                pg.screenshot(path=str(full))
                crop = OUT / ('d108-bar-%s.png' % key)
                size = bar_crop(full, info, crop)
                rows[key] = {
                    'asked': lay, 'actual': info['layout'], 'W': info['W'], 'H': info['H'],
                    'scale': info['scale'], 'dpr': info['dpr'], 'bar': info['bar'],
                    'cells': info['cells'], 'barCrop': list(size),
                }
                print('%-20s actual=%-10s bar=%s cells=%s' %
                      (key, info['layout'], info['bar'],
                       [(c['label'], c['iconName'], c['icon'] and [c['icon']['w'], c['icon']['h']])
                        for c in info['cells']]), flush=True)
                ctx.close()
        b.close()
    with open(OUT / 'd108-shots.json', 'w', encoding='utf-8') as fh:
        json.dump(rows, fh, ensure_ascii=False, indent=2)
    print('-> d108-shots.json')


if __name__ == '__main__':
    main()
