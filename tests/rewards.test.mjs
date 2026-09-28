import test from 'node:test';
import assert from 'node:assert/strict';
import {loadData} from '../tools/lib/data.mjs';
import {newRun,act,settle,battle,rewardOffer,playerBuild,validateSave,availablePool} from '../packages/engine/game.mjs';
import {initSide} from '../packages/engine/battle.mjs';
import {placement,campaign} from '../tools/difficulty-test.mjs';
const d=loadData();
function milestone(round=3,cls='warrior') {
  let s=newRun(cls,9124,d);s.round=round;
  s.pages=d.rules.unlock.pageSizes.slice(0,d.rules.unlock.pageUnlockRounds.filter(r=>r<=round).length).map(p=>[...p]);
  // Fixture stock length follows the real rule so reload validation is meaningful.
  while(s.shop.offers.length<7&&round>=4){s.shop.offers.push(null);s.shop.frozen.push(false);}
  return act(settle(s,{round,winner:'A',ticks:1,events:[]},d),{type:'next'},d);
}
test('rewards occur after 3,6,9,12,15; deterministic, mandatory and reloadable',()=>{
  for(const round of [3,6,9,12,15])for(const cls of d.classById.keys()) {
    const s=milestone(round,cls);assert.equal(s.phase,'REWARD');assert(validateSave(s,d));
    assert.deepEqual(s.reward,rewardOffer(s,d));assert.deepEqual(milestone(round,cls).reward,s.reward);
    assert.equal(d.itemById.get(s.reward.weaponId).rarity,round<6?'rare':round<12?'epic':'legendary');
    assert.throws(()=>battle(s,d));assert.throws(()=>act(s,{type:'next'},d));assert.throws(()=>act(s,{type:'undo'},d));
    const reloaded=JSON.parse(JSON.stringify(s));assert.deepEqual(act(reloaded,{type:'reward',choice:'gold'},d),act(s,{type:'reward',choice:'gold'},d));
  }
});
test('gold reward credited exactly once, no purchase required or reward reroll',()=>{
  const s=milestone(),r=act(s,{type:'reward',choice:'gold'},d);
  assert.equal(r.gold,s.gold+12);assert.equal(r.income,s.income+12);assert.equal(r.round,4);assert.equal(r.phase,'SHOP');
  assert.equal(r.rewardHistory.length,1);assert.throws(()=>act(r,{type:'reward',choice:'gold'},d));assert.throws(()=>act(r,{type:'undo'},d));assert(validateSave(r,d));
});
test('permanent blessing affects battle health and damage, stacks, resets on a new run',()=>{
  const s=milestone(),r=act(s,{type:'reward',choice:'stats'},d);
  const old=initSide(playerBuild(s),0,d,r.round),boosted=initSide(playerBuild(r),0,d,r.round);
  assert.equal(boosted.maxHp,204);assert(boosted.maxHp > old.maxHp);assert.equal(boosted.atkScale,1.08);
  const log=battle(r,d);assert.equal(log.a.hpScale,1.15);assert.equal(log.a.atkScale,1.08);
  let t=milestone(6);t.blessings=r.blessings;t.rewardHistory=r.rewardHistory;
  t=act(t,{type:'reward',choice:'stats'},d);assert.deepEqual(t.blessings,{hpPct:30,atkPct:16});
  assert.deepEqual(newRun('warrior',1,d).blessings,{hpPct:0,atkPct:0});
});
test('weapon goes into stash and persists when placement fails; equip is free and undo restores it',()=>{
  const s=milestone(),r=act(s,{type:'reward',choice:'weapon'},d);const id=s.reward.weaponId;
  assert.deepEqual(r.rewardStash,[id]);assert.equal(r.gold,s.gold);assert.equal(r.items.length,s.items.length);
  const before=JSON.stringify(r);assert.throws(()=>act(r,{type:'equipReward',index:0,page:0,row:0,col:0,rot:0},d));assert.equal(JSON.stringify(r),before);
  assert(validateSave(JSON.parse(before),d));
  const equipped=act(r,{type:'equipReward',index:0,...placement(r,id,d)},d);
  assert.equal(equipped.gold,r.gold);assert.equal(equipped.rewardStash.length,0);assert(equipped.items.some(i=>i.defId===id));
  assert.deepEqual(act(equipped,{type:'undo'},d),r);
});
test('owned or stashed legendary weapons are excluded; collected tier still offers gold or stats',()=>{
  let s=milestone(12);s=act(s,{type:'reward',choice:'weapon'},d);const id=s.rewardStash[0];
  assert(!availablePool(s,d).some(i=>i.id===id));
  let t=milestone(15);t.rewardStash=['wpn_doom_hammer','wpn_world_tree_bow'];t.reward=rewardOffer(t,d);
  assert.equal(t.reward.weaponId,null);assert.throws(()=>act(t,{type:'reward',choice:'weapon'},d));
  assert.equal(act(t,{type:'reward',choice:'gold'},d).round,16);
});
test('dead runs and final round do not grant rewards; forged reward saves are rejected',()=>{
  let s=milestone(3);s.hearts=1;s.phase='SHOP';s=act(settle(s,{round:3,winner:'B',ticks:1,events:[]},d),{type:'next'},d);assert.equal(s.phase,'END');
  let last=milestone(18);assert.equal(last.phase,'END');
  for(const mutate of [s=>s.reward.gold=999,s=>s.blessings.hpPct=-1,s=>s.rewardStash=['missing'],s=>s.rewardHistory=[{round:3,choice:'gold'}]]){const s=milestone();mutate(s);assert(!validateSave(s,d));}
});
test('legacy saves remain valid and can earn their next milestone reward',()=>{
  let s=newRun('warrior',7,d);delete s.blessings;delete s.rewardHistory;delete s.rewardStash;assert(validateSave(s,d));
  s.round=3;s=act(settle(s,{round:3,winner:'A',ticks:1,events:[]},d),{type:'next'},d);s=act(s,{type:'reward',choice:'stats'},d);assert(validateSave(s,d));
});
