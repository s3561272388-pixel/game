// tools/lib/data.mjs — 统一数据加载与索引
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DATA_DIR = path.join(ROOT, 'data');

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf8'));
}

export function loadData() {
  const rules = readJson('rules.json');
  const items = readJson('items.json');
  const classes = readJson('classes.json');
  const enemies = readJson('enemies.json');

  const itemById = new Map(items.items.map((it) => [it.id, it]));
  const classById = new Map(classes.classes.map((c) => [c.id, c]));
  const enemyByRound = new Map(enemies.enemies.map((e) => [e.round, e]));

  return { rules, items, classes, enemies, itemById, classById, enemyByRound };
}

export const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
