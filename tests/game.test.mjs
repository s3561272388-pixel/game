import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { loadData } from "../tools/lib/data.mjs";
import { simulate as oracle } from "../tools/engine.mjs";
import {
  simulate,
  computeSynergies,
  validateBuild,
} from "../packages/engine/battle.mjs";
import {
  newRun,
  act,
  battle,
  settle,
  canPlace,
  playerBuild,
  enemyBuild,
  validateSave,
  mergeGroups,
  expansionCost,
  refund,
} from "../packages/engine/game.mjs";
const d = loadData(),
  fresh = () => newRun("warrior", 123, d),
  clone = (x) => JSON.parse(JSON.stringify(x));
test("four classes have legal starts, deterministic stock and class-only pools", () => {
  for (const cls of d.classById.keys()) {
    const s = newRun(cls, 867, d);
    assert.deepEqual(s, newRun(cls, 867, d));
    assert.equal(validateSave(s, d), true);
    assert.deepEqual(validateBuild(playerBuild(s), d.itemById, s.pages[0]), []);
    assert(
      s.shop.offers.every((id) =>
        ["neutral", cls].includes(d.itemById.get(id).cls),
      ),
    );
  }
});
test("purchase commits only legal placements; rejected actions never mutate", () => {
  const s = fresh();
  s.shop.offers[0] = "wpn_rusty_sword";
  const before = clone(s);
  assert.throws(
    () => act(s, { type: "buy", index: 0, page: 0, col: 0, row: 0, rot: 0 }, d),
    /放不下/,
  );
  assert.deepEqual(s, before);
  const bought = act(
    s,
    { type: "buy", index: 0, page: 0, col: 5, row: 3, rot: 0 },
    d,
  );
  assert.equal(bought.gold, s.gold - 2);
  assert.equal(bought.items.length, s.items.length + 1);
  assert.equal(bought.shop.offers[0], null);
  assert.equal(act(bought, { type: "undo" }, d).gold, s.gold);
});
test("rotation boundaries, moving across pages and collision checks", () => {
  const s = fresh();
  assert(
    !canPlace(
      s,
      { defId: "wpn_steel_sword", stars: 1, page: 0, col: 5, row: 4, rot: 90 },
      d,
    ),
  );
  assert(
    !canPlace(
      s,
      { defId: "wpn_rusty_sword", stars: 1, page: 1, col: 0, row: 0, rot: 0 },
      d,
    ),
  );
  const moved = act(
    s,
    { type: "move", uid: 1, page: 0, col: 3, row: 3, rot: 90 },
    d,
  );
  assert.equal(moved.items[0].rot, 90);
  assert.throws(
    () =>
      act(moved, { type: "move", uid: 1, page: 0, col: 5, row: 4, rot: 90 }, d),
    /重叠|边界/,
  );
});
test("three-item upgrade preserves earliest slot and is irreversible", () => {
  let s = fresh();
  s.gold = 20;
  s.shop.offers[0] = s.shop.offers[1] = "wpn_rusty_sword";
  s = act(s, { type: "buy", index: 0, page: 0, col: 3, row: 0, rot: 0 }, d);
  s = act(s, { type: "buy", index: 1, page: 0, col: 4, row: 0, rot: 0 }, d);
  assert.equal(mergeGroups(s, d).length, 1);
  const m = act(s, { type: "merge" }, d);
  assert.equal(m.items[0].uid, 1);
  assert.equal(m.items[0].stars, 2);
  assert.equal(m.items[0].col, 0);
  assert.equal(m.items.length, 2);
  assert.equal(m.undo.length, 0);
});
test("sale, refund and undo restore exact inventory", () => {
  const s = fresh(),
    sold = act(s, { type: "sell", uid: 1 }, d);
  assert.equal(sold.gold, s.gold + refund(s.items[0], d));
  assert.deepEqual(act(sold, { type: "undo" }, d).items, s.items);
});
test("freeze respects limit and retains offers on reroll and next round", () => {
  let s = fresh();
  for (let i = 0; i < 3; i++) s = act(s, { type: "freeze", index: i }, d);
  assert.throws(() => act(s, { type: "freeze", index: 3 }, d), /最多/);
  const offers = s.shop.offers.slice(0, 3);
  s = act(s, { type: "reroll" }, d);
  assert.deepEqual(s.shop.offers.slice(0, 3), offers);
  assert.equal(s.shop.rerollCost, 2);
  s = act(settle(s, battle(s, d).log, d), { type: "next" }, d);
  assert.deepEqual(s.shop.offers.slice(0, 3), offers);
  assert.equal(s.shop.rerollCost, 1);
});
test("all supported operations reject during result phase", () => {
  const s = fresh(),
    result = settle(s, battle(s, d).log, d);
  for (const action of [
    { type: "reroll" },
    { type: "sell", uid: 1 },
    { type: "move", uid: 1, page: 0, col: 4, row: 2, rot: 0 },
    { type: "buy", index: 0, page: 0, col: 4, row: 2, rot: 0 },
    { type: "merge" },
  ])
    assert.throws(() => act(result, action, d));
  assert.throws(() => settle(result, battle(s, d).log, d), /已经结算/);
});
test("round income, interest, streak and loss use rules", () => {
  let s = fresh();
  s.gold = 17;
  s.winStreak = 2;
  s.round = 5;
  const log = { round: 5, winner: "A", events: [], ticks: 1 };
  const r = settle(s, log, d);
  assert.deepEqual(r.result.receipt, {
    base: 11,
    interest: 3,
    victory: 1,
    streak: 2,
    total: 17,
  });
  assert.equal(r.gold, 34);
  assert.equal(r.hearts, 5);
  assert.equal(settle(s, { ...log, winner: "draw" }, d).hearts, 4);
});
test("expansion limit, price increase and page unlocks", () => {
  let s = fresh();
  assert.throws(() => act(s, { type: "expand", page: 0 }, d), /回合/);
  s.round = 3;
  s.gold = 200;
  const original = s.pages[0][1];
  for (let i = 0; i < 3; i++) {
    const cost = expansionCost(s, d),
      gold = s.gold;
    s = act(s, { type: "expand", page: 0 }, d);
    assert.equal(s.gold, gold - cost);
  }
  assert.equal(s.pages[0][1], original + 3);
  assert.throws(() => act(s, { type: "expand", page: 0 }, d), /上限/);
  s.round = 4;
  s = act(
    settle(s, { round: 4, winner: "A", events: [], ticks: 1 }, d),
    { type: "next" },
    d,
  );
  assert.equal(s.pages.length, 2);
  s.round = 10;
  s = act(
    settle(s, { round: 10, winner: "A", events: [], ticks: 1 }, d),
    { type: "next" },
    d,
  );
  assert.equal(s.pages.length, 3);
});
test("adjacency is orthogonal, capped and never crosses pages", () => {
  const side = {
    cls: "mage",
    pages: [
      [6, 5],
      [6, 4],
    ],
    items: [
      { defId: "trk_mana_gem", stars: 1, page: 0, col: 0, row: 0, rot: 0 },
      { defId: "wpn_spark_staff", stars: 1, page: 0, col: 1, row: 0, rot: 0 },
      { defId: "wpn_spark_staff", stars: 1, page: 1, col: 0, row: 1, rot: 0 },
    ],
  };
  const syn = computeSynergies(side, d.itemById, [6, 5]);
  assert.equal(syn.get(1).atkPct, 5);
  assert(!syn.has(0));
  assert(!syn.has(2));
  side.items[1].col = 2;
  assert.equal(computeSynergies(side, d.itemById, [6, 5]).size, 0);
});
test("pity guarantees rare after dry rounds and owned legendaries cannot be bought twice", () => {
  let s = fresh();
  s.dryRounds = 2;
  s.round = 4;
  s = act(
    settle(s, { round: 4, winner: "A", events: [], ticks: 1 }, d),
    { type: "next" },
    d,
  );
  assert(
    s.shop.offers.some((id) =>
      ["rare", "epic", "legendary"].includes(d.itemById.get(id).rarity),
    ),
  );
  s.gold = 100;
  s.shop.offers[0] = "wpn_doom_hammer";
  s.items = [
    {
      uid: 1,
      defId: "wpn_doom_hammer",
      stars: 1,
      col: 0,
      row: 0,
      page: 0,
      rot: 0,
    },
  ];
  assert.throws(
    () => act(s, { type: "buy", index: 0, page: 0, col: 4, row: 0, rot: 0 }, d),
    /传说/,
  );
});
test("empty inventory persists but cannot start battle; corrupt saves are rejected", () => {
  let s = fresh();
  for (const i of [...s.items]) s = act(s, { type: "sell", uid: i.uid }, d);
  assert(validateSave(s, d));
  assert.throws(() => battle(s, d), /武器/);
  for (const mutate of [
    (s) => (s.gold = -1),
    (s) => (s.round = 99),
    (s) => (s.shop.offers = ["missing"]),
    (s) => (s.items[0].stars = 9),
    (s) => (s.items[0].page = 8),
    (s) => (s.items[0].col = 0.5),
    (s) => delete s.nextId,
  ]) {
    const bad = fresh();
    mutate(bad);
    assert(!validateSave(bad, d));
  }
});
test("ending handles round 18 and exhausted hearts without generating round 19", () => {
  let s = fresh();
  s.round = 18;
  s = act(
    settle(s, { round: 18, winner: "A", events: [], ticks: 1 }, d),
    { type: "next" },
    d,
  );
  assert.equal(s.phase, "END");
  assert.equal(s.round, 18);
  s = fresh();
  s.hearts = 1;
  s = act(
    settle(s, { round: 1, winner: "B", events: [], ticks: 1 }, d),
    { type: "next" },
    d,
  );
  assert.equal(s.phase, "END");
  assert.equal(s.hearts, 0);
});
test("game battle matches supplied oracle, deterministic replays and CLI-compatible evals", () => {
  fs.mkdirSync("reports/evals", { recursive: true });
  for (const cls of d.classById.keys())
    for (const round of [1, 7, 15, 18]) {
      const s = newRun(cls, 100 + round, d);
      s.round = round;
      s.pages = d.rules.unlock.pageSizes.slice(
        0,
        d.rules.unlock.pageUnlockRounds.filter((r) => r <= round).length,
      );
      const ev = battle(s, d);
      assert.deepEqual(ev.log, oracle({ ...ev, data: d }));
      assert.deepEqual(ev.log, battle(s, d).log);
      fs.writeFileSync(
        `reports/evals/${cls}-${round}.json`,
        JSON.stringify(ev),
      );
    }
});
test("enemy build jitter is deterministic and layouts are legal on all rounds", () => {
  for (let round = 1; round <= 18; round++) {
    const s = fresh();
    s.round = round;
    const a = enemyBuild(s, d);
    assert.deepEqual(a, enemyBuild(s, d));
    assert.deepEqual(validateBuild(a, d.itemById, [6, 5]), []);
    assert.equal(
      simulate({ seed: s.seed, round, a: playerBuild(s), b: a, data: d })
        .version,
      "1.0",
    );
  }
});
test("thorns belong to the defender, and only reflect melee damage", () => {
  const weapon = {
      defId: "wpn_rusty_sword",
      stars: 1,
      page: 0,
      col: 0,
      row: 0,
      rot: 0,
    },
    armor = {
      defId: "arm_thorn_mail",
      stars: 1,
      page: 0,
      col: 1,
      row: 0,
      rot: 0,
    };
  const a = { cls: "warrior", items: [weapon] },
    b = { cls: "warrior", items: [armor] };
  const log = simulate({ seed: 1, round: 2, a, b, data: d });
  const reflected = log.events.find((e) => e.type === "damage" && e.thorns);
  assert(reflected);
  assert.equal(reflected.side, 1);
  assert.equal(reflected.target, 0);
  assert(reflected.amount > 0);
  const self = simulate({
    seed: 1,
    round: 2,
    a: { cls: "warrior", items: [weapon, armor] },
    b: { cls: "warrior", items: [] },
    data: d,
  });
  assert(!self.events.some((e) => e.thorns));
  const ranged = simulate({
    seed: 1,
    round: 2,
    a: { cls: "ranger", items: [{ ...weapon, defId: "wpn_hunting_bow" }] },
    b,
    data: d,
  });
  assert(!ranged.events.some((e) => e.thorns));
});
test("timeout contains exactly maxTicks states and no 601st tick duration", () => {
  const empty = { cls: "warrior", items: [] };
  const log = simulate({ seed: 1, round: 1, a: empty, b: empty, data: d });
  assert.equal(log.ticks, d.rules.battle.maxTicks);
  assert.equal(
    log.events.filter((e) => e.type === "state").length,
    d.rules.battle.maxTicks,
  );
  assert.equal(log.winner, "draw");
});
test('undoing a purchase restores the full state including instance allocation', () => {
  const s = fresh(); s.shop.offers[0] = 'wpn_rusty_sword';
  const bought = act(s, { type: 'buy', index: 0, page: 0, col: 5, row: 2, rot: 0 }, d);
  assert.deepEqual(act(bought, { type: 'undo' }, d), s);
});
test('partial and malformed saves are rejected without throwing or duplicate instance IDs', () => {
  for (const mutate of [
    s => s.pages[0] = null,
    s => s.items[0] = null,
    s => delete s.items[0].uid,
    s => s.nextId = 1,
    s => s.shop.offers = [],
    s => s.shop.frozen[0] = 'false',
    s => { s.shop.offers[0] = null; s.shop.frozen[0] = true; },
    s => { s.phase = 'RESULT'; s.result = {winner:'A',receipt:{},ticks:1}; },
  ]) {
    const s = fresh(); mutate(s); assert.equal(validateSave(s, d), false);
  }
});
