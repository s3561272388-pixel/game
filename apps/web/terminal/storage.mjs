import { z } from 'zod';
import { makeData, validateSave } from '../../../packages/engine/game.mjs';
import rules from '../../../data/rules.json' with { type: 'json' };
import items from '../../../data/items.json' with { type: 'json' };
import classes from '../../../data/classes.json' with { type: 'json' };
import enemies from '../../../data/enemies.json' with { type: 'json' };
export const SAVE_KEY = 'wuwa-backpack-v1';
export const META_KEY = 'wuwa-backpack-save-meta';
export const SETTINGS_KEY = 'wuwa-backpack-settings';
export const CORRUPT_KEY = 'backpack-brawl:run:corrupt';
export function browserStorage() { try { return window.localStorage; } catch { return null; } }
const data = makeData(rules, items, classes, enemies);
export const RunSchema = z.object({
  version: z.literal(1), cls: z.enum(['warrior','ranger','mage','cleric']),
  seed: z.number().int().nonnegative(), round: z.number().int().min(1).max(18),
  phase: z.enum(['SHOP','RESULT','REWARD','END']), gold: z.number().finite().nonnegative(),
  hearts: z.number().int().min(0).max(5), pages: z.array(z.tuple([z.number().int(),z.number().int()])),
  items: z.array(z.object({uid:z.number().int().positive(),defId:z.string(),stars:z.number().int(),page:z.number().int(),row:z.number().int(),col:z.number().int(),rot:z.number().int()}).passthrough()),
  shop: z.object({offers:z.array(z.string().nullable()),frozen:z.array(z.boolean()),rerollCost:z.number().finite()}),
  undo: z.array(z.unknown()), history: z.array(z.object({round:z.number().int(),winner:z.enum(['A','B','draw']),ticks:z.number().int()}).passthrough()),
  discovered:z.array(z.string()),
}).passthrough().refine(s => validateSave(s,data), {message:'存档未通过现有游戏规则校验'});

export function readTerminalSave(storage) {
  let raw;
  try {
    raw=storage.getItem(SAVE_KEY);
    if(!raw)return {status:'empty',run:null,savedAt:null};
    const parsed=RunSchema.safeParse(JSON.parse(raw));
    if(!parsed.success)throw Error('invalid save');
    let meta; try{meta=JSON.parse(storage.getItem(META_KEY)||'null')}catch{}
    return {status:parsed.data.phase==='END'?'ended':'valid',run:parsed.data,
      savedAt:Number.isFinite(meta?.savedAt)?meta.savedAt:null};
  }catch{
    if(raw){try{storage.setItem(CORRUPT_KEY,JSON.stringify({raw,backedUpAt:Date.now()}))}catch{}}
    return {status:raw?'corrupt':'unavailable',run:null,savedAt:null};
  }
}
export function readSettings(storage) {
  let raw={};try{raw=JSON.parse(storage.getItem(SETTINGS_KEY)||'{}')||{}}catch{}
  return {...raw,volume:typeof raw.volume==='number'&&Number.isFinite(raw.volume)?Math.min(1,Math.max(0,raw.volume)):.35,
    motion:raw.motion!==false,colorblind:raw.colorblind===true,screenShake:raw.screenShake!==false};
}
