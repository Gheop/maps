#!/usr/bin/env python3
"""Compare deux résultats : bench/compare.py <a> <b>  (labels de bench/results)."""
import json, sys
a, b = (json.load(open(f'bench/results/{l}.json')) for l in sys.argv[1:3])
def row(name, va, vb, sa=None, sb=None, unit=''):
    d = (vb - va) / va * 100 if va else 0
    noise = f"  (sd {sa:.0f}%/{sb:.0f}%)" if sa is not None else ''
    print(f"{name:42s} {va:>12.1f} {vb:>12.1f} {d:+7.1f}%{noise}")
print(f"{'métrique':42s} {a['label']:>12s} {b['label']:>12s}   delta")
for k in a['go_bench']:
    for m in ('ns', 'allocs', 'B'):
        if m in a['go_bench'][k] and m in b['go_bench'][k]:
            x, y = a['go_bench'][k][m], b['go_bench'][k][m]
            row(f'go {k[9:]} {m}/op', x['median'], y['median'], x['sd_pct'], y['sd_pct'])
    for m in ('304s/load', 'bodyBytes/load'):
        if m in a['go_bench'][k]:
            row(f'go {k[9:]} {m}', a['go_bench'][k][m]['median'], b['go_bench'][k][m]['median'])
for k in a['ab']:
    row(f'ab {k} rps', a['ab'][k]['rps'], b['ab'][k]['rps'])
row('server RSS max kB', a['server_rss_kb'], b['server_rss_kb'])
for k in a['front']:
    x, y = a['front'][k], b['front'][k]
    row(f'front {k}', x['median'], y['median'], x['sd_pct'], y['sd_pct'])
