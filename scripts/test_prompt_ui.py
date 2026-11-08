"""Browser integration smoke test without network/YouTube credentials.

Uses an isolated about:blank document and mocked local storage, metadata, and
semantic embeddings. Doesn't test real YouTube API/website playback.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
import re

ROOT=Path(__file__).resolve().parents[1] / 'YouTube-Guide'
html=(ROOT/'index.html').read_text()
html=re.sub(r'<script src="app\.js\?[^\"]+" defer></script>', '', html)
script=(ROOT/'app.js').read_text()

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium', headless=True,
                              args=['--no-sandbox','--disable-dev-shm-usage'])
    page=browser.new_page(viewport={'width':1280,'height':900})
    page.route('https://www.youtube.com/**',lambda route:route.abort())
    failures=[]
    page.on('pageerror',lambda err:failures.append(str(err)))
    page.set_content(html,wait_until='load')
    page.evaluate('''() => {
      Object.defineProperty(window.crypto,'randomUUID',{configurable:true,value:()=> 'mock-uuid-1'});
      const store=new Map();
      for(const key of ['localStorage','sessionStorage'])
        Object.defineProperty(window,key,{configurable:true,value:{getItem:k=>store.get(key+':'+k)||null,setItem:(k,v)=>store.set(key+':'+k,String(v)),removeItem:k=>store.delete(key+':'+k)}});
    }''')
    page.add_script_tag(content=script)
    page.evaluate('''() => {
      window.search = async (q) => Array.from({length:14},(_,i)=>'test_video_'+i);
      window.verify = async (ids) => ids.map((id,i)=>({id,title:'Ben 10 Omnitrix aliens fan theory '+i,
        creator:'Analyst '+i,creatorId:'Analyst '+i,description:'Ben 10 Alien Force Omnitrix lore and theories',
        tags:['ben 10','omnitrix'],duration:1800,published:'2026-10-01T00:00:00Z'}));
      window.semanticModel = async () => async (texts) => ({tolist:()=>texts.map(x=>[1,0,0])});
    }''')
    page.locator('#adminOpen').click()
    page.locator('#password').fill('1234')
    page.locator('#loginForm button[type="submit"]').click()
    page.locator('#create').click()
    page.locator('#name').fill('Ben 10 Universe')
    page.locator('#number').fill('101')
    page.locator('#category').fill('Animation')
    page.locator('#youtubeFeedPrompt').fill('Ben 10 Omnitrix aliens fan theories and character analysis, without gameplay')
    page.locator('#previewSeeds').click()
    page.wait_for_function("document.querySelector('#seedProgress').textContent.includes('ranked suggestions')", timeout=9000)
    assert '14 ranked suggestions' in page.locator('#seedProgress').inner_text()
    page.locator('#seedReviewItems input').first.uncheck()
    page.locator('#submitChannel').click()
    try:
        page.wait_for_function("document.querySelector('#createDialog').open === false",timeout=9000)
    except Exception:
        print('CREATE ERROR:',page.locator('#createError').inner_text())
        print('UI ERRORS:', failures)
        print('PREVIEW:',page.locator('#seedProgress').inner_text())
        raise
    msg=page.locator('#adminMessage').inner_text()
    assert 'Created 13 programs' in msg,msg
    local=page.evaluate("JSON.parse(localStorage.getItem('youtube-guide-v07-channels'))")
    assert len(local)==1
    assert local[0]['feedPrompt'].startswith('Ben 10')
    assert len(local[0]['seedIds'])==0
    assert len(local[0]['videos'])==13
    assert len(local[0]['rejectedIds'])==1
    assert local[0]['approximateDiscovery'] is True
    assert not failures,failures
    print('PASS: prompt-only feed renders, previews recommendations, remembers rejected videos, creates playable channel (mocked).')
    browser.close()
