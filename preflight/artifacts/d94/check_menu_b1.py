# -*- coding: utf-8 -*-
"""D-94 P7.8 B1 复判：门缝唯一光源 + 光池软边 / 逐级衰减。

只用 1024×640（scale=1，逻辑坐标 == 像素坐标）的 menu-root-nosave 实拍。
门区几何由 _menuLayout 的 wide 公式给出：
  door  = (256,144,96,96)
  shaft = (256,240,96,48)
  steps = (256,288,96)，3 级、步高 15、逐级左右各收 8
  seam  = (303,150,2,84)
"""
import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SHOT = os.path.join(HERE, 'b1-exact-1024.png')

fail_n = 0


def ok(msg):
    print('PASS  ' + msg)


def fail(msg):
    global fail_n
    fail_n += 1
    print('FAIL  ' + msg)


def main():
    if not os.path.exists(SHOT):
        print('FAIL  缺少 ' + SHOT)
        return 1
    im = Image.open(SHOT).convert('RGB')
    px = im.load()
    if im.size != (1024, 640):
        print('FAIL  视口应为 1024×640，实际 %s' % (im.size,))
        return 1

    seam_x, seam_y, seam_h, seam_c = 303, 150, 84, (255, 191, 115)

    # ① 门缝仍是唯一的 2px #ffbf73，贯通门高（上下各留 6px）
    bad = [y for y in range(seam_y, seam_y + seam_h)
           for x in (seam_x, seam_x + 1) if px[x, y] != seam_c]
    if bad:
        fail('门缝有 %d 行不是 #ffbf73（首行 y=%d）' % (len(bad), bad[0]))
    else:
        ok('门缝 2px #ffbf73 贯通 y=%d…%d' % (seam_y, seam_y + seam_h - 1))
    # 门缝左右各 1px 不允许同色（宽度必须正好 2px）
    if px[seam_x - 1, 180] == seam_c or px[seam_x + 2, 180] == seam_c:
        fail('门缝宽度不是 2px（左右邻列同色）')
    else:
        ok('门缝宽度正好 2px（左右邻列不是缝色）')

    # ② 门板除竖缝外的亮度峰值必须低于竖缝峰值；门格横档必须暗于门板
    door_peak = 0
    for y in range(150, 240):
        for x in range(258, 350):
            if seam_x - 1 <= x <= seam_x + 2:
                continue
            v = max(px[x, y])
            if v > door_peak:
                door_peak = v
    if door_peak >= 255:
        fail('门板除竖缝外仍有 %d 级峰值像素（与缝同亮）' % door_peak)
    else:
        ok('门板除竖缝外峰值 %d < 竖缝 255' % door_peak)

    def mean_r(x0, x1, y0, y1):
        vals = [px[x, y][0] for y in range(y0, y1) for x in range(x0, x1)]
        return sum(vals) / float(len(vals))

    panel_a = mean_r(260, 300, 152, 164)
    cross_a = mean_r(260, 300, 164, 172)
    panel_b = mean_r(260, 300, 200, 212)
    cross_b = mean_r(260, 300, 212, 220)
    if cross_a >= panel_a or cross_b >= panel_b:
        fail('门格横档没有压暗：上 %.1f/%.1f，下 %.1f/%.1f（横档/门板）'
             % (cross_a, panel_a, cross_b, panel_b))
    else:
        ok('门格横档暗于门板：上 %.1f<%.1f，下 %.1f<%.1f'
           % (cross_a, panel_a, cross_b, panel_b))

    # ③ 光池：门槛 + 每级台阶一层，中心在门缝正下方，横向沿离缝距离单调不增
    #    light(x) = R(x) - 该行台阶带内最小 R；逐行检查左右两侧不回升。
    bands = [('门槛', 240, 288, 258, 350),
             ('第1级', 288, 301, 256, 352),
             ('第2级', 303, 316, 264, 344),
             ('第3级', 318, 331, 272, 336)]
    peaks = {}
    for name, y0, y1, x0, x1 in bands:
        peak = 0
        soft_bad = []
        mono_bad = []
        for y in range(y0, y1):
            row = [px[x, y][0] for x in range(x0, x1)]
            base = min(row)
            light = [v - base for v in row]
            c = (seam_x - x0)
            m = max(light)
            peak = max(peak, m)
            # 中心到右缘：单调不增（容差 3）
            for x in range(c, len(light) - 1):
                if light[x + 1] > light[x] + 3 and light[x] >= 6:
                    mono_bad.append((y, x0 + x, light[x], light[x + 1]))
                    break
            # 中心到左缘
            for x in range(c, 0, -1):
                if light[x - 1] > light[x] + 3 and light[x] >= 6:
                    mono_bad.append((y, x0 + x, light[x], light[x - 1]))
                    break
            # 软边：不允许相邻两列出现 >18 的亮阶（硬直边）
            for x in range(1, len(light)):
                if abs(light[x] - light[x - 1]) > 18:
                    soft_bad.append((y, x0 + x))
                    break
        peaks[name] = peak
        if mono_bad:
            fail('%s 光池横向不单调：y=%d x=%d %d→%d'
                 % (name, mono_bad[0][0], mono_bad[0][1], mono_bad[0][2], mono_bad[0][3]))
        if soft_bad:
            fail('%s 光池出现硬边：y=%d x=%d' % (name, soft_bad[0][0], soft_bad[0][1]))
        if not mono_bad and not soft_bad:
            ok('%s 光池：中心亮 %d，横向单调衰减、无硬边' % (name, peak))

    # ④ 台阶逐级变暗：门槛 > 第1级 > 第2级 > 第3级
    seq = [peaks['门槛'], peaks['第1级'], peaks['第2级'], peaks['第3级']]
    if seq[0] > seq[1] > seq[2] > seq[3]:
        ok('光沿台阶逐级衰减：%d > %d > %d > %d' % tuple(seq))
    else:
        fail('台阶光没有逐级衰减：%d / %d / %d / %d' % tuple(seq))

    # ⑤ 唯一光源：门区（含台阶）除竖缝外没有第二处 >= 240 的亮点
    hot = []
    for y in range(150, 334):
        for x in range(252, 370):  # 252 起：避开左侧骑士（剑尖到 248）
            if seam_x <= x <= seam_x + 1:
                continue
            if max(px[x, y]) >= 240:
                hot.append((x, y))
    if hot:
        fail('门区除竖缝外仍有 %d 个 >=240 的亮点（首个 %s）' % (len(hot), hot[0]))
    else:
        ok('门区除竖缝外没有 >=240 的亮点')

    print('\n%s  (%d FAIL)' % ('B1 ALL PASS' if fail_n == 0 else 'B1 FAILED', fail_n))
    return 0 if fail_n == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
