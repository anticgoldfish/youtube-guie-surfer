'use strict';
const $=id=>document.getElementById(id);
const escapeHtml=v=>String(v??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const STORE='youtube-guide-v07-channels',KEY='youtube-guide-v07-api',GITHUB='youtube-guide-v07-github';
let channels=[],chosen=null,guideStart=0,editing=null,admin=false,debugActive=false,debugOverride=null,seedImported=[],seedPreview=null,apiKey=localStorage.getItem(KEY)||'',github=JSON.parse(localStorage.getItem(GITHUB)||'{}');
let token=sessionStorage.getItem('youtube-guide-github-token')||'',player=null,iframeReady=false,playerReady=false,loadedId='',loadedChannel='',wanted=null,paused=false,pauseAt=0,delay=0,sound=true,errors=new Set(),lastInteraction=0;
const now=()=>Date.now(),time=t=>new Date(t).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
const selected=()=>channels.find(c=>c.id===chosen);
const ordered=()=>channels.filter(c=>!$('filter').value||c.category===$('filter').value).sort((a,b)=>a.number-b.number);
const isPlaylist=c=>['playlist','multi'].includes(c.mode);
const CYCLE_MS=72*3600000; // Three days. Keep dates identical across browsers.
function cycleAnchor(c){return Number(c.anchor)||0}
function cycleStart(c,t){const anchor=cycleAnchor(c);return anchor+Math.floor((t-anchor)/CYCLE_MS)*CYCLE_MS}
// Every 72-hour cycle produces a reproducible new programming order on ALL devices.
// It does not depend on a browser being open or a background script succeeding.
function cycleVideos(c,t){
 const pool=Array.isArray(c.pendingVideos)&&c.pendingVideos.length&&t>=Number(c.activateAt||Infinity)?c.pendingVideos:c.videos;
 if(!Array.isArray(pool)||!pool.length)return [];
 const index=Math.floor((t-cycleAnchor(c))/CYCLE_MS);
 if(c.order!=='shuffle'||pool.length===1)return pool;
 // Stable seeded Fisher-Yates: deterministic per channel and 72-hour cycle.
 let seed=2166136261;
 for(const chr of String(c.id)+'|'+index){seed=Math.imul(seed^chr.charCodeAt(0),16777619)>>>0}
 const out=pool.slice();
 for(let i=out.length-1;i>0;i--){
   seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;
   const j=(seed>>>0)%(i+1);
   [out[i],out[j]]=[out[j],out[i]];
 }
 return out;
}
function channelStatus(c,t=now()){const block=cycleStart(c,t);const list=cycleVideos(c,t)||[];return {cycleStart:block,nextCycle:block+CYCLE_MS,programs:list.length,hasPending:!!(c.pendingVideos?.length&&c.activateAt>t)}}
function saveLocal(){localStorage.setItem(STORE,JSON.stringify(channels));draw();}
function say(v){$('message').textContent=v;}
function overlay(title,detail,show=true){$('overlay').classList.remove('hidden');$('overlayTitle').textContent=title;$('overlayDesc').textContent=detail;$('playNow').classList.toggle('hidden',!show);}
function hideOverlay(){$('overlay').classList.add('hidden')}
function duration(c){return (c.videos||[]).reduce((n,v)=>n+Math.max(0,+v.duration||0),0)}
// Portable UTC EPG: both this website and a future Android TV APK read
// the same channel.schedule / channel.nextSchedule records from channels.json.
// Schedule entries are videoId + millisecond start/end, never local time strings.
function scheduleProgram(c,t){
 const list=[c.nextSchedule,c.schedule].filter(x=>x&&x.start<=t&&t<x.end);
 if(!list.length)return null;
 const epg=list.sort((a,b)=>b.start-a.start)[0];
 // Binary search makes large 100-hour listings practical for many channels.
 let low=0,high=(epg.programs||[]).length-1,entry=null;
 while(low<=high){let mid=(low+high)>>1,p=epg.programs[mid];
   if(t<p.start)high=mid-1;else if(t>=p.end)low=mid+1;else{entry=p;break;}}
 if(!entry)return null;
 const all=[...(c.pendingVideos||[]),...(c.videos||[])];
 const video=all.find(v=>v.id===entry.videoId);
 if(!video)return null;
 return {video,start:entry.start,end:entry.end,offset:(t-entry.start)/1000};
}
function makeSchedule(c,start){
 const items=cycleVideos(c,start),limit=start+100*3600000,programs=[];
 if(!items.length)return null;
 let cursor=start;
 while(cursor<limit){for(const v of items){const ms=Math.floor(Number(v.duration||0)*1000);
   if(ms<=0)continue;const end=Math.min(cursor+ms,limit);
   programs.push({videoId:v.id,start:cursor,end});cursor=end;
   if(cursor>=limit)break;
 }if(!items.some(v=>Number(v.duration)>0))break;}
 return {schemaVersion:1,start,end:cursor,durationHours:(cursor-start)/3600000,programs};
}
function at(c,t){
 const explicit=scheduleProgram(c,t);if(explicit)return explicit;
 // Virtual 72-hour schedule: all devices share the same anchor, and each program
 // repeats as needed to fill that window. API failures can never exhaust it.
 if(!c?.videos?.length&&!c?.pendingVideos?.length)return null;
 const block=cycleStart(c,t),endCycle=block+CYCLE_MS;
 const items=cycleVideos(c,t);
 let total=items.reduce((n,v)=>n+Math.max(0,Number(v.duration)||0),0);
 if(!total)return null;
 let seconds=Math.max(0,(t-block)/1000)%total;
 for(const v of items){
   const len=Math.max(0,Number(v.duration)||0);
   if(seconds<len){const remain=Math.min(len-seconds,(endCycle-t)/1000);
     return {video:v,offset:seconds,start:t-seconds*1000,end:t+Math.max(0,remain)*1000};}
   seconds-=len;
 }
 return null;
}
function draw(){const prev=$('filter').value;const cats=[...new Set(channels.map(c=>c.category))].sort();$('filter').innerHTML='<option value="">All Categories</option>'+cats.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');$('filter').value=cats.includes(prev)?prev:'';
 const current=$('manageChannel').value;$('manageChannel').innerHTML=channels.sort((a,b)=>a.number-b.number).map(c=>`<option value="${escapeHtml(c.id)}">${c.number} — ${escapeHtml(c.name)}</option>`).join('');if(channels.some(c=>c.id===current))$('manageChannel').value=current;
 if(!selected())chosen=channels[0]?.id||null;guide();info();}
function guide(){let arr=ordered(),t=now(),span=150*60000;$('times').innerHTML=Array.from({length:5},(_,i)=>`<div>${time(guideStart+i*1800000)}</div>`).join('');$('infobar').textContent=arr.length?`${arr.length} channels • ${time(t)} • fixed shared clock • ${token?'GitHub connected':'local development'}`:'No channels yet. Admin Options → Create Channel to begin.';
 $('rows').innerHTML=arr.map(c=>{let html='',cursor=guideStart,guard=0;while(cursor<guideStart+span&&guard++<180){const p=at(c,cursor+100);if(!p)break;let end=Math.min(guideStart+span,p.end);if(end<=cursor){cursor+=1000;continue}let left=100*(cursor-guideStart)/span,w=100*(end-cursor)/span;html+=`<button class="program ${p.start<=t&&p.end>t?'current':''}" title="${escapeHtml(p.video.title)}" data-tune="${escapeHtml(c.id)}" style="left:${left}%;width:${w}%"><strong>${escapeHtml(p.video.title)}</strong><small>${escapeHtml(p.video.creator||c.name)} • ${time(p.start)}</small></button>`;cursor=end+50;}let marker=(t-guideStart)/span*100;if(marker>=0&&marker<=100)html+=`<div class="marker" style="left:${marker}%"></div>`;return `<div class="line"><div class="station ${c.id===chosen?'selected':''}" data-tune="${escapeHtml(c.id)}"><b>${c.number}</b><span>${escapeHtml(c.name)}<small>${escapeHtml(c.category)} · ${c.videos.length} programs · new 3-day lineup each cycle</small></span></div><div class="programs">${html}</div></div>`}).join('');}
function info(){let c=selected(),p=c&&at(c,now());$('channelLabel').textContent=c?`CHANNEL ${c.number} • ${c.name}`:'NO CHANNEL SELECTED';$('programLabel').textContent=p?.video.title||'Choose a channel';$('details').textContent=p?`${p.video.creator||c.category} • ${time(p.start)} – ${time(p.end)} • ${['prompt','similar','seeds'].includes(c.mode)?'Recommendation channel':c.mode==='creator'?'Creator channel':'Playlist channel'}`:'No playable programs are available yet. Create or update this channel in Admin Options.';}
function tune(id){if(!channels.some(c=>c.id===id))return;debugOverride=null;chosen=id;if(debugActive)updateDebugPrograms();paused=false;delay=0;loadedId='';errors.clear();draw();if(playerReady)sync(true);else overlay('Channel '+selected().number,'Click WATCH LIVE to join the broadcast at its current point.',true)}
function makePlayer(){if(!iframeReady||player)return;player=new YT.Player('player',{width:'100%',height:'100%',playerVars:{playsinline:1,autoplay:0,controls:0,disablekb:1,fs:0,rel:0,origin:location.protocol.startsWith('http')?location.origin:undefined},events:{onReady:()=>{playerReady=true;try{player.setVolume(85);player.unMute()}catch{}if(wanted)loadWanted()},onStateChange:e=>{if(e.data===YT.PlayerState.PLAYING){if(paused){player.pauseVideo();return}hideOverlay();say('Playing live schedule • rewind and pause available; no skipping ahead.') }if(e.data===YT.PlayerState.ENDED&&!paused)sync(true)},onError:e=>{let reason=({2:'Invalid video',5:'HTML5 player error',100:'Video removed or private',101:'Uploader blocked embedding',150:'Uploader blocked embedding',153:'Embedded playback rejected'})[e.data]||'Video unavailable';errors.add(loadedId);overlay('This program cannot play',reason+'. The schedule remains unchanged. Try another channel or wait for the next program.',false);say(reason)}}})}
function loadWanted(){if(!playerReady||!wanted)return;let w=wanted;wanted=null;loadedId=w.id;loadedChannel=w.channel;try{player.loadVideoById({videoId:w.id,startSeconds:Math.max(0,Math.floor(w.offset))});player.setVolume(85);if(sound)player.unMute();else player.mute();hideOverlay()}catch(e){overlay('Could not tune channel',e.message,true)}}
function sync(force=false){let c=selected(),p=c&&(debugActive&&debugOverride?debugAt(c):at(c,now()-delay));if(!p){overlay('No programs available','This channel does not yet have eligible videos.',false);return}if(!playerReady){wanted={id:p.video.id,offset:p.offset,channel:c.id};makePlayer();return}if(errors.has(p.video.id)){overlay('Program unavailable','YouTube has blocked this embed. The broadcast schedule will continue to the next program.',false);return}if(force||loadedId!==p.video.id||loadedChannel!==c.id){wanted={id:p.video.id,offset:p.offset,channel:c.id};loadWanted();return}if(paused)return;let current=player.getCurrentTime?.()||0;if(!debugActive&&current>p.offset+2){player.seekTo(Math.max(0,p.offset-.5),true);say('Skipping ahead of live is disabled.')}else if(!debugActive&&current<p.offset-35&&delay===0){player.seekTo(Math.max(0,p.offset-1),true)}}
$('playNow').onclick=()=>{if(!chosen)return;paused=false;delay=0;lastInteraction=now();if(!iframeReady){overlay('Loading YouTube','The YouTube player is still loading. Check your internet connection and browser extensions.',true);return}makePlayer();if(playerReady){sync(true);try{player.unMute();player.setVolume(85);player.playVideo()}catch{}}else overlay('Loading player','YouTube is initializing. Click WATCH LIVE again if playback does not start.',true)};
$('pause').onclick=()=>{if(!playerReady||!chosen)return;if(!paused){paused=true;pauseAt=now();player.pauseVideo();$('pause').textContent='▶ RESUME';say('Paused locally; the channel clock keeps running.')}else{delay+=now()-pauseAt;paused=false;player.playVideo();$('pause').textContent='❚❚ PAUSE';say('Resumed behind the live broadcast.')}};
$('back').onclick=()=>{if(!playerReady||!selected())return;let p=at(selected(),now()-delay);if(!p||loadedId!==p.video.id)return;let cur=player.getCurrentTime?.()||0,next=Math.max(0,Math.min(cur,p.offset)-10);player.seekTo(next,true);delay=Math.max(0,now()-(p.start+next*1000));if(paused)pauseAt=now();say('Rewound 10 seconds.');};
$('live').onclick=()=>{paused=false;delay=0;$('pause').textContent='❚❚ PAUSE';sync(true)};
$('sound').onclick=()=>{sound=!sound;$('sound').textContent=sound?'🔊 Sound On':'🔇 Sound Off';if(playerReady){if(sound){player.setVolume(85);player.unMute()}else player.mute()}say(sound?'Sound enabled. Check device and tab volume if silent.':'Sound muted.')};
function debugAt(c){if(!debugOverride||!c?.videos?.length)return at(c,now());let i=Math.max(0,Math.min(c.videos.length-1,debugOverride.index));let v=c.videos[i];let elapsed=Math.max(0,(now()-debugOverride.since)/1000),offset=debugOverride.offset+elapsed;if(offset>=v.duration){debugOverride={index:(i+1)%c.videos.length,offset:0,since:now()};return debugAt(c)}return {video:v,offset,start:now()-offset*1000,end:now()+(v.duration-offset)*1000}}
function debugIndex(i,offset=0){let c=selected();if(!c?.videos?.length)return;debugActive=true;debugOverride={index:(i+c.videos.length)%c.videos.length,offset:Math.max(0,offset),since:now()};loadedId='';refreshDebugInfo();sync(true)}
function refreshDebugInfo(){let c=selected(),p=c&&debugAt(c);if(!p)return;$('channelLabel').textContent=`DEBUG PREVIEW • CHANNEL ${c.number}`;$('programLabel').textContent=p.video.title;$('details').textContent=`Previewing ${p.video.creator||'video'} • Not changing live schedule`;$('debugInfo').textContent=`Previewing ${c.videos.findIndex(v=>v===p.video)+1} / ${c.videos.length} — ${Math.floor(p.offset/60)}:${String(Math.floor(p.offset%60)).padStart(2,'0')} into video`}
function updateDebugPrograms(){let c=selected();$('debugPrograms').innerHTML=(c?.videos||[]).map((v,i)=>`<option value="${i}">${i+1}. ${escapeHtml(v.title.slice(0,75))}</option>`).join('')}
$('debugToggle').onclick=()=>{if(!admin)return;debugActive=!debugActive;debugOverride=null;$('debugPanel').classList.toggle('hidden',!debugActive);$('debugToggle').textContent=debugActive?'Disable Debug Mode':'Enable Debug Mode';updateDebugPrograms();$('adminDialog').close();sync(true)};
$('debugExit').onclick=()=>{debugOverride=null;debugActive=false;$('debugPanel').classList.add('hidden');$('debugToggle').textContent='Enable Debug Mode';delay=0;sync(true)};
$('debugPrev').onclick=()=>{let c=selected();if(!c)return;let i=debugOverride?.index??c.videos.findIndex(v=>v.id===at(c,now())?.video.id);debugIndex(i-1)};
$('debugNext').onclick=()=>{let c=selected();if(!c)return;let i=debugOverride?.index??c.videos.findIndex(v=>v.id===at(c,now())?.video.id);debugIndex(i+1)};
$('debugJump').onclick=()=>{let c=selected();if(!c)return;let p=debugOverride?debugAt(c):at(c,now());let i=debugOverride?.index??c.videos.findIndex(v=>v.id===p?.video.id);debugIndex(i,(p?.offset||0)+300)};
$('debugSelect').onclick=()=>debugIndex(Number($('debugPrograms').value)||0);
function surf(n){let a=ordered(),i=a.findIndex(c=>c.id===chosen);if(a.length)tune(a[(i+n+a.length)%a.length].id)}$('previous').onclick=()=>surf(-1);$('next').onclick=()=>surf(1);
$('rows').onclick=e=>{let b=e.target.closest('[data-tune]');if(b)tune(b.dataset.tune)};$('earlier').onclick=()=>{guideStart-=1800000;guide()};$('later').onclick=()=>{guideStart+=1800000;guide()};$('now').onclick=()=>{guideStart=Math.floor(now()/1800000)*1800000;guide()};$('filter').onchange=guide;
window.addEventListener('keydown',e=>{if(document.querySelector('dialog[open]')||['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName))return;if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();surf(e.key==='ArrowDown'?1:-1)}});
function tick(){$('clock').textContent=time(now());if(debugActive&&debugOverride)refreshDebugInfo();else info();if(playerReady&&selected()&&!paused&&loadedId)sync(false)}
window.onYouTubeIframeAPIReady=()=>{iframeReady=true;makePlayer()};let yt=document.createElement('script');yt.src='https://www.youtube.com/iframe_api';yt.async=true;document.head.appendChild(yt);
// YouTube Data API v3, directly from this browser. Keys in browser storage are NOT secret on a published site.
async function youtube(route,params={}){if(!apiKey)throw Error('Add your YouTube Data API v3 key in Admin Options first.');let url=new URL('https://www.googleapis.com/youtube/v3/'+route);for(let [k,v] of Object.entries({...params,key:apiKey}))url.searchParams.set(k,String(v));let r=await fetch(url);let data=await r.json();if(!r.ok){let msg=data.error?.message||'YouTube API error '+r.status;if(r.status===403&&/quota/i.test(msg))msg+=' Your daily YouTube API quota may be exhausted; try again after reset.';throw Error(msg)}return data}
function isoSeconds(x){let m=String(x||'').match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);return m?Number(m[1]||0)*86400+Number(m[2]||0)*3600+Number(m[3]||0)*60+Number(m[4]||0):0}
const chunks=(a,n)=>Array.from({length:Math.ceil(a.length/n)},(_,i)=>a.slice(i*n,i*n+n));
async function verify(ids){let result=[];for(let ch of chunks([...new Set(ids)].filter(Boolean),50)){let data=await youtube('videos',{part:'snippet,contentDetails,status,liveStreamingDetails',id:ch.join(','),maxResults:50});for(let x of data.items||[]){let s=x.snippet||{},d=isoSeconds(x.contentDetails?.duration);if(d<=180||d>14400)continue;if(x.status?.embeddable===false||x.status?.privacyStatus!=='public')continue;if(s.liveBroadcastContent&&s.liveBroadcastContent!=='none'||x.liveStreamingDetails)continue;if(/(^|[\s#])#?shorts([\s#]|$)/i.test(s.title+' '+s.description))continue;result.push({id:x.id,title:s.title,creator:s.channelTitle,creatorId:s.channelId,duration:d,description:(s.description||'').slice(0,1600),tags:(s.tags||[]).slice(0,16),published:s.publishedAt,categoryId:s.categoryId})}}return result}
async function search(q,count=30){let d=await youtube('search',{part:'snippet',type:'video',q,videoEmbeddable:'true',maxResults:Math.min(50,count),order:'relevance',safeSearch:'moderate'});return (d.items||[]).map(i=>i.id?.videoId).filter(Boolean)}
async function channelRef(str){str=str.trim();let id=(str.match(/(?:youtube\.com\/channel\/)(UC[\w-]+)/)||[])[1];if(id){let d=await youtube('channels',{part:'snippet,contentDetails',id});if(d.items?.length)return d.items[0]}
 let handle=(str.match(/(?:@)([\w.-]+)/)||[])[1];if(handle){let d=await youtube('channels',{part:'snippet,contentDetails',forHandle:handle});if(d.items?.length)return d.items[0]}
 let name=handle||str.replace(/^https?:\/\//,'').split('/').pop();let d=await youtube('search',{part:'snippet',type:'channel',q:name,maxResults:8});let cid=d.items?.find(x=>x.snippet?.title?.toLowerCase()===name.toLowerCase())?.snippet?.channelId||d.items?.[0]?.snippet?.channelId;if(!cid)throw Error('Could not find that YouTube channel. Try its @handle.');d=await youtube('channels',{part:'snippet,contentDetails',id:cid});return d.items?.[0]}
async function uploads(ref,max=100){let c=await channelRef(ref),list=c.contentDetails?.relatedPlaylists?.uploads;if(!list)throw Error('No public uploads playlist for that creator.');let ids=[],page='';do{let d=await youtube('playlistItems',{part:'contentDetails',playlistId:list,maxResults:50,...(page?{pageToken:page}:{})});ids.push(...(d.items||[]).map(x=>x.contentDetails?.videoId).filter(Boolean));page=d.nextPageToken||''}while(page&&ids.length<max);return {creator:c,items:await verify(ids.slice(0,max))}}
function playlistId(u){return u.match(/[?&]list=([A-Za-z0-9_-]+)/)?.[1]||(/^[A-Za-z0-9_-]{12,}$/.test(u)?u:null)}
async function playlistVideos(url){let id=playlistId(url);if(!id)throw Error('Invalid playlist URL: '+url);let ids=[],next='';do{let d=await youtube('playlistItems',{part:'contentDetails',playlistId:id,maxResults:50,...(next?{pageToken:next}:{})});ids.push(...(d.items||[]).map(x=>x.contentDetails?.videoId).filter(Boolean));next=d.nextPageToken||''}while(next&&ids.length<250);return verify(ids)}
// Browser-based semantic recommendation engine (Transformers.js + quantized MiniLM).
// YouTube discovery is official Data API search; this does not access Custom Feeds.
// AI runs ONLY in the admin's browser; published viewers read saved channel schedules.
const STOP=new Set(('a an the of for and or to from with on in as by at it is are be that this those these about into like similar videos video youtube channel make create show watch discussing related content based focus only want some other should more not just please all new old much things stuff etc i you my what would please creators creator series episodes review reviews analysis explained theory theories breakdown retrospective documentary video essay essays reaction opinions discussion discussions lore ranked ranking').split(' '));
const ANCHORS={
 'ben 10':['omnitrix','omniverse','alien force','ultimate alien','alien x','vilgax','kevin levin','gwen tennyson','ben tennyson','four arms','heatblast'],
 'star wars':['jedi','sith','skywalker','clone wars','mandalorian','lightsaber','anakin','ahsoka'],
 'minecraft':['minecraft','creeper','redstone','enderman','nether'],
 'doctor who':['tardis','time lord','dalek','gallifrey'],
 'pokemon':['pokémon','pikachu','pokedex','pokemon','pokédex']
};
function norm(s){return String(s||'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').replace(/\s+/g,' ').trim()}
function words(s){return norm(s).split(' ').filter(w=>(w.length>2||/^\d+$/.test(w))&&!STOP.has(w))}
function contain(s,phrase){let h=' '+norm(s)+' ',p=norm(phrase);return !!p&&h.includes(' '+p+' ')}
function frequency(samples){let counts=new Map();for(let s of samples.slice(0,130)){let ws=words(s.title||'');let seen=new Set();for(let i=0;i<ws.length;i++){let a=ws[i];if(!seen.has(a))counts.set(a,(counts.get(a)||0)+1),seen.add(a);if(i+1<ws.length){let pair=a+' '+ws[i+1];if(!seen.has(pair))counts.set(pair,(counts.get(pair)||0)+2),seen.add(pair)}}}return [...counts].sort((a,b)=>b[1]-a[1])}
function topicProfile(prompt,samples=[],opts={}){
 let explicit=(opts.topic||'').trim();let known=Object.keys(ANCHORS).find(a=>contain(prompt,a));
 let inferred=frequency(samples).find(([term,n])=>n>=4&&term.split(' ').length>1)?.[0]||'';
 // Extract a subject phrase instead of treating opening instructions as the subject.
 let cleaned=String(prompt).replace(/^(?:make|create|build|give me|i want|find|show)\s+(?:me\s+)?(?:a\s+)?(?:youtube\s+)?(?:channel|feed|videos?)\s+(?:about|of|for|on|focused on)?\s*/i,'').trim();
 let quoted=(cleaned.match(/[“"]([^”"]{2,70})[”"]/)||[])[1];
 let firstTopic=quoted||cleaned.split(/[,.;]|\b(?:especially|featuring|including|with|that|similar to)\b/i)[0].trim();
 let anchor=explicit||known||inferred||words(firstTopic).slice(0,4).join(' ');
 let negative=(opts.exclude||'').split(/[,;\n]/).map(x=>norm(x)).filter(Boolean);
 for(let match of String(prompt).matchAll(/(?:avoid|exclude|without|not\s+including)\s+([^.;\n]+)/gi))negative.push(...match[1].split(/,|\band\b/i).map(x=>norm(x)).filter(Boolean));
 let freq=frequency(samples).filter(([term,n])=>n>=3&&!STOP.has(term)).slice(0,12);
 return {anchor:norm(anchor),aliases:ANCHORS[norm(anchor)]||[],negative:[...new Set(negative)],freq,strictness:opts.strictness||'strict',raw:prompt};
}
function queries(p){let a=p.anchor;if(!a)throw Error('Enter a main topic (for example Ben 10), so recommendations have a clear subject.');let q=[a,`${a} explained`,`${a} analysis theories`,`${a} review retrospective`];for(let [topic] of p.freq.slice(0,2)){if(!contain(a,topic)&&topic.length>3)q.push(`${a} ${topic}`)}return [...new Set(q)].slice(0,5)}
// Require actual subject evidence. A semantic match to a generic word must never
// qualify an unrelated video: hard relevance gates and exclusions apply first.
function eligibility(v,p){let title=v.title||'',tags=(v.tags||[]).join(' '),desc=(v.description||'').slice(0,1200);
 let primary=contain(title,p.anchor)||contain(tags,p.anchor)||p.aliases.some(x=>contain(title,x)||contain(tags,x));
 let secondary=contain(desc,p.anchor)||p.aliases.some(x=>contain(desc,x));
 // A clear subject in the description counts too; embeddings decide whether it is truly about that subject.
 if(!primary&&!secondary)return false;
 for(let x of p.negative){if(contain(title,x)||contain(tags,x)||contain(desc,x))return false}
 if(/\b(full episode|full movie|official trailer|reaction|gameplay|walkthrough)\b/i.test(title)&&!/gameplay|reaction|full episodes|trailers/i.test(p.raw))return false;
 return true}
let embeddingPipeline=null,embeddingPromise=null;
async function semanticModel(status=()=>{}){
 if(embeddingPipeline)return embeddingPipeline;
 if(!embeddingPromise){
  embeddingPromise=(async()=>{
   status('Loading free AI model (first run downloads model files; later visits use browser cache)…');
   let library;
   try { library=await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1'); }
   catch (e) { throw Error('Cannot load Transformers.js from jsDelivr ('+e.message+'). Check browser privacy/ad-block settings or network access to cdn.jsdelivr.net.'); }
   const {pipeline,env}=library;
   env.allowLocalModels=false;
   status('AI library loaded. Downloading and initializing the MiniLM model…');
   const model=await pipeline('feature-extraction','Xenova/all-MiniLM-L6-v2',{device:'wasm',dtype:'q8',progress_callback:p=>{
     if(p.status==='progress'&&p.progress!=null)status('Downloading AI model: '+Math.round(p.progress)+'%');
     else if(p.status==='ready')status('AI model ready.');
   }});
   embeddingPipeline=model;
   return model;
  })().catch(e=>{embeddingPromise=null;throw Error('The free AI model could not load. Check internet access and browser extensions, then retry. Details: '+e.message)});
 }
 return embeddingPromise;
}
async function embedTexts(model,texts,status=()=>{}){
 let result=[];
 for(let i=0;i<texts.length;i+=6){
  let batch=texts.slice(i,i+6);
  let tensor=await model(batch,{pooling:'mean',normalize:true});
  let arr=tensor.tolist();
  // 1 input may be [384] in some backends rather than [[384]].
  if(batch.length===1&&typeof arr[0]==='number')arr=[arr];
  result.push(...arr);
  status(`AI analyzing video descriptions: ${Math.min(i+6,texts.length)} / ${texts.length}`);
  await new Promise(resolve=>setTimeout(resolve,0));
 }
 return result;
}
function cosine(a,b){if(!a||!b)return 0;let n=Math.min(a.length,b.length),s=0;for(let i=0;i<n;i++)s+=a[i]*b[i];return s}
function contentText(v){return `${v.title}. ${v.title}. ${String(v.description||'').slice(0,480)}. ${(v.tags||[]).slice(0,10).join(', ')}`.slice(0,1050)}
function pickDiverse(ranked,limit){let groups=new Map();for(let v of ranked){let g=groups.get(v.creatorId)||[];if(g.length<5)g.push(v);groups.set(v.creatorId,g)}let picked=[];while(picked.length<limit){let added=false;for(let g of groups.values()){if(g.length){picked.push(g.shift());added=true;if(picked.length>=limit)break}}if(!added)break}return picked}
async function recommend(prompt,{creator='',existing=[],limit=80,topic='',exclude='',strictness='strict',status=()=>{}}={}){
 let samples=[],excluded=null;
 if(creator){status('Reading reference creator’s public uploads…');let u=await uploads(creator,150);samples=u.items;excluded=u.creator.id}
 let p=topicProfile(prompt,samples,{topic,exclude,strictness});if(!p.anchor)throw Error('Enter a required topic, such as Ben 10, for this channel.');
 status('Searching YouTube for videos about: '+p.anchor+'…');let ids=[],lastError=null,completed=0;
 for(let q of queries(p)){
   try{status(`YouTube search ${completed+1}/${queries(p).length}: ${q}`);ids.push(...await search(q,40))}
   catch(e){lastError=e;if(/quota|API key|accessNotConfigured|forbidden|disabled/i.test(e.message))throw e}
   completed++;
 }
 if(!ids.length)throw lastError||Error('YouTube search returned no videos for: '+p.anchor);
 let unique=[...new Set(ids)];
 status(`Found ${unique.length} possible videos. Checking for normal playable videos…`);
 let verified=await verify(unique.slice(0,240)),used=new Set(existing.map(v=>v.id));
 let candidates=verified.filter(v=>!used.has(v.id)&&v.creatorId!==excluded&&eligibility(v,p));
 if(!candidates.length)throw Error(`YouTube found ${unique.length} candidates, but ${verified.length} passed playback/Shorts/livestream checks and 0 matched your topic (${p.anchor}). Try a simpler Required topic or Balanced mode.`);
 status(`${candidates.length} of ${verified.length} eligible videos match the subject. Starting semantic AI…`);
 // AI is mandatory for recommendation modes: no quiet fallback to old keyword scoring.
 const model=await semanticModel(status);
 const request=`A YouTube video discussing ${p.anchor}. ${prompt||'Thoughtful commentary, analysis, explanations and video essays about the subject.'}`;
 let sourceExamples=samples.filter(v=>eligibility(v,p)).slice(0,10);
 status('Analyzing channel description and creator examples…');
 let anchors=await embedTexts(model,[request,...sourceExamples.map(contentText)],status);
 const aim=anchors[0],exemplars=anchors.slice(1);
 status(`Ranking ${candidates.length} eligible videos with semantic AI…`);
 let embeddings=await embedTexts(model,candidates.map(contentText),status);
 let ranked=candidates.map((v,i)=>{
  let match=cosine(aim,embeddings[i]);
  let example=exemplars.length?Math.max(...exemplars.map(x=>cosine(x,embeddings[i]))):match;
  let subject=contain(v.title,p.anchor)?0.05:p.aliases.some(x=>contain(v.title,x))?0.025:0;
  let score=0.80*match+0.20*example+subject;
  return {...v,fit:Math.min(100,Math.max(0,Math.round(score*100))),_score:score};
 }).sort((a,b)=>b._score-a._score);
 // Relative quality filter prevents weak tail results while avoiding brittle
 // absolute thresholds across topics with different embedding distributions.
 const best=ranked[0]._score;
 const cutoff=Math.max(strictness==='strict'?0.25:0.18,best-(strictness==='strict'?0.16:0.23));
 ranked=ranked.filter(v=>v._score>=cutoff);
 status(`Ranked ${ranked.length} relevant videos. Review before adding them.`);
 return pickDiverse(ranked,limit).map(({_score,...v})=>v);
}
function shuffle(arr){for(let i=arr.length-1;i>0;i--){let j=Math.floor(Math.random()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]]}return arr}
function videoIdFromUrl(raw){try{let u=new URL(raw.trim());if(u.hostname==='youtu.be'||u.hostname==='www.youtu.be')return /^[A-Za-z0-9_-]{11}$/.test(u.pathname.slice(1))?u.pathname.slice(1):null;if(!/(^|\.)youtube\.com$/.test(u.hostname)&&!/(^|\.)youtube-nocookie\.com$/.test(u.hostname))return null;let id=u.searchParams.get('v')||u.pathname.match(/^\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{11})/)?.[1];return /^[A-Za-z0-9_-]{11}$/.test(id||'')?id:null}catch{return /^[A-Za-z0-9_-]{11}$/.test(raw.trim())?raw.trim():null}}
function parseSeedLinks(txt){return [...new Set(String(txt||'').split(/[\s,]+/).map(videoIdFromUrl).filter(Boolean))]}
function importedSeedIds(){return [...new Set([...seedImported.map(v=>v.id),...parseSeedLinks($('seedLinks').value)])]}
function updateSeedStatus(){let imported=seedImported.length,linked=parseSeedLinks($('seedLinks').value).length;$('seedStatus').textContent=`${imported} videos loaded from file • ${linked} videos entered as links • ${importedSeedIds().length} unique reference IDs. Exported feed files remain in your browser session until saved as a channel.`}
$('seedFile').onchange=async e=>{try{const file=e.target.files?.[0];if(!file)return;if(file.size>4_000_000)throw Error('File exceeds the 4 MB import limit.');let d=JSON.parse(await file.text());const list=Array.isArray(d)?d:d.videos||d.items||d.recommendations;if(!Array.isArray(list))throw Error('File does not contain a videos array.');seedImported=list.map(x=>({id:videoIdFromUrl(x.id||x.url||x.videoId||''),title:String(x.title||'').slice(0,200),creator:String(x.creator||'').slice(0,100)})).filter(x=>x.id);if(!seedImported.length)throw Error('No valid YouTube video IDs in this feed file.');updateSeedStatus();seedPreview=null;renderSeedPreview([])}catch(err){$('seedStatus').textContent='Import error: '+err.message}};
$('seedLinks').oninput=()=>{updateSeedStatus();seedPreview=null;renderSeedPreview([])};
// The Companion reads only video cards actually displayed on the signed-in
// YouTube page. The creator works without it using a feed JSON or pasted links.
let companionRequestCount=0, companionPending=new Map();
function companionRequest(type, opts={}) {
  const requestId='ytg107-'+(++companionRequestCount)+'-'+Date.now();
  return new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{companionPending.delete(requestId);reject(Error('No reply from Feed Companion. Check that the extension is installed, enabled, and that you reloaded this Guide tab.'))},7000+(opts.steps||0)*1000);
    companionPending.set(requestId,{resolve,reject,timeout});
    window.postMessage({source:'youtube-guide-site',type,requestId,feedName:opts.feedName||'',steps:opts.steps||0,prompt:opts.prompt||''},location.origin);
  });
}
window.addEventListener('message',evt=>{
 if(evt.source!==window||evt.origin!==location.origin)return;
 const d=evt.data;
 if(d?.source!=='youtube-guide-extension'||d.type!=='YTG_REPLY'||!companionPending.has(d.requestId))return;
 const req=companionPending.get(d.requestId);companionPending.delete(d.requestId);clearTimeout(req.timeout);
 d.ok?req.resolve(d):req.reject(Error(d.error||'Feed Companion failed'));
});
function incorporateFeed(d){
 const videos=Array.isArray(d.videos)?d.videos:[];
 const parsed=videos.map(v=>({id:videoIdFromUrl(v.id||v.url||''),title:String(v.title||'').slice(0,220),creator:String(v.creator||'').slice(0,120)})).filter(v=>v.id);
 if(!parsed.length)throw Error('No videos were captured. Select your Custom Feed on YouTube and try Capture + scroll.');
 seedImported=[...new Map([...seedImported,...parsed].map(v=>[v.id,v])).values()];
 seedPreview=null;renderSeedPreview([]);updateSeedStatus();
 $('seedStatus').textContent=`Loaded ${parsed.length} actual YouTube recommendations from ${d.feedName||'your Custom Feed'}. ${importedSeedIds().length} unique examples are ready for programming.`;
 return parsed.length;
}
async function invokeCompanion(type,steps=0){
 const button=$(type==='YTG_CAPTURE_FEED'?'captureYouTubeFeed':'syncYouTubeFeed');
 button.disabled=true;
 const feedName=$('feedName').value.trim()||$('name').value.trim()||'My Custom Feed';
 $('seedStatus').textContent=type==='YTG_CAPTURE_FEED'?'Capturing the YouTube Custom Feed open in another browser tab…':'Reading your saved Custom Feed recommendations…';
 try{
   const d=await companionRequest(type,{feedName,steps});
   incorporateFeed(d);
   if(type==='YTG_CAPTURE_FEED')$('seedStatus').textContent+=` Captured ${d.scanned} cards, including ${d.added} new videos. ${d.scanned===0?'Check that your Custom Feed is selected on YouTube.':''}`;
 }catch(err){$('seedStatus').textContent='Feed Companion: '+err.message}finally{button.disabled=false}
}
$('openYouTubeCreator').onclick=async()=>{
 const button=$('openYouTubeCreator'),feedName=$('feedName').value.trim()||$('name').value.trim()||'My Custom Feed';
 const prompt=$('youtubeFeedPrompt').value.trim();
 if(!prompt){$('seedStatus').textContent='Enter the prompt you want YouTube itself to use for its Custom Feed.';return}
 button.disabled=true;$('seedStatus').textContent='Opening YouTube’s real Custom Feed creator…';
 try{await companionRequest('YTG_OPEN_CUSTOM_FEED',{feedName,prompt});$('seedStatus').textContent='YouTube opened. Create the Custom Feed in your signed-in YouTube account, then use the extension helper to capture it. Return here and choose Import captured YouTube feed.'}
 catch(e){$('seedStatus').textContent='Companion: '+e.message}
 finally{button.disabled=false}
};
$('captureYouTubeFeed').onclick=()=>invokeCompanion('YTG_CAPTURE_FEED',8);
$('syncYouTubeFeed').onclick=()=>invokeCompanion('YTG_GET_FEED');

// A Guide-owned, prompt-driven feed. Does not query YouTube's private
// Custom Feeds service. Prompt + (optional) examples jointly define relevance.
function representativeSearches(seeds,prompt=''){
 const clean=String(prompt||'').replace(/^(make|create|build|give me|i want|show me|find me|recommend)\s+/i,'').split(/\b(?:without|exclude|avoid|but not)\b/i)[0].trim();
 const meaningful=clean.split(/[\s,;]+/).map(norm).filter(w=>(w.length>2||/^\d+$/.test(w))&&!STOP.has(w)&&!['videos','video','youtube','feed','channel','about'].includes(w));
 let terms=[];if(meaningful.length)terms.push(meaningful.slice(0,8).join(' '));
 if(clean.includes(',')||/\b(?:including|especially|featuring)\b/i.test(clean)){
  for(const portion of clean.split(/[,;]|\b(?:including|especially|featuring)\b/i)){
   const segment=words(portion).slice(0,6).join(' ');if(segment)terms.push(segment);
  }
 }
 const counts=new Map(),pairs=new Map();
 const ignore=new Set(['the','and','for','with','from','into','this','that','about','video','videos','review','explained','analysis','part','what','why','how','you','your','are','was','its','best','top','every','all','new','official','episode','full','reaction','watch','most','one','not','have','more','over','series','history','ranked','ranking']);
 for(const v of seeds){let ws=norm(v.title).split(' ').filter(x=>x.length>2&&!ignore.has(x));for(const x of new Set(ws))counts.set(x,(counts.get(x)||0)+1);for(let i=0;i<ws.length-1;i++){const x=ws[i]+' '+ws[i+1];pairs.set(x,(pairs.get(x)||0)+1)}}
 const frequent=[...pairs].filter(([_,n])=>n>=2).sort((a,b)=>b[1]-a[1]).map(x=>x[0]);
 const anchors=[...counts].filter(([_,n])=>n>=2).sort((a,b)=>b[1]-a[1]).map(x=>x[0]);
 terms.push(...frequent.slice(0,4));
 const main=terms[0]||anchors.slice(0,3).join(' ')||words(seeds[0]?.title||'').slice(0,5).join(' ');
 if(main)terms.push(main,...anchors.slice(0,5).filter(w=>!main.split(' ').includes(w)).map(w=>main+' '+w));
 if(main)terms.push(main+' discussion',main+' retrospective',main+' explained');
 return [...new Set(terms.filter(x=>x.length>2).map(x=>x.slice(0,85)))].slice(0,18);
}
function feedLexical(v,prompt,seeds){
 const p=new Set(words(prompt).filter(w=>!['create','videos','youtube','about','want','feed'].includes(w)));
 const vt=new Set(words(v.title)),vd=new Set(words(v.title+' '+(v.description||'').slice(0,500)));
 const relevance=p.size?0.65*[...p].filter(w=>vt.has(w)).length/p.size+0.2*[...p].filter(w=>vd.has(w)).length/p.size:0;
 const refs=seeds.map(s=>{let r=new Set(words(s.title));return r.size?2*[...r].filter(w=>vt.has(w)).length/(r.size+vt.size||1):0}).sort((a,b)=>b-a).slice(0,4);
 return relevance+(refs.length?0.35*refs.reduce((a,b)=>a+b,0)/refs.length:0);
}
async function recommendFromSeeds(c,{existing=[],status=()=>{},searchCount=2}={}){
 const ids=[...new Set(c.seedIds||[])];const prompt=String(c.feedPrompt||c.youtubeFeedPrompt||c.prompt||'').trim();
 if(!ids.length&&!prompt)throw Error('Describe your feed or add example videos.');
 status(ids.length?`Checking ${ids.length} optional example videos…`:'Building your feed from its description…');
 const seeds=ids.length?await verify(ids.slice(0,120)):[];
 if(!seeds.length&&!prompt)throw Error('None of the example videos are available. Add a written description so the feed can discover alternatives.');
 const queries=representativeSearches(seeds,prompt);
 if(!queries.length)throw Error('Could not infer a search topic. Write a more specific feed description.');
 const round=Number(c.discoveryCount||0);
 const searchPlan=Array.from({length:Math.min(searchCount,queries.length)},(_,i)=>queries[(round+i)%queries.length]);
 status(`Exploring ${searchPlan.length} topics based on your feed description and examples…`);
 let found=[],fail=null;
 for(let i=0;i<searchPlan.length;i++){
  status(`Searching YouTube ${i+1}/${searchPlan.length}: ${searchPlan[i]}`);
  try{found.push(...await search(searchPlan[i],50))}
  catch(e){fail=e;if(/quota|API key|disabled|forbidden/i.test(e.message))throw e}
 }
 if(!found.length)throw fail||Error('YouTube returned no candidates. Try a more specific prompt.');
 const forbidden=new Set([...ids,...existing.map(v=>v.id),...(c.rejectedIds||[])]);
 let candidates=(await verify([...new Set(found)].slice(0,160))).filter(v=>!forbidden.has(v.id));
 const excluded=[...(c.seedExclude||'').split(/[;,]/),...[...prompt.matchAll(/\b(?:without|exclude|avoid|but not)\s+([^.;]+)/gi)].flatMap(x=>x[1].split(/,|\band\b/i))].map(norm).filter(Boolean);
 candidates=candidates.filter(v=>!excluded.some(n=>contain(v.title,n)||contain(v.description,n)||contain((v.tags||[]).join(' '),n)));
 if(!candidates.length){status('No new playable videos this time; the previous three-day lineup will keep airing.');return {seeds,suggestions:[],queries:searchPlan}}
 status(`Ranking ${candidates.length} candidates by what your channel is about…`);
 let promptVector=null,refVectors=[],vectors=[];
 let fallback=false;
 try{
  const model=await semanticModel(status);
  const descriptions=[...(prompt?[`A YouTube video about: ${prompt}.`]:[]),...seeds.slice(0,24).map(contentText)];
  const reference=await embedTexts(model,descriptions,status);
  if(prompt)promptVector=reference.shift();
  refVectors=reference;
  vectors=await embedTexts(model,candidates.map(contentText),status);
 }catch(e){fallback=true;status('Semantic model unavailable. Using stricter keyword matching for this search: '+e.message.slice(0,140))}
 let scored=candidates.map((v,i)=>{
  const lex=feedLexical(v,prompt,seeds);
  const semanticPrompt=promptVector?cosine(promptVector,vectors[i]):0;
  const exemplar=refVectors.length?refVectors.map(r=>cosine(r,vectors[i])).sort((a,b)=>b-a).slice(0,4):[];
  const exampleScore=exemplar.length?exemplar.reduce((a,b)=>a+b,0)/exemplar.length:0;
  const sem=(promptVector&&refVectors.length)?(.65*semanticPrompt+.35*exampleScore):(promptVector?semanticPrompt:exampleScore);
  const score=fallback?lex:.8*sem+.2*lex;
  return {...v,fit:Math.round(Math.min(1,Math.max(0,score))*100),_score:score,_semantic:sem,_lexical:lex};
 }).filter(v=>fallback?v._lexical>=(c.seedStrictness==='balanced'?.15:.24):v._semantic>=(c.seedStrictness==='balanced'?.43:.49)).sort((a,b)=>b._score-a._score);
 // General terms can attract irrelevant videos. Enforce evidence for a concise
 // explicit subject in prompt-only feeds, even when embeddings score highly.
 const subject=words(prompt).filter(w=>!['only','focused','explanations','analysis','theories','discussing','essays','commentary'].includes(w));
 if(subject.length&&subject.length<=3&&!seeds.length){scored=scored.filter(v=>subject.some(w=>words(contentText(v)).includes(w)))}
 const picked=pickDiverse(scored,100).map(({_score,_semantic,_lexical,...v})=>v);
 status(`Found ${picked.length} ranked candidates for your channel.${fallback?' AI unavailable; keyword fallback used.':''}`);
 return {seeds,suggestions:picked,queries:searchPlan};
}
let seedPreviewSignature=()=>JSON.stringify({ids:importedSeedIds(),prompt:$('youtubeFeedPrompt').value.trim(),strictness:$('seedStrictness').value,exclude:$('seedExclude').value,include:$('includeSeeds').checked});
function renderSeedPreview(items){let p=$('seedReview');p.classList.toggle('hidden',!items?.length);$('seedReviewItems').innerHTML=(items||[]).map(v=>`<label class="review-video"><input data-seed-review="${escapeHtml(v.id)}" type="checkbox" checked><span><strong>${escapeHtml(v.title)}</strong><small>${escapeHtml(v.creator||'YouTube creator')} • ${Math.round(v.duration/60)} min • AI match ${v.fit??'—'}%</small></span></label>`).join('');$('seedReviewCount').textContent=items?.length?`${items.length} selected`:''}
$('seedReviewItems').onchange=e=>{if(!seedPreview||!e.target.matches('[data-seed-review]'))return;let id=e.target.dataset.seedReview;e.target.checked?seedPreview.rejected.delete(id):seedPreview.rejected.add(id);$('seedReviewCount').textContent=`${seedPreview.suggestions.length-seedPreview.rejected.size} selected`};
$('previewSeeds').onclick=async()=>{const btn=$('previewSeeds');btn.disabled=true;try{let config={seedIds:importedSeedIds(),feedPrompt:$('youtubeFeedPrompt').value.trim(),seedExclude:$('seedExclude').value,seedStrictness:$('seedStrictness').value};let result=await recommendFromSeeds(config,{status:s=>$('seedProgress').textContent=s});seedPreview={...result,signature:seedPreviewSignature(),rejected:new Set()};renderSeedPreview(result.suggestions);$('seedProgress').textContent=`${result.seeds.length} optional examples • ${result.suggestions.length} ranked suggestions. Uncheck irrelevant results; rejected IDs will not be recommended again.`}catch(e){seedPreview=null;renderSeedPreview([]);$('seedProgress').textContent='Could not find recommendations: '+e.message}finally{btn.disabled=false}};
async function generate(c,status=()=>{}){
 let items=[];
 if(c.mode==='seeds'){
  const ids=(c.seedIds||[]).slice(0,200);
  const seeds=ids.length?await verify(ids):[];
  if(c.includeSeeds)items=seeds;
  status('Finding videos that fit your custom channel description…');
  const results=await recommendFromSeeds(c,{existing:items,status,searchCount:2});
  items.push(...results.suggestions);
  if(!items.length)throw Error('No playable matches were found yet. Try a clearer description or add example video links.');
 }else if(c.mode==='creatorMulti'){
  for(let creator of c.sourceCreators||[])items.push(...(await uploads(creator,150)).items);
 }else if(c.mode==='prompt')items=await recommend(c.prompt,{existing:[],topic:c.topic,exclude:c.exclude,strictness:c.strictness,status});
 else if(c.mode==='similar')items=await recommend(c.prompt||'video essays analysis reviews lore', {creator:c.sourceChannel,existing:[],topic:c.topic,exclude:c.exclude,strictness:c.strictness,status});
 else if(c.mode==='creator')items=(await uploads(c.sourceChannel,200)).items;
 else if(c.mode==='playlist'||c.mode==='multi'){for(let url of c.playlists)items.push(...await playlistVideos(url))}
 items=items.filter((v,i)=>items.findIndex(x=>x.id===v.id)===i);
 if(c.order==='shuffle')shuffle(items);
 return items;
}
function formData(){return {name:$('name').value.trim(),number:Number($('number').value),category:$('category').value.trim(),mode:$('mode').value,prompt:$('prompt').value.trim(),sourceChannel:$('sourceChannel').value.trim(),playlists:$('playlists').value.split('\n').map(s=>s.trim()).filter(Boolean),order:$('order').value,topic:$('topic').value.trim(),exclude:$('exclude').value.trim(),strictness:$('strictness').value,seedIds:importedSeedIds(),approximateDiscovery:true,feedPrompt:$('youtubeFeedPrompt').value.trim(),youtubeFeedPrompt:$('youtubeFeedPrompt').value.trim(),feedName:$('feedName').value.trim(),seedStrictness:$('seedStrictness').value,seedExclude:$('seedExclude').value,includeSeeds:$('includeSeeds').checked,sourceCreators:$('sourceCreators').value.split('\n').map(s=>s.trim()).filter(Boolean)}}
function validate(c){if(!c.name||!c.category||!Number.isInteger(c.number)||c.number<1)throw Error('Enter a name, number and category.');if(channels.some(x=>x.id!==editing&&x.number===c.number))throw Error('That channel number is already taken.');if(c.mode==='seeds'&&!c.seedIds.length&&!c.feedPrompt)throw Error('Describe your channel or add at least one example video.');if(c.mode==='creatorMulti'&&!c.sourceCreators.length)throw Error('Enter one or more YouTube creators.');if(c.mode==='prompt'&&!c.prompt)throw Error('Describe what the recommendation channel should show.');if(['similar','creator'].includes(c.mode)&&!c.sourceChannel)throw Error('Enter a YouTube creator @handle or URL.');if(['playlist','multi'].includes(c.mode)&&!c.playlists.length)throw Error('Add at least one public playlist URL.');}
const closeDialogs=()=>document.querySelectorAll('dialog[open]').forEach(d=>d.close());document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
$('adminOpen').onclick=()=>{(admin?$('adminDialog'):$('loginDialog')).showModal()};
$('loginForm').onsubmit=e=>{e.preventDefault();if($('password').value!=='1234'){$('loginError').textContent='Incorrect PIN.';return}admin=true;$('password').value='';$('loginError').textContent='';$('loginDialog').close();$('adminDialog').showModal()};
$('logout').onclick=()=>{admin=false;debugActive=false;debugOverride=null;$('debugPanel').classList.add('hidden');$('adminDialog').close()};
$('saveKey').onclick=()=>{apiKey=$('apiKey').value.trim();if(!apiKey){$('adminMessage').textContent='Please enter a key.';return}localStorage.setItem(KEY,apiKey);$('apiKey').value='';$('adminMessage').textContent='YouTube API key saved in this browser.'};
function modeFields(){let mode=$('mode').value;document.querySelectorAll('.mode-card').forEach(b=>{let active=b.dataset.mode===mode;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active))});$('seedField').classList.toggle('hidden',mode!=='seeds');$('creatorsField').classList.toggle('hidden',mode!=='creatorMulti');$('promptField').classList.toggle('hidden',!['prompt','similar'].includes(mode));$('creatorField').classList.toggle('hidden',!['creator','similar'].includes(mode));$('playlistField').classList.toggle('hidden',!['playlist','multi'].includes(mode));$('recommendControls').classList.toggle('hidden',!['prompt','similar'].includes(mode))}
function openEditor(c=null){editing=c?.id||null;$('editorTitle').textContent=c?'EDIT CHANNEL':'CREATE CHANNEL';$('name').value=c?.name||'';$('number').value=c?.number||Math.max(101,...channels.map(x=>x.number+1));$('category').value=c?.category||'Animation';let editorMode=['seeds','creatorMulti','playlist','multi'].includes(c?.mode)?c.mode:'seeds';$('mode').value=editorMode;seedImported=(c?.seedIds?.length?c.seedIds:(c&&editorMode==='seeds'?(c.videos||[]).map(v=>v.id):[])).map(id=>({id}));$('seedLinks').value='';$('seedFile').value='';$('youtubeFeedPrompt').value=c?.feedPrompt||c?.youtubeFeedPrompt||'';$('approximateDiscovery').checked=true;$('feedName').value=c?.feedName||c?.name||'';$('seedExclude').value=c?.seedExclude||'';$('seedStrictness').value=c?.seedStrictness||'strict';$('includeSeeds').checked=c?c.includeSeeds!==false:true;$('sourceCreators').value=(c?.sourceCreators||[]).join('\n');seedPreview=null;renderSeedPreview([]);updateSeedStatus();$('prompt').value=c?.prompt||'';$('topic').value=c?.topic||'';$('exclude').value=c?.exclude||'';$('strictness').value=c?.strictness||'strict';previewCache=null;renderPreview([]);$('sourceChannel').value=c?.sourceChannel||'';$('playlists').value=(c?.playlists||[]).join('\n');$('order').value=c?.order||'shuffle';$('submitChannel').textContent=c?'Save Changes':'Generate & Save Channel';$('createError').textContent='';modeFields();$('adminDialog').close();$('createDialog').showModal()}
$('create').onclick=()=>openEditor();$('edit').onclick=()=>{let c=channels.find(x=>x.id===$('manageChannel').value);if(c)openEditor(c)};$('mode').onchange=modeFields;document.querySelectorAll('.mode-card').forEach(b=>b.addEventListener('click',()=>{$('mode').value=b.dataset.mode;modeFields();seedPreview=null;renderSeedPreview([])}));
for(let id of ['prompt','topic','exclude','strictness','sourceChannel','mode'])$(id).addEventListener('input',()=>{if(previewCache){previewCache=null;renderPreview([]);$('previewStatus').textContent='Settings changed. Run Analyze & Review again to use the new settings.'}});
async function autoPublish(){if(!github.owner||!github.repo||!token)return;try{await publish();$('adminMessage').textContent+=' Published to GitHub.'}catch(e){$('adminMessage').textContent+=' Local save succeeded. GitHub publishing failed: '+e.message}}

let previewCache=null;
function renderPreview(items){let panel=$('reviewPanel'),list=$('reviewItems');panel.classList.toggle('hidden',!items.length);if(!items.length){list.innerHTML='';$('previewStatus').textContent='';return}
 list.innerHTML=items.map(v=>`<label class="review-video"><input type="checkbox" data-preview-id="${escapeHtml(v.id)}" checked><span><strong>${escapeHtml(v.title)}</strong><small>${escapeHtml(v.creator)} · ${Math.round(v.duration/60)} min${Number.isFinite(v.fit)?' · AI match '+v.fit+'%':''}</small></span></label>`).join('');
 function update(){let total=items.length,kept=total-previewCache.rejected.size;$('reviewCount').textContent=`${kept} of ${total} selected`}
 list.onchange=e=>{if(!previewCache||!e.target.matches('[data-preview-id]'))return;let id=e.target.dataset.previewId;e.target.checked?previewCache.rejected.delete(id):previewCache.rejected.add(id);update()};update();}
$('previewRecommendations').onclick=async()=>{let b=$('previewRecommendations'),c=formData();if(!['prompt','similar'].includes(c.mode))return;b.disabled=true;$('previewStatus').textContent='Searching YouTube and loading semantic AI…';
 try{if(!c.prompt&&c.mode==='prompt')throw Error('Describe the videos you want.');if(c.mode==='similar'&&!c.sourceChannel)throw Error('Enter the reference creator.');let videos=await generate(c,msg=>$('previewStatus').textContent=msg);previewCache={signature:JSON.stringify(c),videos,rejected:new Set()};renderPreview(videos);$('previewStatus').textContent=videos.length?`Found ${videos.length} candidate programs. Uncheck any that do not belong, then save the channel.`:'No sufficiently relevant videos found. Try a clearer required topic or balanced mode.';
 }catch(e){previewCache=null;renderPreview([]);$('previewStatus').textContent=e.message}finally{b.disabled=false}}

$('createForm').onsubmit=async e=>{e.preventDefault();let b=$('submitChannel');b.disabled=true;$('createError').textContent='';let value=formData();try{validate(value);let original=channels.find(x=>x.id===editing),same=original&&original.mode===value.mode&&original.prompt===value.prompt&&original.sourceChannel===value.sourceChannel&&JSON.stringify(original.playlists)===JSON.stringify(value.playlists)&&original.order===value.order&&original.topic===value.topic&&original.exclude===value.exclude&&original.strictness===value.strictness&&JSON.stringify(original.seedIds||[])===JSON.stringify(value.seedIds||[])&&JSON.stringify(original.sourceCreators||[])===JSON.stringify(value.sourceCreators||[])&&original.feedPrompt===value.feedPrompt&&original.youtubeFeedPrompt===value.youtubeFeedPrompt&&original.feedName===value.feedName&&original.seedStrictness===value.seedStrictness&&original.seedExclude===value.seedExclude&&original.includeSeeds===value.includeSeeds;let signature=JSON.stringify(value),items=same?original.videos:value.mode==='seeds'&&seedPreview?.signature===seedPreviewSignature()?[...(value.includeSeeds?seedPreview.seeds:[]),...seedPreview.suggestions.filter(v=>!seedPreview.rejected.has(v.id))]:previewCache?.signature===signature?previewCache.videos.filter(v=>!previewCache.rejected.has(v.id)):await generate(value,msg=>$('createError').textContent=msg);if(!items.length)throw Error('No eligible programs found. Try a more specific feed description, or import example videos.');let c={...value,id:editing||'ch_'+crypto.randomUUID(),anchor:same?original.anchor:now(),rejectedIds:[...new Set([...(original?.rejectedIds||[]),...(seedPreview?.signature===seedPreviewSignature()?[...seedPreview.rejected]:[])])],videos:items,pendingVideos:same?original.pendingVideos:undefined,activateAt:same?original.activateAt:undefined};if(!same){c.schedule=makeSchedule(c,now());}else{c.schedule=original.schedule;c.nextSchedule=original.nextSchedule;c.lastRefreshAt=original.lastRefreshAt;}
channels=editing?channels.map(x=>x.id===editing?c:x):[...channels,c];saveLocal();$('createDialog').close();chosen=c.id;tune(c.id);$('adminMessage').textContent=`Saved ${items.length} programs to ${c.name}.`;await autoPublish();}catch(err){$('createError').textContent=err.message}finally{b.disabled=false;b.textContent=editing?'Save Changes':'Generate & Save Channel'}};
$('extend').onclick=async()=>{let c=channels.find(x=>x.id===$('manageChannel').value);if(!c)return;let btn=$('extend');btn.disabled=true;$('adminMessage').textContent='Finding eligible videos…';try{let videos=[];if(c.mode==='seeds'){let r=await recommendFromSeeds(c,{existing:c.videos,status:s=>$('adminMessage').textContent=s});videos=r.suggestions}else if(c.mode==='creatorMulti'){for(let ref of c.sourceCreators||[])videos.push(...(await uploads(ref,200)).items);let ids=new Set(c.videos.map(v=>v.id));videos=videos.filter((v,i)=>!ids.has(v.id)&&videos.findIndex(x=>x.id===v.id)===i)}else if(c.mode==='prompt'||c.mode==='similar')videos=await recommend(c.prompt||'video analysis',{creator:c.mode==='similar'?c.sourceChannel:'',existing:c.videos,limit:80,topic:c.topic,exclude:c.exclude,strictness:c.strictness,status:msg=>$('adminMessage').textContent=msg});else if(c.mode==='creator'){let fresh=(await uploads(c.sourceChannel,200)).items;let ids=new Set(c.videos.map(v=>v.id));videos=fresh.filter(v=>!ids.has(v.id))}else{let all=await generate(c),ids=new Set(c.videos.map(v=>v.id));videos=all.filter(v=>!ids.has(v.id))}if(c.order==='shuffle')shuffle(videos);if(videos.length){const base=c.pendingVideos?.length?c.pendingVideos:c.videos;c.pendingVideos=[...base,...videos];c.activateAt=cycleStart(c,now())+CYCLE_MS;}saveLocal();$('adminMessage').textContent=videos.length?`Queued ${videos.length} new programs for the next 3-day rotation. The current schedule is unchanged.`:'No new qualifying videos found; the existing 3-day schedule will repeat.';await autoPublish()}catch(e){$('adminMessage').textContent=e.message}finally{btn.disabled=false}};
$('remove').onclick=async()=>{let id=$('manageChannel').value;if(!id||!confirm('Delete this channel?'))return;channels=channels.filter(x=>x.id!==id);if(chosen===id){chosen=channels[0]?.id||null;loadedId='';overlay('Channel deleted','Select a channel to watch.',true)}saveLocal();$('adminMessage').textContent='Channel deleted locally.';await autoPublish()};
// Optional GitHub Contents API integration for publishing. No token is included in site files or shared JSON.
function persistGitHub(){localStorage.setItem(GITHUB,JSON.stringify(github));$('githubMessage').textContent=github.owner&&github.repo?`Configured ${github.owner}/${github.repo} (${github.branch||'main'}). You can publish channels globally when you supply a token.`:'No GitHub repository connected.'}
$('saveGitHub').onclick=()=>{github={owner:$('ghOwner').value.trim(),repo:$('ghRepo').value.trim(),branch:$('ghBranch').value.trim()||'main'};token=$('ghToken').value.trim()||token;if(token)sessionStorage.setItem('youtube-guide-github-token',token);$('ghToken').value='';persistGitHub()};
function githubPath(){if(!github.owner||!github.repo)throw Error('Connect a GitHub repository first.');return `https://api.github.com/repos/${encodeURIComponent(github.owner)}/${encodeURIComponent(github.repo)}/contents/YouTube-Guide/channels.json`}
async function gitRequest(method='GET',body){let r=await fetch(githubPath()+(method==='GET'?`?ref=${encodeURIComponent(github.branch||'main')}`:''),{method,headers:{Accept:'application/vnd.github+json',...(token?{Authorization:'Bearer '+token}:{}),'X-GitHub-Api-Version':'2022-11-28',...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});let d=await r.json();if(!r.ok){let e=Error(d.message||'GitHub API error '+r.status);e.status=r.status;throw e}return d}
function encode64(s){let bytes=new TextEncoder().encode(s),binary='';for(let b of bytes)binary+=String.fromCharCode(b);return btoa(binary)}
function decode64(s){let binary=atob(s.replace(/\s/g,'')),bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));return new TextDecoder().decode(bytes)}
async function publish(){if(!token)throw Error('A GitHub repository token is required for publishing.');let sha;try{sha=(await gitRequest()).sha}catch(e){if(e.status!==404)throw e}let payload={message:'Update YouTube Guide channel lineup',content:encode64(JSON.stringify({version:3,scheduleSchemaVersion:1,scheduleHorizonHours:100,refreshIntervalHours:72,updatedAt:new Date().toISOString(),channels},null,2)),branch:github.branch||'main',...(sha?{sha}:{})};await gitRequest('PUT',payload);}
$('publishGitHub').onclick=async()=>{try{await publish();$('githubMessage').textContent='Channel library committed to GitHub. Public Pages updates may take a few minutes.'}catch(e){$('githubMessage').textContent=e.message}};
async function pull(){let d=await gitRequest();let data=JSON.parse(decode64(d.content));if(!Array.isArray(data.channels))throw Error('channels.json is not a channel library');channels=data.channels;saveLocal();if(!chosen&&channels.length)chosen=channels[0].id}
$('pullGitHub').onclick=async()=>{try{await pull();$('githubMessage').textContent='Loaded published channels.'}catch(e){$('githubMessage').textContent=e.message}};
async function loadPublic(){await refreshPublic()}
// Ordinary visitors consume identical published channel data. No visitor ever
// performs write operations or independently generates a public schedule.
let lastPublicStamp='';
async function refreshPublic(){
 try{let r=await fetch('./channels.json?ts='+Math.floor(now()/60000),{cache:'no-store'});
 if(!r.ok)return;let raw=await r.text();if(raw===lastPublicStamp)return;
 let d=JSON.parse(raw);if(!Array.isArray(d.channels))return;
 lastPublicStamp=raw;
 // Locally-created channels remain editable until they are published; after
 // publication all viewers (including admins) receive the shared library.
 if(d.channels.length||d.updatedAt){channels=d.channels;saveLocal();if(!selected()){chosen=channels[0]?.id||null;loadedId='';} }
 }catch(e){console.warn('Public channel refresh unavailable:',e.message)}
}
function init(){try{channels=JSON.parse(localStorage.getItem(STORE)||'[]');if(!Array.isArray(channels))channels=[]}catch{channels=[]}guideStart=Math.floor(now()/1800000)*1800000;$('ghOwner').value=github.owner||'';$('ghRepo').value=github.repo||'';$('ghBranch').value=github.branch||'main';persistGitHub();draw();loadPublic().then(()=>{if(selected())overlay('Ready to tune',`Choose WATCH LIVE to join channel ${selected().number} at its current broadcast time.`,true);else overlay('Welcome to YouTube Guide','Admin Options → 1234 → configure YouTube API and create a channel.',true)});setInterval(tick,1000);setInterval(refreshPublic,60000);setInterval(()=>{let start=Math.floor(now()/1800000)*1800000;if(guideStart===start-1800000)guideStart=start;guide()},30000)}
init();
