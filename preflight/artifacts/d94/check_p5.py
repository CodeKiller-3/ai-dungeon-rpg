# -*- coding: utf-8 -*-
"""D-94 P5 断言：横置特效方向语义（斩击角/击退轴/火花角）+ 纵置不变
用法：python check_p5.py
数据：shots_d94.py p5 产出的 p5-*.png + geometry-p5.json；P0 基线 geometry-base.json。
判据：
  1) 纵置无特效帧：像素哈希 == P0 基线（10/10，P5 没有碰纵置一行）；
  2) 横置玩家出手：斩击中心 == 敌方左缘接触点、a0=+ (π/2−0.5)、dir=+1、
     impact 火花平均向 +x 漂移、怪物向右弹开（knockX>0）、玩家前摇向右（lungeX>0）、
     弧的保护带 = 铭牌下沿 ~ 指令条上沿；
  3) 横置怪物反击：斩击中心 == 玩家右缘接触点、a0=−(π/2−0.5)、dir=−1、
     impact 火花平均向 −x、玩家向左弹开（knockX<0）、怪物前扑向左（lungeX<0）；
  4) 纵置特效：a0=−0.15、keepAbove=206 / keepBelow=438、方向与 P0 一致（-1/+1）。
"""
import json
import math
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
FLOORS = [(1, 'slime'), (2, 'ogre_boss'), (3, 'slime'), (4, 'zombie_king'), (5, 'dragon')]
VIEWS = [(1024, 640), (960, 540)]
A0 = math.pi / 2 - 0.5

fails = []
notes = []


def fail(msg):
    fails.append(msg)
    print('FAIL', msg)


def ok(msg):
    notes.append(msg)
    print('ok  ', msg)


def geo_of(geo, tag):
    return (geo.get(tag) or {}).get('geo') or {}


def main():
    geo = json.load(open(os.path.join(ROOT, 'geometry-p5.json'), encoding='utf-8'))
    base = json.load(open(os.path.join(ROOT, 'geometry-base.json'), encoding='utf-8'))

    base_by = {}
    for k, v in base.items():
        g = v.get('geo') or {}
        base_by[(v['viewport'][0], v['viewport'][1], v['floor'], v['monster'], v['ask'])] = g.get('hash')

    # ---- 1) 纵置逐像素不变 ----
    bad = 0
    for (w, h) in VIEWS:
        for f, mid in FLOORS:
            tag = '%dx%d-f%d-%s-vertical-nofx' % (w, h, f, mid)
            g = geo_of(geo, tag)
            want = base_by.get((w, h, f, mid, 'vertical'))
            if not want or g.get('hash') != want:
                bad += 1
                fail('纵置像素变了 %s: %s != %s' % (tag, g.get('hash'), want))
    ok('纵置无特效帧逐像素不变：%d/%d 与 P0 哈希相同' % (len(VIEWS) * len(FLOORS) - bad, len(VIEWS) * len(FLOORS)))

    # ---- 2/3) 横置两个方向 ----
    for (w, h) in VIEWS:
        pcx, ecx = round(w * 0.24), round(w * 0.76)
        G = round(h * 0.766)
        for f, mid, mw in [(1, 'slime', 90), (5, 'dragon', 144)]:
            tagp = '%dx%d-f%d-%s-horizontal-fx-p' % (w, h, f, mid)
            g = geo_of(geo, tagp)
            fx = g.get('fx') or {}
            st = fx.get('state') or {}
            lst = st.get('slashList') or []
            sp = lst[-1] if lst else None
            if not sp:
                fail('%s 没有斩击' % tagp)
                continue
            if abs(sp['x'] - (ecx - 34)) > 1 or abs(sp['y'] - (G - 46)) > 1:
                fail('%s 斩击中心 (%d,%d) != 敌方左缘接触点 (%d,%d)'
                     % (tagp, sp['x'], sp['y'], ecx - 34, G - 46))
            if abs(sp['a0'] - A0) > 1e-6:
                fail('%s 斩击角 %s != %f（应为竖月牙）' % (tagp, sp['a0'], A0))
            if sp['dir'] != 1:
                fail('%s 斩击 dir=%s，玩家右斩应为 +1' % (tagp, sp['dir']))
            if sp.get('keepAbove') != h - 96:
                fail('%s keepAbove=%s，应为指令条上沿 %d' % (tagp, sp.get('keepAbove'), h - 96))
            if sp.get('keepBelow') != G - round(h * 0.247):
                fail('%s keepBelow=%s，应为铭牌下沿 %d' % (tagp, sp.get('keepBelow'), G - round(h * 0.247)))
            ring = st.get('ringPos')
            if not ring or ring['x'] != sp['x'] or ring['y'] != sp['y']:
                fail('%s 冲击环与斩击不同点：%s / %s' % (tagp, ring, sp))
            imp = [x for x in (fx.get('particles') or [])
                   if x.get('kind') == 'impact' and abs(x['x'] - sp['x']) < 70]
            if not imp:
                fail('%s 没有 impact 火花' % tagp)
            else:
                dx = sum(x['x'] - sp['x'] for x in imp) / len(imp)
                if dx <= 3 or any(x['x'] - sp['x'] <= 0 for x in imp):
                    fail('%s 火花没有向右溅：mean dx=%.2f' % (tagp, dx))
                else:
                    ok('%s 玩家右斩：中心(%d,%d) 火花向右 mean dx=%.1f' % (tagp, sp['x'], sp['y'], dx))
            mob = g.get('monster') or {}
            if (mob.get('knockX') or 0) <= 0:
                fail('%s 怪物没有向右弹开：knockX=%s' % (tagp, mob.get('knockX')))
            if mob.get('x', 0) < ecx - mw / 2 - 1:
                fail('%s 怪物绘制 x=%d 没有比站位更靠右' % (tagp, mob.get('x')))
            pl = g.get('player') or {}
            if (pl.get('lungeX') or 0) < 0:
                fail('%s 玩家前摇方向反了：lungeX=%s' % (tagp, pl.get('lungeX')))

            tagm = '%dx%d-f%d-%s-horizontal-fx-m' % (w, h, f, mid)
            g2 = geo_of(geo, tagm)
            fx2 = g2.get('fx') or {}
            st2 = fx2.get('state') or {}
            lst2 = st2.get('slashList') or []
            sp2 = lst2[-1] if lst2 else None
            if not sp2:
                fail('%s 没有斩击' % tagm)
                continue
            if abs(sp2['x'] - (pcx + 24)) > 1 or abs(sp2['y'] - (G - 48)) > 1:
                fail('%s 斩击中心 (%d,%d) != 玩家右缘接触点 (%d,%d)'
                     % (tagm, sp2['x'], sp2['y'], pcx + 24, G - 48))
            if abs(sp2['a0'] + A0) > 1e-6:
                fail('%s 斩击角 %s != %f（应为镜像竖月牙）' % (tagm, sp2['a0'], -A0))
            if sp2['dir'] != -1:
                fail('%s 斩击 dir=%s，怪物左劈应为 -1' % (tagm, sp2['dir']))
            if sp2.get('keepAbove') != h - 96:
                fail('%s keepAbove=%s，应为指令条上沿 %d' % (tagm, sp2.get('keepAbove'), h - 96))
            if sp2.get('keepBelow') != G - round(h * 0.247):
                fail('%s keepBelow=%s，应为铭牌下沿 %d' % (tagm, sp2.get('keepBelow'), G - round(h * 0.247)))
            imp2 = [x for x in (fx2.get('particles') or [])
                    if x.get('kind') == 'impact' and abs(x['x'] - sp2['x']) < 70]
            if not imp2:
                fail('%s 没有 impact 火花' % tagm)
            else:
                dx2 = sum(x['x'] - sp2['x'] for x in imp2) / len(imp2)
                if dx2 >= -3 or any(x['x'] - sp2['x'] >= 0 for x in imp2):
                    fail('%s 火花没有向左溅：mean dx=%.2f' % (tagm, dx2))
                else:
                    ok('%s 怪物左劈：中心(%d,%d) 火花向左 mean dx=%.1f' % (tagm, sp2['x'], sp2['y'], dx2))
            pl2 = g2.get('player') or {}
            if (pl2.get('knockX') or 0) >= 0:
                fail('%s 玩家没有向左弹开：knockX=%s' % (tagm, pl2.get('knockX')))
            if pl2.get('x', 0) > pcx - 25 + 1:
                fail('%s 玩家绘制 x=%d 没有比站位更靠左' % (tagm, pl2.get('x')))
            mob2 = g2.get('monster') or {}
            if (mob2.get('lungeX') or 0) > 0:
                fail('%s 怪物前扑方向反了：lungeX=%s' % (tagm, mob2.get('lungeX')))

    # ---- 4) 纵置特效语义不变 ----
    for (w, h) in VIEWS:
        for f, mid in [(1, 'slime'), (5, 'dragon')]:
            for mode, want_dir, want_keep_a, want_keep_b in [('p', -1, 206, None), ('m', 1, None, 438)]:
                tag = '%dx%d-f%d-%s-vertical-fx-%s' % (w, h, f, mid, mode)
                st = (geo_of(geo, tag).get('fx') or {}).get('state') or {}
                lst = st.get('slashList') or []
                sp = lst[-1] if lst else None
                if not sp:
                    fail('%s 没有斩击' % tag)
                    continue
                if abs(sp['a0'] + 0.15) > 1e-6:
                    fail('%s 纵置斩击角 %s != -0.15' % (tag, sp['a0']))
                if sp['dir'] != want_dir:
                    fail('%s 纵置 dir=%s != %d' % (tag, sp['dir'], want_dir))
                if sp.get('keepAbove') != want_keep_a or sp.get('keepBelow') != want_keep_b:
                    fail('%s 纵置保护带变了：%s / %s' % (tag, sp.get('keepAbove'), sp.get('keepBelow')))
    ok('纵置特效语义不变：a0=-0.15、keepAbove=206 / keepBelow=438、dir -1/+1')

    print('\n---- 汇总 ----')
    print('ok %d 条，FAIL %d 条' % (len(notes), len(fails)))
    if fails:
        for f in fails:
            print(' -', f)
        sys.exit(1)
    print('P5 ALL PASS')


if __name__ == '__main__':
    main()
