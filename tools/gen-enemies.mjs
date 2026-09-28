// tools/gen-enemies.mjs — 生成 data/enemies.json（数据驱动的关卡阵容）
//
// 为什么需要生成器而不是手写：
//   1) 关卡阵容必须随回合数增长，且后期要占用第 2/3 页背包（玩家在 R5/R11 会解锁新页）。
//      手写 18 套多页布局极易出错（重叠/越界），而摆放合法性正是 validate-data 会拦下的东西。
//   2) 关卡强度要跟经济曲线挂钩，手写无法保证单调。
// 生成规则：
//   - 每关按「目标阵容价值」曲线（targetValue）挑选物品，稀有度按回合权重抽取；
//   - 物品按页装箱（用引擎同一套 multi-strategy 首次适应），保证 100% 合法；
//   - 第 12 回合起部分物品升为 2 星，模拟玩家三合一；
//   - 结果完全确定性：同一 seed 反复生成结果一致。hpScale/atkScale 输出为 1.0，
//     真实难度由 tools/calibrate.mjs 依据实测胜率标定。
//
// 用法: node tools/gen-enemies.mjs
import fs from 'node:fs';
import path from 'node:path';
import { loadData, ROOT } from './lib/data.mjs';
import { packBuild, mulberry32 } from './engine.mjs';

const SEED = 20260202;
const data = loadData();
const { rules, items, classes, itemById, enemies } = data;

const ROUNDS = rules.enemyCurve.totalRounds;
const PAGE_SIZES = rules.unlock.pageSizes;
const PAGE_UNLOCK = rules.unlock.pageUnlockRounds;

/** 目标阵容价值曲线：与经济/背包容量增长挂钩，饱和于后期 */
function targetValue(round) {
  const cap = 104;
  return Math.min(cap, Math.round(6 + 5.4 * (round - 1)));
}

function rarityAllowed(round) {
  const row = rules.shop.rarityWeightsByRound.find((w) => round >= w.from && round <= w.to)
    || rules.shop.rarityWeightsByRound[rules.shop.rarityWeightsByRound.length - 1];
  return row.weights;
}

function weightedPick(rng, weights) {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  const total = entries.reduce((a, [, w]) => a + w, 0);
  let x = rng() * total;
  for (const [k, w] of entries) {
    x -= w;
    if (x <= 0) return k;
  }
  return entries[entries.length - 1][0];
}

const starCost = (stars) => (stars === 2 ? 2.2 : stars === 3 ? 4.5 : 1);

/** 按页装箱：逐件尝试放入已有页，全部失败则丢弃该件 */
function assignPages(specs, pageSizes, itemByIdRef) {
  const buckets = pageSizes.map(() => []);
  const dropped = [];
  for (const spec of specs) {
    let placed = false;
    for (let p = 0; p < buckets.length && !placed; p += 1) {
      if (packBuild([...buckets[p], spec], itemByIdRef, pageSizes[p])) {
        buckets[p].push(spec);
        placed = true;
      }
    }
    if (!placed) dropped.push(spec.defId);
  }
  const out = [];
  buckets.forEach((bucket, p) => {
    if (bucket.length === 0) return;
    const placedList = packBuild(bucket, itemByIdRef, pageSizes[p]);
    for (const o of placedList) out.push({ ...o, page: p });
  });
  return { out, dropped };
}

const rng = mulberry32(SEED);
const generated = [];

for (let round = 1; round <= ROUNDS; round += 1) {
  const prev = enemies.enemies.find((e) => e.round === round);
  const cls = prev.cls;
  const pool = items.items.filter((it) => (it.cls === cls || it.cls === 'neutral') && it.cls !== undefined);
  const weights = rarityAllowed(round);
  const budget = targetValue(round);

  // 每关固定 1 件职业起始武器作为"招牌"
  const classDef = classes.classes.find((c) => c.id === cls);
  const signature = classDef.startItems.map((id) => itemById.get(id)).find((d) => d && d.effects.some((e) => e.op === 'damage'));

  const specs = [];
  let spent = 0;
  if (signature) {
    specs.push({ defId: signature.id, stars: 1 });
    spent += signature.cost;
  }

  let guard = 0;
  let legendaryCount = 0;
  const isDamageItem = (def) => def.effects.some((e) => e.op === 'damage' && e.trigger === 'on_activate');
  // 输出装下限：经验上"牧师系"关卡容易生成一堆治疗/护甲而没有武器，
  // 结果就是打不死的 25 秒长局 + 玩家高胜率。强制每关至少 1/3 的输出装。
  const minDamageItems = Math.max(2, Math.round((budget / 12) + 1));
  let damageCount = signature && isDamageItem(signature) ? 1 : 0;

  while (spent < budget && guard < 800) {
    guard += 1;
    const rarity = weightedPick(rng, weights);
    const cands = pool.filter((it) => it.rarity === rarity);
    if (cands.length === 0) continue;
    let def = cands[Math.floor(rng() * cands.length) % cands.length];
    // 还差输出装时，优先补武器
    const remainingSlots = Math.max(0, Math.round((budget - spent) / 6));
    if (damageCount < minDamageItems && !isDamageItem(def) && damageCount + remainingSlots <= minDamageItems) {
      const weapons = cands.filter(isDamageItem);
      if (weapons.length > 0) def = weapons[Math.floor(rng() * weapons.length) % weapons.length];
      else continue;
    }
    // 传奇全局唯一（策划书 §5.2）
    if (def.rarity === 'legendary' && legendaryCount >= 1) continue;
    // 同名 1 星最多 3 件（对应三合一上限）
    const sameOneStar = specs.filter((s) => s.defId === def.id && s.stars === 1).length;
    if (sameOneStar >= 3) continue;
    const stars = round >= 12 && def.rarity !== 'legendary' && rng() < 0.22 ? 2 : 1;
    const cost = def.cost * starCost(stars);
    if (spent + cost > budget * 1.12) continue;
    specs.push({ defId: def.id, stars });
    spent += cost;
    if (isDamageItem(def)) damageCount += 1;
    if (def.rarity === 'legendary') legendaryCount += 1;
  }

  const pageCount = PAGE_UNLOCK.filter((r) => r <= round).length;
  const sizes = PAGE_SIZES.slice(0, pageCount);
  const { out, dropped } = assignPages(specs, sizes, itemById);
  if (dropped.length > 0) {
    console.log(`  第 ${round} 关丢弃 ${dropped.length} 件（装不下）: ${dropped.join(', ')}`);
  }

  generated.push({
    round,
    name: prev.name,
    cls,
    hpScale: 1.0,
    atkScale: 1.0,
    targetValue: budget,
    items: out.map((o) => ({ defId: o.defId, stars: o.stars, page: o.page, col: o.col, row: o.row, rot: o.rot })),
  });
}

// ---------- 写出（紧凑单行物品，便于人工阅读与 diff） ----------
const lines = [];
lines.push('{');
lines.push('  "$schema": "enemies-v1",');
lines.push('  "version": "1.0.0",');
lines.push('  "generated": {');
lines.push(`    "by": "tools/gen-enemies.mjs",`);
lines.push(`    "seed": ${SEED},`);
lines.push(`    "note": "本文件由生成器产出，请勿手改布局。改难度请用 tools/calibrate.mjs 调整 hpScale/atkScale；改阵容请改生成器里的目标价值曲线与物品池规则。"`);
lines.push('  },');
lines.push('  "meta": {');
lines.push('    "grid": [6, 5],');
lines.push('    "note": "page 为背包页下标(0/1/2)，对应 rules.unlock.pageSizes；布局合法性由 tools/validate-data.mjs 校验。"');
lines.push('  },');
lines.push('  "enemies": [');
generated.forEach((e, ei) => {
  const itemLines = e.items.map((it, ii) =>
    `      { "defId": "${it.defId}", "stars": ${it.stars}, "page": ${it.page}, "col": ${it.col}, "row": ${it.row}, "rot": ${it.rot} }${ii === e.items.length - 1 ? '' : ','}`);
  lines.push(`    { "round": ${e.round}, "name": "${e.name}", "cls": "${e.cls}", "hpScale": ${e.hpScale.toFixed(3)}, "atkScale": ${e.atkScale.toFixed(3)}, "items": [`);
  lines.push(...itemLines);
  lines.push(`    ] }${ei === generated.length - 1 ? '' : ','}`);
});
lines.push('  ]');
lines.push('}');

const outFile = path.join(ROOT, 'data', 'enemies.json');
fs.writeFileSync(outFile, `${lines.join('\n')}\n`, 'utf8');

console.log(`已生成 data/enemies.json：${generated.length} 关`);
console.log('');
console.log('| 回合 | 职业 | 物品数 | 目标价值 | 实际价值 | 页数 |');
console.log('|---|---|---|---|---|---|');
for (const e of generated) {
  const value = e.items.reduce((a, it) => a + itemById.get(it.defId).cost * starCost(it.stars), 0);
  const pages = new Set(e.items.map((i) => i.page)).size;
  console.log(`| ${e.round} | ${e.cls} | ${e.items.length} | ${e.targetValue} | ${value.toFixed(0)} | ${pages} |`);
}
