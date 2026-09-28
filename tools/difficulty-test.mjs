// Exercise the same state transitions as the UI; never alter gold, inventory or results.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {loadData, ROOT} from './lib/data.mjs';
import {newRun, act, battle, settle, mergeGroups, expansionCost, validateSave} from '../packages/engine/game.mjs';
import {effectiveSize} from '../packages/engine/battle.mjs';

export function difficultyFingerprint(d) {
  return crypto.createHash('sha256').update(JSON.stringify({rules:d.rules,items:d.items,classes:d.classes,enemies:d.enemies}))
    .update(fs.readFileSync(path.join(ROOT,'packages/engine/game.mjs')))
    .update(fs.readFileSync(path.join(ROOT,'packages/engine/battle.mjs')))
    .update(fs.readFileSync(path.join(ROOT,'tools/difficulty-test.mjs'))).digest('hex');
}

export function placement(s, id, d) {
  for (let page=0; page<s.pages.length; page++) {
    const [cols,rows]=s.pages[page], occupied=new Set();
    for (const i of s.items.filter(i=>i.page===page)) {
      const [w,h]=effectiveSize(d.itemById.get(i.defId).size,i.rot);
      for(let y=0;y<h;y++)for(let x=0;x<w;x++)occupied.add((i.row+y)*cols+i.col+x);
    }
    for(const rot of [0,90]) {
      const [w,h]=effectiveSize(d.itemById.get(id).size,rot);
      for(let row=0;row<=rows-h;row++)for(let col=0;col<=cols-w;col++) {
        let free=true;
        for(let y=0;y<h&&free;y++)for(let x=0;x<w;x++)if(occupied.has((row+y)*cols+col+x)){free=false;break;}
        if(free)return {page,row,col,rot};
      }
    }
  }
  return null;
}
export function nextPurchase(s,d) {
  if(mergeGroups(s,d).length)return {type:'merge'};
  for(let index=0;index<(s.rewardStash||[]).length;index++) {
    const pos=placement(s,s.rewardStash[index],d);
    if(pos)return {type:'equipReward',index,...pos};
  }
  const score=id=>{const i=d.itemById.get(id);return i.effects.reduce((n,e)=>n+(e.op==='damage'?e.value*2:e.op==='block'||e.op==='heal'?e.value:e.op==='buff'&&e.stat==='maxHp'?e.value*.15:1),0)/(Math.max(.5,i.cooldown)*i.cost)};
  const offers=s.shop.offers.map((id,index)=>({id,index})).filter(x=>x.id&&d.itemById.get(x.id).cost<=s.gold && !(d.itemById.get(x.id).rarity==='legendary'&&(s.items.some(i=>i.defId===x.id)||(s.rewardStash||[]).includes(x.id)))).sort((a,b)=>score(b.id)-score(a.id));
  for(const o of offers){const pos=placement(s,o.id,d);if(pos)return {type:'buy',index:o.index,...pos};}
  // Buy space only when an affordable offer cannot fit; no imaginary auto-packing.
  if(offers.length&&s.round>=d.rules.economy.expansion.unlockRound&&s.gold>=expansionCost(s,d)+Math.min(...offers.map(o=>d.itemById.get(o.id).cost))) {
    const page=s.pages.findIndex((p,i)=>p[1]<d.rules.unlock.pageSizes[i][1]+d.rules.economy.expansion.maxExtraRowsPerPage);
    if(page>=0)return {type:'expand',page};
  }
  return null;
}
export function rewardChoice(s,policy='mixed') {
  const choice=policy==='mixed'?['weapon','gold','stats'][(s.round/3-1)%3]:policy;
  return choice==='weapon'&&!s.reward.weaponId?'stats':choice;
}
export function campaign(cls,seed,d,policy='mixed',trace=false) {
  let s=newRun(cls,seed,d); const rounds=[],actions=[];
  while(s.phase!=='END') {
    if(s.phase==='REWARD'){const a={type:'reward',choice:rewardChoice(s,policy)};if(trace)actions.push({round:s.round,...a});s=act(s,a,d);continue;}
    if(s.phase!=='SHOP')throw Error('Unexpected phase '+s.phase);
    for(let steps=0;steps<100;steps++) {
      const a=nextPurchase(s,d);if(!a)break;
      if(trace)actions.push({round:s.round,...a});s=act(s,a,d);
      if(steps===99)throw Error('Shop did not terminate');
    }
    if(!validateSave(s,d))throw Error('Invalid campaign state');
    const ev=battle(s,d);
    rounds.push({round:s.round,winner:ev.log.winner,ticks:ev.log.ticks});
    s=act(settle(s,ev.log,d),{type:'next'},d);
  }
  return {cls,seed,policy,reached:s.round,completed:s.round===18&&s.hearts>0,beatFinal:s.round===18&&rounds.at(-1).winner==='A',hearts:s.hearts,wins:s.wins,rounds,...(trace?{actions,state:s}:{})};
}
export function suite(d,runs=100,baseSeed=9124,policy='mixed') {
  const samples=[];
  for(const cls of d.classById.keys())for(let i=0;i<runs;i++)samples.push(campaign(cls,baseSeed+i*7919,d,policy));
  const summary=a=>({runs:a.length,reach18:a.filter(s=>s.reached===18).length/a.length,complete:a.filter(s=>s.completed).length/a.length,beatFinal:a.filter(s=>s.beatFinal).length/a.length,meanRound:a.reduce((n,s)=>n+s.reached,0)/a.length});
  return {generated:new Date().toISOString(),fingerprint:difficultyFingerprint(d),policy,baseSeed,overall:summary(samples),classes:Object.fromEntries([...d.classById.keys()].map(cls=>[cls,summary(samples.filter(s=>s.cls===cls))])),rounds:Array.from({length:18},(_,i)=>{const r=samples.flatMap(s=>s.rounds.filter(r=>r.round===i+1));return {round:i+1,attempts:r.length,winRate:r.filter(r=>r.winner==='A').length/r.length};}),samples};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const args=process.argv.slice(2),get=(n,f)=>args.includes(n)?args[args.indexOf(n)+1]:f;
  const report=suite(loadData(),Number(get('--runs',100)),Number(get('--seed',9124)),get('--policy','mixed'));
  fs.writeFileSync(path.join(ROOT,'reports',get('--out','difficulty-after.json')),JSON.stringify(report,null,2));
  console.log(JSON.stringify({overall:report.overall,classes:report.classes,rounds:report.rounds},null,2));
}
