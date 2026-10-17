const fs=require('fs');const P=JSON.parse(fs.readFileSync(__dirname+'/../out/asr-parakeet.json'));
const T0=200,T1=260;let words=[];
for(const s of P){let cur=null;s.tokens.forEach((t,i)=>{const ts=s.timestamps[i];if(t.startsWith('▁')||t.startsWith(' ')||!cur){if(cur)words.push(cur);cur={w:t.replace(/^[▁ ]/,''),s:ts,e:ts+0.3}}else{cur.w+=t;cur.e=ts+0.3}});if(cur)words.push(cur)}
words=words.filter(w=>w.s>=T0&&w.s<T1);const f=(x)=>{x=Math.max(0,x);const h=Math.floor(x/3600),m=Math.floor(x%3600/60),s=Math.floor(x%60),ms=Math.round((x%1)*1000);return `${String(h).padStart(2,0)}:${String(m).padStart(2,0)}:${String(s).padStart(2,0)},${String(ms).padStart(3,0)}`}
let out='',n=1;for(let i=0;i<words.length;i+=3){const g=words.slice(i,i+3);const end=i+3<words.length?words[i+3].s:g[g.length-1].e;out+=`${n++}\n${f(g[0].s-T0)} --> ${f(Math.min(end,g[g.length-1].e+0.4)-T0)}\n${g.map(x=>x.w).join(' ')}\n\n`}
fs.writeFileSync(__dirname+'/clip.srt',out);console.log(n-1,'cues')
