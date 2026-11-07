'use strict';
importScripts('capture-core.js');
const prefix = 'ytg:feed:';
const norm = v => String(v || 'My Custom Feed').trim().slice(0, 100) || 'My Custom Feed';
const feedKey = name => prefix + norm(name).toLowerCase();
const safeVideo = v => {
  const id = String(v?.id || '');
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
  return {id, title: String(v.title||'').slice(0,220), creator: String(v.creator||'').slice(0,120), url:`https://www.youtube.com/watch?v=${id}`, source:'visible-custom-feed', capturedAt: v.capturedAt||new Date().toISOString()};
};
async function listFeeds() {
  const data = await chrome.storage.local.get(null);
  const feeds = Object.entries(data).filter(([k,v])=>k.startsWith(prefix) && Array.isArray(v))
    .map(([k,v]) => ({name: data['ytg:name:'+k.slice(prefix.length)] || k.slice(prefix.length), count:v.length}));
  return feeds.sort((a,b)=>a.name.localeCompare(b.name));
}
async function loadFeed(name) {return ((await chrome.storage.local.get(feedKey(name)))[feedKey(name)] || []).map(safeVideo).filter(Boolean);}
async function pickYouTubeTab() {
  const tabs = await chrome.tabs.query({url:['https://www.youtube.com/*']});
  const matches = tabs.filter(t=>!t.discarded && t.id);
  matches.sort((a,b)=>Number(b.active)-Number(a.active) || Number(b.lastAccessed||0)-Number(a.lastAccessed||0));
  if (!matches.length) throw Error('Open your Custom Feed on youtube.com in this browser first.');
  return matches[0];
}
async function captureFeed(name, steps) {
  const tab = await pickYouTubeTab();
  const result = await chrome.scripting.executeScript({target:{tabId:tab.id}, func:captureYouTubeCustomFeed, args:[{steps}]});
  const captured = result?.[0]?.result;
  if (!captured) throw Error('Could not read YouTube video tiles. Reload the YouTube feed and try again.');
  const existing = await loadFeed(name);
  const map = new Map(existing.map(v => [v.id,v]));
  for (const v of captured.videos || []) {const val=safeVideo(v);if(val) map.set(val.id,val);}
  const videos = [...map.values()].slice(-1500);
  await chrome.storage.local.set({[feedKey(name)]:videos,['ytg:name:'+norm(name).toLowerCase()]:norm(name),'ytg:lastName':norm(name)});
  return {feedName:norm(name),videos, added:videos.length-existing.length, scanned:(captured.videos||[]).length, diagnostics:captured.diagnostics, pageTitle:captured.pageTitle};
}
async function message(data) {
  switch(data?.type){
    case 'PING': return {ok:true,version:'1.0.7'};
    case 'LIST_FEEDS': return {feeds:await listFeeds()};
    case 'GET_FEED': return {feedName:norm(data.name),videos:await loadFeed(data.name)};
    case 'CAPTURE_FEED': return await captureFeed(data.name,Math.max(0,Math.min(12,Number(data.steps)||0)));
    case 'CLEAR_FEED': await chrome.storage.local.remove([feedKey(data.name),'ytg:name:'+norm(data.name).toLowerCase()]);return {ok:true};
    case 'OPEN_CUSTOM_FEED': {
      const feedName=norm(data.name), prompt=String(data.prompt||'').trim().slice(0,1200);
      if(!prompt)throw Error('Enter the description for YouTube Custom Feed.');
      await chrome.storage.local.set({'ytg:pendingDraft':{feedName,prompt,createdAt:Date.now()},'ytg:lastName':feedName});
      const tab=await chrome.tabs.create({url:'https://www.youtube.com/',active:true});
      return {opened:true,tabId:tab.id,feedName};
    }
    case 'LAST_NAME': return {name:(await chrome.storage.local.get('ytg:lastName'))['ytg:lastName']||'My Custom Feed'};
    default: throw Error('Unknown Feed Companion operation.');
  }
}
chrome.runtime.onMessage.addListener((data, sender, sendResponse)=>{
  message(data).then(result=>sendResponse({ok:true,...result})).catch(err=>sendResponse({ok:false,error:err.message}));
  return true;
});
