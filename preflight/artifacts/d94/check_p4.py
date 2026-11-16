# -*- coding: utf-8 -*-
"""D-94 P4 断言：身份带（紧凑铭牌）+ 回合条 + 7 格指令条；纵置逐像素不变
用法：python check_p4.py
数据：shots_d94.py p4 产出的 p4-*.png + geometry-p4.json；P0 基线 geometry-base.json。
判据：
  1) 纵置：同参数同帧像素哈希 == P0 基线（逐像素不变，10/10）；
  2) 铭牌宽度 = clamp(round(精灵落屏宽×1.5), 96, 240)，且从不等于旧的固定 340；
     两块铭牌同一条 y、互不重叠、不压精灵（底边距精灵顶 ≥10px）、不出屏；
  3) 指令条：y=H−96、7 格、键位 1–7、格宽 132/122、间距 8、不压地面基线、不与铭牌重叠；
  4) MP=0 时 4/5/6 三格 disabled，其余仍可用（只降 alpha，不改判定）。
"""
import json
import os
import sys

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


def clamp_w(sprite_w):
    return max(96, min(240, round(sprite_w * 1.5)))


def main():
    geo = json.load(open(os.path.join(ROOT, 'geometry-p4.json'), encoding='utf-8'))
    base = json.load(open(os.path.join(ROOT, 'geometry-base.json'), encoding='utf-8'))

    base_by = {}
    for k, v in base.items():
        g = v.get('geo') or {}
        base_by[(v['viewport'][0], v['viewport'][1], v['floor'], v['monster'], v['ask'])] = g.get('hash')

    # ---- 1) 纵置逐像素不变 ----
    for (w, h) in VIEWS:
        for f, mid in FLOORS:
            key = '%dx%d-f%d-%s-vertical' % (w, h, f, mid)
            g = (geo.get(key) or {}).get('geo') or {}
            want = base_by.get((w, h, f, mid, 'vertical'))
            if not want:
                fail('基线缺纵置样本 %s' % key)
            elif g.get('hash') != want:
                fail('纵置像素变了 %s: %s != %s' % (key, g.get('hash'), want))
    ok('纵置逐像素不变：%d/%d 与 P0 哈希相同' % (len(VIEWS) * len(FLOORS), len(VIEWS) * len(FLOORS)))

    # ---- 2) 铭牌 + 回合条 ----
    for (w, h) in VIEWS:
        for f, mid in FLOORS:
            tag = '%dx%d-f%d-%s-horizontal' % (w, h, f, mid)
            g = (geo.get(tag) or {}).get('geo') or {}
            if not g:
                fail('%s 无几何' % tag)
                continue
            pp, mp = g.get('playerPlate'), g.get('monsterPlate')
            if not pp or not mp:
                fail('%s 缺铭牌几何' % tag)
                continue
            wp, wm = g['player']['w'], g['monster']['w']
            if pp['w'] != clamp_w(wp):
                fail('%s 玩家铭牌宽 %d != %d（精灵宽 %d）' % (tag, pp['w'], clamp_w(wp), wp))
            if mp['w'] != clamp_w(wm):
                fail('%s 敌方铭牌宽 %d != %d（精灵宽 %d）' % (tag, mp['w'], clamp_w(wm), wm))
            if pp['w'] == 340 or mp['w'] == 340:
                fail('%s 仍出现固定 340 宽度' % tag)
            if pp['y'] != mp['y']:
                fail('%s 两块铭牌不在同一条 y：%d / %d' % (tag, pp['y'], mp['y']))
            if pp['y'] + pp['h'] > g['player']['y'] - 10:
                fail('%s 我方铭牌压精灵（底 %d，精灵顶 %d）' % (tag, pp['y'] + pp['h'], g['player']['y']))
            if mp['y'] + mp['h'] > g['monster']['y'] - 10:
                fail('%s 敌方铭牌压精灵（底 %d，精灵顶 %d）' % (tag, mp['y'] + mp['h'], g['monster']['y']))
            if pp['x'] < 0 or mp['x'] < 0 or pp['x'] + pp['w'] > w or mp['x'] + mp['w'] > w:
                fail('%s 铭牌出屏' % tag)
            if pp['x'] + pp['w'] > mp['x']:
                fail('%s 两块铭牌重叠（%d+%d > %d）' % (tag, pp['x'], pp['w'], mp['x']))
            rb = g.get('roundBar')
            if not rb or rb['y'] + rb['h'] > pp['y']:
                fail('%s 回合条缺失或与铭牌重叠' % tag)
            ok('%s 铭牌 %d/%d 宽、同 y=%d、回合条 “%s”' % (tag, pp['w'], mp['w'], pp['y'], (rb or {}).get('text')))

    # ---- 3) 指令条 ----
    for (w, h) in VIEWS:
        for f, mid in FLOORS:
            tag = '%dx%d-f%d-%s-horizontal' % (w, h, f, mid)
            g = (geo.get(tag) or {}).get('geo') or {}
            cb = g.get('commandBar')
            if not cb:
                fail('%s 缺指令条几何' % tag)
                continue
            if cb['y'] != h - 96 or cb['h'] != 96:
                fail('%s 指令条 y/h = %d/%d，应为 %d/96' % (tag, cb['y'], cb['h'], h - 96))
            cells = cb['cells']
            if len(cells) != 7:
                fail('%s 指令格格数 %d != 7' % (tag, len(cells)))
                continue
            if [c['key'] for c in cells] != [1, 2, 3, 4, 5, 6, 7]:
                fail('%s 键位不是 1–7：%s' % (tag, [c['key'] for c in cells]))
            want_cw = (132 if w == 1024 else 122)
            for i, c in enumerate(cells):
                if c['w'] != want_cw:
                    fail('%s 格宽 %d != %d' % (tag, c['w'], want_cw))
                if c['x'] < 0 or c['x'] + c['w'] > w:
                    fail('%s 第 %d 格出屏' % (tag, i + 1))
                if c['y'] < g['player']['groundY']:
                    fail('%s 指令条压到基线（格顶 %d < %d）' % (tag, c['y'], g['player']['groundY']))
                if i and c['x'] - (cells[i - 1]['x'] + cells[i - 1]['w']) != 8:
                    fail('%s 第 %d 格格间距不是 8' % (tag, i + 1))
                if not c['sub']:
                    fail('%s 第 %d 格缺副标签' % (tag, i + 1))
            if not (cells[3]['sub'].startswith('MP') and cells[4]['sub'].startswith('MP') and
                    cells[5]['sub'].startswith('MP')):
                fail('%s 技能格副标签应显示 MP 消耗：%s' % (tag, [c['sub'] for c in cells[3:6]]))
            if not cells[6]['sub'].startswith('×'):
                fail('%s 用药格应显示数量：%s' % (tag, cells[6]['sub']))
            if any(c['disabled'] for c in cells):
                fail('%s MP=30 时不应有禁用格' % tag)
            ok('%s 指令条 7 格 1–7、格宽 %d、y=%d' % (tag, want_cw, cb['y']))

    # ---- 4) MP=0 降级 ----
    for (w, h) in VIEWS:
        tag = '%dx%d-f5-dragon-horizontal-mp0' % (w, h)
        g = (geo.get(tag) or {}).get('geo') or {}
        cb = g.get('commandBar')
        if not cb:
            fail('%s 缺指令条几何' % tag)
            continue
        cells = cb['cells']
        want = [False, False, False, True, True, True, False]
        got = [c['disabled'] for c in cells]
        if got != want:
            fail('%s MP=0 禁用格 %s，应为 %s' % (tag, got, want))
        else:
            ok('%s MP=0 → 4/5/6 降级，1/2/3/7 仍可用（%s）' % (tag, [c['sub'] for c in cells[3:6]]))

    print('\n---- 汇总 ----')
    print('ok %d 条，FAIL %d 条' % (len(notes), len(fails)))
    if fails:
        for f in fails:
            print(' -', f)
        sys.exit(1)
    print('P4 ALL PASS')


if __name__ == '__main__':
    main()
