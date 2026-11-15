# -*- coding: utf-8 -*-
"""D-93 像素证明：门缝光的实际宽度/颜色 + 暗栏文字与背景的 WCAG 对比度。
用法：python pixels_d93.py
输入：after-1024x640-save.png（DSF=1 真实视口截图），after-500x700-save.png
输出：逐像素扫描结果 + 对比度表，写入 pixel-proof.json
"""
import json
import os
from PIL import Image

ROOT = r'd:\桌面\工作\人工智能大作业\preflight\artifacts\d93'
SEAM_RGB = (255, 191, 115)          # #ffbf73
PANEL_RGB = (7, 8, 14)              # #07080e

TEXT = {
    '正常项 #cfcfcf': '#cfcfcf',
    '选中/金色 #ffcf6e': '#ffcf6e',
    '禁用项 #7d8397': '#7d8397',
    '副标 #9aa0b4': '#9aa0b4',
    '提示 #7f879c': '#7f879c',
    '覆盖警告 #c98a6b': '#c98a6b',
    '进度标签 #c9a35e': '#c9a35e',
}


def hex2rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def lin(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def lum(rgb):
    r, g, b = rgb
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)


def contrast(a, b):
    la, lb = lum(a), lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def scan_seam(path, y):
    im = Image.open(path).convert('RGB')
    w, h = im.size
    row = [im.getpixel((x, y)) for x in range(w)]
    runs = []
    start = None
    for x, px in enumerate(row):
        if px == SEAM_RGB:
            if start is None:
                start = x
        else:
            if start is not None:
                runs.append((start, x - start))
                start = None
    if start is not None:
        runs.append((start, w - start))
    return [(s, n, '#%02x%02x%02x' % SEAM_RGB) for s, n in runs]


def main():
    out = {'seam': {}, 'contrast': {}, 'inputs': []}

    # 1024×640：门洞在 (256,144) 96×96；取门板中段 y=190 扫整行
    p1 = os.path.join(ROOT, 'after-1024x640-save.png')
    runs1 = scan_seam(p1, 190)
    out['seam']['1024x640@y190'] = runs1
    out['inputs'].append({'file': 'after-1024x640-save.png', 'size': Image.open(p1).size})
    # 门板纵向：逐行统计核心像素数量，给出光的纵向范围
    im1 = Image.open(p1).convert('RGB')
    ys = []
    for y in range(130, 260):
        n = sum(1 for x in range(240, 380) if im1.getpixel((x, y)) == SEAM_RGB)
        if n:
            ys.append((y, n))
    out['seam']['verticalSpan'] = {'first': ys[0] if ys else None, 'last': ys[-1] if ys else None,
                                   'rows': len(ys)}

    # 暗栏背景实采：栏内 (930, 470) 是纯底（不压任何文字）
    bg = im1.getpixel((930, 470))
    out['panelBgSample'] = {'xy': [930, 470], 'rgb': list(bg), 'hex': '#%02x%02x%02x' % bg}
    for name, hx in TEXT.items():
        out['contrast'][name] = round(contrast(hex2rgb(hx), bg), 2)

    # 500×700：门 (178,104) 96×96 → y=150
    p2 = os.path.join(ROOT, 'after-500x700-save.png')
    out['seam']['500x700@y150'] = scan_seam(p2, 150)
    out['inputs'].append({'file': 'after-500x700-save.png', 'size': Image.open(p2).size})

    # 320×640：门 (112,88) 96×96 → y=130
    p3 = os.path.join(ROOT, 'after-320x640-save.png')
    out['seam']['320x640@y130'] = scan_seam(p3, 130)
    out['inputs'].append({'file': 'after-320x640-save.png', 'size': Image.open(p3).size})

    with open(os.path.join(ROOT, 'pixel-proof.json'), 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
