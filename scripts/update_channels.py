#!/usr/bin/env python3
"""Refresh independent three-day channel pools using the official YouTube Data API.

GitHub Actions periodically stages new pools. Every browser creates a deterministic
new 72h play order; when an API operation fails it continues using its previous pool.
No channel shares discoveries with another.
"""
import datetime as dt
import json
import os
from pathlib import Path
from feed_engine import query_plan, rank
from schedule_engine import CYCLE_MS, HORIZON_MS, build_schedule, refresh_due, next_cycle
import random
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'YouTube-Guide' / 'channels.json'
MAX_RECOMMENDATION_SEARCHES = max(0, min(90, int(os.environ.get('CHANNEL_SEARCHES_PER_RUN', '90'))))
MAX_SOURCE_CHANNELS = max(0, min(250, int(os.environ.get('SOURCE_CHANNELS_PER_RUN', '250'))))
def configured_youtube_key():
    key = os.environ.get('YOUTUBE_API_KEY', '').strip()
    if key:
        return key
    html = ROOT / 'YouTube-Guide' / 'index.html'
    try:
        page = html.read_text(encoding='utf-8')
        match = re.search(r'window\.YOUTUBE_GUIDE_SETTINGS\s*=\s*(\{[^;]+\})\s*;', page)
        if match:
            return str(json.loads(match.group(1)).get('youtubeApiKey', '')).strip()
    except (OSError, ValueError):
        pass
    return ''

API_KEY = configured_youtube_key()
STOP = set('the and that from this with your video videos review reviews analysis explained overview theory ranking ranked best most about what how why the new one all official full episode episodes trailer part reaction shorts'.split())

def api(resource, **args):
    url = 'https://www.googleapis.com/youtube/v3/' + resource + '?' + urllib.parse.urlencode({'key': API_KEY, **args})
    req = urllib.request.Request(url, headers={'User-Agent': 'YouTubeGuide/1.0'})
    with urllib.request.urlopen(req, timeout=25) as resp:
        return json.load(resp)

def chunks(items, size=50):
    for i in range(0, len(items), size):
        yield items[i:i+size]

def tokens(value):
    return [t for t in re.findall(r'[a-z0-9]+', str(value or '').lower()) if len(t) > 2 and t not in STOP]

def seconds(iso):
    match = re.fullmatch(r'P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?', str(iso or ''))
    if not match:
        return 0
    return sum(int(x or 0)*unit for x,unit in zip(match.groups(), (86400,3600,60,1)))

def video_metadata(ids):
    result=[]
    for group in chunks(list(dict.fromkeys(v for v in ids if v))[:350]):
        d=api('videos',part='snippet,contentDetails,status,liveStreamingDetails',id=','.join(group))
        for it in d.get('items',[]):
            sn=it.get('snippet',{}); status=it.get('status',{}); cd=it.get('contentDetails',{})
            duration=seconds(cd.get('duration'))
            if not (180 < duration <= 14400 and status.get('embeddable') is True):
                continue
            if status.get('privacyStatus') != 'public' or it.get('liveStreamingDetails') or sn.get('liveBroadcastContent','none')!='none':
                continue
            if '#shorts' in sn.get('title','').lower() or '#shorts' in sn.get('description','')[:600].lower():
                continue
            result.append({'id':it['id'], 'title':sn.get('title','Untitled'),
                           'creator':sn.get('channelTitle','YouTube'), 'creatorId':sn.get('channelId',''),
                           'duration':duration, 'description':sn.get('description','')[:1000],
                           'published':sn.get('publishedAt',''), 'tags':sn.get('tags',[])[:16]})
    return result

def list_playlist(identifier, limit=300):
    ids=[]; page=''
    while len(ids)<limit:
        args={'part':'contentDetails','playlistId':identifier,'maxResults':50}
        if page:args['pageToken']=page
        d=api('playlistItems',**args)
        ids.extend(i.get('contentDetails',{}).get('videoId') for i in d.get('items',[]))
        page=d.get('nextPageToken','')
        if not page:break
    return [x for x in ids[:limit] if x]

def extract_playlist(value):
    text=str(value or '').strip()
    result=re.search(r'[?&]list=([A-Za-z0-9_-]+)',text)
    return result.group(1) if result else text if re.fullmatch('[A-Za-z0-9_-]{12,}',text) else None

def creator_id(value):
    value=str(value or '').strip()
    match=re.search(r'(UC[A-Za-z0-9_-]{22})',value)
    if match:return match.group(1)
    match=re.search(r'@([A-Za-z0-9_.-]+)',value)
    if match:
        d=api('channels',part='contentDetails',forHandle=match.group(1))
    else:
        # Text-only lookup is approximate, but saved @handles and /channel/ links are exact.
        d=api('search',part='snippet',type='channel',q=value,maxResults=1)
        ids=[x.get('snippet',{}).get('channelId') for x in d.get('items',[])]
        return ids[0] if ids else None
    return d.get('items',[{}])[0].get('id') if d.get('items') else None

def creator_uploads(value):
    cid=creator_id(value)
    if not cid:return []
    d=api('channels',part='contentDetails',id=cid)
    if not d.get('items'):return []
    pid=d['items'][0].get('contentDetails',{}).get('relatedPlaylists',{}).get('uploads')
    return list_playlist(pid,250) if pid else []

def refresh_recommendations(channel):
    """Discover and rerank independent results for a prompt and/or seed examples.

    One YouTube search per recommendation-channel refresh. The number of
    channels is discovered dynamically from channels.json, never assumed.
    """
    ids=list(dict.fromkeys(channel.get('seedIds') or []))
    prompt=str(channel.get('feedPrompt') or channel.get('youtubeFeedPrompt') or channel.get('prompt') or '').strip()
    if not ids and not prompt:return [],'no feed description or reference videos'
    refs=video_metadata(ids[:50]) if ids else []
    if ids and not refs and not prompt:return [],'reference videos not publicly available'
    variants=query_plan(prompt,refs)
    if not variants:return [],'no useful topics inferred from the feed'
    iteration=int(channel.get('discoveryCount') or 0)
    query=variants[iteration%len(variants)]
    # Alternate recent-result retrieval with relevance for a changing feed;
    # semantic filtering removes off-topic search results.
    ordering='date' if iteration%4==3 else 'relevance'
    d=api('search',part='snippet',type='video',videoEmbeddable='true',
          safeSearch='moderate',q=query,maxResults=50,order=ordering)
    candidates=video_metadata([x.get('id',{}).get('videoId') for x in d.get('items',[])])
    known={v.get('id') for v in (channel.get('videos') or [])+(channel.get('pendingVideos') or [])}
    known.update(ids)
    eligible=[v for v in candidates if v['id'] not in known]
    profile={**channel,'feedPrompt':prompt}
    ranked=rank(profile,refs,eligible,limit=35)
    channel['discoveryCount']=iteration+1
    return ranked,f'searched "{query}" ({ordering}); {len(eligible)} playable new candidates, {len(ranked)} relevant'

def refresh_source(channel):
    mode=channel.get('mode')
    if mode in ('playlist','multi'):
        urls=(channel.get('playlists') or [])
        if mode=='playlist':urls=urls[:1]
        if not urls:return [],'no playlist URLs'
        ids=[]
        for url in urls:
            pid=extract_playlist(url)
            if not pid:raise ValueError('invalid playlist URL: '+str(url))
            ids.extend(list_playlist(pid))
        return video_metadata(list(dict.fromkeys(ids))[:350]),'refreshed playlist contents'
    if mode in ('creator','creatorMulti'):
        refs=(channel.get('sourceCreators') or []) if mode=='creatorMulti' else [channel.get('sourceChannel','')]
        if not refs:return [],'no creator references'
        ids=[]
        for ref in refs:ids.extend(creator_uploads(ref))
        return video_metadata(list(dict.fromkeys(ids))[:350]),'refreshed creator uploads'
    return [],'unsupported source'

def promote_if_due(channel,now_ms):
    if channel.get('pendingVideos') and now_ms >= int(channel.get('activateAt') or 0):
        channel['videos']=channel.pop('pendingVideos')
        channel.pop('activateAt',None)
        if channel.get('nextSchedule'):
            channel['schedule']=channel.pop('nextSchedule')
        return True
    return False

def stage(channel,new_items,now_ms,source=False):
    # Preserve the active cycle until the boundary. A viewer gets the new lineup
    # only when the next 72-hour slot starts.
    current=channel.get('pendingVideos') or channel.get('videos') or []
    if source:
        # Playlist membership/removal and creator uploads reflected on each refresh.
        pool=list(dict((v['id'],v) for v in new_items).values())
    else:
        pool=list(dict((v['id'],v) for v in current+new_items).values())[-500:]
    # Never go blank if a source becomes private, YouTube errors, or returns empty.
    if not pool:pool=current
    if not pool:return False
    anchor=int(channel.get('anchor') if channel.get('anchor') is not None else now_ms)
    # Extend continuously from the end of the currently published EPG.
    # Starting strictly at a 72h boundary could create a gap after a 100h EPG.
    current_end=int((channel.get('schedule') or {}).get('end') or 0)
    next_start=max(now_ms, current_end)
    channel['pendingVideos']=pool
    channel['activateAt']=next_start
    channel['nextSchedule']=build_schedule(channel, pool, next_start)
    return True

def refresh_one(channel,now_ms):
    promote_if_due(channel,now_ms)
    mode=channel.get('mode')
    if mode=='seeds':
        new,detail=refresh_recommendations(channel)
        source=False
    else:
        new,detail=refresh_source(channel)
        source=True
    stage(channel,new,now_ms,source=source)
    channel['lastDiscoveryAt']=now_ms
    return detail+f'; {len(new)} eligible programs; upcoming uninterrupted schedule staged'

def refresh_staggered(data, now_ms, force=False, api_available=True):
    """Every half hour, replenish whichever *existing* channels are low on airtime.

    New channels are initialized at creation; this is proactive replenishment,
    not a fixed-size round-robin.  Failed discovery reuses cached programs.
    """
    channels=data.get('channels') or []
    # Promote already active staged content even if the channel is not due for discovery.
    promoted=sum(bool(promote_if_due(c,now_ms)) for c in channels)
    due=[c for c in channels if c.get('videos') and refresh_due(c,now_ms,force)]
    attempted=0
    updated=0
    searches=0
    sources=0
    for c in due:
        # A real quota guard across all channels processed in this run. If quota
        # is exhausted, continue to create a 100-hour cached rerun schedule.
        mode=c.get('mode')
        is_recommendation=mode=='seeds'
        budget_ok=(searches < MAX_RECOMMENDATION_SEARCHES if is_recommendation
                   else sources < MAX_SOURCE_CHANNELS)
        attempted+=1
        promote_if_due(c,now_ms)
        if api_available and budget_ok:
            try:
                if is_recommendation: searches+=1
                else: sources+=1
                print('CH',c.get('number'),refresh_one(c,now_ms))
            except Exception as err:
                print('CH',c.get('number'),'YouTube refresh failed, reusing cached programming:',err,file=sys.stderr)
                stage(c,[],now_ms,source=False)
        else:
            print('CH',c.get('number'),'Discovery unavailable or request budget exhausted; keeping reruns')
            stage(c,[],now_ms,source=False)
        if c.get('nextSchedule'):
            updated+=1
        # Ensure the active EPG is usable even if discovery was unavailable.
        if not c.get('schedule') and c.get('videos'):
            c['schedule']=build_schedule(c,c['videos'],now_ms)
        c['lastRefreshAt']=now_ms
    if attempted or promoted:
        data['updatedAt']=dt.datetime.fromtimestamp(now_ms/1000,dt.timezone.utc).isoformat()
        data['scheduleSchemaVersion']=1
        data['scheduleHorizonHours']=100
        data['refreshIntervalHours']=72
    return attempted,updated


def main():
    if not DATA.exists():
        print('No channels.json: no channels to refresh')
        return
    data=json.loads(DATA.read_text(encoding='utf-8'))
    now_ms=int(dt.datetime.now(dt.timezone.utc).timestamp()*1000)
    force=os.environ.get('FORCE_CHANNEL_REFRESH','').strip()=='1'
    old_data=json.dumps(data,sort_keys=True)
    attempted,updated=refresh_staggered(data,now_ms,force=force,api_available=bool(API_KEY))
    if json.dumps(data,sort_keys=True)!=old_data:
        DATA.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(f'Slot refreshed {attempted} channels; staged >=100h EPG for {updated}. '
          f'Next check in 30 minutes; due channels selected by airtime remaining. API key present: {bool(API_KEY)}.')

if __name__=='__main__':main()
