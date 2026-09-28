import test from 'node:test';
import assert from 'node:assert/strict';
import {loadData} from '../tools/lib/data.mjs';
import {newRun} from '../packages/engine/game.mjs';
import {readTerminalSave,readSettings,SAVE_KEY,META_KEY,CORRUPT_KEY,SETTINGS_KEY} from '../apps/web/terminal/storage.mjs';
const d=loadData();
function storage(entries={}){const m=new Map(Object.entries(entries));return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v)};}
test('terminal reads real saves without altering game records or inventing a timestamp',()=>{
 const s=newRun('warrior',42,d),raw=JSON.stringify(s),store=storage({[SAVE_KEY]:raw});
 const r=readTerminalSave(store);assert.equal(r.status,'valid');assert.deepEqual(r.run,s);assert.equal(r.savedAt,null);assert.equal(store.getItem(SAVE_KEY),raw);
 store.setItem(META_KEY,JSON.stringify({savedAt:123456}));assert.equal(readTerminalSave(store).savedAt,123456);
});
test('empty, completed and malformed saves have distinct terminal states',()=>{
 assert.equal(readTerminalSave(storage()).status,'empty');const s=newRun('mage',6,d);s.phase='END';
 assert.equal(readTerminalSave(storage({[SAVE_KEY]:JSON.stringify(s)})).status,'ended');
 for(const raw of ['{broken','null',JSON.stringify({...s,items:[null]}),JSON.stringify({...s,phase:'HACK'})]){
  const store=storage({[SAVE_KEY]:raw}),r=readTerminalSave(store);assert.equal(r.status,'corrupt');assert.equal(r.run,null);
  assert.equal(JSON.parse(store.getItem(CORRUPT_KEY)).raw,raw);assert.equal(store.getItem(SAVE_KEY),raw);
 }
});
test('storage denial and backup quota errors do not crash the terminal',()=>{
 assert.equal(readTerminalSave({getItem(){throw Error('denied')}}).status,'unavailable');
 assert.equal(readTerminalSave({getItem(){return 'bad'},setItem(){throw Error('quota')}}).status,'corrupt');
 assert.equal(readTerminalSave(null).status,'unavailable');assert.equal(readSettings(null).volume,.35);
});
test('terminal settings sanitize hostile values and preserve existing unrelated options',()=>{
 const s=readSettings(storage({[SETTINGS_KEY]:JSON.stringify({volume:12,motion:false,colorblind:true,autoMerge:true,music:true})}));
 assert.equal(s.volume,1);assert.equal(s.motion,false);assert.equal(s.autoMerge,true);assert.equal(s.music,true);
 assert.equal(readSettings(storage({[SETTINGS_KEY]:'{bad'})).volume,.35);
});
