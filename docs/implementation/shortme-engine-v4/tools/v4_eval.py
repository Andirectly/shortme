#!/usr/bin/env python3
"""Reference offline Shortme V1/V2/V3/V4 event/cut evaluation on *real labels*.

No data included, no benchmark claims. Predictions from clip-recheck excluded.
Usage: python tools/v4_eval.py --gold path/to/gold.json --pred path/to/pred.json --k 10

Gold format: {"sources":[{"sha256":"...", "creator":"...", "session":"...",
 "events":[{"id":"evt1", "start":20,"end":50,"peak":35,
 "allowedStart":[18,29], "allowedEnd":[38,58]}]}]}
Pred format: {"clips":[{"engineId":"engine1|engine2|engine3|engine4",
 "sourceSha256":"...", "runKind":"full-source-analysis", "eventId":"...",
 "start":19,"end":54,"rank":1}]}
"""
import argparse
import json
from collections import defaultdict

ENGINES=('engine1','engine2','engine3','engine4')


def is_match(pred, gold):
    a,b=pred['start'],pred['end']
    if b<=a or a<0 or b-a>180: return False
    if not (a<=gold['peak']<=b): return False
    overlap=max(0,min(b,gold['end'])-max(a,gold['start']))
    return overlap>0 and overlap/max(1e-9,b-a)>=0.2


def max_matching(clips, gold):
    edges=[[j for j,g in enumerate(gold) if is_match(p,g)] for p in clips]
    matched_gold={}
    def augment(i,vis):
        for j in edges[i]:
            if j in vis: continue
            vis.add(j)
            if j not in matched_gold or augment(matched_gold[j],vis):
                matched_gold[j]=i
                return True
        return False
    for i in range(len(clips)): augment(i,set())
    return matched_gold


def compute_metrics(gold_source, clips, k):
    clips=sorted(clips,key=lambda c:(c['rank'],c['start']))[:k]
    gold=gold_source['events']
    mapping=max_matching(clips,gold)
    ok=0
    for j,i in mapping.items():
        c,g=clips[i],gold[j]
        if g['allowedStart'][0] <= c['start'] <= g['allowedStart'][1] and g['allowedEnd'][0] <= c['end'] <= g['allowedEnd'][1]: ok+=1
    return {'goldEvents':len(gold),'predictedClips':len(clips),'matchedEvents':len(mapping),
            'bothBoundariesAcceptable':ok,'recallAtK':len(mapping)/len(gold) if gold else None,
            'temporalMatchPrecisionProxyAtK':len(mapping)/len(clips) if clips else None,
            'bothBoundaryAtMatched':ok/len(mapping) if mapping else None}


def evaluate(gold_data,pred_data,k=10):
    if k<1: raise ValueError('K must be >0')
    sources=gold_data['sources']; known={s['sha256']:s for s in sources}
    if len(known)!=len(sources): raise ValueError('Duplicate source hash in gold')
    all_pred=defaultdict(list)
    for c in pred_data['clips']:
        if c['engineId'] not in ENGINES: raise ValueError('Unknown engine '+str(c['engineId']))
        if c.get('runKind')!='full-source-analysis': continue
        if c['sourceSha256'] not in known: raise ValueError('Prediction source not present in gold')
        if not isinstance(c['rank'],int) or c['rank']<1: raise ValueError('Invalid rank')
        all_pred[(c['engineId'],c['sourceSha256'])].append(c)
    detail={}
    for engine in ENGINES:
        rows=[]
        for s in sources:
            metric=compute_metrics(s,all_pred[(engine,s['sha256'])],k)
            metric.update({'sourceSha256':s['sha256'],'creator':s.get('creator','unknown'),'session':s.get('session','unknown')})
            rows.append(metric)
        denom=sum(r['goldEvents'] for r in rows)
        total=sum(r['matchedEvents'] for r in rows)
        n=sum(r['predictedClips'] for r in rows)
        detail[engine]={'numberSources':len(rows),'goldEvents':denom,'predictedClips':n,'matchedEvents':total,
                        'microRecallAtK':total/denom if denom else None,
                        'microTemporalMatchPrecisionProxyAtK':total/n if n else None,
                        'bothBoundaryAtMatched':sum(r['bothBoundariesAcceptable'] for r in rows)/total if total else None,
                        'perSource':rows}
    return {'k':k,'notes':'Temporal gold-event matching is NOT human clip usability precision. No blind reviewer preference or publishable-clip quality is calculated here.', 'results':detail}


def main():
    a=argparse.ArgumentParser(description=__doc__)
    a.add_argument('--gold',required=True);a.add_argument('--pred',required=True)
    a.add_argument('--k',type=int,default=10);a.add_argument('--out')
    args=a.parse_args()
    result=evaluate(json.load(open(args.gold,encoding='utf8')),json.load(open(args.pred,encoding='utf8')),args.k)
    s=json.dumps(result,indent=2,ensure_ascii=False)
    if args.out:
        with open(args.out,'w',encoding='utf8') as f:f.write(s+'\n')
    print(s)
if __name__=='__main__':main()
