const fs=require('fs'),assert=require('assert');
const script=fs.readFileSync(__dirname+'/../YouTube-Guide/app.js','utf8');
const code=script.substring(script.indexOf('const CYCLE_MS'),script.indexOf('function draw()'));
const fn=new Function('now','duration',code+'; return {at,cycleStart,cycleVideos,channelStatus}')(()=>0,c=>c.videos.reduce((sum,v)=>sum+v.duration,0));
const T=72*3600*1000;
const videos=Array.from({length:10},(_,i)=>({id:'V'+i,duration:2000}));
const c={id:'c1',anchor:0,mode:'seeds',order:'shuffle',videos};
for(const stamp of [0,1000,60*60000,T-1,T,T+1000,7*T+5000]) {
 assert(fn.at(c,stamp)?.video?.id,'video missing at '+stamp);
 assert(fn.at(c,stamp).end<=fn.cycleStart(c,stamp)+T,'program extends beyond boundary');
}
assert.deepStrictEqual(fn.cycleVideos(c,0).map(x=>x.id),fn.cycleVideos(c,0).map(x=>x.id),'same schedule across viewers');
assert.notDeepStrictEqual(fn.cycleVideos(c,0).map(x=>x.id),fn.cycleVideos(c,T).map(x=>x.id),'fresh order each 3 days');
assert.deepStrictEqual(fn.cycleVideos(c,0).map(x=>x.id),fn.cycleVideos(c,0).map(x=>x.id));
c.pendingVideos=[{id:'NEW',duration:1000}];c.activateAt=T;
assert(fn.cycleVideos(c,T-1000).every(v=>v.id!=='NEW'));
assert.strictEqual(fn.cycleVideos(c,T)[0].id,'NEW');
assert.strictEqual(fn.cycleVideos(c,2*T)[0].id,'NEW');
const ordered={id:'p',anchor:0,order:'ordered',videos};
assert.deepStrictEqual(fn.cycleVideos(ordered,0),videos,'ordered playlist stays ordered');
console.log('PASS: schedule generates fresh deterministic 72h shuffle, repeats offline, stages at cycle boundary and honors ordered playlists');
