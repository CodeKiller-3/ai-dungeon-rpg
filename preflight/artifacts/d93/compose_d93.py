# -*- coding: utf-8 -*-
"""D-93 改前/改后同状态对照图：左 before、右 after，中间 8px 分隔线。"""
import os
from PIL import Image, ImageDraw

ROOT = r'd:\桌面\工作\人工智能大作业\preflight\artifacts\d93'
PAIRS = [
    ('1024x640-save', 'compare-1024x640-save.png'),
    ('1024x640-empty', 'compare-1024x640-empty.png'),
    ('500x700-save', 'compare-500x700-save.png'),
    ('500x700-empty', 'compare-500x700-empty.png'),
    ('320x640-save', 'compare-320x640-save.png'),
    ('320x640-empty', 'compare-320x640-empty.png'),
]
GAP = 8

for key, out in PAIRS:
    a = Image.open(os.path.join(ROOT, 'before-%s.png' % key)).convert('RGB')
    b = Image.open(os.path.join(ROOT, 'after-%s.png' % key)).convert('RGB')
    w = a.width + GAP + b.width
    h = max(a.height, b.height)
    canvas = Image.new('RGB', (w, h), (20, 20, 24))
    canvas.paste(a, (0, 0))
    canvas.paste(b, (a.width + GAP, 0))
    d = ImageDraw.Draw(canvas)
    d.rectangle([a.width, 0, a.width + GAP - 1, h], fill=(255, 207, 110))
    canvas.save(os.path.join(ROOT, out))
    print(out, canvas.size)
