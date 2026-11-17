#!/usr/bin/env python3
"""Strict receipt auditor for Shortme Engine 4 implementation.

This is NOT an inference test or a certification. It fails closed for missing
code/tests/media evidence. It deliberately never runs arbitrary test commands.
"""
import argparse
import hashlib
import json
import sys
import subprocess
import shutil
import math
from collections import Counter
from pathlib import Path

SPEC = Path(__file__).resolve().parents[1] / 'requirements' / 'v4_requirements.json'
SPEC_SHA256 = '75ab594df21630d196969a402332691b74af3fa2f3058f74236eb50e7265fed2'
STATES = {'pending','in_progress','blocked','failed','passed'}
SOURCE_SUFFIX = {'.ts','.tsx','.js','.jsx','.mjs','.cjs','.py','.rs','.cpp','.h','.c','.cs','.sql','.go','.sh','.ps1'}
TEST_SUFFIX = SOURCE_SUFFIX | {'.yml','.yaml'}


def get_json(p: Path):
    if p.resolve() == SPEC.resolve() and hashlib.sha256(p.read_bytes()).hexdigest() != SPEC_SHA256:
        raise ValueError('V4 requirements list changed; do not shrink or rewrite the contract to pass')
    with p.open(encoding='utf-8') as f:
        return json.load(f)


def write_json(p: Path, obj):
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(p.suffix + '.tmp')
    tmp.write_text(json.dumps(obj, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    tmp.replace(p)


def contained_file(root: Path, path: str, *, suffixes=None, forbid_package=True):
    if not isinstance(path,str) or not path or Path(path).is_absolute():
        return False
    target = (root / path).resolve()
    if not target.is_relative_to(root) or not target.is_file() or target.stat().st_size == 0:
        return False
    if suffixes and target.suffix.lower() not in suffixes:
        return False
    if forbid_package and '/docs/implementation/shortme-engine-v4/' in ('/' + target.relative_to(root).as_posix() + '/'):
        return False
    return True


def _media_trace_file(run_dir: Path, path_value):
    """Run traces live in the user's project directory, not the source repo."""
    if not isinstance(path_value, str) or not path_value:
        return None
    path = Path(path_value)
    path = (path if path.is_absolute() else run_dir / path).resolve()
    if not path.is_relative_to(run_dir.resolve()) or not path.is_file() or path.stat().st_size == 0:
        return None
    return path


def _modality_ok(call, required):
    return bool(isinstance(call, dict) and call.get('success') is True and
                required.issubset(set(call.get('realInputModalities') or [])))


def _dual_pair(calls, video_role, audio_role):
    """Two truly separate observers may jointly verify the *same* synchronized window.

    A single audio-only model or transcript-based placeholder cannot stand in for AV.
    """
    videos=[c for c in calls if c.get('role')==video_role and _modality_ok(c,{'video'})]
    audios=[c for c in calls if c.get('role')==audio_role and _modality_ok(c,{'audio'})]
    return any(v.get('windowId') and v.get('windowId')==a.get('windowId') and
               v.get('verificationGroupId') and v.get('verificationGroupId')==a.get('verificationGroupId')
               for v in videos for a in audios)


def _sampled_deciles(windows, duration):
    """Check temporal spread, not merely a single sample in the final 10%."""
    if duration <= 0:
        return False
    for idx in range(10):
        low,high=idx*duration/10,(idx+1)*duration/10
        if not any(isinstance(w.get('startSeconds'),(int,float)) and
                   isinstance(w.get('endSeconds'),(int,float)) and
                   w['startSeconds'] >= 0 and w['startSeconds'] < w['endSeconds'] <= duration+0.01 and
                   w['startSeconds'] < high and w['endSeconds'] > low for w in windows):
            return False
    return True



def ffprobe_actual(path: Path):
    """Independently re-probe the actual file; do not trust model-supplied receipts."""
    if shutil.which('ffprobe') is None:
        raise RuntimeError('ffprobe executable missing on this machine')
    result=subprocess.run(['ffprobe','-v','error','-show_entries','format=duration:stream=codec_type',
                           '-of','json',str(path)],capture_output=True,text=True,timeout=90,check=True)
    raw=json.loads(result.stdout)
    return {'durationSeconds':float(raw['format']['duration']),
            'streams':[s['codec_type'] for s in raw.get('streams',[]) if 'codec_type' in s]}

def verify_media_proof(repo: Path, proof: dict):
    """Strict *receipt lint*, not an independent observation of ML execution."""
    errors=[]
    if not isinstance(proof,dict):
        return ['run proof missing/invalid']
    for key in ['runId','sourceSha256','outputSha256','sourceMediaAbsolutePath','outputMediaAbsolutePath']:
        if not proof.get(key): errors.append('run proof missing '+key)
    if proof.get('engineId') != 'engine4': errors.append('run proof wrong engineId')
    if proof.get('runKind') != 'full-source-analysis': errors.append('run proof is not a full source run')
    run_manifest_value=proof.get('runManifestAbsolutePath')
    run_dir=None
    if not isinstance(run_manifest_value,str) or not Path(run_manifest_value).is_absolute():
        errors.append('runManifestAbsolutePath must be an absolute existing project-run manifest path')
    else:
        run_manifest=Path(run_manifest_value).resolve()
        if not run_manifest.is_file():
            errors.append('real project-run manifest missing')
        else:
            run_dir=run_manifest.parent
            try:
                manifest=json.loads(run_manifest.read_text(encoding='utf8'))
                if manifest.get('runId')!=proof.get('runId') or manifest.get('engineId')!='engine4':
                    errors.append('run manifest does not match engine4 runId')
                source=manifest.get('source',{})
                if source.get('sha256',manifest.get('sourceSha256'))!=proof.get('sourceSha256'):
                    errors.append('run manifest does not match source sha')
            except (OSError,ValueError,TypeError):
                errors.append('invalid JSON in project run manifest')
    for typ in ('source','output'):
        pathstr=proof.get(typ+'MediaAbsolutePath')
        if pathstr:
            p=Path(pathstr)
            if not p.is_absolute() or not p.is_file() or p.stat().st_size < 1024:
                errors.append(typ+' file does not exist (or empty)')
            else:
                real_sha=stream_sha256(p)
                if proof.get(typ+'Sha256') != real_sha: errors.append(typ+' SHA256 mismatch')
                try:
                    measured=ffprobe_actual(p)
                    claimed=proof.get(typ+'Probe',{})
                    if not isinstance(claimed,dict) or set(measured['streams'])!=set(claimed.get('streams') or []):
                        errors.append(typ+' ffprobe streams differ from actual file')
                    elif not isinstance(claimed.get('durationSeconds'),(int,float)) or not math.isclose(
                        measured['durationSeconds'],claimed['durationSeconds'],abs_tol=0.12,rel_tol=0.001):
                        errors.append(typ+' ffprobe duration differs from actual file')
                except (OSError,KeyError,ValueError,subprocess.SubprocessError,RuntimeError) as exc:
                    errors.append(typ+' independent ffprobe failed: '+str(exc)[:120])
        probe=proof.get(typ+'Probe',{})
        if not isinstance(probe,dict) or not isinstance(probe.get('durationSeconds'),(int,float)) or probe.get('durationSeconds',0)<=0:
            errors.append(typ+' ffprobe duration missing')
        elif not isinstance(probe.get('streams'),list) or not any(x in probe['streams'] for x in ['video','audio']):
            errors.append(typ+' ffprobe streams missing')
    src, out=proof.get('sourceProbe',{}), proof.get('outputProbe',{})
    src=src if isinstance(src,dict) else {}
    out=out if isinstance(out,dict) else {}
    for modality in ['video','audio']:
        if modality in (src.get('streams') or []) and modality not in (out.get('streams') or []):
            errors.append('output missing source modality '+modality)
    # Primary reference run must be a normal real-video+audio case.
    # Silent/video-only source tests are separately required in V4-046 and must
    # legitimately use not-applicable rather than fabricate an audio stream.
    if not {'video','audio'}.issubset(set(src.get('streams') or [])):
        errors.append('primary E2E proof must be a source with both video and audio; test silent separately')
    if not {'video','audio'}.issubset(set(out.get('streams') or [])):
        errors.append('primary E2E output missing real video or audio')
    if not all(isinstance(proof.get(k),list) and len(proof[k]) for k in ['eventIds','clipIds','judgementIds']):
        errors.append('eventIds/clipIds/judgementIds require actual IDs')
    calls=proof.get('modelCalls') or []
    if not isinstance(calls,list): calls=[]
    calls=[c for c in calls if isinstance(c,dict)]
    required_roles={'asr','audio_event','video_embedding','local_cut_judge'}
    found={c.get('role') for c in calls if c.get('success') is True and c.get('modelRevision') and
           c.get('realInputModalities') and c.get('tracePath')}
    for role in sorted(required_roles-found): errors.append('missing real model call '+role)
    for c in calls:
        if c.get('success') is True:
            if not c.get('modelRevision') or not c.get('realInputModalities'):
                errors.append('successful model call missing revision/modalities: '+str(c.get('role')))
            if run_dir is None or _media_trace_file(run_dir,c.get('tracePath')) is None:
                errors.append('missing trace within actual project run: '+str(c.get('role')))
    if not any(_modality_ok(c,{'video'}) and c.get('role')=='video_embedding' for c in calls):
        errors.append('video_embedding did not receive real video')
    joint_av=any(c.get('role')=='av_verification' and _modality_ok(c,{'video','audio'}) for c in calls)
    dual_av=_dual_pair(calls,'av_verification_video','av_verification_audio')
    if not joint_av and not dual_av:
        errors.append('AV verifier missing: require real joint AV input or synchronized dual audio/video observations')
    joint_output=any(c.get('role')=='rendered_output_judge' and _modality_ok(c,{'video','audio'}) and
                     c.get('inputArtifactSha256')==proof.get('outputSha256') for c in calls)
    dual_output=_dual_pair(calls,'rendered_output_judge_video','rendered_output_judge_audio') and all(
        c.get('inputArtifactSha256')==proof.get('outputSha256')
        for c in calls if c.get('role') in ('rendered_output_judge_video','rendered_output_judge_audio') and c.get('success') is True)
    if not joint_output and not dual_output:
        errors.append('rendered-output judge missing actual verified AV output hash')
    coverage=proof.get('coverage') or []
    duration=src.get('durationSeconds',0)
    if not isinstance(coverage,list): coverage=[]
    for lane in ('speech','audio','visual'):
        windows=[w for w in coverage if isinstance(w,dict) and w.get('lane')==lane and w.get('status')=='inspected']
        if not windows: errors.append('no coverage for '+lane)
        elif not _sampled_deciles(windows,duration):
            errors.append('inspected temporal coverage does not reach all 10 source deciles for '+lane)
    if proof.get('renderedArtifactJudged') is not True:
        errors.append('renderedArtifactJudged must be explicitly true after actual output inspection')
    return errors

def stream_sha256(path: Path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda:f.read(4*1024*1024),b''):
            h.update(chunk)
    return h.hexdigest()



def _existing_json_path(repo: Path, pathvalue):
    if not isinstance(pathvalue,str) or not pathvalue:
        return False
    p=Path(pathvalue)
    if not p.is_absolute(): p=repo/p
    if not p.is_file() or p.stat().st_size==0:
        return False
    try:
        json.loads(p.read_text(encoding='utf8'))
        return True
    except (OSError,UnicodeError,ValueError):
        return False


def audit_quality_evidence(repo: Path):
    """Machine-checkable minimum of real human benchmark receipts.

    It cannot prove reviewers are truly independent: manual sign-off is still required.
    Private ratings/media can remain outside the Git repository.
    """
    errors={k:[] for k in ('V4-050','V4-051','V4-052','V4-053')}
    path=repo/'docs'/'ENGINE_V4_QUALITY_EVIDENCE.json'
    if not path.is_file():
        return {k:['missing ENGINE_V4_QUALITY_EVIDENCE.json'] for k in errors}
    try:
        q=get_json(path)
    except (OSError,ValueError,TypeError):
        return {k:['malformed quality evidence JSON'] for k in errors}
    if not isinstance(q,dict):
        return {k:['quality evidence JSON root must be an object'] for k in errors}
    sources=q.get('sources') or []
    if not isinstance(sources,list): sources=[]
    unique=set()
    genres=set()
    for source in sources:
        if not isinstance(source,dict): continue
        sh=source.get('sourceSha256','')
        if isinstance(sh,str) and len(sh)==64 and all(c in '0123456789abcdef' for c in sh):
            unique.add(sh)
        if source.get('authorized') is True: genres.add(source.get('genre'))
        else: errors['V4-050'].append('one or more sources lack authorization')
        if not _existing_json_path(repo,source.get('labelsPath')):
            errors['V4-050'].append('gold label JSON is absent/unreadable')
        reviewers=source.get('reviewers') or []
        ids=set()
        for reviewer in reviewers:
            if not isinstance(reviewer,dict): continue
            rid=reviewer.get('reviewerId')
            if rid and reviewer.get('blind') is True and _existing_json_path(repo,reviewer.get('ratingsPath')):
                ids.add(rid)
        if len(ids)<2:
            errors['V4-051'].append('each source requires 2 independent blind reviewer rating files')
    if len(unique)<20 or len(unique)!=len(sources):
        errors['V4-050'].append('require 20 unique SHA256-labeled source videos')
    required_genres={'podcast','twitch','gaming','rap','no-speech','negative'}
    if not required_genres.issubset(genres):
        errors['V4-050'].append('missing at least one required genre/category: '+','.join(sorted(required_genres-genres)))
    if not sources: errors['V4-051'].append('no sources to review')
    report=q.get('benchmarkReport') or {}
    if not isinstance(report,dict) or not _existing_json_path(repo,report.get('reportPath')) or report.get('measured') is not True:
        errors['V4-052'].append('missing actual measured benchmark JSON report')
    elif not {'engine1','engine2','engine3','engine4'}.issubset(set(report.get('enginesCompared') or [])) or not {'eventRecall','boundary','standalone','editMinutes'}.issubset(set(report.get('metrics') or [])):
        errors['V4-052'].append('benchmark must include all 4 engines and all primary metrics')
    ablation=q.get('ablationReport') or {}
    if not isinstance(ablation,dict) or not _existing_json_path(repo,ablation.get('reportPath')) or ablation.get('measured') is not True:
        errors['V4-053'].append('missing actual measured ablation JSON report')
    elif not {'video','audio','investigator','cut','repair'}.issubset(set(ablation.get('componentsTested') or [])):
        errors['V4-053'].append('ablation must test 5 specified components')
    return {k:v for k,v in errors.items() if v}

def audit(repo, evidence_path, level, proof_path):
    schema=get_json(SPEC)
    req=schema['requirements']
    evidence=get_json(evidence_path) if evidence_path.is_file() else {}
    if evidence.get('engineId') not in ('engine4', None):
        raise ValueError('Evidence is for the wrong engine')
    by_id=evidence.get('requirements',{})
    if not isinstance(by_id,dict): by_id={}
    requested=[r for r in req if level=='all' or r['level']=='core']
    errors={}
    totals=Counter()
    proof=get_json(proof_path) if proof_path.is_file() else {}
    proof_errors=verify_media_proof(repo,proof)
    quality_errors=audit_quality_evidence(repo) if level=='all' else {}
    for r in requested:
        i=r['id']; item=by_id.get(i,{})
        if not isinstance(item,dict): item={}
        state=item.get('status','pending')
        if state not in STATES: state='invalid'
        totals[state]+=1
        failures=[]
        if state != 'passed': failures.append('status='+str(state))
        else:
            code=item.get('implementationFiles') or []
            tests=item.get('testFiles') or []
            if not code or not all(contained_file(repo, x, suffixes=SOURCE_SUFFIX) for x in code):
                failures.append('implementationFiles absent/non-code/outside repo')
            if not tests or not all(contained_file(repo, x, suffixes=TEST_SUFFIX) for x in tests):
                failures.append('testFiles absent/outside repo')
            if not isinstance(item.get('testCommand'),str) or len(item['testCommand'].strip())<7:
                failures.append('testCommand missing')
            if item.get('testExitCode') != 0 or isinstance(item.get('testExitCode'),bool):
                failures.append('testExitCode != 0')
            if not contained_file(repo,item.get('testLog',''),forbid_package=True):
                failures.append('testLog absent/outside repo')
            elif not isinstance(item.get('testLogSha256'),str) or stream_sha256(repo/item['testLog']) != item['testLogSha256']:
                failures.append('testLogSha256 missing/mismatch')
            if 'real_media' in r.get('required_proof',[]):
                if not item.get('realMediaRunId') or item['realMediaRunId']!=proof.get('runId'):
                    failures.append('no matching realMediaRunId')
                if proof_errors:
                    failures.append('runProof: '+'; '.join(proof_errors[:5])+' [see diagnostics]')
        if i in quality_errors: failures.extend(quality_errors[i])
        if failures: errors[i]=failures
    return dict(engineId='engine4',level=level,total=len(requested),statuses=dict(totals),passed=len(requested)-len(errors),gate='PASS' if not errors else 'FAIL',failedRequirements=errors,runProofErrors=proof_errors,qualityProofErrors=quality_errors)


def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--repo',default='.',help='actual Shortme repository root')
    ap.add_argument('--init',action='store_true',help='create evidence file, preserving existing statuses')
    ap.add_argument('--level',choices=['core','all'],default='core')
    ap.add_argument('--json',action='store_true')
    ap.add_argument('--evidence',help='override evidence path')
    ap.add_argument('--run-proof',help='override run-proof path')
    a=ap.parse_args()
    repo=Path(a.repo).resolve()
    evidence=Path(a.evidence).resolve() if a.evidence else repo/'docs'/'ENGINE_V4_EVIDENCE.json'
    proof=Path(a.run_proof).resolve() if a.run_proof else repo/'docs'/'ENGINE_V4_RUN_PROOF.json'
    if a.init:
        existing=get_json(evidence) if evidence.is_file() else {'engineId':'engine4','requirements':{}}
        if existing.get('engineId') != 'engine4': raise SystemExit('ERROR evidence is not Engine4')
        for r in get_json(SPEC)['requirements']:
            existing['requirements'].setdefault(r['id'],{'status':'pending','implementationFiles':[],'testFiles':[],'testCommand':'','testExitCode':None,'testLog':'','testLogSha256':'','realMediaRunId':None,'notes':''})
        write_json(evidence,existing)
        print('Initialized / preserved '+str(evidence)); return 0
    result=audit(repo,evidence,a.level,proof)
    if a.json:
        print(json.dumps(result,indent=2,ensure_ascii=False))
    else:
        print(f"ENGINE V4 {a.level}: {result['gate']} | verified {result['passed']}/{result['total']} | statuses {result['statuses']}")
        for k,v in result['failedRequirements'].items():
            print(f'  {k}: {", ".join(v)}')
        if result['runProofErrors']:
            print('Run Proof diagnostics: '+', '.join(result['runProofErrors']))
    return 0 if result['gate']=='PASS' else 1

if __name__=='__main__':
    sys.exit(main())
