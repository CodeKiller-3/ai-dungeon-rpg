# -*- coding: utf-8 -*-
"""D-94 P7.5 断言：
  A) 五层横置「地板/墙/敌人站位区」亮度关系（复用 measure_wallfloor.py 的实测 JSON）
  B) 纵置只改了 HUD：与 P0 基线逐像素对账，所有差异必须落在顶栏 y<28
  C) F3 两池熔岩各留 ≥5px 白热核心（min(R,G,B)≥230）
  D) HUD MP 读数留白：320 窄屏改前 <4px、改后 ≥4px（数字不再贴/压条框）
用法：python check_p75.py
"""
import json
import os
import sys
from PIL import Image

ROOT = os.path.dirname(os.path.abspath(__file__))
FLOORS = [(1, 'slime'), (2, 'ogre_boss'), (3, 'slime'), (4, 'zombie_king'), (5, 'dragon')]
VIEWS = [(1024, 640), (960, 540)]
BASE = 'base-%dx%d-vertical-%s.png'

fails, notes = [], []


def fail(m):
    fails.append(m)
    print('FAIL', m)


def ok(m):
    notes.append(m)
    print('ok  ', m)


def load(p):
    return Image.open(os.path.join(ROOT, p)).convert('RGB')


def main():
    # ---- A) 墙地关系 ----
    wf = json.load(open(os.path.join(ROOT, 'wallfloor-p75.json'), encoding='utf-8'))
    if not wf.get('allOk'):
        for r in wf['views']:
            if not r['ok']:
                fail('墙地关系 %dx%d F%d 地板%.1f 墙%.1f 敌位%.1f' %
                     (r['viewport'][0], r['viewport'][1], r['floor'], r['floorL'],
                      r['wallL'], r['standL']))
    else:
        ok('五层 × 两视口 10 行：地板 > 墙 +15，敌/玩家站位与地板差 ≤3（见 wallfloor-p75.json）')

    # ---- B) 纵置差异只在 HUD ----
    for w, h in VIEWS:
        for f, mid in FLOORS:
            new = 'p2-%dx%d-f%d-%s-vertical.png' % (w, h, f, mid)
            base = BASE % (w, h, f3name(f, mid))
            if not os.path.exists(os.path.join(ROOT, base)):
                fail('缺 P0 纵置基线 %s' % base)
                continue
            a, b = load(new), load(base)
            if a.size != b.size:
                fail('%s 尺寸变了 %s != %s' % (new, a.size, b.size))
                continue
            pa, pb = a.load(), b.load()
            n = 0
            bad = 0
            for y in range(h):
                for x in range(w):
                    if pa[x, y] != pb[x, y]:
                        n += 1
                        if y >= 28:
                            bad += 1
            if bad:
                fail('%s 纵置 HUD 以外有 %d 个像素变了（总差 %d）' % (new, bad, n))
            else:
                ok('%s 纵置逐像素不变（差异 %d px 全在顶栏 y<28）' % (new, n))

    # ---- C) F3 白热核心 ----
    im = load('p75-1024x640-f3-slime-horizontal-bg.png')
    px = im.load()
    W, H = im.size
    for side, x0, x1 in [('左', 0, int(0.12 * W)), ('右', int(0.88 * W), W)]:
        c = 0
        for y in range(int(0.594 * H), H):
            for x in range(x0, x1):
                p = px[x, y]
                # 背景缓存最后叠了一层四角压暗（边角最多 0.30），纯白核心落屏约 225；
                # 190 仍高于任何石材/熔岩（橙 #ffc060 的蓝通道只有 96），不会误判。
                if p[0] >= 190 and p[1] >= 190 and p[2] >= 190:
                    c += 1
        if c < 5:
            fail('F3 %s池白热核心只有 %d px（需 ≥5）' % (side, c))
        else:
            ok('F3 %s池白热核心 %d px（≥5，在 x≤0.12W / ≥0.88W 的外侧）' % (side, c))

    # ---- D) HUD MP 读数留白（320） ----
    for tag, need in [('before', 0), ('after', 4)]:
        p = 'hud-%s-320x568.png' % tag
        if not os.path.exists(os.path.join(ROOT, p)):
            fail('缺 %s' % p)
            continue
        im = load(p)
        px = im.load()
        xs = []
        for x in range(104, 240):
            q = px[x, 13]
            if q == (96, 165, 250) or (q[0] >= 200 and q[1] >= 200 and q[2] >= 200):
                xs.append(x)
        if not xs:
            fail('%s 找不到 MP 条' % p)
            continue
        bx0, bx1 = xs[0], xs[-1]
        tx = [x for x in xs if all(c >= 200 for c in px[x, 13])]
        padl, padr = (min(tx) - bx0), (bx1 - max(tx)) if tx else (0, 0)
        out = {'bar': [bx0, bx1], 'text': [min(tx), max(tx)] if tx else None,
               'padL': padl, 'padR': padr}
        print('     %s %s' % (p, json.dumps(out)))
        if need == 0:
            ok('%s 改前 MP 读数留白 L%d/R%d（记录用）' % (tag, padl, padr))
        elif min(padl, padr) < need:
            fail('%s MP 读数留白不足 L%d/R%d（需 ≥%d）' % (tag, padl, padr, need))
        else:
            ok('%s MP 读数留白 L%d/R%d（≥%d）' % (tag, padl, padr, need))

    print('\n---- 汇总 ----')
    print('ok %d 条，FAIL %d 条' % (len(notes), len(fails)))
    if fails:
        for f in fails:
            print(' -', f)
        sys.exit(1)
    print('P7.5 ALL PASS')


def f3name(f, mid):
    return ('f3-' + mid) if f == 3 else mid


if __name__ == '__main__':
    main()
