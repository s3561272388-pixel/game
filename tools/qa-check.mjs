// tools/qa-check.mjs — 一键 QA：跑完全部可自动化检查，生成可交付的 QA 报告 + Bug 列表
//
// 用法:
//   node tools/run-balance.mjs --runs 500      # 先产生平衡报告（指标 1–6 的数据源）
//   node tools/qa-check.mjs                    # 一键全检
//   node tools/qa-check.mjs --src <游戏仓库路径>  # 额外对游戏源码做静态扫描
//
// 输出: reports/qa-report-<时间戳>.md  与  reports/qa-report-<时间戳>.json
//
// 设计原则：能自动判定的绝不靠"我觉得"；判不了的明确标注为「需人工验证」并给出可执行清单，
// 而不是假装通过。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadData, ROOT } from './lib/data.mjs';
import { simulate, summarize, packBuild, mulberry32, deriveSeed } from './engine.mjs';
import { dataReport } from './validate-data.mjs';
import { difficultyFingerprint } from './difficulty-test.mjs';

const args = process.argv.slice(2);
const getArg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const SRC = getArg('src', null);

const data = loadData();
const { rules, classes, items, enemyByRound, classById, itemById } = data;
const Q = rules.qaThresholds;

const checks = [];
const bugs = [];
const addCheck = (id, name, status, observed, threshold, note) => checks.push({ id, name, status, observed, threshold, note });
const addBug = (severity, title, repro, expected, actual, hint, source) => bugs.push({ severity, title, repro, expected, actual, hint, source });

// ===========================================================================
// A. 数据体检（直接 import，避免子进程管道在沙箱下受限）
// ===========================================================================
const dataOk = dataReport.errors.length === 0;
addCheck('A1', '数据完整性', dataOk ? 'PASS' : 'FAIL',
  `${dataReport.errors.length} 错误 / ${dataReport.warnings.length} 警告`,
  '0 错误',
  dataReport.errors.slice(0, 5).join('; ') || '物品/职业/关卡全部通过字段、引用、数值区间与布局合法性校验');
for (const e of dataReport.errors) {
  addBug('S1', `数据错误：${e}`, 'node tools/validate-data.mjs', '校验通过', e, '修正 data/*.json 对应字段', 'tools/validate-data.mjs');
}

// ===========================================================================
// B. 确定性（同种子多次运行必须完全一致）
// ===========================================================================
function digest(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex').slice(0, 16);
}

function determinismCheck() {
  const runs = Q.determinismRuns;
  const cls = classes.classes[0].id;
  const build = packBuild(classById.get(cls).startItems.map((defId) => ({ defId, stars: 1 })), itemById, [rules.meta.gridCols, rules.meta.gridRows]);
  const hashes = new Set();
  const cases = [];
  for (let i = 0; i < runs; i += 1) {
    const log = simulate({ seed: 424242, round: 7, a: { cls, items: build }, b: { cls, items: build }, data });
    hashes.add(digest(log.events));
    cases.push(log);
  }
  // 顺带验证：不同种子/不同阵容必须派生出不同的随机流（否则回放与暴击都会失效）
  const clsM = classes.classes.find((c) => c.id === 'mage').id;
  const critBuild = packBuild(
    [{ defId: 'wpn_assassin_blade', stars: 1 }, { defId: 'wpn_twin_daggers', stars: 1 }],
    itemById, [rules.meta.gridCols, rules.meta.gridRows],
  );
  const s1 = simulate({ seed: 111, round: 7, a: { cls: clsM, items: critBuild }, b: { cls: clsM, items: critBuild }, data });
  const s2 = simulate({ seed: 222, round: 7, a: { cls: clsM, items: critBuild }, b: { cls: clsM, items: critBuild }, data });
  const rngDistinct = mulberry32(1)() !== mulberry32(2)();
  const seedDistinct = deriveSeed(1, 7, 'x') !== deriveSeed(2, 7, 'x') && deriveSeed(1, 7, 'x') !== deriveSeed(1, 8, 'x');
  const battleDistinct = digest(s1.events) !== digest(s2.events);
  return { uniqueHashes: hashes.size, runs, rngDistinct, seedDistinct, battleDistinct };
}

const det = determinismCheck();
addCheck('B1', '确定性（不可用 Math.random / Date.now）', det.uniqueHashes === 1 ? 'PASS' : 'FAIL',
  `${det.runs} 次同种子 → ${det.uniqueHashes} 种结果`,
  '必须恰好 1 种',
  det.uniqueHashes === 1 ? '同种子 + 同阵容 → 事件流完全一致' : '存在非确定性来源');
if (det.uniqueHashes !== 1) {
  addBug('S0', '战斗结算不确定：同种子多次运行结果不同', 'node tools/qa-check.mjs（B1 项）', '100 次同种子结果哈希完全一致', `${det.runs} 次得到 ${det.uniqueHashes} 种不同结果`,
    '检查是否使用了 Math.random()、Date.now()、performance.now()，或依赖 Object.keys 遍历顺序、Set/Map 插入顺序未显式排序', 'tools/qa-check.mjs#B1');
}
addCheck('B2', '随机流按 seed/round/阵容指纹 正确派生', (det.rngDistinct && det.seedDistinct && det.battleDistinct) ? 'PASS' : 'FAIL',
  `PRNG 区分种子:${det.rngDistinct ? '是' : '否'} / deriveSeed 区分 seed 与 round:${det.seedDistinct ? '是' : '否'} / 带暴击的对局区分种子:${det.battleDistinct ? '是' : '否'}`,
  '三者均须为「是」',
  '若全为「否」，说明种子没接进随机流，回放与暴击判定会失效');
if (!(det.rngDistinct && det.seedDistinct && det.battleDistinct)) {
  addBug('S1', '随机流未按 (seed, round, 阵容指纹) 正确派生',
    'node tools/qa-check.mjs（B2 项）',
    '不同 seed / 不同 round / 不同阵容都必须产生不同的暴击序列',
    `PRNG 区分种子=${det.rngDistinct}，deriveSeed 区分 seed与round=${det.seedDistinct}，对局结果区分种子=${det.battleDistinct}`,
    '见 docs/02 §6.4：随机数只用种子化 PRNG，种子 = hash(matchSeed, round, 阵容指纹)，不得按左右位置派生', 'tools/qa-check.mjs#B2');
}

// ===========================================================================
// C. 引擎性能
// ===========================================================================
function perfCheck() {
  const cls = classes.classes[0].id;
  const build = packBuild(classById.get(cls).startItems.map((defId) => ({ defId, stars: 1 })), itemById, [rules.meta.gridCols, rules.meta.gridRows]);
  const N = 500;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i += 1) {
    simulate({ seed: i, round: 1 + (i % 18), a: { cls, items: build }, b: { cls, items: build }, data });
  }
  return Number(process.hrtime.bigint() - t0) / 1e6 / N;
}
const settleMs = perfCheck();
addCheck('C1', '结算性能', settleMs <= Q.engineSettleMsMax ? 'PASS' : 'FAIL',
  `${settleMs.toFixed(3)} ms / 场`, `≤ ${Q.engineSettleMsMax} ms`, '以参考裁判为基准；游戏实现同量级即可');

// ===========================================================================
// D. 平衡报告摄取（指标 1–6）
// ===========================================================================
const reportsDir = path.join(ROOT, 'reports');
let balance = null;
let balanceAgeMin = null;
if (fs.existsSync(reportsDir)) {
  const cands = fs.readdirSync(reportsDir).filter((f) => f.startsWith('balance-') && f.endsWith('.json')).sort();
  if (cands.length > 0) {
    const p = path.join(reportsDir, cands[cands.length - 1]);
    balance = JSON.parse(fs.readFileSync(p, 'utf8'));
    balanceAgeMin = (Date.now() - fs.statSync(p).mtimeMs) / 60000;
  }
}

if (rules.rewards?.enabled) {
  // The old proxy reimplements shops and cannot collect rewards. Do not present its metrics as current evidence.
  let report;
  try { report = JSON.parse(fs.readFileSync(path.join(reportsDir, 'difficulty-after.json'), 'utf8')); } catch {}
  const current = report?.fingerprint === difficultyFingerprint(data);
  addCheck('D0', '含奖励的实际游戏规则测试', current ? 'PASS' : 'FAIL', current ? `${report.overall.runs} 局；数据、引擎与策略指纹一致` : '缺少报告或版本不匹配', '报告匹配当前版本', '运行 node tools/difficulty-test.mjs --runs 100 --seed 500003；旧版平衡报告不用于本版判定');
  if (current) {
    const allClasses = classes.classes.every(c => report.classes[c.id]?.beatFinal > 0 && report.classes[c.id]?.runs >= 100);
    addCheck('D1', '四角色可击败第 18 关', allClasses ? 'PASS' : 'FAIL', `抵达 18 关 ${(report.overall.reach18*100).toFixed(1)}%；击败关底 ${(report.overall.beatFinal*100).toFixed(1)}%`, '每角色至少 100 局且存在关底胜局', '只验证可通关及报告概率，不代表真人通关率或四角色难度相同');
    addCheck('D2', '角色难度差异', 'WARN', Object.entries(report.classes).map(([cls,v]) => `${cls} 抵达率 ${(v.reach18*100).toFixed(0)}%`).join('；'), '描述性统计，待真人构筑验证', '近战角色仍较难；原版经济、多样性等指标不自动沿用为本版通过结果');
    addBug('S2', '四角色的终局抵达率仍有明显差异', 'node tools/difficulty-test.mjs --runs 100 --seed 500003', '继续改善角色间体验', '见 D2 的逐角色概率', '结合真人选购与摆放策略继续观察，避免为单一代理过度削弱敌人', 'reports/difficulty-after.json');
  }
} else if (!balance) {
  addCheck('D0', '平衡报告', 'FAIL', '未找到 reports/balance-*.json', '需先跑 run-balance',
    '执行: node tools/run-balance.mjs --runs 500');
  addBug('S2', '缺少平衡报告，指标 1–6 无法判定', 'node tools/run-balance.mjs --runs 500 && node tools/qa-check.mjs',
    '存在最新平衡报告', 'reports/ 下没有 balance-*.json', '先跑平衡模拟器', 'tools/qa-check.mjs#D');
} else {
  addCheck('D0', '平衡报告新鲜度', balanceAgeMin <= 120 ? 'PASS' : 'WARN',
    `${balanceAgeMin.toFixed(1)} 分钟前生成`, '≤ 120 分钟',
    balanceAgeMin <= 120 ? '' : '数据可能已过期，建议重跑 run-balance');
  for (const m of balance.metrics) {
    if (m.pass === null) continue; // 7/8 由本文件其它项负责
    addCheck(`D${m.id}`, `指标${m.id} ${m.name}`, m.pass ? 'PASS' : 'FAIL',
      typeof m.value === 'number' ? m.value.toFixed(4) : String(m.value), m.threshold, m.note);
    if (m.pass === false) {
      addBug('S2', `平衡指标未达标：指标${m.id} ${m.name}`,
        'node tools/run-balance.mjs --runs 500', m.threshold,
        String(m.note), '按 docs/02 §16 平衡旋钮清单调整，改完重跑 run-balance 与 qa-check', `tools/run-balance.mjs#metric${m.id}`);
    }
  }
  // 难度曲线出界的回合
  const outOfBand = (balance.winCurve || []).filter((r) => !r.inBand);
  addCheck('D20', '难度曲线', outOfBand.length === 0 ? 'PASS' : 'WARN',
    `${outOfBand.length} / ${(balance.winCurve || []).length} 个回合出界`,
    '全部落在设计区间',
    outOfBand.length === 0 ? '' : outOfBand.map((r) => `R${r.round}=${(r.winRate * 100).toFixed(0)}%`).join(', '));
  if (outOfBand.length > 0) {
    addBug('S2', `难度曲线有 ${outOfBand.length} 个回合偏离设计区间`,
      'node tools/run-balance.mjs --runs 500 && node tools/calibrate.mjs',
      '每个回合的胜率落在 rules.enemyCurve.winRateBandsByRound 区间内',
      outOfBand.map((r) => `第 ${r.round} 回合胜率 ${(r.winRate * 100).toFixed(1)}%`).join('; '),
      '跑 tools/calibrate.mjs 自动标定 enemies.json 的 hpScale/atkScale，如此往复直到收敛', 'tools/run-balance.mjs#curve');
  }
}

// ===========================================================================
// E. 源码静态扫描（仅当提供 --src）
// ===========================================================================
const FORBIDDEN_IN_ENGINE = [
  { pattern: /\bMath\.random\s*\(/, severity: 'S0', title: '引擎中使用了 Math.random()', hint: '必须改用种子化 PRNG（见 docs/02 §6.4 与 tools/engine.mjs 的 mulberry32）' },
  { pattern: /\bDate\.now\s*\(/, severity: 'S0', title: '引擎中使用了 Date.now()', hint: '逻辑不得依赖真实时间，只能依赖 tick' },
  { pattern: /\bperformance\.now\s*\(/, severity: 'S1', title: '引擎中使用了 performance.now()', hint: '只允许用在性能埋点，不得参与结算' },
  { pattern: /\bdocument\.|\bwindow\./, severity: 'S0', title: '引擎包引用了 DOM（破坏引擎与表现分离）', hint: '战斗逻辑必须能在 Node 里 headless 运行，见 docs/00 §4.1' },
  { pattern: /from ['"]react['"]|from ['"]phaser['"]/, severity: 'S0', title: '引擎包依赖了表现层库', hint: '引擎不得 import react/phaser' },
];

function staticScan(srcDir) {
  const results = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry.name)) results.push(p);
    }
  };
  walk(srcDir);

  const findings = [];
  for (const f of results) {
    const rel = path.relative(ROOT, f);
    const isEngine = /packages[\\/]engine[\\/]/.test(f) || /[\\/]engine[\\/]/.test(f);
    const text = fs.readFileSync(f, 'utf8');
    text.split('\n').forEach((line, idx) => {
      for (const rule of FORBIDDEN_IN_ENGINE) {
        if (!isEngine) continue;
        if (rule.pattern.test(line)) {
          findings.push({ file: rel, line: idx + 1, severity: rule.severity, title: rule.title, hint: rule.hint, code: line.trim().slice(0, 120) });
        }
      }
    });
  }
  return { scanned: results.length, findings };
}

if (SRC) {
  const srcPath = path.isAbsolute(SRC) ? SRC : path.join(ROOT, SRC);
  if (!fs.existsSync(srcPath)) {
    addCheck('E1', '源码静态扫描', 'FAIL', `路径不存在: ${SRC}`, '需提供游戏仓库路径', '');
  } else {
    const { scanned, findings } = staticScan(srcPath);
    addCheck('E1', '源码静态扫描（引擎纯净性）', findings.length === 0 ? 'PASS' : 'FAIL',
      `扫描 ${scanned} 个文件，命中 ${findings.length} 处`, '0 处', '仅检查 packages/engine 是否引入非确定性或表现层依赖');
    for (const f of findings) {
      addBug(f.severity, f.title, `打开 ${f.file}:${f.line}`, '引擎不得使用非确定性 API / DOM / 表现层库', f.code, f.hint, `${f.file}:${f.line}`);
    }
  }
} else {
  addCheck('E1', '源码静态扫描（引擎纯净性）', 'SKIP', '未提供 --src', '建议提供游戏仓库路径',
    '用法: node tools/qa-check.mjs --src <游戏仓库路径>；将扫描 packages/engine 是否混入 Math.random/Date.now/DOM/react');
}

// ===========================================================================
// F. 需人工验证的交互清单（不假装自动通过）
// ===========================================================================
const MANUAL = [
  ['拖拽放置', '拖起物品移动时跟手无延迟；合法位置显示高亮预览；非法位置红色高亮且禁止落地，回弹动画 ≤200ms'],
  ['旋转', '右键 / R 键可将手中物品旋转 90°，旋转后占位预览同步变化，不出现越界或重叠'],
  ['合并升星', '3 件同名同星物品自动合成 1 件 +1 星；合并后原位保留（不跳到其他格子）；播放金光与音效；数值按 starMult 提升'],
  ['出售与撤销', '拖到商店区或右键菜单可出售，返还 = max(1, floor(cost*0.6))；Ctrl+Z 能连续回退最近 20 步摆放/买卖'],
  ['背包已满时的购买', '背包放不下时必须禁止购买并给出可见原因，绝不能出现"买完放不下导致卡死"'],
  ['战斗跳过与倍速', '空格进入战斗；1/2/4 倍速与"跳过"按钮均可用；跳过能直接出结果且不卡死、不丢结算'],
  ['Tooltip 数值一致性', '随机抽查 10 件物品的详情浮窗，其显示数值必须与实战生效数值完全一致（含星级、协同加成）'],
  ['色盲模式', '开启后"合法/非法格"与稀有度颜色仍可区分'],
  ['存档', '刷新页面后能继续当前局，金币/命值/背包/商店状态完整恢复'],
];

// ===========================================================================
// 汇总
// ===========================================================================
const s0 = bugs.filter((b) => b.severity === 'S0').length;
const s1 = bugs.filter((b) => b.severity === 'S1').length;
const s2 = bugs.filter((b) => b.severity === 'S2').length;
const failed = checks.filter((c) => c.status === 'FAIL').length;
const passedCount = checks.filter((c) => c.status === 'PASS').length;
const warnCount = checks.filter((c) => c.status === 'WARN').length;

const gate = s0 === 0 && s1 === 0 && failed === 0;

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const lines = [];
lines.push('# 背包大乱斗 · QA 报告（可玩性检测 + 错误代码报告）');
lines.push('');
lines.push(`- 生成时间: ${new Date().toISOString()}`);
lines.push(`- 结论: **${gate ? '通过（可进入下一阶段）' : '未通过（须修复后回归）'}**`);
lines.push(`- 自动检查: ${passedCount} 通过 / ${failed} 失败 / ${warnCount} 告警　|　Bug: **S0 ${s0}** · **S1 ${s1}** · S2 ${s2}`);
lines.push(`- 门禁规则: 无 S0/S1 且无 FAIL 检查项（见 docs/05）`);
lines.push('');
lines.push('> 本报告只包含**可自动判定**的结论。交互手感类项目在最后一节列为「需人工验证」，不自动判通过。');
lines.push('');
lines.push('## 一、自动检查结果');
lines.push('');
lines.push('| 编号 | 检查项 | 状态 | 实测 | 阈值/期望 | 说明 |');
lines.push('|---|---|---|---|---|---|');
for (const c of checks) {
  const icon = c.status === 'PASS' ? '✅ PASS' : c.status === 'FAIL' ? '❌ FAIL' : c.status === 'WARN' ? '⚠️ WARN' : '⏭ SKIP';
  lines.push(`| ${c.id} | ${c.name} | ${icon} | ${String(c.observed).replace(/\|/g, '\\|')} | ${String(c.threshold).replace(/\|/g, '\\|')} | ${String(c.note).replace(/\|/g, '\\|')} |`);
}
lines.push('');

lines.push('## 二、错误代码报告（Bug 列表）');
lines.push('');
if (bugs.length === 0) {
  lines.push('本次自动检测未发现 Bug。');
} else {
  lines.push('| # | 级别 | 标题 | 复现步骤 | 期望 | 实际 | 修法提示 | 定位 |');
  lines.push('|---|---|---|---|---|---|---|---|');
  bugs.sort((a, b) => a.severity.localeCompare(b.severity)).forEach((b, i) => {
    lines.push(`| ${i + 1} | **${b.severity}** | ${b.title.replace(/\|/g, '\\|')} | \`${b.repro.replace(/\|/g, '\\|')}\` | ${b.expected.replace(/\|/g, '\\|')} | ${b.actual.replace(/\|/g, '\\|')} | ${b.hint.replace(/\|/g, '\\|')} | ${b.source} |`);
  });
  lines.push('');
  lines.push('### 分级定义');
  lines.push('');
  lines.push('| 级别 | 含义 | 处理要求 |');
  lines.push('|---|---|---|');
  lines.push('| **S0** | 致命：结算错误 / 不确定 / 无法开局或卡死体 | 必须立即修，阻塞发布 |');
  lines.push('| **S1** | 高：数值与规则不符、非法状态、数据错误 | 本轮必须修 |');
  lines.push('| **S2** | 中：平衡/体验指标未达标、告警 | 本轮应修，或明确记录为已知问题 |');
  lines.push('| **S3** | 低：文案、命名、格式 | 可延后 |');
  lines.push('');
  lines.push('> 直接把这些条目复制给 GPT-6，并使用 `docs/03-GPT6提示词包.md` 的 **P8 修复循环提示词**。');
  lines.push('');
}

lines.push('## 三、需人工验证的交互清单（不可自动判定）');
lines.push('');
lines.push('请逐条实机验证并在括号内打勾。任何一条不通过，按 S1 记入 Bug 列表。');
lines.push('');
MANUAL.forEach(([name, detail], i) => {
  lines.push(`${i + 1}. [ ] **${name}** — ${detail}`);
});
lines.push('');
lines.push('## 四、本次检测使用的命令');
lines.push('');
lines.push('```powershell');
lines.push('node tools/validate-data.mjs');
lines.push(rules.rewards?.enabled ? 'node tools/difficulty-test.mjs --runs 100 --seed 500003' : 'node tools/run-balance.mjs --runs 500');
lines.push('node tools/qa-check.mjs' + (SRC ? ` --src ${SRC}` : ' --src <游戏仓库路径>'));
lines.push('node tools/diff-test.mjs --evals <游戏 sim:dump 输出目录>');
lines.push('```');
lines.push('');

const md = lines.join('\n');
fs.mkdirSync(reportsDir, { recursive: true });
const mdPath = path.join(reportsDir, `qa-report-${ts}.md`);
const jsonPath = path.join(reportsDir, `qa-report-${ts}.json`);
fs.writeFileSync(mdPath, md, 'utf8');
fs.writeFileSync(jsonPath, JSON.stringify({ generatedAt: new Date().toISOString(), gate, checks, bugs, manualChecklist: MANUAL }, null, 2), 'utf8');

console.log(md);
console.log(`\n报告已写入:\n  ${path.relative(ROOT, mdPath)}\n  ${path.relative(ROOT, jsonPath)}`);
process.exit(gate ? 0 : 1);
