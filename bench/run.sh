#!/usr/bin/env bash
# Harnais complet : benchmarks Go, charge HTTP (ab) + RSS, bench front (Playwright).
# Usage : bench/run.sh <label> [runs]   -> bench/results/<label>.json
set -euo pipefail
cd "$(dirname "$0")/.."
# Épinglage sur les P-cores (0-11 sur ce Core Ultra) : sans ça, le scheduler balade
# renderer et serveur entre P et E-cores et l'écart-type dépasse 30 %.
PIN=${PIN:-0-11}; if [ -z "${PINNED:-}" ]; then PINNED=1 exec taskset -c "$PIN" "$0" "$@"; fi
LABEL=${1:?label}; RUNS=${2:-10}; PORT=${PORT:-18080}
OUT=bench/results/$LABEL.json; TMP=$(mktemp -d)
trap 'kill $SRV 2>/dev/null || true; rm -rf "$TMP"' EXIT

go build -trimpath -ldflags='-s -w' -o "$TMP/maps" .
PORT=$PORT "$TMP/maps" >"$TMP/srv.log" 2>&1 & SRV=$!
for i in $(seq 50); do curl -sf "http://127.0.0.1:$PORT/healthz" >/dev/null && break; sleep 0.1; done

echo "== go bench (count=$RUNS)" >&2
go test -run xxx -bench . -benchmem -benchtime 2s -count "$RUNS" . >"$TMP/gobench.txt"

echo "== ab" >&2
ab_one() { # path, extra header (opt) -> "rps p50 p95"
  local hdr=(); [ -n "${2:-}" ] && hdr=(-H "$2")
  ab -q -k -c 32 -n 20000 "${hdr[@]}" "http://127.0.0.1:$PORT$1" 2>/dev/null \
    | awk '/Requests per second/{r=$4} /^ *50%/{p50=$2} /^ *95%/{p95=$2} END{print r, p50, p95}'
}
ETAG=$(curl -sI "http://127.0.0.1:$PORT/js/map.js" | awk 'tolower($1)=="etag:"{print $2}' | tr -d '\r')
ab_one /js/map.js >/dev/null # warmup
A1=(); A2=(); A3=()
for i in 1 2 3; do # entrelacé : chaque config voit la même dérive thermique
  A1+=("$(ab_one /js/map.js)"); A2+=("$(ab_one /)"); A3+=("$(ab_one /js/map.js "If-None-Match: ${ETAG:-x}")")
done
med() { printf '%s\n' "$@" | sort -n -k1 | sed -n 2p; }
AB_MAPJS=$(med "${A1[@]}"); AB_INDEX=$(med "${A2[@]}"); AB_MAPJS_COND=$(med "${A3[@]}")
RSS_KB=$(awk '/VmHWM/{print $2}' "/proc/$SRV/status")

echo "== front (runs=$RUNS)" >&2
python3 bench/front.py "http://127.0.0.1:$PORT" "$RUNS" >"$TMP/front.json"

python3 - "$LABEL" "$TMP" "$AB_MAPJS" "$AB_INDEX" "$AB_MAPJS_COND" "$RSS_KB" "$OUT" <<'PY'
import json, re, statistics, subprocess, sys
label, tmp, ab1, ab2, ab3, rss, out = sys.argv[1:]
gb = {}
for line in open(f'{tmp}/gobench.txt'):
    m = re.match(r'(Benchmark\w+)-\d+\s+\d+\s+([\d.]+) ns/op(.*)', line)
    if not m: continue
    d = gb.setdefault(m.group(1), {'ns': [], 'B': [], 'allocs': []})
    d['ns'].append(float(m.group(2)))
    for k, pat in (('B', r'(\d+) B/op'), ('allocs', r'(\d+) allocs/op')):
        mm = re.search(pat, m.group(3)); d[k].append(int(mm.group(1)) if mm else 0)
    for mm in re.finditer(r'([\d.]+) (\w+/load)', m.group(3)):
        d.setdefault(mm.group(2), []).append(float(mm.group(1)))
gob = {}
for k, d in gb.items():
    gob[k] = {m: {'median': statistics.median(v), 'sd_pct': round(100 * statistics.pstdev(v) / statistics.median(v), 1) if statistics.median(v) else 0} for m, v in d.items()}
def ab(s):
    r, p50, p95 = s.split(); return {'rps': float(r), 'p50_ms': float(p50), 'p95_ms': float(p95)}
res = {
    'label': label,
    'commit': subprocess.run(['git', 'rev-parse', '--short', 'HEAD'], capture_output=True, text=True).stdout.strip(),
    'env': {'go': subprocess.run(['go', 'version'], capture_output=True, text=True).stdout.strip(),
            'cpu': open('/proc/cpuinfo').read().split('model name\t: ')[1].split('\n')[0],
            'governor': open('/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor').read().strip()},
    'go_bench': gob,
    'ab': {'map.js': ab(ab1), 'index': ab(ab2), 'map.js_if_none_match': ab(ab3)},
    'server_rss_kb': int(rss),
    'front': json.load(open(f'{tmp}/front.json'))['summary'],
}
json.dump(res, open(out, 'w'), indent=1)
print(json.dumps({k: v for k, v in res.items() if k != 'go_bench'}, indent=1))
PY
echo "-> $OUT" >&2
