"""Offline browser test: global GitHub publish merge, retry and >1MB API fallback."""
from pathlib import Path
import re
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]/'YouTube-Guide'
html=re.sub(r'<script src="app\.js\?[^"]+" defer></script>','',(ROOT/'index.html').read_text())
script=(ROOT/'app.js').read_text()
with sync_playwright() as playwright:
    browser=playwright.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
    page=browser.new_page()
    errors=[]
    page.on('pageerror',lambda err:errors.append(str(err)))
    page.set_content(html)
    page.evaluate('''() => {const store=new Map();for(const name of ['localStorage','sessionStorage'])Object.defineProperty(window,name,{configurable:true,value:{getItem:k=>store.get(name+':'+k)||null,setItem:(k,v)=>store.set(name+':'+k,String(v)),removeItem:k=>store.delete(name+':'+k)}})}''')
    page.add_script_tag(content=script)
    result=page.evaluate('''async () => {
        github={owner:'anticgoldfish',repo:'youtube-guie-surfer',branch:'main'};
        token='test-token-for-mock-only';
        let count=0, puts=0;
        const original={version:3,channels:[{id:'existing',number:100,name:'Existing',videos:[{id:'A',duration:1800}],schedule:{end:123}}]};
        gitRequest=async (method='GET',body)=>{
          if(method==='GET')return {sha:'SHA-'+(++count),encoding:'base64',content:encode64(JSON.stringify(original))};
          puts++;
          if(puts===1){const e=Error('SHA stale');e.status=409;throw e;}
          const updated=JSON.parse(decode64(body.content));
          if(updated.channels.length!==2)throw Error('Removed existing channel');
          if(!updated.channels.find(c=>c.id==='new'))throw Error('New channel not added');
          return {content:{sha:'committed'}};
        };
        await publish({type:'upsert',channel:{id:'new',number:101,name:'New',videos:[{id:'B',duration:1800}]}});
        // Git Blob API fallback for large channel files >1MB.
        const oldFetch=window.fetch;
        window.fetch=async()=>({ok:true,json:async()=>({encoding:'base64',content:encode64(JSON.stringify(original))})});
        const blob=await readChannelContents({sha:'SHA',encoding:'none',content:''});
        window.fetch=oldFetch;
        return {puts,count,channels:channels.length,blobCount:blob.channels.length};
    }''')
    assert result['puts']==2,result
    assert result['channels']==2,result
    assert result['blobCount']==1,result
    assert not errors,errors
    page.locator('#adminOpen').click()
    page.locator('#password').fill('1234')
    page.locator('#loginForm button[type="submit"]').click()
    page.locator('#create').click()
    assert page.locator('#createDialog').evaluate('(e)=>e.open')
    for name in ['back120','back60','earlier','now','later','forward60','forward120','filter']:
        assert page.locator('#'+name).count()==1,name
    print('PASS: editor opens, guide controls exist, GitHub SHA conflict is retried and large-file blob fallback works')
    browser.close()
