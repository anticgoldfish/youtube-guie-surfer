(() => {
  'use strict';
  if(window.__ytgActualCustomFeedHelper) return;
  window.__ytgActualCustomFeedHelper = true;
  const $=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text)el.textContent=text;return el;};
  const style=$('style');
  style.textContent=`#ytg-custom-feed-helper{position:fixed;z-index:2147483646;right:16px;bottom:16px;width:min(355px,calc(100vw - 32px));background:#091b36;color:#f2f7ff;border:2px solid #edca55;border-radius:12px;box-shadow:0 12px 35px #0009;padding:17px;font:13px/1.5 Arial,sans-serif}#ytg-custom-feed-helper *{box-sizing:border-box}#ytg-custom-feed-helper strong{font-size:16px}#ytg-custom-feed-helper .gold{color:#f7db71}#ytg-custom-feed-helper p{margin:10px 0}#ytg-custom-feed-helper textarea{width:100%;min-height:88px;background:#071326;border:1px solid #5b84ae;border-radius:6px;padding:10px;color:#e6f4ff;font:12px/1.4 Arial;resize:vertical}#ytg-custom-feed-helper button{background:#165b9f;color:white;border:1px solid #90baee;border-radius:6px;padding:9px;cursor:pointer;font-size:12px;font-weight:bold}#ytg-custom-feed-helper button.gold{background:#f1ce53;color:#172b43;border-color:#ffec9b}#ytg-custom-feed-helper .buttons{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin:10px 0}#ytg-custom-feed-helper .close{float:right;background:transparent;border:0;padding:0 4px;font-size:21px;color:white}#ytg-custom-feed-helper .feedback{padding:9px;background:#102f53;border:1px solid #3e709c;border-radius:5px;margin-top:8px}#ytg-custom-feed-helper .small{font-size:11px;color:#c0d7eb}`;
  document.documentElement.append(style);
  let panel=null;
  async function start(){
    const d=await chrome.storage.local.get('ytg:pendingDraft');
    const draft=d['ytg:pendingDraft'];
    if(!draft||Date.now()-draft.createdAt>24*60*60*1000)return;
    if(document.querySelector('#ytg-custom-feed-helper'))return;
    panel=$('div'); panel.id='ytg-custom-feed-helper';
    const close=$('button','close','×');close.setAttribute('aria-label','Close helper');close.onclick=()=>panel.remove();panel.append(close);
    panel.append($('strong',null,'YouTube '));panel.append($('strong','gold','Custom Feed Creator'));
    panel.append($('p',null,'Use YouTube’s own Custom Feed feature. Create the feed here on YouTube, then capture the recommendations it displays.'));
    panel.append($('div','small','Your feed prompt:'));
    const txt=$('textarea');txt.readOnly=true;txt.value=draft.prompt;panel.append(txt);
    const actions=$('div','buttons');panel.append(actions);
    const copy=$('button','gold','Copy prompt');actions.append(copy);copy.onclick=async()=>{try{await navigator.clipboard.writeText(draft.prompt);update('Prompt copied. Click + or Custom Feed on YouTube Home, paste and submit.')}catch{txt.focus();txt.select();update('Copy the selected prompt and paste it into YouTube’s feed creator.')}};
    const locate=$('button',null,'Find Custom Feed');actions.append(locate);
    locate.onclick=()=>{
      const candidates=[...document.querySelectorAll('button,[role="button"],a')].filter(x=>{
        const text=[x.getAttribute('aria-label'),x.getAttribute('title'),x.textContent].filter(Boolean).join(' ').replace(/\s+/g,' ').trim();
        return /(your custom feed|create custom feed|custom feeds?)/i.test(text)&&text.length<150&&x.getClientRects().length;
      });
      const el=candidates.find(x=>/create/i.test(x.getAttribute('aria-label')||''))||candidates[0];
      if(el){el.scrollIntoView({block:'center'});el.click();update('Opened a Custom Feed control. Enter the prompt on YouTube and submit it.');}
      else update('On YouTube Home, use the + icon near the top feed tabs to create a Custom Feed. YouTube may change this interface.');
    };
    const actions2=$('div','buttons');panel.append(actions2);
    const cap=$('button','gold','Capture this feed');actions2.append(cap);
    const more=$('button',null,'Capture + scroll');actions2.append(more);
    async function capture(steps){
      const ok=confirm('Are you viewing the recommendations inside your new YouTube Custom Feed (not the ordinary Home feed)?');
      if(!ok)return;
      cap.disabled=more.disabled=true;update('Reading recommendations displayed in the current YouTube feed…');
      try{
        const resp=await chrome.runtime.sendMessage({type:'CAPTURE_FEED',name:draft.feedName,steps});
        if(!resp?.ok)throw Error(resp?.error||'Capture failed');
        update(`Saved ${resp.videos.length} distinct videos for “${draft.feedName}”; ${resp.added} added in this capture. Return to YouTube Guide and select “Import captured YouTube feed”.`);
        await chrome.storage.local.remove('ytg:pendingDraft');
      }catch(e){update('Capture failed: '+e.message)}
      finally{cap.disabled=more.disabled=false}
    }
    cap.onclick=()=>capture(0);more.onclick=()=>capture(8);
    const note=$('div','small','This uses YouTube’s actual Custom Feed page, not a copied recommendation algorithm. The extension can only collect videos YouTube displays.');panel.append(note);
    const feedback=$('div','feedback','First create your Custom Feed on YouTube, then capture its displayed recommendations.');feedback.setAttribute('role','status');panel.append(feedback);
    function update(t){feedback.textContent=t}
    document.body.append(panel);
  }
  const go=()=>start().catch(e=>console.warn('YouTube Guide helper:',e));
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',go,{once:true});else go();
})();
