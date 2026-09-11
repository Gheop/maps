#!/usr/bin/env python3
"""Bench front : livraison du shell (octets/requêtes à froid et à chaud) et coût du
thread principal sur un scénario pan/zoom scripté. Réseau isolé : tuiles et API mockées.

Usage : bench/front.py http://127.0.0.1:18080 [runs]
Sortie : JSON sur stdout (médiane + écart-type par métrique, runs bruts)."""
import asyncio, json, statistics, struct, sys, zlib
from playwright.async_api import async_playwright

BASE = sys.argv[1].rstrip('/')
RUNS = int(sys.argv[2]) if len(sys.argv) > 2 else 10
TILE_HOSTS = ('tile.openstreetmap.org', 'server.arcgisonline.com', 'tile.opentopomap.org', 'tiles.stadiamaps.com')
VIEW = '#plan/12/48.8566/2.3522'  # Paris z12 : ~30 tuiles visibles en 1280x800


def png_tile(size=256, gray=180):
    """PNG 256x256 gris uni : même octets à chaque requête de tuile (déterministe)."""
    raw = b''.join(b'\x00' + bytes([gray, gray, gray]) * size for _ in range(size))
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 6)) + chunk(b'IEND', b''))


TILE_PNG = png_tile()


async def mock(context):
    async def tile(route):
        await route.fulfill(status=200, content_type='image/png', body=TILE_PNG)
    async def api(route):
        await route.fulfill(status=200, content_type='application/json', body='[]')
    for h in TILE_HOSTS:
        await context.route(f'https://{h}/**', tile)
    await context.route(f'{BASE}/api/**', api)


class Net:
    """Compte requêtes/octets same-origin d'une navigation (hors tuiles et API)."""
    def __init__(self, page):
        self.reset(); page.on('response', self._on)
    def reset(self):
        self.reqs = 0; self.b200 = 0; self.n304 = 0; self.bytes = 0; self.pending = []
    def _on(self, resp):
        url = resp.url
        if not url.startswith(BASE) or '/api/' in url:
            return
        self.pending.append(resp)
    async def settle(self):
        for r in self.pending:
            s = await r.request.sizes()
            self.reqs += 1
            self.bytes += s['responseBodySize'] + s['responseHeadersSize']
            if r.status == 304: self.n304 += 1
            else: self.b200 += s['responseBodySize']
        self.pending = []
        return {'requests': self.reqs, 'wire_bytes': self.bytes, 'body_bytes_200': self.b200, 'n304': self.n304}


async def metrics(cdp):
    m = (await cdp.send('Performance.getMetrics'))['metrics']
    return {x['name']: x['value'] for x in m}


LATENCY_MS = 100  # latence émulée seule (débit illimité) : le temps de charge compte les allers-retours en cascade


async def load_run(browser):
    """Octets/requêtes du shell à froid puis à chaud, et temps jusqu'à la carte (1re requête de
    tuile) sous latence émulée. Sans context.route() : l'interception Playwright désactive le
    cache HTTP de Chrome (plus de If-None-Match). Tuiles et API sont bloquées au niveau réseau."""
    ctx = await browser.new_context(viewport={'width': 1280, 'height': 800}, service_workers='block')
    page = await ctx.new_page()
    cdp = await ctx.new_cdp_session(page)
    await cdp.send('Network.enable')
    await cdp.send('Network.setBlockedURLs', {'urls': [f'*{h}/*' for h in TILE_HOSTS] + [f'{BASE}/api/*']})
    await cdp.send('Network.emulateNetworkConditions', {'offline': False, 'latency': LATENCY_MS,
                   'downloadThroughput': -1, 'uploadThroughput': -1})
    # instant où la carte démarre = 1re tuile insérée dans #map (observé depuis la page, avant tout script)
    await page.add_init_script("""new MutationObserver((ms, o) => { for (const m of ms) if (m.target.id === 'map' && m.addedNodes.length) { window.__mapInit = performance.now(); o.disconnect(); return; } })
      .observe(document, {childList: true, subtree: true});""")
    async def timings():
        hosts = list(TILE_HOSTS)
        return await page.evaluate("(hosts) => { const n = performance.getEntriesByType('navigation')[0];"
            " const tiles = performance.getEntriesByType('resource').filter(e => hosts.some(h => e.name.includes(h))).length;"  # bloquées mais comptées
            " return {map_init_ms: Math.round(window.__mapInit || -1), dcl_ms: Math.round(n.domContentLoadedEventEnd), load_ms: Math.round(n.loadEventEnd), tile_requests: tiles}; }", hosts)
    net = Net(page)
    await page.goto(f'{BASE}/{VIEW}', wait_until='load')
    await page.wait_for_timeout(800)
    cold = await net.settle(); cold.update(await timings())
    # garde-fou fonctionnel : la vue du hash est bien celle rendue
    ok = await page.evaluate("location.hash.startsWith('%s') && document.querySelectorAll('img.tile').length > 0" % VIEW.rsplit('/', 1)[0])  # la carte réécrit le hash à 5 décimales
    if not ok:
        raise SystemExit('vue du hash non rendue')
    net.reset()
    await page.reload(wait_until='load')
    await page.wait_for_timeout(800)
    warm = await net.settle(); warm.update(await timings())
    await ctx.close()
    return cold, warm


async def one_run(browser):
    cold, warm = await load_run(browser)
    ctx = await browser.new_context(viewport={'width': 1280, 'height': 800}, service_workers='block')
    await mock(ctx)
    page = await ctx.new_page()
    await page.goto(f'{BASE}/{VIEW}', wait_until='networkidle')
    await page.wait_for_timeout(400)

    cdp = await ctx.new_cdp_session(page)
    await cdp.send('Performance.enable')
    await cdp.send('HeapProfiler.enable')
    await page.wait_for_timeout(500)  # anneau de préchargement posé, main thread au repos
    m0 = await metrics(cdp)
    # 12 pans de 320 px (dépassent PAN_COMMIT -> re-tuilage), en alternant les directions
    for i in range(12):
        dx, dy = ((320, 0), (0, 320), (-320, 0), (0, -320))[i % 4]
        await page.mouse.move(640, 400)
        await page.mouse.down()
        for k in range(1, 9):
            await page.mouse.move(640 + dx * k / 8, 400 + dy * k / 8)
        await page.mouse.up()
        await page.wait_for_timeout(120)
    # 6 crans de zoom avant puis 6 arrière (debounce 90 ms -> commit)
    for d in (-100,) * 6 + (100,) * 6:
        await page.mouse.move(640, 400)
        await page.mouse.wheel(0, d)
        await page.wait_for_timeout(250)
    await page.wait_for_timeout(600)
    # Sans GC forcé, Nodes et JSHeapUsedSize comptent les nœuds détachés pas encore collectés :
    # 288 à 1686 nœuds d'un run à l'autre sur un code identique. Après GC, la mesure est stable.
    await cdp.send('HeapProfiler.collectGarbage')
    await page.wait_for_timeout(300)
    m1 = await metrics(cdp)
    tiles = await page.evaluate("document.querySelectorAll('img.tile').length")
    delta = {k: (m1[k] - m0[k]) * 1000 for k in ('ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'TaskDuration')}
    for k in ('RecalcStyleCount', 'LayoutCount'):  # compteurs : déterministes, insensibles à la fréquence CPU
        delta[k] = m1[k] - m0[k]
    delta['JSHeapUsedMB'] = m1['JSHeapUsedSize'] / 1e6
    delta['Nodes'] = m1['Nodes']
    delta['tiles_in_dom'] = tiles
    await ctx.close()
    return {'cold': cold, 'warm': warm, 'interact_ms': delta}


def summarize(runs, path):
    vals = [r[path[0]][path[1]] for r in runs]
    med = statistics.median(vals)
    sd = statistics.pstdev(vals) if len(vals) > 1 else 0
    return {'median': round(med, 2), 'sd': round(sd, 2), 'sd_pct': round(100 * sd / med, 1) if med else 0}


async def main():
    async with async_playwright() as p:
        runs = []; retries = 0
        for i in range(RUNS + 1):  # navigateur neuf par run (pas de dérive avec l'âge du processus)
            browser = await p.chromium.launch()
            r = await one_run(browser)
            await browser.close()
            if i == 0: continue  # run 0 = warmup (JIT, disque), exclu
            if r['cold']['load_ms'] > 1500 and retries < 3:  # décrochage ~2 s du 1er Chromium du processus : artefact headless, run refait
                retries += 1; continue
            runs.append(r)
    keys = [('cold', 'requests'), ('cold', 'wire_bytes'), ('cold', 'map_init_ms'), ('cold', 'dcl_ms'), ('cold', 'load_ms'), ('cold', 'tile_requests'),
            ('warm', 'requests'), ('warm', 'wire_bytes'), ('warm', 'map_init_ms'), ('warm', 'load_ms'),
            ('warm', 'body_bytes_200'), ('warm', 'n304'), ('interact_ms', 'ScriptDuration'),
            ('interact_ms', 'LayoutDuration'), ('interact_ms', 'RecalcStyleDuration'), ('interact_ms', 'TaskDuration'),
            ('interact_ms', 'RecalcStyleCount'), ('interact_ms', 'LayoutCount'), ('interact_ms', 'JSHeapUsedMB'), ('interact_ms', 'Nodes'), ('interact_ms', 'tiles_in_dom')]
    out = {'runs': len(runs), 'retries': retries, 'summary': {f'{a}.{b}': summarize(runs, (a, b)) for a, b in keys}, 'raw': runs}
    print(json.dumps(out, indent=1))

if __name__ == "__main__":
    asyncio.run(main())
