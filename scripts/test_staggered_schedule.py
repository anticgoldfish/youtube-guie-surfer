import unittest
from unittest.mock import patch
from schedule_engine import (HALF_HOUR_MS,CYCLE_MS,HORIZON_MS,build_schedule,
                             refresh_due,channel_slot,EARLY_REPLENISH_MS,URGENT_REPLENISH_MS)
import update_channels as updater

class AdaptiveScheduleTests(unittest.TestCase):
    def channel(self, n=1, mode='seeds', start=0):
        c={'id':f'c{n}','number':n,'mode':mode,'anchor':start,'order':'shuffle',
           'seedIds':['SEED'],'videos':[{'id':'OLD','duration':1800,'title':'Old program'}]}
        c['schedule']=build_schedule(c,c['videos'],start)
        return c

    def test_100_hours_exact_and_contiguous(self):
        c=self.channel()
        epg=c['schedule']
        self.assertEqual(epg['end']-epg['start'],HORIZON_MS)
        self.assertGreaterEqual(len(epg['programs']),200)
        self.assertEqual(epg['programs'][0]['start'],epg['start'])
        self.assertEqual(epg['programs'][-1]['end'],epg['end'])
        self.assertTrue(all(a['end']==b['start'] for a,b in zip(epg['programs'],epg['programs'][1:])))

    def test_channel_count_not_assumed(self):
        channels=[self.channel(i) for i in [6, 28, 801]]
        self.assertTrue(all(0<=channel_slot(c)<48 for c in channels))
        self.assertFalse(any(refresh_due(c,0) for c in channels))

    def test_newly_created_missing_schedule_due(self):
        c=self.channel()
        c.pop('schedule')
        self.assertTrue(refresh_due(c,0))

    def test_replenish_before_airtime_runs_out(self):
        c=self.channel()
        self.assertFalse(refresh_due(c,47*3600000))
        # With only 28 hours left, always replenish even after a missed slot.
        self.assertTrue(refresh_due(c,72*3600000))
        self.assertTrue(refresh_due(c,99*3600000))

    def test_30_minute_stagger_within_24h(self):
        c=self.channel()
        eligible=[]
        for tick in range(48*2,72*2):
            when=tick*HALF_HOUR_MS
            if refresh_due(c,when):eligible.append(when)
        self.assertTrue(eligible)
        self.assertTrue(all(48*3600000<=t<=72*3600000 for t in eligible))

    def test_staggered_run_stages_new_programs(self):
        c=self.channel()
        when=72*3600000
        with patch.object(updater,'refresh_recommendations',return_value=([{'id':'NEW','duration':3000}], 'mock discovery')):
            attempts,count=updater.refresh_staggered({'channels':[c]},when,api_available=True)
        self.assertEqual((attempts,count),(1,1))
        self.assertIn('NEW',[v['id'] for v in c['pendingVideos']])
        self.assertEqual(c['nextSchedule']['durationHours'],100)
        self.assertEqual(c['activateAt'],100*3600000)  # Append to the existing 100h EPG

    def test_offline_run_still_builds_100_hours(self):
        c=self.channel()
        attempts,count=updater.refresh_staggered({'channels':[c]},72*3600000,api_available=False)
        self.assertEqual((attempts,count),(1,1))
        self.assertEqual(c['nextSchedule']['programs'][0]['videoId'],'OLD')

    def test_playlist_new_video_on_refresh(self):
        c=self.channel(1,'playlist');c['playlists']=['PLtest12345678']
        with patch.object(updater,'refresh_source',return_value=([{'id':'NEW','duration':2400}], 'updated playlist')):
            updater.refresh_staggered({'channels':[c]},72*3600000,api_available=True)
        self.assertEqual([v['id'] for v in c['pendingVideos']],['NEW'])

    def test_staged_schedule_prevents_repeated_requests(self):
        c=self.channel()
        updater.refresh_staggered({'channels':[c]},72*3600000,api_available=False)
        self.assertFalse(refresh_due(c,73*3600000))

if __name__=='__main__':unittest.main()
