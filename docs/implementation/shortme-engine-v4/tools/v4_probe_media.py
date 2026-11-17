#!/usr/bin/env python3
"""Create *media-only* ffprobe+SHA receipts. DOES NOT claim V4 models ran."""
import argparse
import hashlib
import json
import shutil
import subprocess
from pathlib import Path


def sha(p):
    h=hashlib.sha256()
    with p.open('rb') as f:
        for chunk in iter(lambda:f.read(4*1024*1024),b''):h.update(chunk)
    return h.hexdigest()


def probe(path):
    if not shutil.which('ffprobe'): raise RuntimeError('ffprobe not installed')
    cmd=['ffprobe','-v','error','-show_entries','format=duration:stream=codec_type,codec_name,start_time','-of','json',str(path)]
    p=subprocess.run(cmd,check=True,capture_output=True,text=True,timeout=120)
    data=json.loads(p.stdout)
    return {'durationSeconds':float(data['format']['duration']),
            'streams':[x['codec_type'] for x in data.get('streams',[])],
            'streamDetails':data.get('streams',[]), 'ffprobeCommand':cmd}


def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--source',required=True)
    ap.add_argument('--output',required=True)
    ap.add_argument('--run-id',required=True)
    ap.add_argument('--run-manifest',help='absolute path to existing engine4 project run manifest, not a substitute for real tracing')
    ap.add_argument('--out',required=True)
    a=ap.parse_args()
    source=Path(a.source).resolve(); output=Path(a.output).resolve()
    if not source.is_file() or not output.is_file(): raise SystemExit('ERROR source/output not found')
    receipt={
      'engineId':'engine4','runKind':'full-source-analysis','runId':a.run_id,
      'runManifestAbsolutePath':str(Path(a.run_manifest).resolve()) if a.run_manifest else '',
      'sourceMediaAbsolutePath':str(source),'outputMediaAbsolutePath':str(output),
      'sourceSha256':sha(source),'outputSha256':sha(output),
      'sourceProbe':probe(source),'outputProbe':probe(output),
      # Deliberately incomplete: Claude must fill from real Shortme run logs.
      'eventIds':[], 'clipIds':[], 'judgementIds':[], 'modelCalls':[],
      'coverage':[],'renderedArtifactJudged':False,
      'note':'Media probing only. Not an AI/E2E test. Real traces required.'
    }
    out=Path(a.out); out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(json.dumps(receipt,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
    print('Wrote media-only proof (intentionally insufficient for V4 Gate):',out)

if __name__=='__main__': main()
