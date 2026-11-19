# -*- coding: utf-8 -*-
"""D-107 战斗节奏实拍序列：普通怪 / 精英 / 巨龙（含龙威播报）。

用法：python shots_d107.py
产物：preflight/artifacts/d107/
  d107-<scene>-t<ms>.png      单帧（960x540，16ms 帧步进冻结）
  d107-<scene>-strip.png      六帧拼版（3x2，带节拍标注）
  d107-sequences.json         每帧的节点表 / beatLog / 飘字账本 / 战报末三行
"""
import json
import os
import pathlib
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parents[3]
PAGE = (ROOT / 'preflight' / '_shot_d107.html').resolve().as_uri()
OUT = ROOT / 'preflight' / 'artifacts' / 'd107'
OUT.mkdir(parents=True, exist_ok=True)

W, H = 960, 540
TIMES = [20, 50, 80, 120, 160, 200]
LABELS = {
    20: 't=20ms  玩家段·出手（同帧结算，怪物侧飘字）',
    50: 't=50ms  玩家段·落定（+40ms）',
    80: 't=80ms  怪物段·起手（+60ms）',
    120: 't=120ms 怪物段·命中（+100ms，玩家侧飘字）',
    160: 't=160ms 怪物段·落定（+150ms）',
    200: 't=200ms 回合收束（+180ms，输入已解锁）',
}
SCENES = [
    ('normal', dict(f=1, m='slime', rounds=1)),
    ('elite', dict(f=3, m='elite_orc', rounds=1)),
    ('dragon', dict(f=5, m='dragon', rounds=9)),
]


def font(size):
    for p in (r'C:\Windows\Fonts\msyh.ttc', r'C:\Windows\Fonts\simhei.ttf'):
        if os.path.isfile(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    return ImageFont.load_default()


def strip(scene, frames, seq):
    tw, th = W // 2, H // 2          # 480x270
    pad, head = 8, 26
    cols, rows = 3, 2
    sw = cols * tw + (cols + 1) * pad
    sh = rows * (th + head) + (rows + 1) * pad
    sheet = Image.new('RGB', (sw, sh), (10, 10, 16))
    d = ImageDraw.Draw(sheet)
    f = font(15)
    for i, (t, path) in enumerate(frames):
        im = Image.open(path).convert('RGB').resize((tw, th), Image.LANCZOS)
        cx = pad + (i % cols) * (tw + pad)
        cy = pad + (i // cols) * (th + head + pad)
        note = LABELS.get(t, '')
        d.text((cx + 2, cy + 2), note, fill=(230, 230, 240), font=f)
        sheet.paste(im, (cx, cy + head))
        d.rectangle([cx, cy + head, cx + tw - 1, cy + head + th - 1], outline=(60, 60, 76))
    sheet.save(OUT / ('d107-%s-strip.png' % scene))
    print('strip', scene, sheet.size)


def main():
    seq = {}
    with sync_playwright() as pw:
        b = pw.chromium.launch(channel='msedge', headless=True,
                               args=['--allow-file-access-from-files', '--disable-gpu'])
        for scene, cfg in SCENES:
            frames = []
            seq[scene] = {}
            for t in TIMES:
                ctx = b.new_context(viewport={'width': W, 'height': H}, device_scale_factor=1)
                pg = ctx.new_page()
                pg.goto('%s?w=%d&h=%d&f=%d&m=%s&layout=horizontal&t=%d&rounds=%d'
                        % (PAGE, W, H, cfg['f'], cfg['m'], t, cfg['rounds']))
                pg.wait_for_function('document.title === "READY D107"', timeout=40000)
                info = pg.evaluate('window.__D107')
                name = 'd107-%s-t%03d.png' % (scene, t)
                pg.screenshot(path=str(OUT / name))
                seq[scene][str(t)] = info
                frames.append((t, str(OUT / name)))
                print('%-7s t=%3d round=%s texts=%s textsP=%s beatLog=%s'
                      % (scene, t, info.get('round'),
                         info.get('texts'), info.get('textsP'),
                         [x['id'] for x in info.get('beatLog', [])]), flush=True)
                ctx.close()
            strip(scene, frames, seq)
        b.close()
    with open(OUT / 'd107-sequences.json', 'w', encoding='utf-8') as fh:
        json.dump(seq, fh, ensure_ascii=False, indent=2)
    print('-> d107-sequences.json')


if __name__ == '__main__':
    main()
