# -*- coding: utf-8 -*-
"""D-108 四策略逐局对照：以 D-107（= D-106 = D-103 基线，已逐字段相同）为参照。
用法：python compare_d108.py
说明：逐局逐字段规范 JSON 比较；任何差异打印（最多 6 条/策略），全零输出 TOTAL_DIFF=0。
"""
import json

BASE = r'd:\桌面\工作\人工智能大作业\preflight\selfcheck'
PAIRS = [('b1', 'd107-b1-50.json', 'd108-b1-50.json'),
         ('s1', 'd107-s1-50.json', 'd108-s1-50.json'),
         ('g2', 'd107-g2-50.json', 'd108-g2-50.json'),
         ('m1', 'd107-m1-50.json', 'd108-m1-50.json')]


def canon(v):
    return json.dumps(v, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


allbad = 0
for key, oldf, newf in PAIRS:
    with open(BASE + '\\' + oldf, encoding='utf-8-sig') as f:
        a = json.load(f)['runs'][key]
    with open(BASE + '\\' + newf, encoding='utf-8-sig') as f:
        b = json.load(f)['runs'][key]
    bad = []
    if len(a) != 50 or len(b) != 50:
        bad.append({'len': [len(a), len(b)]})
    fields = 0
    for i in range(min(len(a), len(b))):
        for fld in sorted(set(a[i]) | set(b[i])):
            fields = max(fields, len(set(a[i]) | set(b[i])))
            if canon(a[i].get(fld)) != canon(b[i].get(fld)):
                bad.append({'game': i + 1, 'seed': a[i].get('seed'), 'field': fld,
                            'old': a[i].get(fld), 'new': b[i].get(fld)})
    print('%s: %d/%d games, %d fields/game, diffs=%d' % (key, len(b), len(a), fields, len(bad)))
    if bad:
        print(json.dumps(bad[:6], ensure_ascii=False))
    allbad += len(bad)
print('TOTAL_DIFF=%d' % allbad)
