// tools/calibrate.mjs — 依据实测胜率曲线自动标定 data/enemies.json 的难度旋钮
//
// 用法:
//   node tools/run-balance.mjs --runs 400        # 先测
//   node tools/calibrate.mjs                     # 读最新报告，写回 enemies.json
//   node tools/run-balance.mjs --runs 400        # 再测，确认收敛
//
// 原理：两个旋钮各管一个目标，避免互相打架。
//   ① atkScale —— 管「胜率」：实测胜率高于目标 → 提高敌人攻击
//        factor = (实测胜率 / 目标胜率) ^ 0.6   ← 指数 <1 抑制过冲
//   ② hpScale  —— 管「战斗时长」：打得太快说明敌人血量不足以撑住，加血
//        avgSeconds < 8s → ×1.20；> 30s → ×0.85
// 单次迭代的幅度被限制在 ±35% 以内，避免一轮跳过头。
// 只改 hpScale / atkScale 两个旋钮，其余内容与文件格式保持原样。
import fs from 'node:fs';
import path from 'node:path';
import { loadData, ROOT } from './lib/data.mjs';

const args = process.argv.slice(2);
const reportArg = args.find((a) => !a.startsWith('--'));
const DRY = args.includes('--dry-run');

const reportsDir = path.join(ROOT, 'reports');
let reportPath = reportArg;
if (!reportPath) {
  const candidates = fs.readdirSync(reportsDir).filter((f) => f.startsWith('balance-') && f.endsWith('.json')).sort();
  if (candidates.length === 0) {
    console.error('找不到 balance-*.json，请先运行: node tools/run-balance.mjs --runs 400');
    process.exit(1);
  }
  reportPath = path.join(reportsDir, candidates[candidates.length - 1]);
}
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const data = loadData();
const { rules, enemyByRound } = data;

const MIN_FACTOR = 0.75;
const MAX_FACTOR = 1.35;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const updates = [];
for (const row of report.winCurve) {
  const band = rules.enemyCurve.winRateBandsByRound.find((b) => row.round >= b.from && row.round <= b.to);
  const enemy = enemyByRound.get(row.round);
  if (!band || !enemy || row.samples < 20) continue;
  const target = (band.min + band.max) / 2;
  const observed = Math.max(0.05, row.winRate);
  // ① 胜率：实测偏高 → 敌人该更强
  const atkFactor = clamp(Math.pow(observed / target, 0.6), MIN_FACTOR, MAX_FACTOR);
  // ② 时长：打得太快 → 敌人血太薄
  let hpFactor = 1;
  if (row.avgSeconds < 8) hpFactor = 1.20;
  else if (row.avgSeconds > 30) hpFactor = 0.85;
  // Correct defender-thorns mechanics can dominate damage independently of atkScale.
  // Reduce time exposed to reflection when a round is severely overtuned.
  const hasThorns = enemy.items.some(it => data.itemById.get(it.defId).effects.some(e => e.stat === 'thorns'));
  if (hasThorns && row.winRate < band.min * 0.8) hpFactor = 0.75;
  // Once attack reaches its cap, health remains the available difficulty control.
  if (enemy.atkScale >= 2.99 && row.winRate > band.max) hpFactor = 1.15;
  const newHp = clamp(enemy.hpScale * hpFactor, 0.5, 3.5);
  const newAtk = clamp(enemy.atkScale * atkFactor, 0.5, 3.0);
  updates.push({ round: row.round, observed: row.winRate, target, band, avgSeconds: row.avgSeconds, oldHp: enemy.hpScale, oldAtk: enemy.atkScale, newHp, newAtk });
}

const file = path.join(ROOT, 'data', 'enemies.json');
let text = fs.readFileSync(file, 'utf8');
const byRound = new Map(updates.map((u) => [u.round, u]));
let changed = 0;
text = text.split('\n').map((line) => {
  const m = /"round":\s*(\d+)/.exec(line);
  if (!m) return line;
  const u = byRound.get(Number(m[1]));
  if (!u) return line;
  const replaced = line.replace(
    /"hpScale":\s*[\d.]+,\s*"atkScale":\s*[\d.]+/,
    `"hpScale": ${u.newHp.toFixed(3)}, "atkScale": ${u.newAtk.toFixed(3)}`,
  );
  if (replaced !== line) changed += 1;
  return replaced;
}).join('\n');

console.log(`数据源: ${path.relative(ROOT, reportPath)}`);
console.log('');
console.log('| 回合 | 实测胜率 | 目标 | 时长 | hpScale | atkScale |');
console.log('|---|---|---|---|---|---|');
for (const u of updates) {
  const arrow = (o, n) => (Math.abs(n - o) < 0.001 ? `${n.toFixed(3)}` : `${o.toFixed(3)} → **${n.toFixed(3)}**`);
  console.log(`| ${u.round} | ${(u.observed * 100).toFixed(1)}% | ${(u.target * 100).toFixed(0)}% | ${u.avgSeconds.toFixed(1)}s | ${arrow(u.oldHp, u.newHp)} | ${arrow(u.oldAtk, u.newAtk)} |`);
}
console.log('');
if (DRY) {
  console.log(`--dry-run：未写入。将影响 ${changed} 个回合。`);
} else {
  fs.writeFileSync(file, text, 'utf8');
  console.log(`已写回 data/enemies.json，调整 ${changed} 个回合。请重跑 run-balance 验证收敛。`);
}
