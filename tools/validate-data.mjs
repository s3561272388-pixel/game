// tools/validate-data.mjs — 数据体检：字段 / 引用 / 数值区间 / 布局合法性
// 用法: node tools/validate-data.mjs [--json]
// 也可被 tools/qa-check.mjs 直接 import（此时只做检查，不输出、不退出）
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadData, RARITY_ORDER } from './lib/data.mjs';
import { validateBuild } from './engine.mjs';

const ALLOWED_SIZES = new Set(['1x1', '1x2', '1x3', '1x4', '2x2', '2x3', '3x3', '2x4']);
const COST_BY_RARITY = { common: 2, uncommon: 4, rare: 7, epic: 11, legendary: 16 };
const VALID_OPS = new Set(['damage', 'heal', 'block', 'buff', 'stamina', 'drain']);
const VALID_TRIGGERS = new Set(['on_battle_start', 'on_activate', 'on_hit_taken', 'on_kill', 'on_low_hp']);

const errors = [];
const warnings = [];
const E = (m) => errors.push(m);
const W = (m) => warnings.push(m);

const data = loadData();
const { rules, items, classes, enemies, itemById, classById } = data;
const GRID = [rules.meta.gridCols, rules.meta.gridRows];
const caps = rules.statCaps;
const val = rules.validation;

// ---------- 1. 物品 ----------
const seenIds = new Set();
const rarityCount = {};
const allTags = new Set();
for (const it of items.items) {
  const where = `item[${it.id || '?'}]`;
  if (!it.id) { E(`${where} 缺少 id`); continue; }
  if (seenIds.has(it.id)) E(`${where} id 重复`);
  seenIds.add(it.id);
  if (!/^[a-z][a-z0-9_]*$/.test(it.id)) E(`${where} id 必须为 snake_case`);
  for (const f of ['name', 'cls', 'rarity', 'size', 'cost', 'tags', 'cooldown', 'staminaCost', 'effects', 'desc']) {
    if (it[f] === undefined) E(`${where} 缺少字段 ${f}`);
  }
  if (!RARITY_ORDER.includes(it.rarity)) E(`${where} 稀有度非法: ${it.rarity}`);
  else rarityCount[it.rarity] = (rarityCount[it.rarity] || 0) + 1;
  if (!classById.has(it.cls) && it.cls !== 'neutral') E(`${where} 职业非法: ${it.cls}`);
  if (COST_BY_RARITY[it.rarity] !== undefined && it.cost !== COST_BY_RARITY[it.rarity]) {
    E(`${where} 价格 ${it.cost} 与稀有度 ${it.rarity} 规定价 ${COST_BY_RARITY[it.rarity]} 不符`);
  }
  const sizeKey = `${it.size[0]}x${it.size[1]}`;
  if (!ALLOWED_SIZES.has(sizeKey) && !ALLOWED_SIZES.has(`${it.size[1]}x${it.size[0]}`)) E(`${where} 尺寸非法: ${sizeKey}`);
  if (it.size[0] > GRID[0] || it.size[1] > GRID[1]) E(`${where} 尺寸 ${sizeKey} 超出网格 ${GRID.join('x')}`);
  if (!Array.isArray(it.tags) || it.tags.length === 0) E(`${where} tags 不能为空`);
  else it.tags.forEach((t) => allTags.add(t));
  if (it.cooldown < val.cooldown.min || it.cooldown > val.cooldown.max) E(`${where} 冷却 ${it.cooldown} 超出 [${val.cooldown.min},${val.cooldown.max}]`);
  if (it.staminaCost < val.staminaCost.min || it.staminaCost > val.staminaCost.max) E(`${where} 耐力消耗 ${it.staminaCost} 超出范围`);
  if (!Array.isArray(it.effects)) E(`${where} effects 必须为数组`);

  const hasActivate = (it.effects || []).some((e) => e.trigger === 'on_activate');
  if (it.cooldown === 0 && hasActivate) E(`${where} 冷却为 0 却含 on_activate 效果 → 会导致每 tick 无限触发`);
  if (it.cooldown > 0 && !hasActivate && !(it.synergy || []).length) W(`${where} 有冷却但无 on_activate 效果，形同废件`);

  let dps = 0;
  for (const eff of it.effects || []) {
    if (!VALID_TRIGGERS.has(eff.trigger)) E(`${where} 非法 trigger: ${eff.trigger}`);
    if (!VALID_OPS.has(eff.op)) E(`${where} 非法 op: ${eff.op}`);
    if (eff.op === 'buff' && !caps[eff.stat]) E(`${where} buff 属性 ${eff.stat} 未在 statCaps 中定义`);
    if (eff.op === 'buff' && !eff.stat) E(`${where} buff 缺少 stat`);
    if (typeof eff.value !== 'number' || Number.isNaN(eff.value)) E(`${where} 效果数值非法: ${eff.value}`);
    if (eff.op === 'damage') {
      if (eff.value < val.damage.min || eff.value > val.damage.max) E(`${where} 伤害 ${eff.value} 超出 [${val.damage.min},${val.damage.max}]`);
      if (it.cooldown > 0) dps += eff.value / it.cooldown;
    }
    if (eff.op === 'block' && (eff.value < val.block.min || eff.value > val.block.max)) E(`${where} 护甲 ${eff.value} 超出范围`);
    if (eff.op === 'heal' && (eff.value < val.heal.min || eff.value > val.heal.max)) E(`${where} 治疗 ${eff.value} 超出范围`);
  }
  const range = val.dpsByRarity[it.rarity];
  if (dps > 0 && range && (dps < range[0] || dps > range[1])) {
    E(`${where} DPS ${dps.toFixed(2)} 超出 ${it.rarity} 区间 [${range[0]},${range[1]}]（要么超模，要么偏弱到没人用）`);
  }
  for (const s of it.synergy || []) {
    if (!caps[s.stat]) E(`${where} 协同属性 ${s.stat} 未在 statCaps 中定义`);
    if (s.add > val.synergyAddMax) E(`${where} 协同加成 ${s.add} 超过上限 ${val.synergyAddMax}`);
    if (s.maxStacks > val.synergyMaxStacksMax) E(`${where} 协同层数 ${s.maxStacks} 超过上限 ${val.synergyMaxStacksMax}`);
    if (s.maxStacks < 1) E(`${where} 协同层数必须 ≥1`);
  }
  // 描述一致性：desc 里的"每 X 秒"必须等于 cooldown
  const m = /每\s*([\d.]+)\s*秒/.exec(it.desc || '');
  if (m && Number(m[1]) !== it.cooldown) {
    E(`${where} 描述写"每 ${m[1]} 秒"但 cooldown=${it.cooldown}（描述与实际不符会被 QA 判为缺陷）`);
  }
}

// 声明的数量与实际一致
for (const r of RARITY_ORDER) {
  if ((items.counts[r] || 0) !== (rarityCount[r] || 0)) {
    E(`items.counts.${r} 声明 ${items.counts[r]} 与实际 ${rarityCount[r] || 0} 不符`);
  }
}
if (items.counts.total !== items.items.length) E(`items.counts.total 声明 ${items.counts.total} 与实际 ${items.items.length} 不符`);

// 协同引用的 tag 必须真实存在于池子里（拼错 tag = 永远不生效的死协同）
for (const it of items.items) {
  for (const s of it.synergy || []) {
    if (!allTags.has(s.withTag)) W(`item[${it.id}] 协同引用了不存在的 tag "${s.withTag}"（该协同永不生效）`);
  }
}

// ---------- 2. 职业 ----------
for (const c of classes.classes) {
  const where = `class[${c.id}]`;
  if (!c.base) { E(`${where} 缺少 base`); continue; }
  for (const k of ['maxHp', 'maxStamina', 'staminaRegen']) {
    if (typeof c.base[k] !== 'number') E(`${where} base.${k} 缺失`);
  }
  if (c.base.maxHp < 60 || c.base.maxHp > 200) E(`${where} maxHp ${c.base.maxHp} 超出合理范围 [60,200]`);
  if (c.base.maxStamina < 4 || c.base.maxStamina > 30) E(`${where} maxStamina ${c.base.maxStamina} 超出合理范围`);
  for (const sid of c.startItems || []) {
    if (!itemById.has(sid)) E(`${where} 起始物品不存在: ${sid}`);
    else if (itemById.get(sid).cls !== c.id && itemById.get(sid).cls !== 'neutral') {
      W(`${where} 起始物品 ${sid} 属于 ${itemById.get(sid).cls}，已跨职业`);
    }
  }
  const traitTypes = new Set(['dynamicAtkPctPerHpLostPct', 'onBattleStartBuff', 'onBattleStartHealPct', 'passive']);
  for (const t of c.traits || []) {
    if (!traitTypes.has(t.impl?.type)) E(`${where} 特性 ${t.id} 的 impl.type 未被引擎支持: ${t.impl?.type}`);
  }
}

// ---------- 3. 关卡 ----------
const rounds = new Set();
const enemyValues = [];
for (const e of enemies.enemies) {
  const where = `enemy[round ${e.round}]`;
  if (rounds.has(e.round)) E(`${where} 回合重复`);
  rounds.add(e.round);
  if (!classById.has(e.cls)) E(`${where} 职业非法: ${e.cls}`);
  const errs = validateBuild(e, itemById, GRID);
  errs.forEach((msg) => E(`${where} 布局非法: ${msg}`));
  if (e.hpScale < 0.5 || e.hpScale > 3.0) E(`${where} hpScale ${e.hpScale} 超出合理区间 [0.5,3.0]`);
  if (e.atkScale < 0.5 || e.atkScale > 3.0) E(`${where} atkScale ${e.atkScale} 超出合理区间 [0.5,3.0]`);
  // 注意：hpScale/atkScale 是**相对难度的自由旋钮**，不再要求贴合某个公式。
  // 全局回合生命刻度由 rules.battle.hpGrowthPerRound 承担（对双方同时生效）。
  // 真实难度必须靠 tools/run-balance.mjs 的实测胜率曲线来校准。
  const legendaries = e.items.filter((i) => itemById.get(i.defId)?.rarity === 'legendary');
  if (legendaries.length > 1) E(`${where} 出现 ${legendaries.length} 件传奇，违反"传奇全局唯一"`);
  // 阵容价值按星级折算（2 星 ≈ 2.2 件 1 星的获取成本）
  const starCost = (s) => (s === 2 ? 2.2 : s === 3 ? 4.5 : 1);
  const value = e.items.reduce((acc, i) => {
    const d = itemById.get(i.defId);
    return acc + (d ? d.cost * starCost(i.stars || 1) : 0);
  }, 0);
  enemyValues.push({ round: e.round, value, cls: e.cls, itemCount: e.items.length });
}
for (let r = 1; r <= rules.enemyCurve.totalRounds; r += 1) {
  if (!rounds.has(r)) E(`缺少第 ${r} 关的对手配置`);
}
// 结构检查：阵容规模必须单调增长，否则"越往后越简单"是数据缺陷
// （真实难度由 tools/run-balance.mjs 实测胜率校验，不在此处拍板）
for (let i = 1; i < enemyValues.length; i += 1) {
  const prev = enemyValues[i - 1];
  const cur = enemyValues[i];
  if (cur.value < prev.value * 0.8) {
    W(`第 ${cur.round} 关阵容价值 ${cur.value} 比第 ${prev.round} 关 ${prev.value} 缩水 >20%（节奏倒退）`);
  }
}
const firstValue = enemyValues[0].value;
const lastValue = enemyValues[enemyValues.length - 1].value;
if (lastValue < firstValue * 2) E(`第 18 关阵容价值 ${lastValue} 不足第 1 关 ${firstValue} 的 2 倍，难度曲线过平`);


// ---------- 4. 规则自洽 ----------
if (rules.battle.starMult.length !== rules.battle.maxStars) E(`starMult 长度 ${rules.battle.starMult.length} ≠ maxStars ${rules.battle.maxStars}`);
if (!(rules.battle.maxTicks > 0)) E(`maxTicks 必须为正`);
const ALL_STATS = ['atkPct', 'atkFlat', 'speedPct', 'critChance', 'critMult', 'lifesteal', 'thorns', 'regenPerTick', 'healPct', 'maxHp', 'maxStamina', 'staminaRegen'];
for (const s of ALL_STATS) if (caps[s] === undefined) E(`statCaps 缺少 ${s}`);
for (const w of rules.shop.rarityWeightsByRound) {
  const sum = Object.values(w.weights).reduce((a, b) => a + b, 0);
  if (sum <= 0) E(`rarityWeightsByRound(from ${w.from}) 权重全为 0`);
}

// ---------- 输出 ----------
const report = {
  ok: errors.length === 0,
  itemCount: items.items.length,
  rarityCount,
  classCount: classes.classes.length,
  enemyCount: enemies.enemies.length,
  enemyValues,
  errors,
  warnings,
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

export { report as dataReport, errors as dataErrors, warnings as dataWarnings };

if (isMain && process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else if (isMain) {
  console.log('=== 背包大乱斗 · 数据体检 ===');
  console.log(`物品 ${report.itemCount} 件 | 职业 ${report.classCount} 个 | 关卡 ${report.enemyCount} 关`);
  console.log(`稀有度分布: ${Object.entries(rarityCount).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  if (warnings.length) {
    console.log(`\n--- 警告 (${warnings.length}) ---`);
    warnings.forEach((w) => console.log(`  [WARN] ${w}`));
  }
  if (errors.length) {
    console.log(`\n--- 错误 (${errors.length}) ---`);
    errors.forEach((e) => console.log(`  [FAIL] ${e}`));
  }
  console.log(`\n结果: ${errors.length === 0 ? 'PASS ✅' : 'FAIL ❌'}`);
}
if (isMain) process.exit(errors.length === 0 ? 0 : 1);
