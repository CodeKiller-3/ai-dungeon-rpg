# -*- coding: utf-8 -*-
"""D-94 横置战斗实拍 / 几何实测
用法：python shots_d94.py base|gate|p2|p4
  base → 改动前纵置基线（P0）：五层纵置 + 四怪矩阵（1024×640、960×540）
  gate → 改动后门帧：纵置/横置同状态对照 + 四怪 + 2× 骑士对照
  p2   → 五层横置全量 + 五层纵置同状态 + 五层横置纯背景（bg=1）
  p4   → 五层横置身份带/指令条 + 纵置同状态 + MP=0 降级对照
同一页面、同一固定时钟（T=0、_animNow=1234），参数即"种子"：同参数同帧可复算。
写出 geometry-{mode}.json：每张图的 _lastBattleBox + cssW/cssH + 布局 + 像素哈希。
"""
import json
import os
import sys
from playwright.sync_api import sync_playwright

ROOT = r'd:\桌面\工作\人工智能大作业\preflight\artifacts\d94'
BASE = ('file:///d:/%E6%A1%8C%E9%9D%A2/%E5%B7%A5%E4%BD%9C/%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD%E5%A4%A7%E4%BD%9C%E4%B8%9A'
        '/preflight/artifacts/d94/shot.html')

# (mid, floor) —— Boss 楼层与 MAPS.bosses 对齐
MON = [('slime', 1), ('ogre_boss', 2), ('zombie_king', 4), ('dragon', 5)]


def base_shots():
    out = []
    for w, h in [(1024, 640), (960, 540)]:
        # 五层纵置（f3 用 slime，Boss 按真实楼层）
        for mid, f in MON:
            out.append(('%dx%d-vertical-%s' % (w, h, mid), w, h, f, mid, 'vertical', ''))
        out.append(('%dx%d-vertical-f3-slime' % (w, h), w, h, 3, 'slime', 'vertical', ''))
    return out


def gate_shots():
    out = []
    for w, h in [(1024, 640), (960, 540)]:
        for mid, f in MON:
            out.append(('%dx%d-horizontal-%s' % (w, h, mid), w, h, f, mid, 'horizontal', ''))
            out.append(('%dx%d-vertical-%s' % (w, h, mid), w, h, f, mid, 'vertical', ''))
        out.append(('%dx%d-horizontal-f3-slime' % (w, h), w, h, 3, 'slime', 'horizontal', ''))
        out.append(('%dx%d-vertical-f3-slime' % (w, h), w, h, 3, 'slime', 'vertical', ''))
    # 2× 骑士对照（只出对照，不改代码）
    out.append(('1024x640-horizontal-slime-2x', 1024, 640, 1, 'slime', 'horizontal', '&gk=2x'))
    out.append(('1024x640-vertical-slime-2x', 1024, 640, 1, 'slime', 'vertical', '&gk=2x'))
    return out


# P2：五层横置全量（带怪） + 五层纯背景 + 五层纵置同状态（与 P0 基线逐像素对账）
FLOORS = [(1, 'slime'), (2, 'ogre_boss'), (3, 'slime'), (4, 'zombie_king'), (5, 'dragon')]


def p2_shots():
    out = []
    for w, h in [(1024, 640), (960, 540)]:
        for f, mid in FLOORS:
            tag = '%dx%d-f%d-%s' % (w, h, f, mid)
            out.append((tag + '-horizontal', w, h, f, mid, 'horizontal', ''))
            out.append((tag + '-vertical', w, h, f, mid, 'vertical', ''))
            out.append((tag + '-horizontal-bg', w, h, f, mid, 'horizontal', '&bg=1'))
    return out


# P4：身份带 + 指令条（五层）+ 纵置同状态 + MP=0 的降级对照
def p4_shots():
    out = []
    for w, h in [(1024, 640), (960, 540)]:
        for f, mid in FLOORS:
            tag = '%dx%d-f%d-%s' % (w, h, f, mid)
            out.append((tag + '-horizontal', w, h, f, mid, 'horizontal', ''))
            out.append((tag + '-vertical', w, h, f, mid, 'vertical', ''))
        out.append(('%dx%d-f5-dragon-horizontal-mp0' % (w, h), w, h, 5, 'dragon', 'horizontal', '&mp=0'))
    return out


def main():
    mode = (sys.argv[1] if len(sys.argv) > 1 else 'gate').lower()
    if mode == 'base':
        shots = base_shots()
    elif mode == 'p2':
        shots = p2_shots()
    elif mode == 'p4':
        shots = p4_shots()
    else:
        shots = gate_shots()
    geo = {}
    with sync_playwright() as p:
        b = p.chromium.launch(channel='msedge', headless=True,
                              args=['--allow-file-access-from-files', '--disable-gpu'])
        for name, w, h, f, mid, layout, extra in shots:
            ctx = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=1)
            pg = ctx.new_page()
            url = BASE + '?w=%d&h=%d&f=%d&m=%s&layout=%s%s' % (w, h, f, mid, layout, extra)
            pg.goto(url)
            pg.wait_for_function('document.title === "READY D94"', timeout=20000)
            g = pg.evaluate('window.__D94_GEO')
            geo[name] = {'viewport': [w, h], 'floor': f, 'monster': mid, 'ask': layout, 'geo': g}
            pg.screenshot(path=os.path.join(ROOT, '%s-%s.png' % (mode, name)))
            print(mode, name, '|', w, 'x', h, '|', g and g.get('layout'), '|', pg.title(), flush=True)
            ctx.close()
        b.close()
    with open(os.path.join(ROOT, 'geometry-%s.json' % mode), 'w', encoding='utf-8') as fh:
        json.dump(geo, fh, ensure_ascii=False, indent=2)
    print('-> geometry-%s.json  %d shots' % (mode, len(geo)))


if __name__ == '__main__':
    main()
