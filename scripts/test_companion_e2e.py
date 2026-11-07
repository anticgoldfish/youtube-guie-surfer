"""Offline integration test using a simulated YouTube video grid and mocked Data API.
Does not prove the current live YouTube site markup is identical.
"""
import asyncio, json, os, re, subprocess, time
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
SITE=ROOT/'YouTube-Guide'
EXT=ROOT/'Feed-Companion-Extension'
PORT='8793'
VIDEO_IDS=['BEN10VIDEO1','BEN10VIDEO2','BEN10VIDEO3','BEN10VIDEO4']
assert all(len(x)==11 for x in VIDEO_IDS)
MOCK_YT='''<!doctype html><html><body><main><ytd-browse page-subtype="home"><h1>Your custom feed: Ben 10</h1><ytd-rich-grid-renderer>'''+''.join(f'''<ytd-rich-item-renderer style="display:block;height:190px"><ytd-rich-grid-media><a href="/watch?v={vid}"><img src="/img.jpg"></a><h3><a id="video-title-link" href="/watch?v={vid}">Ben 10 Lore Discussion — Part {i+1}</a></h3><ytd-channel-name>Cartoon Breakdown Channel</ytd-channel-name></ytd-rich-grid-media></ytd-rich-item-renderer>''' for i,vid in enumerate(VIDEO_IDS))+'''</ytd-rich-grid-renderer></ytd-browse></main></body></html>'''
async def main():
    proc=subprocess.Popen(['python','-m','http.server',PORT,'--bind','127.0.0.1'],cwd=SITE,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    try:
        await asyncio.sleep(.7)
        async with async_playwright() as p:
            ctx=await p.chromium.launch_persistent_context('/tmp/ytg106-test-profile',executable_path='/usr/bin/chromium',headless=True, args=[f'--disable-extensions-except={EXT}',f'--load-extension={EXT}','--no-sandbox'])
            # External YouTube is blocked in this test environment; use a rendered-card fixture on localhost.
            async def api_route(route):
                u=route.request.url
                if '/videos?' in u:
                    from urllib.parse import parse_qs,urlparse
                    ids=parse_qs(urlparse(u).query).get('id',[''])[0].split(',')
                    resp={'items':[{'id':vid,'snippet':{'title':f'Ben 10 Lore Discussion — {vid}', 'channelTitle':'Cartoon Breakdown Channel','channelId':'UC12345','description':'Ben 10 Omnitrix lore and Alien X retrospective','tags':['Ben 10','Omnitrix'],'liveBroadcastContent':'none'},'contentDetails':{'duration':'PT23M'},'status':{'privacyStatus':'public','embeddable':True}} for vid in ids]}
                else: resp={'items':[]}
                await route.fulfill(status=200,content_type='application/json',body=json.dumps(resp),headers={'access-control-allow-origin':'*'})
            await ctx.route('https://www.googleapis.com/youtube/v3/**',api_route)
            yt=await ctx.new_page();await yt.goto('http://localhost:8793/');await yt.set_content(MOCK_YT);await yt.add_script_tag(content=(EXT/'capture-core.js').read_text()); captured=await yt.evaluate('captureYouTubeCustomFeed({steps:0})');assert len(captured['videos'])==4, captured; print('PASS: DOM capture finds 4 videos in YouTube-style feed fixture')
            sw=None
            for _ in range(30):
                ws=ctx.service_workers
                if ws: sw=ws[0]; break
                await asyncio.sleep(.2)
            assert sw, 'Extension service worker missing'
            extension_id=sw.url.split('/')[2]
            # Preload what the service worker normally captures from the YouTube tab.
            videos=captured['videos']
            await sw.evaluate("async videos => await chrome.storage.local.set({'ytg:feed:ben 10 universe':videos,'ytg:name:ben 10 universe':'Ben 10 Universe'})",videos)
            popup=await ctx.new_page();await popup.goto(f'chrome-extension://{extension_id}/popup.html')
            await popup.locator('#name').fill('Ben 10 Universe')
            await popup.locator('#name').dispatch_event('change')
            await popup.wait_for_function("document.querySelector('#count').textContent.includes('4 saved')",timeout=15000)
            print('PASS: extension popup reads stored feed with 4 captured video cards')
            site=await ctx.new_page();await site.goto('http://localhost:8793/?test=106',wait_until='domcontentloaded')
            await site.evaluate("localStorage.setItem('youtube-guide-v07-api','MOCK_KEY')")
            await site.reload()
            await site.locator('#adminOpen').click()
            await site.locator('#password').fill('1234')
            await site.locator('#loginForm button[type=submit]').click()
            await site.locator('#create').click()
            await site.locator('#name').fill('Ben 10 Universe')
            await site.locator('#number').fill('105')
            await site.locator('#feedName').fill('Ben 10 Universe')
            await site.locator('#syncYouTubeFeed').click()
            await site.wait_for_function("document.querySelector('#seedStatus').textContent.includes('4 actual') or document.querySelector('#seedStatus').textContent.includes('Loaded 4')",timeout=12000)
            assert await site.locator('#includeSeeds').is_checked()
            await site.locator('#submitChannel').click()
            await site.wait_for_function("!document.querySelector('#createDialog').open",timeout=15000)
            data=await site.evaluate("JSON.parse(localStorage.getItem('youtube-guide-v07-channels'))")
            assert len(data)==1 and len(data[0]['videos'])==4,repr(data)
            assert data[0]['seedIds']==VIDEO_IDS,repr(data[0]['seedIds'])
            assert data[0]['mode']=='seeds'
            print('PASS: Guide synced 4 references and saved a playable 4-video channel without calling the AI')
            await ctx.close()
    finally: proc.terminate();proc.wait(timeout=5)
if __name__=='__main__': asyncio.run(main())
