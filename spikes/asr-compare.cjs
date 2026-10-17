// M0.2: Parakeet vs Whisper Übereinstimmung (WER-Proxy) + Wort-Zeitstempel-Plausibilität
const fs=require('fs');const L=(m)=>JSON.parse(fs.readFileSync(__dirname+`/out/asr-${m}.json`));
const norm=(t)=>t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu,'').split(/\s+/).filter(Boolean)
const P=L('parakeet'),W=L('whisper');
const a=norm(P.map(s=>s.text).join(' ')),b=norm(W.map(s=>s.text).join(' '))
const n=a.length,m=b.length;let prev=Array.from({length:m+1},(_,j)=>j)
for(let i=1;i<=n;i++){const cur=[i];for(let j=1;j<=m;j++)cur[j]=Math.min(prev[j]+1,cur[j-1]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));prev=cur}
console.log(`Diff Parakeet↔Whisper: ${(prev[m]/Math.max(n,m)*100).toFixed(1)}% (Wörter ${n}/${m})`)
// Wörter aus Tokens
let words=[];for(const s of P){let cur=null;s.tokens.forEach((t,i)=>{const ts=s.timestamps[i];if(t.startsWith('▁')||t.startsWith(' ')||!cur){if(cur)words.push(cur);cur={w:t.replace(/^[▁ ]/,''),s:ts,e:ts}}else{cur.w+=t;cur.e=ts}});if(cur)words.push(cur)}
let bad=0,mono=true,long=0;for(let i=0;i<words.length;i++){if(i&&words[i].s<words[i-1].s)mono=false;if(words[i].e-words[i].s>1.0)long++}
console.log(`Parakeet-Wörter=${words.length} monoton=${mono} Wörter>1s=${long}`)
const s=words.slice(Math.floor(words.length/3),Math.floor(words.length/3)+50);console.log('PARAKEET:',s.map(x=>`${x.w}@${x.s.toFixed(2)}`).join(' '))
const t0=s[0].s;const wseg=W.filter(x=>x.end>t0-1&&x.start<s[49].s+1).map(x=>x.text.trim()).join(' | ');console.log('WHISPER :',wseg)
