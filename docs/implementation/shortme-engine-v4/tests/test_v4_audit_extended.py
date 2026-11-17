"""Guard against specific defects found in the 16 Nov 2026 audit.

These tests exercise only the acceptance tooling. They are NOT engine E2E tests.
"""
import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('gate4audit',ROOT/'tools'/'v4_gate.py')
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ExtendedAuditTests(unittest.TestCase):
    def _proof(self, root, dual=False):
        run=root/'projects/p/analysis/runs/r4'
        run.mkdir(parents=True)
        src=root/'input.mp4';out=root/'result.mp4'
        src.write_bytes(b'SOURCE'*400);out.write_bytes(b'OUTPUT'*400)
        sh=hashlib.sha256(src.read_bytes()).hexdigest()
        oh=hashlib.sha256(out.read_bytes()).hexdigest()
        (run/'manifest.json').write_text(json.dumps({'runId':'r4','engineId':'engine4','source':{'sha256':sh}}))
        calls=[]
        def add(role,modalities, group=None, sha=None):
            t=f'trace_{len(calls)}.json'
            (run/t).write_text(json.dumps({'role':role,'modalities':modalities,'sha':sha}))
            c={'role':role,'success':True,'modelRevision':'test-rev','realInputModalities':modalities,'tracePath':t}
            if group:
                c.update(windowId='window-a',verificationGroupId=group)
            if sha:c['inputArtifactSha256']=sha
            calls.append(c)
        add('asr',['audio']);add('audio_event',['audio']);add('video_embedding',['video'])
        add('local_cut_judge',['video','audio'])
        if dual:
            add('av_verification_video',['video'],'av-1')
            add('av_verification_audio',['audio'],'av-1')
            add('rendered_output_judge_video',['video'],'output-1',oh)
            add('rendered_output_judge_audio',['audio'],'output-1',oh)
        else:
            add('av_verification',['video','audio'])
            add('rendered_output_judge',['video','audio'],sha=oh)
        return {'engineId':'engine4','runId':'r4','runKind':'full-source-analysis',
            'runManifestAbsolutePath':str(run/'manifest.json'),
            'sourceSha256':sh,'outputSha256':oh,
            'sourceMediaAbsolutePath':str(src),'outputMediaAbsolutePath':str(out),
            'sourceProbe':{'durationSeconds':100,'streams':['video','audio']},
            'outputProbe':{'durationSeconds':30,'streams':['video','audio']},
            'eventIds':['e'],'clipIds':['c'],'judgementIds':['j'],
            'modelCalls':calls,'renderedArtifactJudged':True,
            'coverage':[{'lane':lane,'status':'inspected','startSeconds':i*10,'endSeconds':(i+1)*10}
                     for lane in ['speech','audio','visual'] for i in range(10)]}

    def test_real_run_proof_standard_av_valid(self):
        with tempfile.TemporaryDirectory() as tmp:
            r=Path(tmp)
            with patch.object(module,'ffprobe_actual',side_effect=[{'durationSeconds':100,'streams':['video','audio']},{'durationSeconds':30,'streams':['video','audio']}]):
                self.assertEqual(module.verify_media_proof(r,self._proof(r)),[])

    def test_real_run_proof_dual_av_valid(self):
        with tempfile.TemporaryDirectory() as tmp:
            r=Path(tmp)
            with patch.object(module,'ffprobe_actual',side_effect=[{'durationSeconds':100,'streams':['video','audio']},{'durationSeconds':30,'streams':['video','audio']}]):
                self.assertEqual(module.verify_media_proof(r,self._proof(r,dual=True)),[])

    def test_missing_source_decile_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            r=Path(tmp); proof=self._proof(r)
            proof['coverage']=[x for x in proof['coverage'] if x['startSeconds']<90]
            self.assertTrue(any('10 source deciles' in x for x in module.verify_media_proof(r,proof)))

    def test_trace_outside_run_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            r=Path(tmp); proof=self._proof(r)
            proof['modelCalls'][0]['tracePath']=str(r/'input.mp4')
            self.assertTrue(any('missing trace' in x for x in module.verify_media_proof(r,proof)))

    def test_quality_gate_no_false_pass_without_dataset(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(len(module.audit_quality_evidence(Path(tmp))),4)

    def test_final_schema_has_ten_distinct_required_criteria(self):
        data=json.loads((ROOT/'schemas/final_judge.schema.json').read_text())
        criteria=data['properties']['criteria']
        self.assertEqual(criteria['minItems'],10)
        self.assertEqual(criteria['maxItems'],10)
        self.assertEqual(len(criteria['allOf']),10)
        self.assertEqual(data['properties']['evaluatedRenderedOutput'],{'const':True})

if __name__=='__main__': unittest.main()
