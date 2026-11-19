# -*- coding: utf-8 -*-
"""D-105 四策略逐局对照：以 D-103 同参数基线为参照，逐局逐字段全量比对。
用法：python compare_d105.py
说明：D-69 报告产出的 run 记录不含 wallMs/env，故这里对 seed..battles 全部字段做规范 JSON 比较；
      任何字段差异都会打印（最多 6 条/策略），全零时输出 TOTAL_DIFF=0。
"""
import json

BASE = r'd:\桌面\工作\人工智能大作业\preflight\selfcheck'
PAIRS = [('b1', 'd103-b1-50.json', 'd105-b1-50.json'),
         ('s1', 'd103-s1-50.json', 'd105-s1-50.json'),
         ('g2', 'd103-g2-50.json', 'd105-g2-50.json'),
         ('m1', 'd103-m1-50.json', 'd105-m1-50.json')]


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
    for i in range(min(len(a), len(b))):
        fields = sorted(set(a[i]) | set(b[i]))
        for fld in fields:
            if canon(a[i].get(fld)) != canon(b[i].get(fld)):
                bad.append({'game': i + 1, 'seed': a[i].get('seed'), 'field': fld,
                            'old': a[i].get(fld), 'new': b[i].get(fld)})
    print('%s: %d/%d games, %d fields/game, diffs=%d' % (key, len(b), len(a), 22, len(bad)))
    if bad:
        print(json.dumps(bad[:6], ensure_ascii=False))
    allbad += len(bad)
print('TOTAL_DIFF=%d' % allbad)
