# -*- coding: utf-8 -*-
"""D-94 P7.5：横置战斗背景「地板 / 墙 / 敌人站位区」亮度实测
口径与探索层 preflight/_aes_light.html 完全一致：
  亮度 = 0.299R + 0.587G + 0.114B（NTSC），仅统计 alpha>0 的像素；PNG 已合成，全部 alpha=255。
  （对纯背景截图逐像素求区域均值，等价于"仅不透明像素"；素材叠黑系数不在这里复算，
    直接量最终落屏像素，避免"改前/改后"两套公式对不上。）
用法：python measure_wallfloor.py [tag]      tag 默认 p7a（改前）
读：{tag}-{W}x{H}-f{f}-{monster}-horizontal-bg.png
写：wallfloor-{tag}.json + 控制台表
区域定义（全部由 W/H 比例给出，五层同一份）：
  G          = round(0.766H)                 地平线
  bwY        = round(H*backWall[f])          后墙/地板交界（来自 Render._battleSceneH）
  floor      = x∈[0.30W,0.70W], y∈[G+10, H-6]   两人共用的中央可走面
  wall       = x∈[0.30W,0.70W], y∈[0.10H, bwY-8] 中央后墙（不含两侧构件/光源）
  stand      = x∈[敌人中心±0.075W], y∈[G+4, G+42] 敌人脚下站位区（同一块地的右半边）
  playerStand= x∈[玩家中心±0.075W], y∈[G+4, G+42] 玩家脚下站位区（左右应对齐）
"""
import json
import os
import sys
from PIL import Image

ROOT = os.path.dirname(os.path.abspath(__file__))
FLOORS = [(1, 'slime'), (2, 'ogre_boss'), (3, 'slime'), (4, 'zombie_king'), (5, 'dragon')]
VIEWS = [(1024, 640), (960, 540)]
BACKWALL = [0.656, 0.641, 0.625, 0.672, 0.648]


def lum(px):
    return 0.299 * px[0] + 0.587 * px[1] + 0.114 * px[2]


def region_mean(px, x0, x1, y0, y1):
    s = 0.0
    n = 0
    for y in range(y0, y1):
        for x in range(x0, x1):
            s += lum(px[x, y])
            n += 1
    return (s / n) if n else 0.0


def main():
    tag = sys.argv[1] if len(sys.argv) > 1 else 'p7a'
    out = {'tag': tag, 'method': 'NTSC 0.299/0.587/0.114, alpha>0（PNG 已合成）',
           'rule': '地板必须是最亮的可走面，且明显高于墙（gap≥15，同探索层）', 'views': []}
    for w, h in VIEWS:
        G = round(h * 0.766)
        for idx, (f, mid) in enumerate(FLOORS):
            name = '%s-%dx%d-f%d-%s-horizontal-bg.png' % (tag, w, h, f, mid)
            p = os.path.join(ROOT, name)
            if not os.path.exists(p):
                print('MISS', name)
                continue
            im = Image.open(p).convert('RGB')
            px = im.load()
            bwY = round(h * BACKWALL[idx])
            floor = region_mean(px, round(0.30 * w), round(0.70 * w), G + 10, h - 6)
            wall = region_mean(px, round(0.30 * w), round(0.70 * w), round(0.10 * h), bwY - 8)
            ecx = round(0.76 * w)
            stand = region_mean(px, ecx - round(0.075 * w), ecx + round(0.075 * w),
                                min(h - 4, G + 4), min(h, G + 42))
            pcx = round(0.24 * w)
            pstand = region_mean(px, pcx - round(0.075 * w), pcx + round(0.075 * w),
                                 min(h - 4, G + 4), min(h, G + 42))
            row = {'viewport': [w, h], 'floor': f, 'floorL': round(floor, 1),
                   'wallL': round(wall, 1), 'standL': round(stand, 1),
                   'playerStandL': round(pstand, 1),
                   'floorMinusWall': round(floor - wall, 1),
                   'floorMinusStand': round(floor - stand, 1),
                   'standsEqual': abs(stand - pstand) <= 3,
                   # 站位区就是地板本体：允许 ±3 的纹理/反光起伏，判的是"不是浅坑"
                   'ok': floor > wall and floor - wall >= 15 and floor >= stand - 3 and
                         abs(stand - pstand) <= 3}
            out['views'].append(row)
            print('%dx%d F%d | 地板 %5.1f | 墙 %5.1f | 敌位 %5.1f | 地-墙 %+6.1f | 地-敌位 %+6.1f | %s'
                  % (w, h, f, row['floorL'], row['wallL'], row['standL'],
                     row['floorMinusWall'], row['floorMinusStand'], 'PASS' if row['ok'] else 'FAIL'))
    out['allOk'] = all(v['ok'] for v in out['views'])
    with open(os.path.join(ROOT, 'wallfloor-%s.json' % tag), 'w', encoding='utf-8') as fh:
        json.dump(out, fh, ensure_ascii=False, indent=2)
    print('-> wallfloor-%s.json  allOk=%s' % (tag, out['allOk']))


if __name__ == '__main__':
    main()
