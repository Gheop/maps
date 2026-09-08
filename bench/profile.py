#!/usr/bin/env python3
"""Profil CPU (CDP Profiler) du scénario d'interaction de front.py : self-time par fonction.
Usage : bench/profile.py http://127.0.0.1:18080"""
import asyncio, collections, sys
sys.argv = [sys.argv[0], sys.argv[1], '1']
import front  # noqa: E402  (réutilise mock/scénario)
from playwright.async_api import async_playwright


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context(viewport={'width': 1280, 'height': 800}, service_workers='block')
        await front.mock(ctx)
        page = await ctx.new_page()
        await page.goto(f'{front.BASE}/{front.VIEW}', wait_until='networkidle')
        await page.wait_for_timeout(900)
        cdp = await ctx.new_cdp_session(page)
        await cdp.send('Profiler.enable')
        await cdp.send('Profiler.setSamplingInterval', {'interval': 100})
        await cdp.send('Profiler.start')
        for i in range(12):
            dx, dy = ((320, 0), (0, 320), (-320, 0), (0, -320))[i % 4]
            await page.mouse.move(640, 400); await page.mouse.down()
            for k in range(1, 9): await page.mouse.move(640 + dx * k / 8, 400 + dy * k / 8)
            await page.mouse.up(); await page.wait_for_timeout(120)
        for d in (-100,) * 6 + (100,) * 6:
            await page.mouse.move(640, 400); await page.mouse.wheel(0, d); await page.wait_for_timeout(250)
        await page.wait_for_timeout(600)
        prof = (await cdp.send('Profiler.stop'))['profile']
        await browser.close()
    nodes = {n['id']: n for n in prof['nodes']}
    self_us = collections.Counter()
    deltas = prof['timeDeltas']
    for i, nid in enumerate(prof['samples']):
        cf = nodes[nid]['callFrame']
        name = f"{cf['functionName'] or '(anon)'} {cf['url'].split('/')[-1]}:{cf['lineNumber'] + 1}"
        self_us[name] += deltas[i]
    total = sum(self_us.values())
    print(f"total échantillonné : {total / 1000:.0f} ms")
    for name, us in self_us.most_common(28):
        print(f"{us / 1000:7.1f} ms {100 * us / total:5.1f}%  {name}")

asyncio.run(main())
