# -*- coding: utf-8 -*-
"""D-94 P7：给「按纵置几何写判据」的验证页显式加一行 _setBattleLayout('vertical')。
默认布局已改横置，验证页不允许再靠默认值。只插一行，不改任何判据。
用法：python pin_vertical.py [--check]
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
PRE = os.path.abspath(os.path.join(ROOT, '..', '..'))
PAGES = [
    'verify_d10', 'verify_d14', 'verify_d15', 'verify_d16', 'verify_d19', 'verify_d20',
    'verify_d23', 'verify_d24', 'verify_d27', 'verify_d34', 'verify_d51', 'verify_d53',
    'verify_d78', 'verify_d84', 'verify_d85', 'verify_d86', 'verify_d87', 'verify_d88',
    'verify_d89', 'verify_m2', 'verify_m8_6', 'verify_m9_3', 'verify_p1_3', 'verify_p2_1',
    'verify_p2_4', 'verify_selfcheck',
]
# d70 / m8_1 / m8_2 / m8_3 不加载 render.js，也没有战斗绘制，不插这一行。
MARK = "_setBattleLayout('vertical')"
LINE = "  Game.Core.Render._setBattleLayout('vertical');  /* D-94 P7：本页判竖置几何，不靠默认值 */\n"


def main():
    check = '--check' in sys.argv
    changed = []
    for name in PAGES:
        p = os.path.join(PRE, name + '.html')
        with io.open(p, 'r', encoding='utf-8', newline='') as f:
            text = f.read()
        if MARK in text:
            print('skip ', name, '（已有显式声明）')
            continue
        nl = '\r\n' if '\r\n' in text else '\n'
        anchor = "'use strict';"
        i = text.find(anchor)
        if i >= 0:
            j = text.find('\n', i)
            j = len(text) if j < 0 else j
        else:
            anchor = '(function () {'
            i = text.find(anchor)
            if i < 0:
                print('FAIL ', name, '找不到插入锚点')
                continue
            j = text.find('\n', i)
            j = len(text) if j < 0 else j
        ins = LINE.replace('\n', nl)
        new = text[:j + 1] + ins + text[j + 1:]
        if check:
            print('would', name)
            continue
        with io.open(p, 'w', encoding='utf-8', newline='') as f:
            f.write(new)
        changed.append(name)
        print('pin  ', name)
    print(('check: %d 页待加' if check else 'done: %d 页已加') % (len(PAGES) if check else len(changed)))


if __name__ == '__main__':
    main()
