# -*- coding: utf-8 -*-
"""D-89 证据拼图：并排/逐帧对照/三 Boss 比高/接触阴影网格。"""
import os
from PIL import Image, ImageDraw, ImageFont

D = r'd:\桌面\工作\人工智能大作业\preflight\artifacts\d89'
OLD = r'd:\桌面\工作\人工智能大作业\preflight\artifacts\d88'
SPR = r'd:\桌面\工作\人工智能大作业\assets\sprites'
FONT_PATH = r'C:\Windows\Fonts\msyh.ttc'
FONT = ImageFont.truetype(FONT_PATH, 16)
FONT_S = ImageFont.truetype(FONT_PATH, 13)
FONT_L = ImageFont.truetype(FONT_PATH, 20)


def open_(p):
    return Image.open(p).convert('RGB')


def label_bar(w, h, text, bg=(18, 18, 24)):
    bar = Image.new('RGB', (w, h), bg)
    d = ImageDraw.Draw(bar)
    d.text((8, max(1, (h - 16) // 2)), text, font=FONT_S, fill=(220, 220, 230))
    return bar


def grid(files, labels, cols, cw, ch, out):
    rows = (len(files) + cols - 1) // cols
    gap = 10
    W = cols * cw + (cols + 1) * gap
    H = rows * (ch + 22) + (rows + 1) * gap
    canvas = Image.new('RGB', (W, H), (10, 10, 14))
    d = ImageDraw.Draw(canvas)
    for i, f in enumerate(files):
        r, c = divmod(i, cols)
        x = gap + c * (cw + gap)
        y = gap + r * (ch + 22 + gap)
        im = open_(f).resize((cw, ch), Image.LANCZOS)
        canvas.paste(im, (x, y))
        d.text((x + 2, y + ch + 3), labels[i], font=FONT_S, fill=(200, 200, 210))
    canvas.save(os.path.join(D, out))
    print(out, canvas.size)


# ── 1. 五层并排 ─────────────────────────────────────────
grid([os.path.join(D, 'bg-f%d.png' % i) for i in range(1, 6)],
     ['F1 石厅（火把立地）', 'F2 营地（篝火落地）', 'F3 熔岩裂谷（熔岩压暗）',
      'F4 墓穴（烛台落地）', 'F5 深渊王座（龙 144×144）'],
     3, 620, 388, 'bg-five-together.png')

# ── 2. 改前/改后同状态对照 ──────────────────────────────
for f, note in ((2, 'F2 篝火：悬空 372 → 落地 476'), (3, 'F3 熔岩：200/337 亮部 → 178/5')):
    a = open_(os.path.join(OLD, 'bg-f%d.png' % f)).resize((900, 563), Image.LANCZOS)
    b = open_(os.path.join(D, 'bg-f%d.png' % f)).resize((900, 563), Image.LANCZOS)
    cv = Image.new('RGB', (900 * 2 + 30, 563 + 34), (10, 10, 14))
    cv.paste(a, (10, 28))
    cv.paste(b, (920, 28))
    d = ImageDraw.Draw(cv)
    d.text((10, 6), 'D-88 改前', font=FONT, fill=(255, 170, 120))
    d.text((920, 6), 'D-89 改后 · ' + note, font=FONT, fill=(150, 255, 180))
    cv.save(os.path.join(D, 'bg-before-after-f%d.png' % f))
    print('bg-before-after-f%d.png' % f, cv.size)

# ── 3. 身体位移逐帧（怪物 6 帧 / 玩家 6 帧）─────────────
def crop_frame(path, box, scale=1):
    im = open_(path)
    s = 1.25
    c = im.crop((int(box[0] * s), int(box[1] * s), int(box[2] * s), int(box[3] * s)))
    if scale != 1:
        c = c.resize((int(c.width * scale), int(c.height * scale)), Image.NEAREST)
    return c


hit_off = [4, 4, 4, 3, 0, 0]
hit_ts = [0, 25, 50, 60, 75, 90]
cells, labels = [], []
for i, t in enumerate(hit_ts):
    cells.append(crop_frame(os.path.join(D, 'hit-monster-t%03d.png' % t), (430, 50, 610, 220)))
    labels.append('t=%dms top=90-%d off=%dpx' % (t, hit_off[i], hit_off[i]))
w, h = cells[0].size
cv = Image.new('RGB', (6 * (w + 10) + 10, h + 58), (10, 10, 14))
d = ImageDraw.Draw(cv)
for i, im in enumerate(cells):
    x = 10 + i * (w + 10)
    cv.paste(im, (x, 30))
    d.text((x + 2, 8), labels[i], font=FONT_S, fill=(210, 210, 220))
d.text((10, h + 38), '怪物受击：接触点保持 4px/50ms，80ms 归零（y=90 为站姿原位）', font=FONT_S, fill=(255, 210, 130))
cv.save(os.path.join(D, 'body-displacement-monster.png'))
print('body-displacement-monster.png', cv.size)

cnt_off = [7, 7, 7, 6, 4, 1]
cnt_ts = [100, 125, 150, 160, 175, 190]
cells, labels = [], []
for i, t in enumerate(cnt_ts):
    cells.append(crop_frame(os.path.join(D, 'counter-t%d.png' % t), (440, 420, 620, 580)))
    labels.append('t=%dms top=450+%d off=%dpx' % (t, cnt_off[i], cnt_off[i]))
w, h = cells[0].size
cv = Image.new('RGB', (6 * (w + 10) + 10, h + 58), (10, 10, 14))
d = ImageDraw.Draw(cv)
for i, im in enumerate(cells):
    x = 10 + i * (w + 10)
    cv.paste(im, (x, 30))
    d.text((x + 2, 8), labels[i], font=FONT_S, fill=(210, 210, 220))
d.text((10, h + 38), '玩家被反击：接触点保持 7px/50ms，100ms 归零（y=450 为站姿原位）', font=FONT_S, fill=(255, 210, 130))
cv.save(os.path.join(D, 'body-displacement-player.png'))
print('body-displacement-player.png', cv.size)

# ── 4. 接触点火花 4× ────────────────────────────────────
im = open_(os.path.join(D, 'hit-monster-t000.png'))
# 逻辑 536,165 → 设备 ×1.25；裁 200×150 设备像素
cx, cy = int(536 * 1.25), int(165 * 1.25)
crop = im.crop((cx - 120, cy - 90, cx + 120, cy + 90)).resize((960, 720), Image.NEAREST)
crop.save(os.path.join(D, 'spark-contact-4x.png'))
print('spark-contact-4x.png', crop.size)

# ── 5. 接触阴影网格（五层 × 怪物/玩家）──────────────────
# 组装：上排怪物脚下，下排玩家脚下
cellw, cellh = 300, 110
cv = Image.new('RGB', (cellw * 5 + 60, cellh * 2 + 90), (10, 10, 14))
d = ImageDraw.Draw(cv)
d.text((10, 6), '五层接触阴影（上：怪物脚下 / 下：玩家脚下，含环境亮边）', font=FONT, fill=(220, 220, 230))
for i, f in enumerate(range(1, 6)):
    src = open_(os.path.join(D, 'bg-f%d.png' % f))
    m = src.crop((int(420 * 1.25), int(150 * 1.25), int(610 * 1.25), int(200 * 1.25))).resize((cellw, cellh), Image.NEAREST)
    p = src.crop((int(430 * 1.25), int(500 * 1.25), int(600 * 1.25), int(550 * 1.25))).resize((cellw, cellh), Image.NEAREST)
    x = 10 + i * (cellw + 10)
    cv.paste(m, (x, 30))
    cv.paste(p, (x, 30 + cellh + 30))
    d.text((x + 2, 30 + cellh + 6), 'F%d 玩家脚下' % f, font=FONT_S, fill=(200, 200, 210))
    d.text((x + 2, 14), 'F%d 怪物脚下' % f, font=FONT_S, fill=(200, 200, 210))
cv.save(os.path.join(D, 'shadow-5f.png'))
print('shadow-5f.png', cv.size)

# ── 6. 三 Boss 比高（落屏 2× 整数倍）────────────────────
def boss(img, h):
    im = Image.open(img).convert('RGBA')
    w = round(im.width * h / im.height)
    return im.resize((w, h), Image.NEAREST)

og = boss(os.path.join(SPR, 'ogre_boss_idle_anim_f0.png'), 108)
zk = boss(os.path.join(SPR, 'zombie_king_idle_anim_f0.png'), 108)
dr = boss(os.path.join(SPR, 'dragon_idle_anim_f0.png'), 144)
cv = Image.new('RGB', (980, 400), (12, 12, 18))
d = ImageDraw.Draw(cv)
base = 340
for x, im, name, hh in ((90, og, 'ogre_boss', 108), (390, zk, 'zombie_king', 108), (680, dr, 'dragon', 144)):
    cv.paste(im, (x - im.width // 2, base - im.height), im)
    d.text((x - 60, base + 12), '%s  %dpx' % (name, hh), font=FONT, fill=(230, 230, 240))
    d.line([(x - 70, base - hh), (x + 70, base - hh)], fill=(90, 160, 120), width=1)
d.line([(40, base), (940, base)], fill=(120, 120, 140), width=2)
d.text((40, 14), '三只 Boss 同基线比高（全部整数倍：48×54→108 / 72×72→144）', font=FONT_L, fill=(255, 210, 120))
cv.save(os.path.join(D, 'dragon-3boss.png'))
print('dragon-3boss.png', cv.size)

# ── 7. 龙头 1× / 8× + 三态 8× ───────────────────────────
f5 = open_(os.path.join(D, 'bg-f5.png'))
# 龙头在落屏 (512, 36+52) 附近
head = f5.crop((int(466 * 1.25), int(44 * 1.25), int(558 * 1.25), int(136 * 1.25)))
head.save(os.path.join(D, 'dragon-head-1x.png'))
head.resize((head.width * 8, head.height * 8), Image.NEAREST).save(os.path.join(D, 'dragon-head-8x.png'))
print('dragon-head-1x.png', head.size)

states = ['idle', 'attack', 'hurt']
cv = Image.new('RGB', (72 * 3 * 8 + 40, 72 * 8 + 50), (10, 10, 14))
d = ImageDraw.Draw(cv)
for i, s in enumerate(states):
    im = Image.open(os.path.join(SPR, 'dragon_%s_anim_f0.png' % s)).convert('RGBA')
    big = im.resize((72 * 8, 72 * 8), Image.NEAREST)
    bg = Image.new('RGBA', big.size, (8, 8, 14, 255))
    bg.alpha_composite(big)
    x = 10 + i * (72 * 8 + 10)
    cv.paste(bg.convert('RGB'), (x, 40))
    d.text((x + 4, 12), '%s 原生 72×72' % s, font=FONT, fill=(230, 230, 240))
cv.save(os.path.join(D, 'dragon-native-8x.png'))
print('dragon-native-8x.png', cv.size)
