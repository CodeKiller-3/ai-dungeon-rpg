# -*- coding: utf-8 -*-
"""D-114 四策略逐局对照：D-113 基线 vs 本轮（纯表现层，行为应零差异）。

用法：python preflight\\artifacts\\d114\\compare_d114.py
说明：逐局逐字段规范 JSON 比较；任何差异打印（最多 6 条/策略），全零输出 TOTAL_DIFF=0。
"""
import json
import os

BASE = r'd:\桌面\工作\人工智能大作业\preflight\selfcheck'
PAIRS = [('b1', 'd113-b1-50.json', 'd115-b1-50.json'),
         ('s1', 'd113-s1-50.json', 'd115-s1-50.json'),
         ('g2', 'd113-g2-50.json', 'd115-g2-50.json'),
         ('m1', 'd113-m1-50.json', 'd115-m1-50.json')]

EXTRA_KEYS = ['agg', 'boss', 'enc', 'exitHp', 'exitHpM1', 'curve', 'elite', 'eliteNext']


def canon(v):
    return json.dumps(v, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def load(path):
    with open(path, encoding='utf-8-sig') as f:
        return json.load(f)


allbad = 0
for key, oldf, newf in PAIRS:
    po, pn = os.path.join(BASE, oldf), os.path.join(BASE, newf)
    if not (os.path.exists(po) and os.path.exists(pn)):
        print('%s: MISSING %s' % (key, po if not os.path.exists(po) else pn))
        allbad += 1
        continue
    a_doc, b_doc = load(po), load(pn)
    a, b = a_doc['runs'][key], b_doc['runs'][key]
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
    for k in EXTRA_KEYS:
        if canon(a_doc.get(k)) != canon(b_doc.get(k)):
            bad.append({'scope': 'top', 'field': k,
                        'old': a_doc.get(k), 'new': b_doc.get(k)})
    print('%s: %d/%d games, %d fields/game, diffs=%d' % (key, len(b), len(a), fields, len(bad)))
    if bad:
        print(json.dumps(bad[:6], ensure_ascii=False))
    allbad += len(bad)
print('TOTAL_DIFF=%d' % allbad)

