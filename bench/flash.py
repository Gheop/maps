#!/usr/bin/env python3
"""Mesure du « flash » : tuiles mockées avec un délai réseau, geste (zoom ou changement de
calque), captures à intervalles, part de l'écran laissée au gris de fond (#e8e8e8).
Usage : bench/flash.py http://127.0.0.1:18080 [délai_tuile_ms] [zoom|layer]"""
import asyncio, io, struct, sys, zlib
sys.argv += ['1'] if len(sys.argv) < 3 else []
import front
from playwright.async_api import async_playwright

BASE = sys.argv[1].rstrip('/')
DELAY = int(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[2].isdigit() else 1500
SCENARIO = sys.argv[3] if len(sys.argv) > 3 else 'zoom'
BG = (0xe8, 0xe8, 0xe8)


def png_pixels(data):
    """Décodeur PNG minimal (RGB/RGBA 8 bits, filtres 0-4) pour ne pas dépendre de PIL."""
    pos = 8; w = h = 0; ctype = 0; idat = b''
    while pos < len(data):
        ln = struct.unpack('>I', data[pos:pos + 4])[0]; t = data[pos + 4:pos + 8]; body = data[pos + 8:pos + 8 + ln]
        if t == b'IHDR': w, h, _, ctype = struct.unpack('>IIBB', body[:10])
        elif t == b'IDAT': idat += body
        pos += 12 + ln
    bpp = 4 if ctype == 6 else 3
    raw = zlib.decompress(idat); stride = w * bpp; prev = bytearray(stride); out = []; p = 0
    for _ in range(h):
        f = raw[p]; line = bytearray(raw[p + 1:p + 1 + stride]); p += 1 + stride
        for i in range(stride):
            a = line[i - bpp] if i >= bpp else 0; b = prev[i]; c = prev[i - bpp] if i >= bpp else 0
            if f == 1: line[i] = (line[i] + a) & 255
            elif f == 2: line[i] = (line[i] + b) & 255
            elif f == 3: line[i] = (line[i] + (a + b) // 2) & 255
            elif f == 4:
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                line[i] = (line[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        out.append(bytes(line)); prev = line
    return w, h, bpp, out


def grey_share(png):
    try:
        from PIL import Image
        im = Image.open(io.BytesIO(png)).convert('RGB'); w, h = im.size; px = im.load()
        rows = None
    except ImportError:
        w, h, bpp, rows = png_pixels(png); px = None
    n = grey = 0
    for y in range(0, h, 4):  # sous-échantillonnage 4x4
        for x in range(0, w, 4):
            n += 1
            c = px[x, y] if px else tuple(rows[y][x * bpp:x * bpp + 3])
            if c == BG: grey += 1
    return grey / n


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context(viewport={'width': 1280, 'height': 800}, service_workers='block')
        async def tile(route):
            await asyncio.sleep(DELAY / 1000)
            await route.fulfill(status=200, content_type='image/png', body=front.TILE_PNG)
        for h in front.TILE_HOSTS: await ctx.route(f'https://{h}/**', tile)
        await ctx.route(f'{BASE}/api/**', lambda r: r.fulfill(status=200, content_type='application/json', body='[]'))
        page = await ctx.new_page()
        await page.goto(f'{BASE}/{front.VIEW}', wait_until='load')
        await page.wait_for_timeout(DELAY + 1500)  # 1er niveau entièrement chargé
        base = grey_share(await page.screenshot(clip={'x': 0, 'y': 0, 'width': 1280, 'height': 800}))
        if SCENARIO == 'layer':  # bascule Plan -> Relief, même géographie, autre style
            await page.click('#layers-current')
            await page.click('#layers-list button[data-layer="relief"]')
        else:
            await page.mouse.move(640, 400)
            for _ in range(2): await page.mouse.wheel(0, -100); await page.wait_for_timeout(30)  # 2 crans -> +2 niveaux
        shots = []  # capturer d'abord (rapide), décoder après : le décodage décalerait les instants
        t0 = asyncio.get_event_loop().time()
        for step in (300, 500, 700, 900, 1100, 1300, 1500, 1800, 2200, 2600, 3200):
            now = (asyncio.get_event_loop().time() - t0) * 1000
            if step > now: await page.wait_for_timeout(step - now)
            shots.append((round((asyncio.get_event_loop().time() - t0) * 1000), await page.screenshot()))
        await browser.close()
    samples = [(ms, round(100 * grey_share(png), 1)) for ms, png in shots]
    print(f'scénario {SCENARIO} ; délai tuile {DELAY} ms ; gris avant geste : {100 * base:.1f} %')
    print('ms après geste -> % écran gris : ' + ', '.join(f'{ms}:{g}' for ms, g in samples))
    print(f'max gris pendant le geste : {max(g for _, g in samples)} %')

if __name__ == "__main__":
    asyncio.run(main())
