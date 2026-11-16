"""D-94：玩法说明右半区非背景像素占比（判据 ≥25%）。

输入 preflight/artifacts/d94/c-menu-help-1280.png（1280×800 视口，逻辑 1024×640，系数 1.25）。
卡片：逻辑 x=72..952，y=24..616；右半区取 卡 x+440…x+880（逻辑 512…952），
纵向取正文区 y=96…576。背景为卡底 #07080e，RGB 差值和 >12 记为非背景。
"""
from PIL import Image
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[3]
IMG = ROOT / 'preflight' / 'artifacts' / 'd94' / 'c-menu-help-1280.png'
BG = (7, 8, 14)
CARD_X, CARD_W = 72, 880
K = 1280 / 1024.0

im = Image.open(IMG).convert('RGB')
L = int(round((CARD_X + 440) * K))
R = int(round((CARD_X + 880) * K))
T = int(round(96 * K))
B = int(round(576 * K))

n = tot = 0
for y in range(T, B):
    for x in range(L, R):
        p = im.getpixel((x, y))
        tot += 1
        if abs(p[0] - BG[0]) + abs(p[1] - BG[1]) + abs(p[2] - BG[2]) > 12:
            n += 1

ratio = 100.0 * n / tot
print('right-half region x=%d..%d y=%d..%d' % (L, R, T, B))
print('non-background %d / %d = %.1f%%  -> %s' % (n, tot, ratio, 'PASS' if ratio >= 25 else 'FAIL'))
raise SystemExit(0 if ratio >= 25 else 1)
