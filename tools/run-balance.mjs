// tools/run-balance.mjs — 批量模拟：难度曲线、经济、公平性、时长、多样性
// 用法: node tools/run-balance.mjs [--runs 500] [--seed 12345] [--calibrate]
import fs from 'node:fs';
import path from 'node:path';
import { loadData, ROOT } from './lib/data.mjs';
import { simulate, summarize, effectiveSize, mulberry32 } from './engine.mjs';

const args = process.argv.slice(2);
const getArg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : def;
};
const RUNS = getArg('runs', 500);
const BASE_SEED = getArg('seed', 20260101);
const CALIBRATE = args.includes('--calibrate');

const data = loadData();
const { rules, items, classes, enemyByRound, itemById, classById } = data;
const Q = rules.qaThresholds;
const ECO = rules.economy;
const MIRROR_SAMPLES = Math.min(2000, Math.max(400, RUNS));

// ---------------------------------------------------------------------------
// 弱玩家代理（贪心 AI）：能力上限低于真人，因此它的胜率是难度的**下界**
// 它不会卖货、不会为协同刻意摆位、不会为利息存钱 —— 这些留白让真人更强。
// ---------------------------------------------------------------------------
const PASSIVE_WEIGHTS = {
  atkPct: 0.15, atkFlat: 0.9, speedPct: 0.08, critChance: 0.12, critMult: 8,
  lifesteal: 0.15, thorns: 0.2, regenPerTick: 8, maxHp: 0.12, healPct: 0.1,
  maxStamina: 0.3, staminaRegen: 1.2,
};

function itemScore(def, ownedDefs) {
  let s = 0;
  if (def.cooldown > 0) {
    for (const e of def.effects) {
      if (e.trigger !== 'on_activate') continue;
      const perSec = e.value / def.cooldown;
      if (e.op === 'damage') s += perSec * 1.0;
      else if (e.op === 'block') s += perSec * 0.8;
      else if (e.op === 'heal') s += perSec * 0.7;
      else if (e.op === 'stamina') s += perSec * 0.25;
      else if (e.op === 'drain') s += perSec * 0.3;
    }
  }
  for (const e of def.effects) {
    if (e.trigger !== 'on_battle_start') continue;
    if (e.op === 'buff') s += e.value * (PASSIVE_WEIGHTS[e.stat] || 0.1);
    if (e.op === 'block') s += e.value * 0.8;
  }
  for (const rule of def.synergy || []) {
    const hits = ownedDefs.filter((d) => d.tags.includes(rule.withTag)).length;
    s += Math.min(hits, rule.maxStacks) * rule.add * (PASSIVE_WEIGHTS[rule.stat] || 0.15);
  }
  return s;
}

const unlockedPageCount = (round) => rules.unlock.pageUnlockRounds.filter((r) => r <= round).length;

function pageSize(page, extraRows) {
  const [cols, rows] = rules.unlock.pageSizes[page];
  return [cols, rows + (extraRows[page] || 0)];
}

function pageCells(page, extraRows) {
  const [c, r] = pageSize(page, extraRows);
  return c * r;
}

/**
 * 单次贪心装箱（首次适应，行优先）。返回 placements 或 null。
 * 注意：该算法**非单调** —— 容器变大可能改变早期物品的落点，反而让后面的物品放不下。
 * 因此对外只用 packAll（多策略重试），不直接调用本函数。
 */
function tryPack(order, pageCount, extraRows, rotOrder) {
  const out = [];
  for (const spec of order) {
    const def = itemById.get(spec.defId);
    if (!def) return null;
    let done = false;
    for (let page = 0; page < pageCount && !done; page += 1) {
      const [cols, rows] = pageSize(page, extraRows);
      const occupied = new Set();
      for (const o of out) {
        if (o.page !== page) continue;
        const d = itemById.get(o.defId);
        const [w, h] = effectiveSize(d.size, o.rot);
        for (let dx = 0; dx < w; dx += 1) for (let dy = 0; dy < h; dy += 1) occupied.add(`${o.col + dx},${o.row + dy}`);
      }
      for (const rot of rotOrder) {
        const [w, h] = effectiveSize(def.size, rot);
        for (let row = 0; row <= rows - h && !done; row += 1) {
          for (let col = 0; col <= cols - w && !done; col += 1) {
            let ok = true;
            for (let dx = 0; dx < w && ok; dx += 1) {
              for (let dy = 0; dy < h && ok; dy += 1) {
                if (occupied.has(`${col + dx},${row + dy}`)) ok = false;
              }
            }
            if (ok) {
              out.push({ defId: spec.defId, stars: spec.stars || 1, page, col, row, rot });
              done = true;
            }
          }
        }
        if (done) break;
      }
    }
    if (!done) return null;
  }
  return out;
}

const defArea = (d) => d.size[0] * d.size[1];
const defMaxDim = (d) => Math.max(d.size[0], d.size[1]);

/**
 * 多策略确定性装箱：按「物品顺序 × 旋转优先级」枚举若干策略，返回第一个成功解。
 * 这是测试工具里的"AI 摆放器"，不是游戏规则 —— 真人由玩家手动摆放。
 */
export function packAll(specs, pageCount, extraRows) {
  const strategies = [
    (l) => l,
    (l) => [...l].sort((a, b) => defArea(itemById.get(b.defId)) - defArea(itemById.get(a.defId)) || a.defId.localeCompare(b.defId)),
    (l) => [...l].sort((a, b) => defMaxDim(itemById.get(b.defId)) - defMaxDim(itemById.get(a.defId)) || a.defId.localeCompare(b.defId)),
    (l) => [...l].sort((a, b) => a.defId.localeCompare(b.defId)),
  ];
  for (const rotOrder of [[0, 90], [90, 0]]) {
    for (const strat of strategies) {
      const r = tryPack(strat(specs), pageCount, extraRows, rotOrder);
      if (r) return r;
    }
  }
  return null;
}

function usedCells(build, extraRows) {
  void extraRows;
  let n = 0;
  for (const o of build) {
    const d = itemById.get(o.defId);
    const [w, h] = effectiveSize(d.size, o.rot);
    n += w * h;
  }
  return n;
}

const rarityWeights = (round) => {
  const row = rules.shop.rarityWeightsByRound.find((w) => round >= w.from && round <= w.to);
  return row ? row.weights : rules.shop.rarityWeightsByRound[rules.shop.rarityWeightsByRound.length - 1].weights;
};

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

const poolFor = (cls, ownedLegendary) => items.items.filter((it) => {
  if (it.cls !== cls && it.cls !== 'neutral') return false;
  if (it.rarity === 'legendary' && ownedLegendary.has(it.id)) return false;
  return true;
});

function genShop(round, cls, ownedLegendary, rng) {
  const slotCount = rules.shop.slotCountByRound[String(round)] || rules.shop.slotCount;
  const pool = poolFor(cls, ownedLegendary);
  const offers = [];
  for (let i = 0; i < slotCount; i += 1) {
    const rarity = weightedPick(rng, rarityWeights(round));
    const cands = pool.filter((it) => it.rarity === rarity);
    const list = cands.length > 0 ? cands : pool;
    offers.push(list[Math.floor(rng() * list.length) % list.length]);
  }
  return offers;
}

const interest = (gold) => Math.min(ECO.interestCap, Math.floor(gold / ECO.interestPerGold));

function roundIncome(round, goldBefore) {
  return ECO.baseIncome
    + Math.floor((round - 1) / ECO.incomeRoundBonusPer) * ECO.incomeRoundBonusStep
    + interest(goldBefore);
}

/** 跑一整局（贪心 AI），返回本局统计 */
function playRun(runSeed, cls) {
  const rng = mulberry32(runSeed);
  const exp = ECO.expansion;
  let gold = ECO.startGold;
  let totalIncome = ECO.startGold;
  let hearts = ECO.startHearts;
  let winStreak = 0;
  let round = 1;
  let expansionCount = 0;
  const extraRows = [0, 0, 0];
  const owned = classById.get(cls).startItems.map((defId) => ({ defId, stars: 1 }));
  const ownedLegendary = new Set(owned.filter((o) => itemById.get(o.defId).rarity === 'legendary').map((o) => o.defId));
  const perRound = [];
  const boughtCount = new Map();
  let maxHitRatio = 0;
  let worstHitAbsolute = 0;
  let worstHitMaxHp = Infinity;
  let worstTopItemShare = 0;
  let topItemShareSamples = 0;
  let timeoutBattles = 0;
  let cantAffordStreak = 0;
  let maxCantAffordStreak = 0;
  let startOptionMisses = 0;
  let roundsPlayed = 0;
  let finalBuild = [];

  while (hearts > 0 && round <= rules.enemyCurve.totalRounds) {
    roundsPlayed = round;
    const income = roundIncome(round, gold);
    gold += income;
    totalIncome += income;
    const pages = unlockedPageCount(round);

    const shop = genShop(round, cls, ownedLegendary, rng);
    if (!shop.some((it) => it.cost <= gold)) {
      startOptionMisses += 1;
      cantAffordStreak += 1;
      maxCantAffordStreak = Math.max(maxCantAffordStreak, cantAffordStreak);
    } else {
      cantAffordStreak = 0;
    }

    // 贪心购买
    const purchased = new Set();
    for (;;) {
      let best = null;
      for (let i = 0; i < shop.length; i += 1) {
        if (purchased.has(i)) continue;
        const def = shop[i];
        if (def.cost > gold) continue;
        // 同 id + 同星满 3 件后不再重复购买（注意不能把已升星的算进 1 星计数）
        if (owned.filter((o) => o.defId === def.id && o.stars === 1).length >= 3) continue;
        if (!packAll([...owned, { defId: def.id, stars: 1 }], pages, extraRows)) continue;
        const sc = itemScore(def, owned.map((o) => itemById.get(o.defId))) / Math.max(1, def.cost);
        if (!best || sc > best.sc) best = { i, def, sc };
      }
      if (!best) break;

      // 试买 → 升星 → **必须重新校验可摆放性**，失败则整体回滚。
      // 否则会出现"上回合还装得下、这回合装不下"的卡死状态（实测复现过）。
      const snapshot = owned.map((o) => ({ ...o }));
      const goldBefore = gold;
      owned.push({ defId: best.def.id, stars: 1 });
      const sameIdx = owned.map((o, k) => ({ o, k })).filter(({ o }) => o.defId === best.def.id && o.stars === 1).map(({ k }) => k);
      if (sameIdx.length >= 3) {
        // 升星：**原位保留第一件**（对应策划书 §5.3 的"保留 slotIndex 最小者的位置"），
        // 而不是挪到列表末尾 —— 列表顺序即装箱顺序，挪位会破坏贪心装箱的稳定性。
        const keep = sameIdx[0];
        owned[keep] = { defId: best.def.id, stars: 2 };
        for (let n = sameIdx.length - 1; n >= 1 && n >= sameIdx.length - 2; n -= 1) {
          if (sameIdx[n] !== keep) owned.splice(sameIdx[n], 1);
        }
      }
      if (!packAll(owned, pages, extraRows)) {
        owned.length = 0;
        for (const o of snapshot) owned.push(o);
        gold = goldBefore;
        purchased.add(best.i);
        continue;
      }
      gold -= best.def.cost;
      if (best.def.rarity === 'legendary') ownedLegendary.add(best.def.id);
      boughtCount.set(best.def.id, (boughtCount.get(best.def.id) || 0) + 1);
      purchased.add(best.i);
    }

    // 背包扩容：金币出口。仅在背包接近装满时购买，符合真人行为
    if (exp.enabled && round >= exp.unlockRound) {
      for (;;) {
        const build0 = packAll(owned, pages, extraRows);
        let total = 0;
        for (let p = 0; p < pages; p += 1) total += pageCells(p, extraRows);
        const fill = build0 ? usedCells(build0, extraRows) / total : 1;
        const lastPage = pages - 1;
        const cost = exp.baseCost + exp.costStep * expansionCount;
        const canExpand = extraRows[lastPage] < exp.maxExtraRowsPerPage;
        if (fill > 0.85 && canExpand && gold >= cost) {
          gold -= cost;
          extraRows[lastPage] += 1;
          expansionCount += 1;
        } else break;
      }
    }

    const build = packAll(owned, pages, extraRows);
    if (!build) throw new Error(`玩家阵容无法摆放 @ round ${round} pages=${pages} extraRows=${JSON.stringify(extraRows)} items=${JSON.stringify(owned.map((o) => `${o.defId}*${o.stars}`))}`);
    const playerPages = Array.from({ length: pages }, (_, p) => pageSize(p, extraRows));
    const enemy = enemyByRound.get(round);
    const jitter = 2 * (rng() - 0.5) * (rules.enemyCurve.randomJitterPct / 100);
    const log = simulate({
      seed: (runSeed ^ Math.imul(round, 2654435761)) >>> 0,
      round,
      a: { cls, items: build, name: 'player', pages: playerPages },
      b: {
        cls: enemy.cls,
        items: enemy.items,
        name: enemy.name,
        hpScale: enemy.hpScale * (1 + jitter),
        atkScale: enemy.atkScale * (1 + jitter),
      },
      data,
    });
    const s = summarize(log);
    const defender = log.sides[s.maxHitSide === 0 ? 1 : 0];
    maxHitRatio = Math.max(maxHitRatio, s.maxHit / Math.max(1, defender.maxHp));
    if (s.maxHit > worstHitAbsolute) {
      worstHitAbsolute = s.maxHit;
      worstHitMaxHp = defender.maxHp;
    }
    worstTopItemShare = Math.max(worstTopItemShare, s.topItemDamageShare);
    if (log.ticks >= rules.battle.maxTicks) timeoutBattles += 1;
    // 单件伤害占比只在"双方都有 ≥2 件输出装、且命中次数足够多"时才有统计意义：
    // 单武器阵容里那件武器必然占 100%，那是构筑选择，不是设计缺陷。
    const damageItemCount = (list) => list.filter((x) => itemById.get(x.defId).effects.some((e) => e.op === 'damage' && e.trigger === 'on_activate')).length;
    if (s.damageEvents >= 10 && damageItemCount(build) >= 2 && damageItemCount(enemy.items) >= 2) {
      worstTopItemShare = Math.max(worstTopItemShare, s.topItemDamageShare);
      topItemShareSamples += 1;
    }

    const won = log.winner === 'A';
    if (won) {
      winStreak += 1;
      const bonus = ECO.winBonus + (winStreak >= ECO.winStreakThreshold ? ECO.winStreakBonus : 0);
      gold += bonus;
      totalIncome += bonus;
    } else {
      winStreak = 0;
      hearts -= log.winner === 'draw' ? ECO.drawHeartCost : ECO.lossHeartCost;
    }
    finalBuild = build.map((b) => b.defId);
    perRound.push({ round, won, ticks: log.ticks, winner: log.winner, gold, itemCount: owned.length });
    round += 1;
  }

  return {
    cls,
    roundsPlayed,
    cleared: roundsPlayed >= rules.enemyCurve.totalRounds && hearts > 0,
    finalGold: gold,
    totalIncome,
    perRound,
    boughtCount,
    maxHitRatio,
    worstHitAbsolute,
    worstHitMaxHp,
    worstTopItemShare,
    topItemShareSamples,
    timeoutBattles,
    startOptionMisses,
    maxCantAffordStreak,
    finalBuild,
    expansionCount,
  };
}

// ---------------------------------------------------------------------------
// 指标 3：左右对称性 + 镜像僵局率
//   (a) 换边一致性：同一对阵容、同一 seed/round，交换左右后结果必须完全镜像。
//       这验证"随机流绑定阵容指纹而非左右位置"这一设计；违规率必须为 0。
//   (b) 镜像僵局率：同阵容互殴不应大量打满 600 tick 靠血量比判定平局。
// ---------------------------------------------------------------------------
function randomBuild(cls, itemCount, rng) {
  const pool = poolFor(cls, new Set());
  const weapons = pool.filter((d) => d.effects.some((e) => e.op === 'damage'));
  // 保证至少 1 件输出装：否则会造出"纯防御/纯食物"的畸形阵容，
  // 双方都打不死对方 → 必然打满 600 tick 判平局，污染公平性统计。
  const specs = [{ defId: weapons[Math.floor(rng() * weapons.length) % weapons.length].id, stars: 1 }];
  for (let i = 1; i < itemCount; i += 1) {
    const d = pool[Math.floor(rng() * pool.length) % pool.length];
    if (specs.filter((s) => s.defId === d.id && s.stars === 1).length >= 3) continue;
    specs.push({ defId: d.id, stars: rng() < 0.25 ? 2 : 1 });
  }
  return packAll(specs, 3, [0, 0, 0])
    || packAll(classById.get(cls).startItems.map((defId) => ({ defId, stars: 1 })), 1, [0, 0, 0]);
}

function fairnessTests(seed, samples) {
  const rng = mulberry32(seed);
  const classIdsLocal = classes.classes.map((c) => c.id);
  const firstStriker = (round) => (round % 2 === 0 ? 'A' : 'B');
  const flip = (w) => (w === 'A' ? 'B' : w === 'B' ? 'A' : 'draw');

  // (a) 左右对称性：**交换左右位置，同时翻转先手方**，两次运行里"先出手的都是同一套阵容"。
  //     此时唯一差异只剩"这套阵容坐在左槽还是右槽"，因此结果必须完全镜像。
  //     常见的两种错误构造：
  //       · 只交换位置不翻转先手方 → 先手权也跟着换了人，是两个不同对局；
  //       · 只翻转先手方不交换位置 → 只是测了"先手优势有多大"，与位置无关。
  let violations = 0;
  let compared = 0;
  for (let i = 0; i < samples; i += 1) {
    const clsX = classIdsLocal[i % classIdsLocal.length];
    const clsY = classIdsLocal[(i + 1) % classIdsLocal.length];
    const X = randomBuild(clsX, 4 + (i % 5), rng);
    const Y = randomBuild(clsY, 4 + ((i + 2) % 5), rng);
    const round = 1 + (i % rules.enemyCurve.totalRounds);
    const s = (seed + i * 7919) >>> 0;
    // 跑 1: X 在左槽(0)、先手 = 左槽  → X 先出手
    const l1 = simulate({ seed: s, round, a: { cls: clsX, items: X }, b: { cls: clsY, items: Y }, data, firstStrikeSide: 0 });
    // 跑 2: X 在右槽(1)、先手 = 右槽  → 仍然是 X 先出手
    const l2 = simulate({ seed: s, round, a: { cls: clsY, items: Y }, b: { cls: clsX, items: X }, data, firstStrikeSide: 1 });
    compared += 1;
    const okWinner = flip(l1.winner) === l2.winner;
    const okHp = Math.abs(l1.finalHp[0] - l2.finalHp[1]) < 1e-6 && Math.abs(l1.finalHp[1] - l2.finalHp[0]) < 1e-6;
    const okTicks = l1.ticks === l2.ticks;
    if (!okWinner || !okHp || !okTicks) violations += 1;
  }

  // (b) 先手优势幅度 + 僵局率（不同阵容对打）
  let fsWins = 0;
  let fsDecided = 0;
  let draws = 0;
  for (let i = 0; i < samples; i += 1) {
    const clsX = classIdsLocal[i % classIdsLocal.length];
    const clsY = classIdsLocal[(i + 2) % classIdsLocal.length];
    const X = randomBuild(clsX, 4 + (i % 5), rng);
    const Y = randomBuild(clsY, 4 + ((i + 3) % 5), rng);
    const round = 1 + (i % rules.enemyCurve.totalRounds);
    const log = simulate({ seed: (seed + i * 104729) >>> 0, round, a: { cls: clsX, items: X }, b: { cls: clsY, items: Y }, data });
    if (log.winner === 'draw') draws += 1;
    else {
      fsDecided += 1;
      if (log.winner === firstStriker(round)) fsWins += 1;
    }
  }

  return {
    violations,
    compared,
    firstStrikeWinRate: fsWins / Math.max(1, fsDecided),
    mixedDrawRate: draws / Math.max(1, samples),
  };
}

function perfBench(iterations) {
  const cls = 'warrior';
  const build = packAll(classById.get(cls).startItems.map((defId) => ({ defId, stars: 1 })), 1, [0, 0, 0]);
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < iterations; i += 1) {
    simulate({ seed: i, round: 1 + (i % 18), a: { cls, items: build }, b: { cls, items: build }, data });
  }
  return Number(process.hrtime.bigint() - t0) / 1e6 / iterations;
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
const classIds = classes.classes.map((c) => c.id);
const runStats = [];
for (let i = 0; i < RUNS; i += 1) {
  runStats.push(playRun((BASE_SEED + i * 104729) >>> 0, classIds[i % classIds.length]));
}

const roundWin = new Map();
for (const r of runStats) {
  for (const pr of r.perRound) {
    if (!roundWin.has(pr.round)) roundWin.set(pr.round, { win: 0, total: 0, ticks: 0 });
    const rec = roundWin.get(pr.round);
    rec.total += 1;
    if (pr.won) rec.win += 1;
    rec.ticks += pr.ticks;
  }
}
const winCurve = [...roundWin.entries()].sort((a, b) => a[0] - b[0]).map(([round, r]) => ({
  round,
  winRate: r.total ? r.win / r.total : 0,
  samples: r.total,
  avgSeconds: r.total ? (r.ticks / r.total) * 0.1 : 0,
}));

// 指标 6：构筑多样性（以"终局阵容里出现了什么"为准，且按职业资格归一化）
const runsByClass = new Map();
for (const r of runStats) runsByClass.set(r.cls, (runsByClass.get(r.cls) || 0) + 1);
const buildAppear = new Map();
for (const r of runStats) for (const id of new Set(r.finalBuild)) buildAppear.set(id, (buildAppear.get(id) || 0) + 1);
const slotCount = new Map();
for (const r of runStats) for (const id of r.finalBuild) slotCount.set(id, (slotCount.get(id) || 0) + 1);
const totalSlots = [...slotCount.values()].reduce((a, b) => a + b, 0);
const top10Slots = [...slotCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).reduce((a, [, n]) => a + n, 0);
const itemUsage = items.items.map((it) => {
  const eligible = it.cls === 'neutral' ? RUNS : (runsByClass.get(it.cls) || 0);
  const appears = buildAppear.get(it.id) || 0;
  const isStartingItem = classes.classes.some((c) => c.startItems.includes(it.id));
  return { id: it.id, name: it.name, cls: it.cls, rarity: it.rarity, appears, eligible, isStartingItem, rate: eligible > 0 ? appears / eligible : 0 };
}).sort((a, b) => a.rate - b.rate);
// 起始物品天然 100% 出场（每个职业开局就带），必须排除在"必买物品"判定之外
const choosable = itemUsage.filter((u) => !u.isStartingItem);
const deadItems = choosable.filter((u) => u.rate < Q.deadItemUsageMin);
const deadItemRate = deadItems.length / choosable.length;
const maxAppearance = Math.max(...choosable.map((u) => u.rate));
const maxAppearanceItem = choosable.find((u) => u.rate === maxAppearance);

const fair = fairnessTests(BASE_SEED, MIRROR_SAMPLES);
const settleMs = perfBench(300);

const avgRounds = runStats.reduce((a, r) => a + r.roundsPlayed, 0) / RUNS;
const clearRate = runStats.filter((r) => r.cleared).length / RUNS;
const unspentRatio = runStats.reduce((a, r) => a + r.finalGold / Math.max(1, r.totalIncome), 0) / RUNS;
const worstUnspentRatio = Math.max(...runStats.map((r) => r.finalGold / Math.max(1, r.totalIncome)));
const avgMaxHitRatio = runStats.reduce((a, r) => a + r.maxHitRatio, 0) / RUNS;
const worstHitAbsolute = Math.max(...runStats.map((r) => r.worstHitAbsolute));
const worstHitMaxHp = Math.min(...runStats.filter((r) => r.worstHitAbsolute === worstHitAbsolute).map((r) => r.worstHitMaxHp));
const noOneShot = runStats.every((r) => r.worstHitAbsolute < r.worstHitMaxHp);
const worstTopItemShare = Math.max(...runStats.map((r) => r.worstTopItemShare));
// 用 p95 而不是 max 做闸门：单件占比是重尾分布，max 会被个别畸形对局主导，
// 用极值当闸门会导致"为了一个样本砍掉整个传奇武器体系"。
const topShares = runStats.map((r) => r.worstTopItemShare).sort((a, b) => a - b);
const p95TopItemShare = topShares[Math.min(topShares.length - 1, Math.floor(topShares.length * 0.95))];
const totalRoundSamples = runStats.reduce((a, r) => a + r.roundsPlayed, 0);
const timeoutRate = runStats.reduce((a, r) => a + r.timeoutBattles, 0) / Math.max(1, totalRoundSamples);
const startOptionRate = 1 - runStats.reduce((a, r) => a + r.startOptionMisses, 0) / Math.max(1, totalRoundSamples);
const worstCantAfford = Math.max(...runStats.map((r) => r.maxCantAffordStreak));
const avgExpansions = runStats.reduce((a, r) => a + r.expansionCount, 0) / RUNS;

const metrics = [
  { id: 1, name: '开局可操作性', value: startOptionRate, threshold: `≥ ${Q.startOptionsProbability}`, pass: startOptionRate >= Q.startOptionsProbability, note: '存在至少 1 件买得起的商品的回合占比' },
  { id: 2, name: '单局时长（回合数）', value: avgRounds, threshold: `${Q.avgRoundsMin}–${Q.avgRoundsMax} 回合，贪心 AI 通关率 ${(rules.enemyCurve.greedyAiClearRate.min * 100).toFixed(0)}–${(rules.enemyCurve.greedyAiClearRate.max * 100).toFixed(0)}%`, pass: avgRounds >= Q.avgRoundsMin && avgRounds <= Q.avgRoundsMax && clearRate >= rules.enemyCurve.greedyAiClearRate.min && clearRate <= rules.enemyCurve.greedyAiClearRate.max, note: `贪心 AI 平均存活 ${avgRounds.toFixed(1)} 回合；通关率 ${(clearRate * 100).toFixed(1)}%` },
  { id: 3, name: '左右对称性', value: fair.compared ? fair.violations / fair.compared : 0, threshold: '换边违规 = 0；先手优势 ≤75%；不同阵容僵局率 ≤10%', pass: fair.violations === 0 && fair.firstStrikeWinRate <= 0.75 && fair.mixedDrawRate <= 0.1, note: `固定先手方后交换左右阵容比对 ${fair.compared} 组，违规 ${fair.violations} 组；不同阵容时先手方胜率 ${(fair.firstStrikeWinRate * 100).toFixed(1)}%；僵局率 ${(fair.mixedDrawRate * 100).toFixed(1)}%` },
  { id: 4, name: '经济健康', value: unspentRatio, threshold: `未花费 ≤ 总收入 ${(Q.maxUnspentGoldRatio * 100).toFixed(0)}%；连续买不起 ≤ ${Q.maxCantAffordStreak} 回合`, pass: unspentRatio <= Q.maxUnspentGoldRatio && worstCantAfford <= Q.maxCantAffordStreak, note: `平均未花费占总收入 ${(unspentRatio * 100).toFixed(1)}%（最坏 ${(worstUnspentRatio * 100).toFixed(1)}%）；平均扩容 ${avgExpansions.toFixed(2)} 次；最长"一件都买不起"连续 ${worstCantAfford} 回合` },
  { id: 5, name: '无秒杀 / 无爆炸', value: p95TopItemShare, threshold: `单次伤害 < maxHp；单件伤害占比 p95 ≤ ${Q.maxTopItemDamageSharePct} 且最坏 ≤ ${Q.maxWorstItemDamageShare}；超时率 ≤1%`, pass: noOneShot && p95TopItemShare <= Q.maxTopItemDamageSharePct && worstTopItemShare <= Q.maxWorstItemDamageShare && timeoutRate <= 0.01, note: `最坏单次伤害 ${worstHitAbsolute.toFixed(0)} vs 对方 maxHp ${worstHitMaxHp.toFixed(0)}（不可满血秒杀：${noOneShot ? '成立' : '被打破'}）；单件占比 p95 ${(p95TopItemShare * 100).toFixed(1)}%、最坏 ${(worstTopItemShare * 100).toFixed(1)}%；超时率 ${(timeoutRate * 100).toFixed(2)}%（已由突然死亡规则压制）` },
  { id: 6, name: '构筑多样性', value: deadItemRate, threshold: `死件率 ≤20%；最高出现率 ≤95%（仅告警）`, pass: deadItemRate <= 0.2, note: `死件 ${deadItems.length}/${choosable.length}（${(deadItemRate * 100).toFixed(1)}%）；最高出现率 ${maxAppearanceItem ? `${maxAppearanceItem.name} ${(maxAppearance * 100).toFixed(1)}%` : '—'}${maxAppearance > 0.95 ? ' ⚠️ 存在近乎必买物品' : ''}；前 10 物品占终局槽位 ${((top10Slots / Math.max(1, totalSlots)) * 100).toFixed(1)}%（参考值）` },
  { id: 7, name: '确定性', value: null, threshold: `${Q.determinismRuns} 次同种子结果一致`, pass: null, note: '由 tools/qa-check.mjs 验证' },
  { id: 8, name: '交互完整性', value: null, threshold: '5 类操作 0 异常', pass: null, note: '需真实前端，由 qa-check 的静态扫描 + 人工清单覆盖' },
  { id: 9, name: '引擎性能', value: settleMs, threshold: `≤ ${Q.engineSettleMsMax} ms / 场`, pass: settleMs <= Q.engineSettleMsMax, note: `参考实现单场结算 ${settleMs.toFixed(3)} ms（游戏实现应同量级）` },
];

// ---------------------------------------------------------------------------
// 输出
// ---------------------------------------------------------------------------
const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const reportsDir = path.join(ROOT, 'reports');
fs.mkdirSync(reportsDir, { recursive: true });

const bandFor = (round) => rules.enemyCurve.winRateBandsByRound.find((b) => round >= b.from && round <= b.to);
const curveRows = winCurve.map((w) => {
  const band = bandFor(w.round);
  return { ...w, band, inBand: band ? w.winRate >= band.min && w.winRate <= band.max : true };
});
const outOfBand = curveRows.filter((r) => !r.inBand);

const lines = [];
lines.push('# 平衡与可玩性报告（模拟实测）');
lines.push('');
lines.push(`- 生成时间: ${new Date().toISOString()}`);
lines.push(`- 样本: **${RUNS}** 局完整对局（4 职业轮换，种子 ${BASE_SEED}）+ **${MIRROR_SAMPLES}** 场镜像对局`);
lines.push(`- 玩家模型: **贪心 AI**（不会卖货、不为协同刻意摆位、不为利息存钱）→ 仅代表该策略，不能推断真人通关率`);
lines.push('');
lines.push('## 九项指标');
lines.push('');
lines.push('| # | 指标 | 实测 | 阈值 | 判定 | 说明 |');
lines.push('|---|---|---|---|---|---|');
for (const m of metrics) {
  const val = m.value === null ? '见 qa-check' : (typeof m.value === 'number' ? m.value.toFixed(4) : String(m.value));
  const verdict = m.pass === null ? '⏭ 待测' : m.pass ? '✅ PASS' : '❌ FAIL';
  lines.push(`| ${m.id} | ${m.name} | ${val} | ${m.threshold} | ${verdict} | ${m.note} |`);
}
lines.push('');
lines.push('## 难度曲线（逐关胜率，贪心 AI 视角）');
lines.push('');
lines.push('| 回合 | 胜率 | 设计区间 | 区间 | 平均战斗时长 | 样本 | 建议 |');
lines.push('|---|---|---|---|---|---|---|');
for (const r of curveRows) {
  const bandTxt = r.band ? `${(r.band.min * 100).toFixed(0)}–${(r.band.max * 100).toFixed(0)}%` : '—';
  let advice = '—';
  if (r.band && !r.inBand) {
    advice = r.winRate > r.band.max
      ? `偏易 → 提高 hpScale/atkScale（×${(1 + (r.winRate - r.band.max) * 1.5).toFixed(2)}）`
      : `偏难 → 降低 hpScale/atkScale（×${Math.max(0.8, 1 - (r.band.min - r.winRate) * 1.5).toFixed(2)}）`;
  }
  lines.push(`| ${r.round} | ${(r.winRate * 100).toFixed(1)}% | ${bandTxt} | ${r.inBand ? '✅' : '⚠️'} | ${r.avgSeconds.toFixed(1)}s | ${r.samples} | ${advice} |`);
}
lines.push('');
lines.push('## 物品在终局阵容中的出现率（越低越可能是死件）');
lines.push('');
lines.push('| 物品 | 职业 | 稀有度 | 出现率 | 样本局数 |');
lines.push('|---|---|---|---|---|');
for (const u of itemUsage.slice(0, 20)) {
  lines.push(`| ${u.name} | ${u.cls} | ${u.rarity} | ${(u.rate * 100).toFixed(1)}% | ${u.eligible} |`);
}
lines.push('');
if (deadItems.length > 0) {
  lines.push(`> ⚠️ **死件告警（出现率 < ${(Q.deadItemUsageMin * 100).toFixed(0)}%）**: ${deadItems.map((d) => `${d.name}(${(d.rate * 100).toFixed(1)}%)`).join('、')}`);
  lines.push('>');
  lines.push('> 注意：贪心 AI 不会为协同摆位，因此**依赖相邻协同的饰品**天然会被低估。判定死件前请人工确认该物品是否只对真人有效。');
  lines.push('');
}

function suggestKnob(id) {
  switch (id) {
    case 1: return '`shop.rarityWeightsByRound`（降低高稀有度权重）或 `economy.baseIncome`';
    case 2: return '`enemies.json` 各关 hpScale/atkScale 与 `rules.enemyCurve`';
    case 3: return '随机流种子与左右位置无关的实现（不该动数值）';
    case 4: return '`economy.expansion` 价格与 `maxExtraRowsPerPage`，或 `interestCap`';
    case 5: return '`rules.statCaps` 与 `battle.starMult`';
    case 6: return '弱物品的 `items.json` 数值（提升弱件，而不是砍强件）';
    case 9: return '结算算法复杂度（避免每 tick 重建数组/对象）';
    default: return '见 docs/02 §16 平衡旋钮清单';
  }
}

lines.push('## 结论与调参建议');
lines.push('');
const failed = metrics.filter((m) => m.pass === false);
if (failed.length === 0 && outOfBand.length === 0) {
  lines.push('- ✅ 全部指标达标，难度曲线全部落在设计区间内。');
} else {
  failed.forEach((m) => lines.push(`- ❌ **指标 ${m.id} ${m.name}** 未达标：实测 ${typeof m.value === 'number' ? m.value.toFixed(4) : m.value}（阈值 ${m.threshold}）→ 调整 ${suggestKnob(m.id)}`));
  if (outOfBand.length > 0) {
    lines.push(`- ⚠️ ${outOfBand.length} 个回合胜率偏离设计区间：${outOfBand.map((r) => `R${r.round}(${(r.winRate * 100).toFixed(0)}%)`).join(', ')}`);
    lines.push('  → 优先改 `data/enemies.json` 对应关卡的 `hpScale`/`atkScale`（跑 `--calibrate` 可直接得到建议值），或增删该关物品。');
  }
}
lines.push('');

const md = lines.join('\n');
fs.writeFileSync(path.join(reportsDir, `balance-${ts}.md`), md, 'utf8');
fs.writeFileSync(path.join(reportsDir, `balance-${ts}.json`), JSON.stringify({
  runs: RUNS, baseSeed: BASE_SEED, metrics, winCurve: curveRows,
  itemUsage, deadItems: deadItems.map((d) => d.id), fairness: fair,
  clearRate, avgRounds, unspentRatio, worstUnspentRatio, settleMs,
}, null, 2), 'utf8');

console.log(md);
console.log(`\n报告已写入 reports/balance-${ts}.md`);

if (CALIBRATE) {
  console.log('\n=== 校准建议（可直接抄进 data/enemies.json）===');
  for (const r of curveRows) {
    if (!r.band) continue;
    const mid = (r.band.min + r.band.max) / 2;
    const factor = Math.pow(mid / Math.max(0.05, r.winRate), 0.6);
    const enemy = enemyByRound.get(r.round);
    const clamp = (v) => Math.min(3, Math.max(0.9, v));
    console.log(`R${String(r.round).padStart(2)} 实测 ${(r.winRate * 100).toFixed(1).padStart(5)}% 目标 ${(mid * 100).toFixed(0)}% → hpScale ${enemy.hpScale.toFixed(3)} → ${clamp(enemy.hpScale * factor).toFixed(3)}   atkScale ${enemy.atkScale.toFixed(3)} → ${clamp(enemy.atkScale * factor).toFixed(3)}`);
  }
}
