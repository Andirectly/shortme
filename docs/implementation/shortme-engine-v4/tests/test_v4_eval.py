"""Synthetic unit tests ONLY; no actual claim of Shortme highlight quality."""
import importlib.util
import unittest
from pathlib import Path
R=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('v4_eval',R/'tools'/'v4_eval.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class EvalTests(unittest.TestCase):
    def setUp(self):
        self.gold={'sources':[{'sha256':'abc','creator':'c','session':'s','events':[{'id':'gold1','start':20,'end':50,'peak':36,'allowedStart':[18,30],'allowedEnd':[45,60]}]}]}
    def test_good_clip_matches(self):
        p={'clips':[{'engineId':'engine4','sourceSha256':'abc','runKind':'full-source-analysis','eventId':'a','start':22,'end':52,'rank':1}]}
        r=m.evaluate(self.gold,p)['results']['engine4']
        self.assertEqual(r['matchedEvents'],1)
        self.assertEqual(r['bothBoundaryAtMatched'],1.0)
    def test_recheck_cannot_cheat_recall(self):
        p={'clips':[{'engineId':'engine4','sourceSha256':'abc','runKind':'clip-recheck','eventId':'a','start':22,'end':52,'rank':1}]}
        self.assertEqual(m.evaluate(self.gold,p)['results']['engine4']['matchedEvents'],0)
    def test_negative_prediction_wrong_time(self):
        p={'clips':[{'engineId':'engine4','sourceSha256':'abc','runKind':'full-source-analysis','eventId':'a','start':90,'end':110,'rank':1}]}
        self.assertEqual(m.evaluate(self.gold,p)['results']['engine4']['microTemporalMatchPrecisionProxyAtK'],0)
if __name__=='__main__':unittest.main()
