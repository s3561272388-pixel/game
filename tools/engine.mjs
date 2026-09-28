// tools/engine.mjs
// ============================================================================
// 背包大乱斗 · 战斗结算参考实现（Oracle / 裁判）
// 严格对应 docs/02-游戏策划书.md §6。任何与实现不一致的游戏代码都会被
// tools/diff-test.mjs 逐 tick 抓出。
//
// 纯函数、零依赖、确定性：无 Math.random / Date.now，随机只用种子化 PRNG。
// ============================================================================

/** mulberry32：32 位种子确定性 PRNG */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 由 matchSeed + round + **阵容指纹** 派生独立随机流。
 * 关键设计：随机流绑定"阵容内容"而不是"左侧/右侧位置"。
 *  - 保证左右换边后结果镜像对称（不存在"当 A 方有隐藏优势"）；
 *  - 保证同一阵容无论放在哪一边，暴击序列都一样，回放可复现；
 *  - 双方各自独立一条流，一方是否暴击不影响另一方的序列。
 */
export function deriveSeed(matchSeed, round, fingerprint) {
  let h = 2166136261 >>> 0;
  const s = String(fingerprint);
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (Math.imul(matchSeed >>> 0, 0x9e3779b1) ^ Math.imul(round + 1, 0x85ebca6b) ^ h) >>> 0;
}

/** 阵容指纹：与物品摆放顺序无关的稳定哈希（同页、按坐标排序） */
export function buildFingerprint(side) {
  const parts = side.items
    .map((it) => `${it.defId}:${it.stars || 1}:${it.page || 0}:${it.col}:${it.row}:${it.rot || 0}`)
    .sort();
  return `${side.cls}|${parts.join('|')}`;
}

/** 有效占位尺寸：所有物品均为实心矩形，故 rot 90/270 等价于宽高互换 */
export function effectiveSize(size, rot) {
  const [w, h] = size;
  const swapped = rot === 90 || rot === 270;
  return swapped ? [h, w] : [w, h];
}

export function itemCells(item) {
  const [w, h] = effectiveSize(item.size, item.rot || 0);
  const cells = [];
  for (let dx = 0; dx < w; dx += 1) {
    for (let dy = 0; dy < h; dy += 1) cells.push([item.col + dx, item.row + dy]);
  }
  return cells;
}

/** 网格占用键必须含背包页：不同页面坐标相同也绝不相邻（策划书 §4.1） */
const cellKey = (page, x, y) => `${page}:${x},${y}`;

/**
 * 校验并返回某个阵营的布局问题列表（空数组 = 合法）
 * @param {{items:Array, pages?:Array<[number,number]>}} side
 *   side.pages 为该方**实际生效**的背包页尺寸（含扩容加的行）；缺省时用全局网格。
 * @param {[number,number]} grid 兜底网格 [cols, rows]
 */
export function validateBuild(side, itemById, grid) {
  const errors = [];
  const seen = new Map();
  side.items.forEach((it, idx) => {
    const def = itemById.get(it.defId);
    if (!def) {
      errors.push(`#${idx} 未知物品 id: ${it.defId}`);
      return;
    }
    const stars = it.stars || 1;
    if (stars < 1 || stars > 3) errors.push(`#${idx} ${it.defId} 星级非法: ${stars}`);
    const page = it.page || 0;
    const g = (side.pages && side.pages[page]) ? side.pages[page] : grid;
    const [cols, rows] = g;
    const cells = itemCells({ ...def, col: it.col, row: it.row, rot: it.rot || 0 });
    for (const [x, y] of cells) {
      if (x < 0 || y < 0 || x >= cols || y >= rows) {
        errors.push(`#${idx} ${it.defId} 越界 @ 第 ${page + 1} 页 (${x},${y})，该页尺寸 ${cols}x${rows}`);
        break;
      }
      const key = cellKey(page, x, y);
      if (seen.has(key)) errors.push(`#${idx} ${it.defId} 与 #${seen.get(key)} 在第 ${page + 1} 页 (${x},${y}) 重叠`);
      else seen.set(key, idx);
    }
  });
  return errors;
}

/**
 * 计算相邻协同加成。
 * 语义（策划书 §5.5）：物品 i 的每条 synergy 规则，对其**符合 withTag 的邻居**各提供 add；
 * 最多影响 maxStacks 个邻居（按 slotIndex = 数组顺序取前 N 个）。
 * 返回 Map<收到加成的 itemIndex, {stat: value}>。
 */
export function computeSynergies(side, itemById, grid) {
  const occupancy = new Map(); // "page:x,y" -> itemIndex
  const pageOf = (it) => it.page || 0;
  side.items.forEach((it, idx) => {
    const def = itemById.get(it.defId);
    for (const [x, y] of itemCells({ ...def, col: it.col, row: it.row, rot: it.rot || 0 })) {
      occupancy.set(cellKey(pageOf(it), x, y), idx);
    }
  });

  // 每个物品的正交邻居（同页才算），按索引升序
  const neighborsOf = (idx) => {
    const it = side.items[idx];
    const def = itemById.get(it.defId);
    const set = new Set();
    for (const [x, y] of itemCells({ ...def, col: it.col, row: it.row, rot: it.rot || 0 })) {
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        const other = occupancy.get(cellKey(pageOf(it), nx, ny));
        if (other !== undefined && other !== idx) set.add(other);
      }
    }
    return [...set].sort((p, q) => p - q);
  };

  const _grid = grid; // 边界由 occupancy + validateBuild 共同保证
  const received = new Map();
  side.items.forEach((_it, i) => {
    const def = itemById.get(side.items[i].defId);
    if (!def.synergy || def.synergy.length === 0) return;
    const neighbors = neighborsOf(i);
    for (const rule of def.synergy) {
      const qualifying = neighbors.filter((j) => itemById.get(side.items[j].defId).tags.includes(rule.withTag));
      for (const j of qualifying.slice(0, rule.maxStacks)) {
        const acc = received.get(j) || {};
        acc[rule.stat] = (acc[rule.stat] || 0) + rule.add;
        received.set(j, acc);
      }
    }
  });
  return received;
}

const DIRECT_STATE_STATS = new Set(['maxHp', 'maxStamina', 'staminaRegen']);

function capOf(rules, stat) {
  const caps = rules.statCaps;
  return caps[stat] !== undefined ? caps[stat] : Number.POSITIVE_INFINITY;
}

function buffKeys(rules) {
  return Object.keys(rules.statCaps).filter((k) => !DIRECT_STATE_STATS.has(k));
}

function makeBuffs(rules) {
  const b = {};
  for (const k of buffKeys(rules)) b[k] = 0;
  return b;
}

/** 初始化一方战斗状态 */
export function initSide(side, sideIndex, data, round) {
  const { rules, itemById, classById } = data;
  const cls = classById.get(side.cls);
  if (!cls) throw new Error(`未知职业: ${side.cls}`);

  const state = {
    side: sideIndex,
    cls: side.cls,
    name: side.name || cls.name,
    maxHp: cls.base.maxHp,
    maxStamina: cls.base.maxStamina,
    staminaRegen: cls.base.staminaRegen,
    buffs: makeBuffs(rules),
    hp: 0,
    stamina: 0,
    block: 0,
  };
  // 职业基线里除三围外的都是初始 buff
  for (const k of Object.keys(state.buffs)) {
    if (cls.base[k] !== undefined) state.buffs[k] = cls.base[k];
  }

  // 物品入场效果（先 maxHp 类，再其它）
  const startEffects = [];
  side.items.forEach((it, idx) => {
    const def = itemById.get(it.defId);
    if (!def) throw new Error(`未知物品: ${it.defId}`);
    for (const eff of def.effects) {
      if (eff.trigger === 'on_battle_start') startEffects.push({ idx, def, eff, stars: it.stars || 1 });
    }
  });

  const pendingHeal = [];
  for (const { def, eff, stars } of startEffects) {
    const v = eff.value * rules.battle.starMult[stars - 1];
    if (eff.op === 'buff') {
      const stat = eff.stat;
      if (DIRECT_STATE_STATS.has(stat)) {
        state[stat] = Math.min(state[stat] + v, capOf(rules, stat));
      } else {
        state.buffs[stat] = Math.min((state.buffs[stat] || 0) + v, capOf(rules, stat));
      }
    } else if (eff.op === 'block') {
      state.block += v;
    } else if (eff.op === 'heal') {
      pendingHeal.push(v);
    } else if (eff.op === 'stamina') {
      state.stamina += v;
    }
  }

  // 相邻协同 → 以战前 buff 形式叠入
  const syn = computeSynergies(side, itemById, data.rules.meta ? [data.rules.meta.gridCols, data.rules.meta.gridRows] : [6, 5]);
  for (const [, acc] of syn) {
    for (const [stat, v] of Object.entries(acc)) {
      if (DIRECT_STATE_STATS.has(stat)) state[stat] = Math.min(state[stat] + v, capOf(rules, stat));
      else state.buffs[stat] = Math.min((state.buffs[stat] || 0) + v, capOf(rules, stat));
    }
  }

  // 敌方缩放 + 全局回合生命成长
  // hpGrowthPerRound 对**双方**同时生效：它是"这一局打到第几回合"的血量刻度，
  // 让战斗时长在整局中保持稳定（否则后期玩家输出涨 6 倍而血量只涨 1.3 倍，
  // 战斗会在 1 tick 内结束 —— 已由平衡模拟实测复现）。
  const hpScale = side.hpScale === undefined ? 1 : side.hpScale;
  const growth = 1 + rules.battle.hpGrowthPerRound * (round - 1);
  state.maxHp = Math.floor(state.maxHp * hpScale * growth);
  state.hp = state.maxHp;

  // 职业特性
  for (const trait of cls.traits || []) {
    const impl = trait.impl || {};
    if (impl.type === 'onBattleStartBuff') {
      state.buffs[impl.stat] = Math.min((state.buffs[impl.stat] || 0) + impl.value, capOf(rules, impl.stat));
    } else if (impl.type === 'onBattleStartHealPct') {
      pendingHeal.push(Math.floor(state.maxHp * (impl.value / 100)));
    }
  }

  for (const v of pendingHeal) state.hp = Math.min(state.maxHp, state.hp + v);
  state.stamina = Math.min(state.maxStamina, state.stamina + state.maxStamina);

  state.items = side.items.map((it, idx) => ({
    idx,
    defId: it.defId,
    def: itemById.get(it.defId),
    stars: it.stars || 1,
    page: it.page === undefined ? 0 : it.page,
    col: it.col,
    row: it.row,
    rot: it.rot || 0,
    cdRemaining: 0,
  }));
  state.items.sort((a, b) => a.page - b.page || a.row - b.row || a.col - b.col);

  state.atkScale = side.atkScale === undefined ? 1 : side.atkScale;
  return state;
}

/** 战士狂暴：按已损失生命百分比动态提供 atkPct */
function dynamicAtkPct(state, cls, rules) {
  let extra = 0;
  for (const trait of cls.traits || []) {
    const impl = trait.impl || {};
    if (impl.type === 'dynamicAtkPctPerHpLostPct') {
      const lostPct = (1 - state.hp / state.maxHp) * 100;
      extra += Math.min(impl.cap, Math.floor(lostPct / 20) * impl.perPct);
    }
  }
  return extra;
}

/**
 * 主结算函数
 * @param {{seed:number, round:number, a:object, b:object, data:object}} opts
 * @returns {object} BattleLog（见策划书 §6.7）
 */
export function simulate(opts) {
  const { seed, round, a, b, data } = opts;
  const { rules, classById } = data;
  const grid = [rules.meta.gridCols, rules.meta.gridRows];
  const tickSec = rules.battle.tickMs / 1000;
  const maxTicks = rules.battle.maxTicks;
  const starMult = rules.battle.starMult;

  // 布局合法性：非法布局直接抛错，避免"悄悄算出一个结果"
  for (const [label, side] of [['A', a], ['B', b]]) {
    const errs = validateBuild(side, data.itemById, grid);
    if (errs.length > 0) throw new Error(`阵营 ${label} 布局非法: ${errs.join('; ')}`);
  }

  const sides = [initSide(a, 0, data, round), initSide(b, 1, data, round)];
  const rngs = [
    mulberry32(deriveSeed(seed, round, buildFingerprint(a))),
    mulberry32(deriveSeed(seed, round, buildFingerprint(b))),
  ];

  const events = [];
  const log = (e) => events.push(e);
  const snapshotSides = sides.map((s, i) => ({
    cls: s.cls,
    name: s.name,
    maxHp: s.maxHp,
    pages: [a, b][i].pages || null,
    items: s.items.map((i2) => ({ defId: i2.defId, stars: i2.stars, col: i2.col, row: i2.row, rot: i2.rot, page: i2.page })),
  }));

  const clsOf = (s) => classById.get(s.cls);

  const totalAtkPct = (s) => Math.min(s.buffs.atkPct + dynamicAtkPct(s, clsOf(s), rules), capOf(rules, 'atkPct'));

  function activate(s, other, item, tick) {
    const me = item.def.melee === true;
    const sd = rules.battle.suddenDeath;
    const dmgMult = tick >= sd.fromTick ? sd.damageMult : 1;
    log({ t: tick, type: 'activate', side: s.side, slot: item.idx, itemId: item.defId });
    for (const eff of item.def.effects) {
      if (eff.trigger !== 'on_activate') continue;
      const v = eff.value * starMult[item.stars - 1];
      if (eff.op === 'damage') {
        let raw = (v + s.buffs.atkFlat) * (1 + totalAtkPct(s) / 100) * s.atkScale * dmgMult;
        const critChance = Math.min(s.buffs.critChance, capOf(rules, 'critChance'));
        const crit = rngs[s.side]() < critChance / 100;
        if (crit) raw *= Math.min(s.buffs.critMult, capOf(rules, 'critMult'));
        raw = Math.floor(raw);
        const blocked = Math.min(other.block, raw);
        other.block -= blocked;
        const dealt = raw - blocked;
        other.hp -= dealt;
        log({ t: tick, type: 'damage', side: s.side, target: other.side, amount: dealt, blocked: Math.round(blocked), crit });
        if (me) {
          const th = Math.min(other.buffs.thorns, capOf(rules, 'thorns')); // Reflect defender thorns, not attacker thorns.
          if (th > 0) {
            const tb = Math.min(s.block, th);
            s.block -= tb;
            s.hp -= th - tb;
            log({ t: tick, type: 'damage', side: other.side, target: s.side, amount: Math.round(th - tb), blocked: Math.round(tb), crit: false, thorns: true });
          }
        }
        const ls = Math.min(s.buffs.lifesteal, capOf(rules, 'lifesteal'));
        if (ls > 0 && dealt > 0) {
          const gain = Math.floor((dealt * ls) / 100);
          if (gain > 0) {
            s.hp = Math.min(s.maxHp, s.hp + gain);
            log({ t: tick, type: 'heal', side: s.side, amount: gain });
          }
        }
      } else if (eff.op === 'heal') {
        const amount = Math.floor(v * (1 + Math.min(s.buffs.healPct, capOf(rules, 'healPct')) / 100));
        s.hp = Math.min(s.maxHp, s.hp + amount);
        log({ t: tick, type: 'heal', side: s.side, amount });
      } else if (eff.op === 'block') {
        s.block += v;
        log({ t: tick, type: 'block', side: s.side, amount: v });
      } else if (eff.op === 'buff') {
        const stat = eff.stat;
        s.buffs[stat] = Math.min((s.buffs[stat] || 0) + v, capOf(rules, stat));
        log({ t: tick, type: 'buff', side: s.side, stat, value: v, total: s.buffs[stat] });
      } else if (eff.op === 'stamina') {
        s.stamina = Math.min(s.maxStamina, s.stamina + v);
        log({ t: tick, type: 'stamina', side: s.side, value: v, total: s.stamina });
      } else if (eff.op === 'drain') {
        other.stamina = Math.max(0, other.stamina - v);
        log({ t: tick, type: 'stamina', side: other.side, value: -v, total: other.stamina });
      }
    }
    const speedPct = Math.min(s.buffs.speedPct, capOf(rules, 'speedPct'));
    const cd = item.def.cooldown / (1 + speedPct / 100) / tickSec;
    item.cdRemaining = Math.max(1, Math.round(cd));
    s.stamina -= item.def.staminaCost;
  }

  let tick = 0;
  let winner = null;
  // firstStrikeSide 是**测试用**覆盖项（默认 null = 按回合奇偶交替）。
  // 它存在的唯一目的：让 QA 能固定先手方后交换左右阵容，从而验证"引擎不存在任何
  // 位置相关逻辑"。游戏实现不需要暴露该参数，但保留它可以让差分测试也能构造对称用例。
  const forcedFirst = opts.firstStrikeSide === undefined ? null : opts.firstStrikeSide;
  for (; tick < maxTicks; tick += 1) {
    const defaultFirst = round % 2 === 0 ? 0 : 1;
    const firstSide = forcedFirst === null ? defaultFirst : forcedFirst;
    const order = [firstSide, 1 - firstSide];
    let decided = false;
    for (const si of order) {
      const s = sides[si];
      const other = sides[1 - si];
      for (const item of s.items) {
        if (item.cdRemaining > 0) {
          item.cdRemaining -= 1;
          continue;
        }
        if (item.def.staminaCost > s.stamina) continue;
        activate(s, other, item, tick);
      }
      // 关键规则：每方行动结束后**立即**判定死亡。
      // 否则同阵容互殴会因双方在同一 tick 内等量掉血而 100% 平局（已由模拟实测验证）。
      if (sides[0].hp <= 0 || sides[1].hp <= 0) {
        decided = true;
        break;
      }
    }
    if (!decided) {
      for (const s of sides) {
        s.stamina = Math.min(s.maxStamina, s.stamina + s.staminaRegen);
        s.hp = Math.min(s.maxHp, s.hp + Math.min(s.buffs.regenPerTick, capOf(rules, 'regenPerTick')));
      }
    }
    log({
      t: tick,
      type: 'state',
      hp: sides.map((s) => Math.round(Math.max(0, s.hp) * 100) / 100),
      block: sides.map((s) => Math.round(s.block * 100) / 100),
      stamina: sides.map((s) => Math.round(s.stamina * 100) / 100),
    });
    const dead = sides.map((s) => s.hp <= 0);
    if (dead[0] || dead[1]) {
      winner = dead[0] && dead[1] ? 'draw' : dead[0] ? 'B' : 'A';
      break;
    }
  }
  if (winner === null) {
    const r = sides.map((s) => Math.max(0, s.hp) / s.maxHp);
    if (Math.abs(r[0] - r[1]) < 1e-9) winner = 'draw';
    else winner = r[0] > r[1] ? 'A' : 'B';
  }

  const finalHp = sides.map((s) => Math.round(Math.max(0, s.hp) * 100) / 100);
  log({ t: tick, type: 'end', winner });

  return {
    version: '1.0',
    seed,
    round,
    sides: snapshotSides,
    events,
    ticks: Math.min(tick + 1, maxTicks),
    winner,
    finalHp,
  };
}

/** 从战斗日志汇总可玩性/平衡指标 */
export function summarize(log) {
  let maxHit = 0;
  let maxHitSide = -1;
  const dmgByItem = new Map();
  let lastActivate = null;
  let totalDamage = 0;
  let critCount = 0;
  let damageEvents = 0;
  for (const e of log.events) {
    if (e.type === 'activate') lastActivate = e;
    if (e.type === 'damage' && !e.thorns) {
      totalDamage += e.amount;
      damageEvents += 1;
      if (e.crit) critCount += 1;
      if (e.amount > maxHit) {
        maxHit = e.amount;
        maxHitSide = e.side;
      }
      if (lastActivate && lastActivate.side === e.side) {
        const key = `${e.side}:${lastActivate.itemId}`;
        dmgByItem.set(key, (dmgByItem.get(key) || 0) + e.amount);
      }
    }
  }
  let topShare = 0;
  for (const [, v] of dmgByItem) if (totalDamage > 0) topShare = Math.max(topShare, v / totalDamage);
  return {
    ticks: log.ticks,
    seconds: (log.ticks * 0.1),
    winner: log.winner,
    maxHit,
    maxHitSide,
    totalDamage,
    damageEvents,
    critRate: damageEvents > 0 ? critCount / damageEvents : 0,
    topItemDamageShare: topShare,
  };
}

/** 首次适应（行优先）自动摆放，用于敌人生成与模拟中的"玩家"摆放 */
export function packBuild(defs, itemById, grid) {
  const [cols, rows] = grid;
  const occupied = new Set();
  const placed = [];
  for (const spec of defs) {
    const def = itemById.get(spec.defId);
    if (!def) return null;
    let done = false;
    for (const rot of [0, 90]) {
      const [w, h] = effectiveSize(def.size, rot);
      for (let row = 0; row <= rows - h && !done; row += 1) {
        for (let col = 0; col <= cols - w && !done; col += 1) {
          const cells = [];
          let ok = true;
          for (let dx = 0; dx < w && ok; dx += 1) {
            for (let dy = 0; dy < h && ok; dy += 1) {
              const key = `${col + dx},${row + dy}`;
              if (occupied.has(key)) ok = false;
              else cells.push(key);
            }
          }
          if (ok) {
            for (const k of cells) occupied.add(k);
            placed.push({ defId: spec.defId, stars: spec.stars || 1, col, row, rot });
            done = true;
          }
        }
      }
      if (done) break;
    }
    if (!done) return null;
  }
  return placed;
}
