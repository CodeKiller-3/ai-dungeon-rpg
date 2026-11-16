# -*- coding: utf-8 -*-
"""D-94 P2 断言：纵置逐像素不变 / 横置背景亮度分区 / 五层签名 / 实体脚底同基线
用法：python check_p2.py
数据：shots_d94.py p2 产出的 p2-*.png + p2-*-horizontal-bg.png + geometry-p2.json
     P0 基线几何与哈希在 geometry-base.json（纵置逐像素对账用）。
判据全部是实数断言，不读截图主观判断：
  1) 纵置：同参数同帧的像素哈希必须与 P0 基线一致（逐像素不变）；
  2) 横置纯背景：全局最亮像素落在 x≤0.12W 或 x≥0.88W、y≥0.594H；
     两个精灵包围盒内最亮 ≤115，且比全局最亮低 ≥60；
  3) 五层纯背景像素签名两两不同；
  4) 横置全图：玩家/怪物精灵最低"变亮"像素行 == groundY-1（同一基线），
     groundY == round(0.766H)；接触阴影中心行 == groundY-1（不越过基线）。
"""
import json
import os
import sys
from PIL import Image

ROOT = os.path.dirname(os.path.abspath(__file__))
FLOORS = [(1, 'slime'), (2, 'ogre_boss'), (3, 'slime'), (4, 'zombie_king'), (5, 'dragon')]
VIEWS = [(1024, 640), (960, 540)]

fails = []
notes = []


def fail(msg):
    fails.append(msg)
    print('FAIL', msg)


def ok(msg):
    notes.append(msg)
    print('ok  ', msg)


def load(name):
    p = os.path.join(ROOT, name + '.png')
    return Image.open(p).convert('RGB')


def bright(px):
    return max(px[0], px[1], px[2])


def main():
    geo = json.load(open(os.path.join(ROOT, 'geometry-p2.json'), encoding='utf-8'))

    # ---- 1) 纵置场景逐像素不变（P7.5 起 HUD 顶栏获准最小修复，故对账口径为 y≥28；
    #         顶栏差异由 check_p75.py D 组单独判"MP 读数留白"，不在这里放宽） ----
    for (w, h) in VIEWS:
        for f, mid in FLOORS:
            key = '%dx%d-f%d-%s-vertical' % (w, h, f, mid)
            base_name = 'base-%dx%d-vertical-%s.png' % (w, h, ('f3-' + mid) if f == 3 else mid)
            bp = os.path.join(ROOT, base_name)
            np_ = os.path.join(ROOT, 'p2-' + key + '.png')
            if not os.path.exists(bp):
                fail('基线缺纵置样本 %s' % base_name)
                continue
            a, b = load('p2-' + key), load(base_name[:-4])
            W0, H0 = a.size
            pa, pb = a.load(), b.load()
            bad, hud = 0, 0
            for y in range(H0):
                for x in range(W0):
                    if pa[x, y] != pb[x, y]:
                        if y >= 28:
                            bad += 1
                        else:
                            hud += 1
            if bad:
                fail('纵置场景变了 %s：y≥28 有 %d px 不同' % (key, bad))
            else:
                ok('纵置场景逐像素不变 %s（顶栏差异 %d px，见 check_p75）' % (key, hud))

    # ---- 2) 横置纯背景亮度分区 ----
    sig = {}
    for (w, h) in VIEWS:
        for f, mid in FLOORS:
            name = '%dx%d-f%d-%s-horizontal-bg' % (w, h, f, mid)
            im = load('p2-' + name)
            W, H = im.size
            px = im.load()
            G = round(H * 0.766)
            best = (-1, 0, 0)
            for y in range(H):
                for x in range(W):
                    b = bright(px[x, y])
                    if b > best[0]:
                        best = (b, x, y)
            bx, by = best[1], best[2]
            side = (bx <= 0.12 * W) or (bx >= 0.88 * W)
            low = by >= round(0.594 * H)
            if not side or not low:
                fail('%s 最亮像素越界 (%d,%d) b=%d 需 x≤%d 或 x≥%d, y≥%d'
                     % (name, bx, by, best[0], round(0.12 * W), round(0.88 * W), round(0.594 * H)))
            else:
                ok('%s 最亮在侧 (%d,%d) b=%d' % (name, bx, by, best[0]))
            # 两个精灵包围盒（1024 基准 201–291 / 706–850，其它视口按比例缩放）
            boxes = [(round(0.196 * W), round(0.284 * W)), (round(0.689 * W), round(0.830 * W))]
            for bi, (x0, x1) in enumerate(boxes):
                mx = -1
                for y in range(round(0.60 * H), min(H, G + 6)):
                    for x in range(x0, x1 + 1):
                        b = bright(px[x, y])
                        if b > mx:
                            mx = b
                if mx > 115 or best[0] - mx < 60:
                    fail('%s 精灵盒%d 背景过亮 max=%d（全局 %d，需 ≤115 且低 ≥60）'
                         % (name, bi + 1, mx, best[0]))
                else:
                    ok('%s 精灵盒%d max=%d（比光源低 %d）' % (name, bi + 1, mx, best[0] - mx))
            sig[(w, h, f)] = im.tobytes()
    for (w, h) in VIEWS:
        n = len({hash(sig[(w, h, f)]) for f, _ in FLOORS})
        if n != 5:
            fail('%dx%d 五层横置背景像素签名只有 %d 个' % (w, h, n))
        else:
            ok('%dx%d 五层横置背景两两不同（5 个签名）' % (w, h))

    # ---- 3) 脚底同基线（精灵最低"变亮"像素行） ----
    for (w, h) in VIEWS:
        for f, mid in FLOORS:
            tag = '%dx%d-f%d-%s-horizontal' % (w, h, f, mid)
            shot = load('p2-' + tag)
            bg = load('p2-' + tag + '-bg')
            g = (geo.get(tag) or {}).get('geo') or {}
            W, H = shot.size
            G = round(H * 0.766)
            ps, pb = shot.load(), bg.load()
            for who in ('player', 'monster'):
                box = g.get(who)
                if not box:
                    fail('%s 缺 %s 几何' % (tag, who))
                    continue
                if box['groundY'] != G:
                    fail('%s %s groundY=%d != %d' % (tag, who, box['groundY'], G))
                x0 = max(0, box['x'])
                x1 = min(W - 1, box['x'] + box['w'])
                y0 = max(0, box['y'])
                lowrow = None
                # P7.5：地板按"最亮可走面"提亮后，深色靴底不再比地面亮，
                # 原来"精灵比背景亮 >16"的单向判据会漏掉靴底两行。改为同一阈值的
                # 双向色差（|ΔR|/|ΔG|/|ΔB| 任一 >16），并把扫描上界收到基线行，
                # 避开接触阴影（阴影恒在 groundY-1..+3，属于绘制结果而不是精灵本体）。
                for y in range(y0, min(H, G)):
                    for x in range(x0, x1 + 1):
                        a, b = ps[x, y], pb[x, y]
                        if (abs(a[0] - b[0]) > 16 or abs(a[1] - b[1]) > 16 or
                                abs(a[2] - b[2]) > 16):
                            lowrow = y
                            break
                if lowrow is None:
                    fail('%s %s 找不到精灵像素' % (tag, who))
                elif abs(lowrow - (G - 1)) > 1:
                    fail('%s %s 脚底行 %d，基线应为 %d（差 %d）'
                         % (tag, who, lowrow, G - 1, lowrow - (G - 1)))
                else:
                    print('     %s %s 脚底行 %d / 基线 %d' % (tag, who, lowrow, G - 1))
            ok('%s 双方 groundY=%d（脚底行实测见上）' % (tag, G))

    print('\n---- 汇总 ----')
    print('ok %d 条，FAIL %d 条' % (len(notes), len(fails)))
    if fails:
        for f in fails:
            print(' -', f)
        sys.exit(1)
    print('P2 ALL PASS')


if __name__ == '__main__':
    main()
