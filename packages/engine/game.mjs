import {
  mulberry32,
  deriveSeed,
  effectiveSize,
  validateBuild,
  packBuild,
  simulate,
} from "./battle.mjs";
export const clone = (value) => JSON.parse(JSON.stringify(value));
export function makeData(rules, items, classes, enemies) {
  return {
    rules,
    items,
    classes,
    enemies,
    itemById: new Map(items.items.map((i) => [i.id, i])),
    classById: new Map(classes.classes.map((i) => [i.id, i])),
    enemyByRound: new Map(enemies.enemies.map((i) => [i.round, i])),
  };
}
const orderedRarities = ["common", "uncommon", "rare", "epic", "legendary"];
export function playerBuild(s) {
  return {
    cls: s.cls,
    items: s.items.map(({ uid, ...i }) => i),
    pages: s.pages,
    hpScale: 1 + (s.blessings?.hpPct || 0) / 100,
    atkScale: 1 + (s.blessings?.atkPct || 0) / 100,
  };
}
export function availablePool(s, d) {
  return d.items.items.filter(
    (i) =>
      (i.cls === s.cls || i.cls === "neutral") &&
      !(
        d.rules.shop.legendaryUniquePerRun &&
        i.rarity === "legendary" &&
        (s.items.some((x) => x.defId === i.id) || (s.rewardStash || []).includes(i.id))
      ),
  );
}
function stock(s, d, newRound = false) {
  const rule = d.rules.shop,
    rng = mulberry32(deriveSeed(s.seed, s.round, "shop:" + s.rolls++));
  const pool = availablePool(s, d),
    weights = rule.rarityWeightsByRound.find(
      (w) => s.round >= w.from && s.round <= w.to,
    ).weights;
  const slots =
    Object.entries(rule.slotCountByRound)
      .filter(([r]) => Number(r) <= s.round)
      .sort((a, b) => Number(b[0]) - Number(a[0]))[0]?.[1] || rule.slotCount;
  s.shop.offers = Array.from({ length: slots }, (_, index) => {
    if (s.shop.frozen[index] && s.shop.offers[index])
      return s.shop.offers[index];
    const candidates = orderedRarities.filter(
      (r) => weights[r] > 0 && pool.some((i) => i.rarity === r),
    );
    let n = rng() * candidates.reduce((sum, r) => sum + weights[r], 0),
      rarity = candidates.at(-1);
    for (const r of candidates) {
      n -= weights[r];
      if (n < 0) {
        rarity = r;
        break;
      }
    }
    const choices = pool.filter((i) => i.rarity === rarity);
    return choices[Math.floor(rng() * choices.length)].id;
  });
  if (newRound) {
    const hasRare = () =>
      s.shop.offers.some(
        (id) => orderedRarities.indexOf(d.itemById.get(id).rarity) >= 2,
      );
    if (!hasRare() && s.dryRounds >= rule.pityRareAfterDryRounds) {
      const idx = s.shop.offers.findIndex((_, i) => !s.shop.frozen[i]);
      const choices = pool.filter((i) => i.rarity === "rare");
      if (idx >= 0 && choices.length)
        s.shop.offers[idx] = choices[Math.floor(rng() * choices.length)].id;
    }
    s.dryRounds = hasRare() ? 0 : s.dryRounds + 1;
  }
  if (
    !newRound &&
    s.shop.offers.some(
      (id) => orderedRarities.indexOf(d.itemById.get(id).rarity) >= 2,
    )
  )
    s.dryRounds = 0;
  s.shop.frozen = Array.from({ length: slots }, (_, i) => !!s.shop.frozen[i]);
}
export function newRun(cls, seed, d) {
  if (!d.classById.has(cls)) throw Error("请选择共鸣者");
  const pages = [clone(d.rules.unlock.pageSizes[0])];
  const start = packBuild(
    d.classById.get(cls).startItems.map((defId) => ({ defId, stars: 1 })),
    d.itemById,
    pages[0],
  );
  const s = {
    version: 1,
    seed: seed >>> 0,
    cls,
    round: 1,
    hearts: d.rules.economy.startHearts,
    gold: d.rules.economy.startGold,
    winStreak: 0,
    wins: 0,
    phase: "SHOP",
    pages,
    items: start.map((x, i) => ({ ...x, page: 0, uid: i + 1 })),
    nextId: start.length + 1,
    shop: { offers: [], frozen: [], rerollCost: d.rules.shop.rerollBaseCost },
    rolls: 0,
    dryRounds: 0,
    expansions: 0,
    undo: [],
    history: [],
    income: d.rules.economy.startGold,
    discovered: [...d.classById.get(cls).startItems],
    maxHit: 0,
    rewardStash: [],
    rewardHistory: [],
    blessings: { hpPct: 0, atkPct: 0 },
  };
  stock(s, d, true);
  return s;
}
function remember(s) {
  const { undo, ...snap } = s;
  s.undo = [...s.undo, clone(snap)].slice(-20);
}
export function refund(item, d) {
  return Math.max(
    d.rules.shop.sellRefundMin,
    Math.floor(d.itemById.get(item.defId).cost * d.rules.shop.sellRefundRatio),
  );
}
export function expansionCost(s, d) {
  return (
    d.rules.economy.expansion.baseCost +
    s.expansions * d.rules.economy.expansion.costStep
  );
}
export function canPlace(s, spec, d, ignoreUid) {
  if (
    !s.pages[spec.page] ||
    !Number.isInteger(spec.col) ||
    !Number.isInteger(spec.row) ||
    ![0, 90, 180, 270].includes(spec.rot)
  )
    return false;
  return (
    validateBuild(
      {
        pages: s.pages,
        items: [...s.items.filter((i) => i.uid !== ignoreUid), spec],
      },
      d.itemById,
      s.pages[0],
    ).length === 0
  );
}
export function mergeGroups(s, d) {
  const groups = new Map();
  s.items.forEach((i) => {
    if (i.stars >= d.rules.battle.maxStars) return;
    const k = i.defId + ":" + i.stars;
    groups.set(k, [...(groups.get(k) || []), i]);
  });
  return [...groups.values()].filter((a) => a.length >= 3);
}
export function enemyBuild(s, d) {
  const enemy = clone(d.enemyByRound.get(s.round)),
    j = d.rules.enemyCurve.randomJitterPct / 100,
    rng = mulberry32(deriveSeed(s.seed, s.round, "enemy"));
  enemy.hpScale *= 1 + (rng() * 2 - 1) * j;
  enemy.atkScale *= 1 + (rng() * 2 - 1) * j;
  enemy.pages = d.rules.unlock.pageSizes.slice(
    0,
    d.rules.unlock.pageUnlockRounds.filter((r) => r <= s.round).length,
  );
  return enemy;
}
export function isRewardRound(s, d) {
  return !!d.rules.rewards?.enabled && s.hearts > 0 &&
    s.round < d.rules.enemyCurve.totalRounds && s.round % d.rules.rewards.everyRounds === 0 &&
    !(s.rewardHistory || []).some(r => r.round === s.round);
}
export function rewardOffer(s, d) {
  const r = d.rules.rewards;
  const tier = r.weaponTiers.filter(t => t.fromRound <= s.round).at(-1).rarity;
  const owned = new Set([...s.items.map(i => i.defId), ...(s.rewardStash || [])]);
  const weapons = d.items.items.filter(i => i.rarity === tier && i.tags.includes('weapon') &&
    !(tier === 'legendary' && owned.has(i.id)));
  const preferred = weapons.filter(i => i.cls === s.cls || i.cls === 'neutral');
  // Bonus weapons can be equipped by any class, including classes without a weapon at this tier.
  const pool = preferred.length ? preferred : weapons;
  const rng = mulberry32(deriveSeed(s.seed, s.round, 'reward'));
  return { round: s.round, weaponId: pool.length ? pool[Math.floor(rng() * pool.length)].id : null,
    rarity: tier, gold: r.baseGold + (s.round / r.everyRounds - 1) * r.goldStep,
    hpPct: r.hpPct, atkPct: r.atkPct };
}
function advanceRound(s, d) {
  s.round++;
  s.phase = 'SHOP';
  s.shop.rerollCost = d.rules.shop.rerollBaseCost;
  s.undo = [];
  delete s.reward;
  d.rules.unlock.pageUnlockRounds.forEach((r, i) => {
    if (r <= s.round && !s.pages[i]) s.pages.push(clone(d.rules.unlock.pageSizes[i]));
  });
  stock(s, d, true);
  return s;
}
export function battle(s, d) {
  if (s.phase !== "SHOP") throw Error("当前不能发起战斗");
  if (
    !s.items.some((i) =>
      d.itemById.get(i.defId).effects.some((e) => e.op === "damage"),
    )
  )
    throw Error("请先装备至少一件能造成伤害的武器");
  const a = playerBuild(s),
    b = enemyBuild(s, d);
  return {
    seed: s.seed,
    round: s.round,
    a,
    b,
    log: simulate({ seed: s.seed, round: s.round, a, b, data: d }),
  };
}
export function settle(s, log, d) {
  if (s.phase !== "SHOP" || log.round !== s.round)
    throw Error("本回合已经结算");
  s = clone(s);
  const e = d.rules.economy;
  const win = log.winner === "A";
  s.winStreak = win ? s.winStreak + 1 : 0;
  s.wins += Number(win);
  if (!win)
    s.hearts = Math.max(
      0,
      s.hearts - (log.winner === "draw" ? e.drawHeartCost : e.lossHeartCost),
    );
  const receipt = {
    base:
      e.baseIncome +
      Math.floor((s.round - 1) / e.incomeRoundBonusPer) *
        e.incomeRoundBonusStep,
    interest: Math.min(e.interestCap, Math.floor(s.gold / e.interestPerGold)),
    victory: win ? e.winBonus : 0,
    streak: s.winStreak >= e.winStreakThreshold ? e.winStreakBonus : 0,
  };
  receipt.total = Object.values(receipt).reduce((a, b) => a + b, 0);
  s.gold += receipt.total;
  s.income += receipt.total;
  s.maxHit = Math.max(
    s.maxHit,
    ...log.events
      .filter((e) => e.type === "damage" && e.side === 0)
      .map((e) => e.amount),
  );
  s.history.push({ round: s.round, winner: log.winner, ticks: log.ticks });
  s.result = { winner: log.winner, receipt, ticks: log.ticks };
  s.phase = "RESULT";
  s.undo = [];
  return s;
}
export function act(state, action, d) {
  if (action.type === "undo") {
    if (state.phase !== "SHOP" || !state.undo.length)
      throw Error("没有可以撤销的操作");
    const s = clone(state.undo.at(-1));
    s.undo = state.undo.slice(0, -1);
    return s;
  }
  let s = clone(state);
  if (action.type === "next") {
    if (s.phase !== "RESULT") throw Error("请先完成战斗");
    if (s.hearts <= 0 || s.round >= d.rules.enemyCurve.totalRounds) {
      s.phase = "END";
      return s;
    }
    if (isRewardRound(s, d)) {
      s.phase = 'REWARD';
      s.reward = rewardOffer(s, d);
      s.undo = [];
      return s;
    }
    return advanceRound(s, d);
  }
  if (action.type === 'reward') {
    if (s.phase !== 'REWARD' || !isRewardRound(s, d)) throw Error('当前没有可领取的奖励');
    const offer = rewardOffer(s, d);
    if (!['weapon', 'gold', 'stats'].includes(action.choice)) throw Error('请选择一项奖励');
    s.rewardStash ??= [];
    s.rewardHistory ??= [];
    s.blessings ??= { hpPct: 0, atkPct: 0 };
    if (action.choice === 'weapon') {
      if (!offer.weaponId) throw Error('本阶武器已集齐，请选择其他奖励');
      s.rewardStash.push(offer.weaponId);
      if (!s.discovered.includes(offer.weaponId)) s.discovered.push(offer.weaponId);
    } else if (action.choice === 'gold') {
      s.gold += offer.gold;
      s.income += offer.gold;
    } else {
      s.blessings.hpPct += offer.hpPct;
      s.blessings.atkPct += offer.atkPct;
    }
    s.rewardHistory.push({ round: s.round, choice: action.choice, ...offer });
    return advanceRound(s, d);
  }
  if (s.phase !== "SHOP") throw Error("战斗与结算期间不能整理背包");
  if (action.type === 'equipReward') {
    const id = s.rewardStash?.[action.index];
    if (!d.itemById.has(id)) throw Error('找不到这件奖励武器');
    const item = { defId: id, stars: 1, uid: s.nextId, page: action.page, col: action.col, row: action.row, rot: action.rot || 0 };
    if (!canPlace(s, item, d)) throw Error('放不下：奖励仍会保留，请整理背包或扩容');
    remember(s);
    s.nextId++;
    s.items.push(item);
    s.rewardStash.splice(action.index, 1);
  } else if (action.type === "buy") {
    const id = s.shop.offers[action.index],
      def = d.itemById.get(id);
    if (!def) throw Error("这件补给已售出");
    if (s.gold < def.cost) throw Error("贝币不足");
    if (!availablePool(s, d).some((i) => i.id === id))
      throw Error("同名传说物品只能持有一件");
    const item = {
      defId: id,
      stars: 1,
      page: action.page,
      col: action.col,
      row: action.row,
      rot: action.rot || 0,
      uid: s.nextId,
    };
    if (!canPlace(s, item, d)) throw Error("放不下：请避开已有物品和背包边界");
    remember(s);
    s.nextId++;
    s.gold -= def.cost;
    s.items.push(item);
    s.shop.offers[action.index] = null;
    s.shop.frozen[action.index] = false;
    if (!s.discovered.includes(id)) s.discovered.push(id);
  } else if (action.type === "move") {
    const i = s.items.find((i) => i.uid === action.uid);
    if (!i) throw Error("找不到这件物品");
    const target = {
      ...i,
      page: action.page,
      col: action.col,
      row: action.row,
      rot: action.rot,
    };
    if (!canPlace(s, target, d, i.uid))
      throw Error("无法放置：格子重叠或超出边界");
    remember(s);
    Object.assign(i, target);
  } else if (action.type === "sell") {
    const i = s.items.find((i) => i.uid === action.uid);
    if (!i) throw Error("请先选择背包中的物品");
    remember(s);
    s.gold += refund(i, d);
    s.items = s.items.filter((x) => x.uid !== i.uid);
  } else if (action.type === "reroll") {
    if (s.gold < s.shop.rerollCost) throw Error("刷新所需贝币不足");
    s.gold -= s.shop.rerollCost;
    s.shop.rerollCost += d.rules.shop.rerollCostStep;
    stock(s, d);
    s.undo = [];
  } else if (action.type === "freeze") {
    if (!s.shop.offers[action.index]) throw Error("空货架不能锁定");
    if (
      !s.shop.frozen[action.index] &&
      s.shop.frozen.filter(Boolean).length >= d.rules.shop.freezeSlots
    )
      throw Error("最多锁定 " + d.rules.shop.freezeSlots + " 件补给");
    s.shop.frozen[action.index] = !s.shop.frozen[action.index];
  } else if (action.type === "expand") {
    const e = d.rules.economy.expansion,
      p = action.page;
    if (!s.pages[p]) throw Error("背包页尚未解锁");
    if (!e.enabled || s.round < e.unlockRound)
      throw Error("第 " + e.unlockRound + " 回合开放扩容");
    if (s.pages[p][1] >= d.rules.unlock.pageSizes[p][1] + e.maxExtraRowsPerPage)
      throw Error("这一页已扩容至上限");
    const cost = expansionCost(s, d);
    if (s.gold < cost) throw Error("扩容所需贝币不足");
    remember(s);
    s.gold -= cost;
    s.pages[p][1] += e.rowsPerPurchase;
    s.expansions++;
  } else if (action.type === "merge") {
    const g = mergeGroups(s, d)[0];
    if (!g) throw Error("需要三件同名、同星级物品才能合成");
    const keep = g[0];
    keep.stars++;
    s.items = s.items.filter((i) => i.uid !== g[1].uid && i.uid !== g[2].uid);
    s.undo = [];
  } else throw Error("未知操作");
  return s;
}
export function validateSave(s, d) {
  try { return validateSaveShape(s, d); } catch { return false; }
}
function validateSaveShape(s, d) {
  if (
    !s ||
    s.version !== 1 ||
    !d.classById.has(s.cls) ||
    !Number.isInteger(s.seed) ||
    !Number.isInteger(s.round) ||
    s.round < 1 ||
    s.round > d.rules.enemyCurve.totalRounds ||
    !["SHOP", "RESULT", "REWARD", "END"].includes(s.phase)
  )
    return false;
  if (
    !Number.isFinite(s.gold) ||
    s.gold < 0 ||
    !Number.isInteger(s.hearts) ||
    s.hearts < 0 ||
    s.hearts > d.rules.economy.startHearts ||
    !Array.isArray(s.pages) ||
    !s.pages.length ||
    !Array.isArray(s.items) ||
    !s.shop ||
    !Array.isArray(s.shop.offers) ||
    !Array.isArray(s.shop.frozen)
  )
    return false;
  if (
    [
      "nextId",
      "rolls",
      "dryRounds",
      "expansions",
      "winStreak",
      "wins",
      "income",
      "maxHit",
    ].some((k) => !Number.isFinite(s[k]) || s[k] < 0) ||
    !Array.isArray(s.history) ||
    !Array.isArray(s.discovered) ||
    !Number.isFinite(s.shop.rerollCost) ||
    s.shop.rerollCost < d.rules.shop.rerollBaseCost
  )
    return false;
  if (
    s.phase === "RESULT" &&
    (!s.result ||
      !["A", "B", "draw"].includes(s.result.winner) ||
      !s.result.receipt ||
      Object.values(s.result.receipt).some((v) => !Number.isFinite(v)))
  )
    return false;
  const count = d.rules.unlock.pageUnlockRounds.filter(
    (r) => r <= s.round,
  ).length;
  if (
    s.pages.length !== count ||
    s.pages.some(
      (p, i) =>
        p[0] !== d.rules.unlock.pageSizes[i][0] ||
        !Number.isInteger(p[1]) ||
        p[1] < d.rules.unlock.pageSizes[i][1] ||
        p[1] >
          d.rules.unlock.pageSizes[i][1] +
            d.rules.economy.expansion.maxExtraRowsPerPage,
    )
  )
    return false;
  if (
    s.items.some(
      (i) =>
        !Number.isInteger(i.uid) || i.uid < 1 ||
        !d.itemById.has(i.defId) ||
        !Number.isInteger(i.stars) ||
        i.stars < 1 ||
        i.stars > d.rules.battle.maxStars ||
        !s.pages[i.page] ||
        ![0, 90, 180, 270].includes(i.rot) ||
        !Number.isInteger(i.col) ||
        !Number.isInteger(i.row),
    )
  )
    return false;
  if (
    new Set(s.items.map((i) => i.uid)).size !== s.items.length ||
    !Number.isInteger(s.nextId) || s.nextId <= Math.max(0, ...s.items.map(i => i.uid)) ||
    s.shop.offers.some((id) => id !== null && !d.itemById.has(id))
  )
    return false;
  const slots = Object.entries(d.rules.shop.slotCountByRound)
    .filter(([round]) => Number(round) <= s.round)
    .sort((a, b) => Number(b[0]) - Number(a[0]))[0]?.[1] || d.rules.shop.slotCount;
  if (s.shop.offers.length !== slots || s.shop.frozen.length !== slots ||
      s.shop.frozen.some((v, i) => typeof v !== 'boolean' || (v && !s.shop.offers[i])) ||
      s.shop.frozen.filter(Boolean).length > d.rules.shop.freezeSlots) return false;
  if (s.phase === 'RESULT' && ['base', 'interest', 'victory', 'streak', 'total'].some(k => !Number.isFinite(s.result.receipt[k]) || s.result.receipt[k] < 0)) return false;
  if (s.rewardStash !== undefined && (!Array.isArray(s.rewardStash) || s.rewardStash.length > 5 || s.rewardStash.some(id => !d.itemById.has(id)))) return false;
  if (s.blessings !== undefined && ['hpPct', 'atkPct'].some(k => !Number.isFinite(s.blessings[k]) || s.blessings[k] < 0 || s.blessings[k] > 100)) return false;
  if (s.rewardHistory !== undefined && (!Array.isArray(s.rewardHistory) || s.rewardHistory.length > 5 ||
    new Set(s.rewardHistory.map(r => r.round)).size !== s.rewardHistory.length ||
    s.rewardHistory.some(r => !Number.isInteger(r.round) || r.round < 3 || r.round >= s.round || r.round % 3 !== 0 || !['weapon', 'gold', 'stats'].includes(r.choice)))) return false;
  if (s.phase === 'REWARD' && (!isRewardRound(s, d) || JSON.stringify(s.reward) !== JSON.stringify(rewardOffer(s, d)))) return false;
  try {
    return validateBuild(playerBuild(s), d.itemById, s.pages[0]).length === 0;
  } catch {
    return false;
  }
}
