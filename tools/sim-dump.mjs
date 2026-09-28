// tools/sim-dump.mjs — 参考实现的批次导出口（契约样板）
//
// 这个脚本演示了游戏引擎**必须提供**的接口形态，供 tools/diff-test.mjs 做差分测试。
// GPT-6 需要在 packages/engine 里实现等价的 CLI：
//   pnpm -F engine sim:dump --seed <n> --round <n> --a <buildA.json> --b <buildB.json> --out <eval.json>
// 输出结构与本脚本完全一致（seed / round / a / b / log）。
//
// 用法:
//   node tools/sim-dump.mjs --seed 1 --round 7 --a a.json --b b.json --out out/eval-1.json
//   node tools/sim-dump.mjs --demo --out out/            # 生成 3 个演示用例（自有阵容）
import fs from 'node:fs';
import path from 'node:path';
import { loadData, ROOT } from './lib/data.mjs';
import { simulate, packBuild } from './engine.mjs';

const args = process.argv.slice(2);
const getArg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const data = loadData();

const buildFromFile = (p) => {
  const abs = path.isAbsolute(p) ? p : path.join(ROOT, p);
  const raw = JSON.parse(fs.readFileSync(abs, 'utf8'));
  return { cls: raw.cls, items: raw.items, pages: raw.pages, hpScale: raw.hpScale, atkScale: raw.atkScale };
};

function demoBuild(cls, round) {
  const startIds = data.classById.get(cls).startItems;
  const pool = data.items.items.filter((it) => it.cls === cls || it.cls === 'neutral');
  const isDmg = (d) => d.effects.some((e) => e.op === 'damage' && e.trigger === 'on_activate');
  const pageCount = data.rules.unlock.pageUnlockRounds.filter((r) => r <= round).length;
  const sizes = data.rules.unlock.pageSizes.slice(0, pageCount);

  const specs = startIds.map((defId) => ({ defId, stars: 1 }));
  let budget = 12 + 5 * (round - 1);
  // 先补足 2 件输出装，避免生成"双方都打不死对方"的畸形演示阵容
  const ordered = [...pool.filter(isDmg), ...pool.filter((d) => !isDmg(d))];
  let dmgAdded = specs.filter((s) => isDmg(data.itemById.get(s.defId))).length;
  for (const it of ordered) {
    if (budget < it.cost) continue;
    if (dmgAdded < 2 && !isDmg(it)) continue;
    if (specs.filter((s) => s.defId === it.id).length >= 3) continue;
    specs.push({ defId: it.id, stars: round >= 12 && it.rarity !== 'legendary' ? 2 : 1 });
    if (isDmg(it)) dmgAdded += 1;
    budget -= it.cost;
  }
  // 逐件分配到各背包页（不能整页一次性 pack：装不下会整页失败）
  const buckets = sizes.map(() => []);
  for (const spec of specs) {
    let placed = false;
    for (let p = 0; p < buckets.length && !placed; p += 1) {
      if (packBuild([...buckets[p], spec], data.itemById, sizes[p])) {
        buckets[p].push(spec);
        placed = true;
      }
    }
  }
  const out = [];
  buckets.forEach((bucket, p) => {
    if (bucket.length === 0) return;
    for (const o of packBuild(bucket, data.itemById, sizes[p])) out.push({ ...o, page: p });
  });
  return { cls, items: out, pages: sizes };
}

const outArg = getArg('out', null);
if (args.includes('--demo')) {
  const dir = outArg ? (path.isAbsolute(outArg) ? outArg : path.join(ROOT, outArg)) : path.join(ROOT, 'out');
  fs.mkdirSync(dir, { recursive: true });
  const cases = [
    { seed: 1, round: 1 }, { seed: 2, round: 7 }, { seed: 3, round: 15 },
  ];
  for (const c of cases) {
    const a = demoBuild('warrior', c.round);
    const b = demoBuild('mage', c.round);
    const log = simulate({ seed: c.seed, round: c.round, a, b, data });
    const ev = { seed: c.seed, round: c.round, a, b, log };
    const f = path.join(dir, `eval-r${c.round}-s${c.seed}.json`);
    fs.writeFileSync(f, JSON.stringify(ev, null, 2), 'utf8');
    console.log(`已写出 ${path.relative(ROOT, f)}  winner=${log.winner} ticks=${log.ticks}`);
  }
  process.exit(0);
}

const seed = Number(getArg('seed', 1));
const round = Number(getArg('round', 1));
const aPath = getArg('a', null);
const bPath = getArg('b', null);
if (!aPath || !bPath || !outArg) {
  console.error('用法: node tools/sim-dump.mjs --seed <n> --round <n> --a <a.json> --b <b.json> --out <eval.json>');
  console.error('  或: node tools/sim-dump.mjs --demo --out <目录>');
  process.exit(2);
}
const a = buildFromFile(aPath);
const b = buildFromFile(bPath);
const log = simulate({ seed, round, a, b, data });
const outPath = path.isAbsolute(outArg) ? outArg : path.join(ROOT, outArg);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify({ seed, round, a, b, log }, null, 2), 'utf8');
console.log(`已写出 ${path.relative(ROOT, outPath)}  winner=${log.winner} ticks=${log.ticks}`);
