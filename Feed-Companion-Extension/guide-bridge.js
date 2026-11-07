'use strict';
// Bridge visible feed metadata from the extension to the YouTube Guide UI.
// Only a user-initiated command can trigger collection from the YouTube tab.
window.addEventListener('message', event => {
  if(event.source !== window || event.origin !== location.origin) return;
  const data=event.data;
  if(data?.source !== 'youtube-guide-site' || !['YTG_PING','YTG_LIST_FEEDS','YTG_CAPTURE_FEED','YTG_GET_FEED','YTG_OPEN_CUSTOM_FEED'].includes(data.type)) return;
  const command={YTG_PING:'PING',YTG_LIST_FEEDS:'LIST_FEEDS',YTG_CAPTURE_FEED:'CAPTURE_FEED',YTG_GET_FEED:'GET_FEED',YTG_OPEN_CUSTOM_FEED:'OPEN_CUSTOM_FEED'}[data.type];
  chrome.runtime.sendMessage({type:command,name:String(data.feedName||'My Custom Feed').slice(0,100),steps:data.steps||0,prompt:String(data.prompt||'').slice(0,1200)}, response => {
    const error=chrome.runtime.lastError?.message;
    window.postMessage({source:'youtube-guide-extension',type:'YTG_REPLY',requestId:data.requestId,action:data.type,
      ...(response || {ok:false,error:error||'The extension did not respond.'})},location.origin);
  });
});
