"""No-network tests for independent prompt feeds, topical filters and fallback."""
import unittest
import feed_engine as f
import update_channels as r


def vid(id,title,description='',creator='Cartoon Analyst'):
    return {'id':id,'title':title,'description':description,
            'creator':creator,'creatorId':creator,'duration':1800,'tags':[]}


class PromptFeedTests(unittest.TestCase):
    def test_queries_are_based_on_prompt_without_examples(self):
        queries=f.query_plan('Videos discussing Ben 10 aliens, Omnitrix lore and fan theories. Avoid gameplay',[])
        self.assertTrue(queries)
        self.assertTrue(any('ben' in q and 'lore' in q for q in queries))
        self.assertFalse(any('gameplay' in q for q in queries))

    def test_queries_use_seed_concepts(self):
        seeds=[vid('1','Ben 10 Alien X explained'),vid('2','Ben 10 Alien Force characters'),vid('3','Ben 10 Alien Force lore')]
        q=f.query_plan('',seeds)
        self.assertTrue(any('ben' in s or 'alien' in s for s in q))

    def test_negative_topics_and_subject_gate(self):
        c={'feedPrompt':'Ben 10 character theories, without gameplay', 'seedStrictness':'strict','seedExclude':'reaction'}
        self.assertFalse(f.allowed(vid('a','Ben 10 gameplay secrets'),c,[]))
        self.assertFalse(f.allowed(vid('b','Ben 10 reaction compilation'),c,[]))
        self.assertTrue(f.allowed(vid('c','Ben 10 character theories','Omnitrix aliens'),c,[]))

    def test_no_unrelated_title_in_lexical_mode(self):
        c={'feedPrompt':'Ben 10 alien lore', 'seedStrictness':'strict'}
        candidates=[vid('good','Ben 10 alien lore explained'),
                    vid('bad','Top ten places to visit for vacation'),
                    vid('bad2','Cooking delicious pasta with cheese')]
        ranked=f.rank(c,[],candidates,use_model=False)
        self.assertEqual([v['id'] for v in ranked],['good'])

    def test_rejected_ids_never_return(self):
        c={'feedPrompt':'Ben 10 alien lore', 'seedStrictness':'balanced','rejectedIds':['no']}
        candidates=[vid('yes','Ben 10 alien lore explained'),vid('no','Ben 10 alien lore part two')]
        self.assertEqual([v['id'] for v in f.rank(c,[],candidates,use_model=False)],['yes'])

    def test_prompt_only_backend_refresh(self):
        c={'id':'prompt','number':12,'mode':'seeds','feedPrompt':'Ben 10 alien lore',
            'seedIds':[],'videos':[vid('old','Ben 10 Alien lore explained')]}
        old_api,old_meta,old_rank=r.api,r.video_metadata,r.rank
        try:
            seen=[]
            def fake_api(resource,**kwargs):
                self.assertEqual(resource,'search')
                seen.append(kwargs['q'])
                return {'items':[{'id':{'videoId':'NEWID'}}]}
            r.api=fake_api
            r.video_metadata=lambda ids:[vid('NEWID','Ben 10 theories Omnitrix lore')]
            r.rank=lambda channel,seeds,videos,limit:videos
            new,reason=r.refresh_recommendations(c)
            self.assertEqual(new[0]['id'],'NEWID')
            self.assertTrue(seen[0])
            self.assertEqual(c['discoveryCount'],1)
        finally:
            r.api,r.video_metadata,r.rank=old_api,old_meta,old_rank

    def test_refresh_rotation(self):
        channel={'feedPrompt':'Ben 10 alien lore and theories','seedIds':[],
                 'discoveryCount':1,'videos':[]}
        old_api,old_meta,old_rank=r.api,r.video_metadata,r.rank
        try:
            plans=[]
            r.api=lambda resource,**params:(plans.append((params['q'],params['order'])) or {'items':[]})
            r.video_metadata=lambda ids:[]
            r.rank=lambda channel,seeds,videos,limit:[]
            for _ in range(5):r.refresh_recommendations(channel)
            self.assertGreater(len(set(q for q,order in plans)),1)
            self.assertIn('date',[o for q,o in plans])
        finally:r.api,r.video_metadata,r.rank=old_api,old_meta,old_rank

    def test_refresh_budget(self):
        self.assertGreaterEqual(r.MAX_RECOMMENDATION_SEARCHES,67)
        self.assertLessEqual(r.MAX_RECOMMENDATION_SEARCHES,100)

if __name__=='__main__':unittest.main()
