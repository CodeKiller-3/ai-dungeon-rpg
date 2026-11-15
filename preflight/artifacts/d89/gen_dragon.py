# -*- coding: utf-8 -*-
"""D-89 龙素材重绘：原生 72x72（原 64x54），压低站姿、拉宽翼展。
输出 assets/sprites/dragon_{idle,attack,hurt}_anim_f0..3.png。
调色板沿用旧龙（#62232F 体 / #9F294E 翼膜 / #C56025 铜脊 / #AA8D7A 角爪 / #FDF7ED 牙）。
整数倍口径不变：落屏仍由 BOSS_MUL=2 决定（72*2=144）。
"""
import os
from PIL import Image, ImageDraw

W = H = 72
OUT = os.path.join(os.path.dirname(__file__), '..', '..', '..', 'assets', 'sprites')

BODY = (98, 35, 47, 255)
MEMB = (159, 41, 78, 255)
COPP = (197, 96, 37, 255)
RED = (218, 78, 56, 255)
HORN = (170, 141, 122, 255)
FANG = (253, 247, 237, 255)
EYE = (250, 203, 62, 255)
DARK = (34, 34, 34, 255)
MAW = (34, 34, 34, 255)   # 口内暗腔：复用描边色，不引入调色板外颜色（D-21 A7）


def mirror(pts):
    return [(W - 1 - x, y) for (x, y) in pts]


def draw_frame(dy_head=0, dy_body=0, wing_dy=0, mouth=0, hurt=0):
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)

    def P(pts, col):
        d.polygon(pts, fill=col)

    def off(pts, dx=0, dy=0):
        return [(x + dx, y + dy) for (x, y) in pts]

    # ── 翼（右半，左侧镜像）──────────────────────────────
    wing_r = [(37, 34), (45, 23), (57, 10), (70, 3), (71, 13), (62, 17), (68, 27),
              (57, 29), (63, 39), (52, 39), (56, 49), (45, 45), (46, 55), (38, 47), (36, 38)]
    wing_r = [(x, y + (wing_dy if x > 40 else 0)) for (x, y) in wing_r]
    P(wing_r, MEMB)
    P(mirror(wing_r), MEMB)
    # 翼骨：从肩根射向翼尖与三个翼指；同色深体色，1~2px
    def rib(dst, w=1):
        d.line([(37, 35 + dy_body), dst], fill=BODY, width=w)
        d.line([(W - 1 - 37, 35 + dy_body), (W - 1 - dst[0], dst[1])], fill=BODY, width=w)
    rib((70, 4 + wing_dy), 2)
    rib((68, 27 + wing_dy))
    rib((63, 39 + wing_dy))
    rib((56, 49 + wing_dy))
    # 铜色前缘高光（只在上缘一段，静止帧读得出翼的走向）
    d.line([(46, 21 + wing_dy), (56, 11 + wing_dy), (66, 5 + wing_dy)], fill=COPP, width=1)
    d.line([(W - 1 - 46, 21 + wing_dy), (W - 1 - 56, 11 + wing_dy), (W - 1 - 66, 5 + wing_dy)], fill=COPP, width=1)

    # ── 尾（低伏在腿后，向右卷）──────────────────────────
    tail = [(36, 60 + dy_body), (46, 66 + dy_body), (54, 64 + dy_body),
            (58, 68 + dy_body), (48, 71 + dy_body), (38, 66 + dy_body)]
    P(tail, BODY)
    d.polygon(mirror(tail), fill=BODY)

    # ── 后腿 / 前腿（蹲姿：膝低、爪贴地 y≈69）────────────
    for sx in (0, 1):
        leg = [(25, 52 + dy_body), (33, 52 + dy_body), (33, 67), (30, 69), (25, 67)]
        if sx:
            leg = mirror(leg)
        P(leg, BODY)
        # 爪
        for i in range(3):
            cx = (23 + i * 4) if sx == 0 else (W - 1 - (23 + i * 4))
            d.rectangle([cx, 67, cx + 2, 69], fill=HORN)
    # 膝部铜脊
    d.rectangle([26, 55 + dy_body, 31, 56 + dy_body], fill=COPP)
    d.rectangle([W - 1 - 31, 55 + dy_body, W - 1 - 26, 56 + dy_body], fill=COPP)

    # ── 身体（压低：肩宽腰短，蹲成一团）──────────────────
    body = [(27, 31 + dy_body), (44, 31 + dy_body), (48, 40 + dy_body), (49, 54 + dy_body),
            (45, 62 + dy_body), (33, 64 + dy_body), (24, 58 + dy_body), (23, 44 + dy_body)]
    P(body, BODY)
    # 胸腹铜脊
    d.rectangle([33, 36 + dy_body, 38, 40 + dy_body], fill=COPP)
    d.rectangle([31, 42 + dy_body, 40, 44 + dy_body], fill=RED)
    d.rectangle([32, 47 + dy_body, 39, 48 + dy_body], fill=COPP)
    d.rectangle([33, 52 + dy_body, 38, 53 + dy_body], fill=COPP)

    # ── 头（正中，双角向后上）────────────────────────────
    hd = dy_head + dy_body
    # 角（先画，被头盖住根部）
    for s in (0, 1):
        horn = [(30, 20 + hd), (28, 13 + hd), (20, 5 + hd), (23, 4 + hd), (31, 16 + hd)]
        if s:
            horn = mirror(horn)
        P(horn, HORN)
    head = [(29, 18 + hd), (42, 18 + hd), (45, 24 + hd), (45, 31 + hd),
            (41, 36 + hd), (32, 36 + hd), (27, 31 + hd), (27, 24 + hd)]
    P(head, BODY)
    # 眉骨铜线（身份线索，不依赖发光眼）
    d.line([(28, 23 + hd), (35, 22 + hd)], fill=COPP)
    d.line([(W - 1 - 28, 23 + hd), (W - 1 - 35, 22 + hd)], fill=COPP)
    # 吻部 / 口
    if mouth:
        d.rectangle([31, 33 + hd, 40, 37 + hd], fill=MAW)
        d.rectangle([32, 34 + hd, 39, 36 + hd], fill=RED)
        d.rectangle([34, 35 + hd, 37, 36 + hd], fill=EYE)   # 口内余火（仅攻击帧）
        d.rectangle([32, 33 + hd, 33, 35 + hd], fill=FANG)
        d.rectangle([38, 33 + hd, 39, 35 + hd], fill=FANG)
    else:
        d.line([(31, 34 + hd), (40, 34 + hd)], fill=DARK)
        d.rectangle([32, 35 + hd, 33, 36 + hd], fill=FANG)
        d.rectangle([38, 35 + hd, 39, 36 + hd], fill=FANG)
    # 鼻孔
    d.rectangle([32, 31 + hd, 33, 32 + hd], fill=DARK)
    d.rectangle([39, 31 + hd, 40, 32 + hd], fill=DARK)
    # 眼睛（原生 2x2，落屏 4x4；发光眼由渲染层叠加，这里给底色）
    d.rectangle([30, 25 + hd, 32, 27 + hd], fill=EYE)
    d.rectangle([41, 25 + hd, 43, 27 + hd], fill=EYE)
    d.rectangle([31, 26 + hd, 31, 26 + hd], fill=DARK)
    d.rectangle([42, 26 + hd, 42, 26 + hd], fill=DARK)

    # ── 1px 深色描边（向外扩一圈，保持剪影可在暗背景上读）──
    px = im.load()
    mask = [[px[x, y][3] > 0 for x in range(W)] for y in range(H)]
    for y in range(H):
        for x in range(W):
            if mask[y][x]:
                continue
            near = False
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                xx, yy = x + dx, y + dy
                if 0 <= xx < W and 0 <= yy < H and mask[yy][xx]:
                    near = True
                    break
            if near:
                px[x, y] = DARK
    return im


FRAMES = {
    'idle':   [(0, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 1, 1, 0)],
    'attack': [(2, 1, -2, 1), (3, 1, -3, 1), (3, 2, -2, 1), (2, 1, -1, 0)],
    'hurt':   [(-1, 1, 2, 0), (-1, 1, 3, 0), (-1, 2, 3, 0), (-1, 1, 2, 0)]
}


def main():
    os.makedirs(OUT, exist_ok=True)
    for state, frames in FRAMES.items():
        for i, (dh, db, wd, mo) in enumerate(frames):
            im = draw_frame(dy_head=dh, dy_body=db, wing_dy=wd, mouth=mo)
            p = os.path.normpath(os.path.join(OUT, 'dragon_%s_anim_f%d.png' % (state, i)))
            im.save(p, optimize=True)
            print(p, im.size)


if __name__ == '__main__':
    main()
