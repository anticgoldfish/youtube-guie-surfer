import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('refresh',Path(__file__).with_name('update_channels.py'))
r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)

class RefreshTests(unittest.TestCase):
    def channel(self,mode='seeds'):
        return {'id':'ch-14','mode':mode,'number':14,'anchor':0,'order':'shuffle','videos':[{'id':'OLD','title':'Old program','duration':1800}], 'seedIds':['SEED'], 'playlists':['https://www.youtube.com/playlist?list=PLtest12345678'], 'sourceChannel':'@Example','sourceCreators':['@Example']}
    def test_seed_recommendations_stage_next_cycle(self):
        c=self.channel();orig=r.refresh_recommendations
        try:
            r.refresh_recommendations=lambda x:([{'id':'NEW','title':'New program','duration':1800}],'searched')
            r.refresh_one(c,1000)
            self.assertEqual([v['id'] for v in c['videos']],['OLD'])
            self.assertEqual([v['id'] for v in c['pendingVideos']],['OLD','NEW'])
            self.assertEqual(c['activateAt'],1000)  # No prior EPG: start immediately
        finally:r.refresh_recommendations=orig
    def test_no_discovery_repeats_and_stages(self):
        c=self.channel();orig=r.refresh_recommendations
        try:
            r.refresh_recommendations=lambda x:([],'nothing')
            r.refresh_one(c,1000)
            self.assertEqual([v['id'] for v in c['pendingVideos']],['OLD'])
            self.assertEqual(c['activateAt'],1000)  # No prior EPG: start immediately
        finally:r.refresh_recommendations=orig
    def test_playlist_updates_and_removed_items(self):
        c=self.channel('playlist');orig=r.refresh_source
        try:
            r.refresh_source=lambda x:([{'id':'A','duration':1900},{'id':'B','duration':1900}],'playlist')
            r.refresh_one(c,1000)
            self.assertEqual([v['id'] for v in c['pendingVideos']],['A','B'])
        finally:r.refresh_source=orig
    def test_creator_new_upload(self):
        c=self.channel('creatorMulti');orig=r.refresh_source
        try:
            r.refresh_source=lambda x:([{'id':'NEW-UPLOAD','duration':2200}],'creator')
            r.refresh_one(c,1000)
            self.assertEqual(c['pendingVideos'][0]['id'],'NEW-UPLOAD')
        finally:r.refresh_source=orig
    def test_failure_keeps_old_pool(self):
        c=self.channel('creator');orig=r.refresh_source
        try:
            def fail(_):raise RuntimeError('API unavailable')
            r.refresh_source=fail
            with self.assertRaises(RuntimeError):r.refresh_one(c,1000)
            self.assertEqual(c['videos'][0]['id'],'OLD')
            self.assertNotIn('pendingVideos',c)
        finally:r.refresh_source=orig
    def test_promote_after_boundary(self):
        c=self.channel();c['pendingVideos']=[{'id':'NEW','duration':1900}];c['activateAt']=r.CYCLE_MS
        self.assertTrue(r.promote_if_due(c,r.CYCLE_MS))
        self.assertEqual(c['videos'][0]['id'],'NEW')
        self.assertNotIn('pendingVideos',c)
    def test_playlist_url(self):
        self.assertEqual(r.extract_playlist('https://youtube.com/watch?v=123&list=PLabc123456789'), 'PLabc123456789')

if __name__=='__main__':unittest.main()
