# -*- coding: utf-8 -*-
"""D-93 四策略逐局对照：与 D-91 同参数基线逐局比对 15 个字段（seed + 14 项）。
用法：python compare_runs.py
"""
import json

BASE = r'd:\桌面\工作\人工智能大作业\preflight\selfcheck'
FIELDS = ['seed', 'outcome', 'deathFloor', 'floor', 'maxFloor', 'steps', 'actions',
          'battleTurns', 'level', 'maxLevel', 'kills', 'hp', 'gold', 'potions', 'rescue']
PAIRS = [('b1', 'd91-b1-2500.json', 'd93-b1-2500.json'),
         ('s1', 'd91-s1-2500.json', 'd93-s1-2500.json'),
         ('g2', 'd91-g2-4500.json', 'd93-g2-4500.json'),
         ('m1', 'd91-m1-6000.json', 'd93-m1-6000.json')]

allbad = 0
for key, oldf, newf in PAIRS:
    a = json.load(open(BASE + '\\' + oldf, encoding='utf-8-sig'))['runs'][key]
    b = json.load(open(BASE + '\\' + newf, encoding='utf-8-sig'))['runs'][key]
    bad = []
    if len(a) != 50 or len(b) != 50:
        bad.append({'len': [len(a), len(b)]})
    for i in range(min(len(a), len(b))):
        for f in FIELDS:
            if a[i].get(f) != b[i].get(f):
                bad.append({'game': i + 1, 'seed': a[i].get('seed'), 'field': f,
                            'old': a[i].get(f), 'new': b[i].get(f)})
    print('%s: %d/%d games, %d fields/game, diffs=%d' % (key, len(b), len(a), len(FIELDS), len(bad)))
    if bad:
        print(json.dumps(bad[:6], ensure_ascii=False))
    allbad += len(bad)
print('TOTAL_DIFF=%d' % allbad)
