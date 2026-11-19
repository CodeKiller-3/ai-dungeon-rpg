# -*- coding: utf-8 -*-
"""D-109 纵置结果卡实拍：四档纵置 × 结果卡遮挡前后对照 + chip/N3 取证。

用法：python shots_d109.py
产物：preflight/artifacts/d109/
  d109-card-<after|before>-<m>-<W>x<H>.png   全屏（before=旧安全带，after=N1 新落点）
  d109-crop-<after|before>-<m>-<W>x<H>.png   信息带 2× 裁切（管线/战报/属性行/玩家）
  d109-chips-<W>x<H>-n<N>.png               N2 chip 文案
  d109-fx-<layout>-<W>x<H>.png              N3 受击白闪 + 斩击弧
  d109-shots.json                           每张的 band/cards/obs 与相交面积（Python 复核）
"""
import json
import pathlib
from playwright.sync_api import sync_playwright
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[3]
PAGE = (ROOT / 'preflight' / '_shot_d109.html').resolve().as_uri()
OUT = ROOT / 'preflight' / 'artifacts' / 'd109'
OUT.mkdir(parents=True, exist_ok=True)

VERT = [(320, 568), (390, 844), (800, 700), (1024, 640)]


def iarea(a, b):
    ix = max(0, min(a['x'] + a['w'], b['x'] + b['w']) - max(a['x'], b['x']))
    iy = max(0, min(a['y'] + a['h'], b['y'] + b['h']) - max(a['y'], b['y']))
    return ix * iy


def shoot(b, w, h, lay, m, extra, tag):
    q = '?w=%d&h=%d&layout=%s&m=%s&f=1' % (w, h, lay, m)
    ctx = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=1)
    pg = ctx.new_page()
    pg.goto(PAGE + q + extra)
    pg.wait_for_function('document.title === "READY D109"', timeout=60000)
    info = pg.evaluate('window.__D109')
    full = OUT / ('d109-%s.png' % tag)
    pg.screenshot(path=str(full))
    obs = info.get('obs') or {}
    if 'pipeline' in obs and 'player' in obs:
        k = info.get('k') or 1
        y0 = max(0, int(round((obs['pipeline']['y'] - 8) * k)))
        y1 = min(h, int(round((obs['player']['y'] + obs['player']['h'] + 8) * k)))
        crop = Image.open(full).crop((0, y0, w, y1))
        crop = crop.resize((crop.width * 2, crop.height * 2), Image.NEAREST)
        crop.save(OUT / ('d109-crop-%s.png' % tag))
    hits = {}
    for c in info.get('cards', []):
        for k2, r in obs.items():
            a = iarea(c, r)
            if a > 0:
                hits['%s/%s' % (c['title'], k2)] = a
    ctx.close()
    return {
        'tag': tag, 'W': w, 'H': h, 'layout': info['layout'], 'old': info['old'],
        'dying': info['dying'], 'band': info['band'], 'cards': info['cards'],
        'obs': obs, 'bar': info['bar'], 'chips': info['chips'], 'hits': hits,
        'k': info.get('k'), 'm': m
    }


def main():
    rows = []
    with sync_playwright() as pw:
        b = pw.chromium.launch(channel='msedge', headless=True,
                               args=['--allow-file-access-from-files', '--disable-gpu'])
        for (w, h) in VERT:
            r0 = shoot(b, w, h, 'vertical', 'slime', '&card=0',
                       'card-none-slime-%dx%d' % (w, h))
            rows.append(r0)
            print('%-34s cards=%d band=%s' %
                  (r0['tag'], len(r0['cards']), r0['band']), flush=True)
            for old in ('0', '1'):
                mode = 'before' if old == '1' else 'after'
                r = shoot(b, w, h, 'vertical', 'slime', '&card=1&old=' + old,
                          'card-%s-slime-%dx%d' % (mode, w, h))
                rows.append(r)
                print('%-34s cards=%d band=%s hits=%s' %
                      (r['tag'], len(r['cards']), r['band'], r['hits']), flush=True)
        for (w, h) in [(320, 568), (390, 844)]:
            for old in ('0', '1'):
                mode = 'before' if old == '1' else 'after'
                r = shoot(b, w, h, 'vertical', 'dragon', '&card=1&old=' + old,
                          'card-%s-dragon-%dx%d' % (mode, w, h))
                rows.append(r)
                print('%-34s cards=%d band=%s hits=%s' %
                      (r['tag'], len(r['cards']), r['band'], r['hits']), flush=True)
        for (w, h, lay) in [(320, 568, 'vertical'), (960, 540, 'horizontal')]:
            for n in (1, 2, 3, 4):
                r = shoot(b, w, h, lay, 'slime', '&chips=%d' % n,
                          'chips-%dx%d-n%d' % (w, h, n))
                rows.append(r)
                print('%-34s chips=%s' % (r['tag'], [c['text'] for c in r['chips']]), flush=True)
        for (w, h, lay) in [(1024, 640, 'horizontal'), (390, 844, 'vertical')]:
            r = shoot(b, w, h, lay, 'slime', '&fx=1', 'fx-%s-%dx%d' % (lay, w, h))
            rows.append(r)
            print('%-34s fx' % r['tag'], flush=True)
        b.close()
    with open(OUT / 'd109-shots.json', 'w', encoding='utf-8') as fh:
        json.dump(rows, fh, ensure_ascii=False, indent=2)
    bad = [r['tag'] for r in rows if r['tag'].startswith('card-after') and r['hits']]
    print('AFTER 相交非零:', bad if bad else 'none')
    print('-> d109-shots.json')


if __name__ == '__main__':
    main()
