// tools/diff-test.mjs — 差分测试：把 GPT-6 的游戏引擎输出与参考裁判（oracle）逐 tick 对比
//
// 这是第 3 步"检测可玩性、生成错误代码报告"的核心武器。
// 数值型 Bug（护甲结算顺序反了、相邻加成旋转后丢失、升星乘算变加算、冷却多算一帧）
// 靠人眼和手感都测不出来，但在这里会被精确定位到「第几 tick、哪一方的哪个物品、差多少」。
//
// 契约（必须写进给 GPT-6 的提示词里）：
//   游戏引擎提供 CLI：
//     pnpm -F engine sim:dump --seed <n> --round <n> --a <buildA.json> --b <buildB.json> --out <eval.json>
//   输出的 eval.json 结构：
//     { "seed": n, "round": n, "a": {build}, "b": {build}, "log": {BattleLog} }
//   其中 BattleLog 必须与 docs/02 §6.7 字段完全一致。
//
// 用法:
//   node tools/diff-test.mjs --evals <目录或文件...>      # 对比游戏产出的 eval 文件
//   node tools/diff-test.mjs --self-test                  # 自检：裁判 vs 裁判，应为 0 差异
//   node tools/diff-test.mjs --evals out/ --report reports/diff.md
import fs from 'node:fs';
import path from 'node:path';
import { loadData, ROOT } from './lib/data.mjs';
import { simulate, packBuild, buildFingerprint } from './engine.mjs';

const args = process.argv.slice(2);
const getArg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const SELF_TEST = args.includes('--self-test');
const EVAL_PATHS = [];
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--evals') {
    let j = i + 1;
    while (j < args.length && !args[j].startsWith('--')) {
      EVAL_PATHS.push(args[j]);
      j += 1;
    }
  }
}
const REPORT_PATH = getArg('report', null);
const MAX_DETAIL = Number(getArg('max-detail', 20));

const data = loadData();

function collectFiles(targets) {
  const out = [];
  for (const t of targets) {
    const p = path.isAbsolute(t) ? t : path.join(ROOT, t);
    if (!fs.existsSync(p)) continue;
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      for (const f of fs.readdirSync(p)) {
        if (f.endsWith('.json')) out.push(path.join(p, f));
      }
    } else out.push(p);
  }
  return out.sort();
}

/** 逐 tick 对比两份战斗日志 */
function compareLogs(oracle, game) {
  const issues = [];
  const add = (severity, kind, detail, t) => issues.push({ severity, kind, detail, tick: t === undefined ? null : t });

  // 0. 结构
  for (const f of ['version', 'seed', 'round', 'sides', 'events', 'ticks', 'winner', 'finalHp']) {
    if (game[f] === undefined) add('S0', '字段缺失', `战斗日志缺少字段 ${f}（docs/02 §6.7 规定必须存在）`);
  }
  if (issues.some((i) => i.severity === 'S0')) return issues;

  // 1. 战前快照
  if (JSON.stringify(game.sides?.map((s) => s.maxHp)) !== JSON.stringify(oracle.sides?.map((s) => s.maxHp))) {
    add('S1', '开局属性不符', `maxHp 不一致：裁判 ${JSON.stringify(oracle.sides.map((s) => s.maxHp))}，游戏 ${JSON.stringify(game.sides.map((s) => s.maxHp))}（检查物品 on_battle_start 加成/协同/回合生命成长/敌方缩放的计算顺序）`);
  }
  const fp = (side) => buildFingerprint({ cls: side.cls, items: side.items });
  if (game.sides?.[0] && fp(game.sides[0]) !== fp(oracle.sides[0])) {
    add('S2', '战前阵容快照不符', `第 1 方阵容与裁判输入不一致`);
  }

  // 2. 事件流逐条比对
  const oe = oracle.events;
  const ge = game.events;
  const cmpKeys = (e) => {
    if (e.type === 'activate') return `${e.t}|${e.type}|${e.side}|${e.itemId}`;
    if (e.type === 'state') return `${e.t}|${e.type}`;
    if (e.type === 'end') return `${e.t}|${e.type}`;
    return `${e.t}|${e.type}|${e.side}|${e.target ?? ''}`;
  };
  const n = Math.max(oe.length, ge.length);
  let firstDiffTick = null;
  for (let i = 0; i < n; i += 1) {
    const a = oe[i];
    const b = ge[i];
    if (!a) { add('S1', '事件多余', `游戏日志多出事件 #${i}: ${JSON.stringify(b)}`, b.t); break; }
    if (!b) { add('S1', '事件缺失', `游戏日志缺少事件 #${i}: 裁判为 ${JSON.stringify(a)}`, a.t); break; }
    if (cmpKeys(a) !== cmpKeys(b)) {
      add('S1', '事件顺序/类型分歧', `事件 #${i}：裁判 ${JSON.stringify(a)} vs 游戏 ${JSON.stringify(b)}`, Math.min(a.t, b.t));
      break;
    }
    if (a.type === 'damage' && (a.amount !== b.amount || a.blocked !== b.blocked || a.crit !== b.crit)) {
      add('S1', '伤害数值不符', `tick ${a.t}，第 ${a.side + 1} 方攻击第 ${a.target + 1} 方：裁判 伤害${a.amount}/格挡${a.blocked}/暴击${a.crit}，游戏 伤害${b.amount}/格挡${b.blocked}/暴击${b.crit} → 见 docs/02 §6.4 伤害公式（取整时机、护甲扣减顺序、暴击判定是常见错因）`, a.t);
      if (firstDiffTick === null) firstDiffTick = a.t;
      break;
    }
    if (a.type === 'heal' && a.amount !== b.amount) {
      add('S1', '治疗数值不符', `tick ${a.t}，第 ${a.side + 1} 方：裁判 ${a.amount}，游戏 ${b.amount} → 检查治疗量加成与取整`, a.t);
      break;
    }
    if (a.type === 'block' && a.amount !== b.amount) {
      add('S1', '护甲数值不符', `tick ${a.t}，第 ${a.side + 1} 方：裁判 ${a.amount}，游戏 ${b.amount}`, a.t);
      break;
    }
    if (a.type === 'state') {
      const dh = Math.abs(a.hp[0] - b.hp[0]) + Math.abs(a.hp[1] - b.hp[1]);
      const ds = Math.abs(a.stamina[0] - b.stamina[0]) + Math.abs(a.stamina[1] - b.stamina[1]);
      if (dh > 0.01) {
        add('S1', '每 tick 血量不符', `tick ${a.t}：裁判 hp=${JSON.stringify(a.hp)}，游戏 hp=${JSON.stringify(b.hp)} → 常见错因：耐力不足时的等待规则、每 tick 末回复顺序、死亡判定时机（docs/02 §6.3）`, a.t);
        break;
      }
      if (ds > 0.01) {
        add('S2', '耐力不符（不影响本场胜负）', `tick ${a.t}：裁判 stamina=${JSON.stringify(a.stamina)}，游戏 ${JSON.stringify(b.stamina)} → 检查耐力消耗与回复的取整方式`, a.t);
      }
    }
  }

  if (game.ticks !== oracle.ticks) add('S1', '战斗时长不符', `裁判 ${oracle.ticks} tick，游戏 ${game.ticks} tick`, firstDiffTick);
  if (game.winner !== oracle.winner) add('S0', '胜负判定不符', `裁判 ${oracle.winner}，游戏 ${game.winner}`);
  if (JSON.stringify(game.finalHp) !== JSON.stringify(oracle.finalHp)) {
    add('S2', '终局血量不符', `裁判 ${JSON.stringify(oracle.finalHp)}，游戏 ${JSON.stringify(game.finalHp)}`);
  }
  return issues;
}

// ---------------------------------------------------------------------------
// 自检：用同一份输入跑两次裁判，应当 0 差异（同时验证评测器本身没写错）
// ---------------------------------------------------------------------------
function selfTest() {
  const cls = 'warrior';
  const grid = [data.rules.meta.gridCols, data.rules.meta.gridRows];
  const start = packBuild(data.classById.get(cls).startItems.map((defId) => ({ defId, stars: 1 })), data.itemById, grid);
  const mk = (items) => ({ cls, items });
  const cases = [
    { seed: 1, round: 1, a: mk(start), b: mk(start) },
    { seed: 2, round: 5, a: mk(start), b: mk(start) },
    { seed: 3, round: 12, a: mk(start), b: mk(start) },
  ];
  let bad = 0;
  for (const c of cases) {
    const l1 = simulate({ ...c, data });
    const l2 = simulate({ ...c, data });
    const issues = compareLogs(l1, l2);
    if (issues.length > 0) {
      bad += 1;
      console.log(`自检失败 seed=${c.seed}:`, issues.slice(0, 3));
    }
  }
  console.log(bad === 0
    ? `自检通过：${cases.length} 组用例，裁判与自身对比 0 差异（评测器可用）`
    : `自检失败：${bad}/${cases.length} 组用例出现差异，评测器本身有 bug`);
  return bad === 0 ? 0 : 1;
}

if (SELF_TEST) process.exit(selfTest());

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
if (EVAL_PATHS.length === 0) {
  console.error('用法: node tools/diff-test.mjs --evals <目录或文件...>  或  --self-test');
  console.error('');
  console.error('eval 文件结构（游戏引擎 sim:dump 的输出）:');
  console.error('  { "seed": 1, "round": 1, "a": {build}, "b": {build}, "log": {BattleLog} }');
  process.exit(2);
}

const files = collectFiles(EVAL_PATHS);
if (files.length === 0) {
  console.error(`未找到任何 .json eval 文件。检查路径: ${EVAL_PATHS.join(', ')}`);
  process.exit(2);
}

const allIssues = [];
let passed = 0;
for (const f of files) {
  let ev;
  try {
    ev = JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (err) {
    allIssues.push({ file: f, severity: 'S0', kind: 'eval 文件无法解析', detail: String(err.message) });
    continue;
  }
  if (!ev.log || !ev.a || !ev.b || ev.seed === undefined || ev.round === undefined) {
    allIssues.push({ file: f, severity: 'S0', kind: 'eval 文件结构不符契约', detail: '必须包含 seed / round / a / b / log（见本文件头部注释）' });
    continue;
  }
  let oracle;
  try {
    oracle = simulate({ seed: ev.seed, round: ev.round, a: ev.a, b: ev.b, data });
  } catch (err) {
    allIssues.push({ file: f, severity: 'S0', kind: '裁判无法复现该对局', detail: `${err.message}（通常是阵容布局非法或引用了不存在的物品 id）` });
    continue;
  }
  const issues = compareLogs(oracle, ev.log);
  if (issues.length === 0) passed += 1;
  else for (const i of issues) allIssues.push({ file: f, ...i });
}

const bySeverity = { S0: 0, S1: 0, S2: 0, S3: 0 };
for (const i of allIssues) bySeverity[i.severity] = (bySeverity[i.severity] || 0) + 1;

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const lines = [];
lines.push('# 差分测试报告（游戏引擎 vs 参考裁判）');
lines.push('');
lines.push(`- 生成时间: ${new Date().toISOString()}`);
lines.push('- 比较基准：本包 tools/engine.mjs（已同步修正原裁判的反伤取值与超时 ticks；原始 G 盘文件未修改）。引擎复用参考实现，因此此项是兼容性回归，不是独立正确性证明；独立规则测试见 tests/game.test.mjs。');
lines.push(`- 用例: **${files.length}** 个 eval 文件，完全一致 **${passed}** 个，存在差异 **${files.length - passed}** 个`);
lines.push(`- 差异分级: S0(致命) ${bySeverity.S0} · S1(高) ${bySeverity.S1} · S2(中) ${bySeverity.S2}`);
lines.push('');
if (allIssues.length === 0) {
  lines.push('## ✅ 结论');
  lines.push('');
  lines.push('所有用例与参考裁判逐 tick 完全一致：伤害/护甲/耐力/冷却/胜负判定均无偏差。');
} else {
  lines.push('## ❌ 差异清单');
  lines.push('');
  lines.push('| # | 文件 | 级别 | 类型 | 定位 | 详情 |');
  lines.push('|---|---|---|---|---|---|');
  allIssues.slice(0, MAX_DETAIL).forEach((i, idx) => {
    lines.push(`| ${idx + 1} | ${path.basename(i.file)} | **${i.severity}** | ${i.kind} | ${i.tick === null || i.tick === undefined ? '—' : `tick ${i.tick}`} | ${String(i.detail).replace(/\|/g, '\\|')} |`);
  });
  if (allIssues.length > MAX_DETAIL) lines.push(`| … | | | | | 其余 ${allIssues.length - MAX_DETAIL} 条省略 |`);
  lines.push('');
  lines.push('## 修法提示（按出现频率排序）');
  lines.push('');
  lines.push('1. **伤害取整时机**：裁判是「先乘所有加成与暴击 → `Math.floor` → 再扣护甲」。若你先扣护甲再取整，数值会差 1。');
  lines.push('2. **护甲扣减**：`blocked = min(target.block, raw)`，护甲只吸收不超过本次伤害的部分，剩余归零；护甲**不衰减**。');
  lines.push('3. **每方行动后立即判定死亡**（docs/02 §6.3）：等双方都行动完再判定会导致大量平局。');
  lines.push('4. **耐力不足时的等待**：耐力不够时物品**不激活也不重置冷却**（冷却已为 0，下 tick 再试）。');
  lines.push('5. **每 tick 末回复**：只在"本 tick 未分出胜负"时才回复耐力与 regen。');
  lines.push('6. **协同加成归属**：协同是加成给**邻居**，不是加给自己；`maxStacks` 限制能影响几个邻居（按 slotIndex 取前 N 个）。');
  lines.push('7. **随机流**：种子必须由 `(matchSeed, round, 阵容指纹)` 派生，不能按左右位置派生，也不能用 `Math.random()`。');
}
lines.push('');

const md = lines.join('\n');
const outPath = REPORT_PATH
  ? (path.isAbsolute(REPORT_PATH) ? REPORT_PATH : path.join(ROOT, REPORT_PATH))
  : path.join(ROOT, 'reports', `diff-${ts}.md`);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, md, 'utf8');
console.log(md);
console.log(`报告已写入 ${path.relative(ROOT, outPath)}`);
process.exit(allIssues.length === 0 ? 0 : 1);
