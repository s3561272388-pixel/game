import React, { useEffect, useRef, useState } from "react";
import {
  Backpack,
  Swords,
  Coins,
  Heart,
  Settings,
  BookOpen,
  RotateCw,
  Undo2,
  Lock,
  Unlock,
  Plus,
  ChevronRight,
  X,
  Volume2,
  VolumeX,
  Shield,
  Zap,
  Sparkles,
  ArrowUpRight,
  RefreshCw,
  Play,
  FastForward,
  Download,
  Home,
  Check,
  HelpCircle,
  Trash2,
  Target,
  Flame,
  Wind,
  Flower2,
  Radio,
  ChevronsUp,
  Trophy,
  Gift,
} from "lucide-react";
import rules from "../../data/rules.json";
import items from "../../data/items.json";
import classes from "../../data/classes.json";
import enemies from "../../data/enemies.json";
import assets from "../../assets/manifest.json";
import {
  makeData,
  newRun,
  act,
  battle,
  settle,
  validateSave,
  playerBuild,
  enemyBuild,
  canPlace,
  mergeGroups,
  expansionCost,
  refund,
  isRewardRound,
} from "../../packages/engine/game.mjs";
import {
  effectiveSize,
  computeSynergies,
  initSide,
} from "../../packages/engine/battle.mjs";
import "./style.css";
const data = makeData(rules, items, classes, enemies),
  SAVE = "wuwa-backpack-v1",
  SETTINGS = "wuwa-backpack-settings";
const chars = {
  warrior: {
    name: "长离",
    en: "CHANGLI",
    title: "丹煌离火",
    color: "#ef987d",
    element: "热熔",
    icon: Flame,
    style: "残血增伤 · 近战反击",
  },
  ranger: {
    name: "炽霞",
    en: "CHIXIA",
    title: "丹心侠骨",
    color: "#e4b778",
    element: "热熔",
    icon: Target,
    style: "高速连击 · 耐力循环",
  },
  mage: {
    name: "安可",
    en: "ENCORE",
    title: "羊咩大冒险",
    color: "#d0a1d7",
    element: "热熔",
    icon: Sparkles,
    style: "暴击爆发 · 声骸增幅",
  },
  cleric: {
    name: "维里奈",
    en: "VERINA",
    title: "万物生长",
    color: "#a8cc8b",
    element: "衍射",
    icon: Flower2,
    style: "治疗续航 · 护盾反击",
  },
};
const rarity = {
  common: ["普通", "#b7c5ca"],
  uncommon: ["精良", "#87bd9f"],
  rare: ["稀有", "#8eb8e8"],
  epic: ["史诗", "#c1a0e4"],
  legendary: ["传说", "#e5be70"],
};
const statNames = {
  damage: "伤害",
  block: "护盾",
  heal: "治疗",
  stamina: "耐力",
  staminaGain: "耐力",
  drain: "削减耐力",
  atkPct: "攻击%",
  atkFlat: "攻击",
  speedPct: "攻速%",
  critChance: "暴击率%",
  critMult: "暴击倍率",
  lifesteal: "吸血%",
  thorns: "反伤",
  regenPerTick: "生命 / tick",
  healPct: "治疗%",
  maxHp: "生命上限",
  maxStamina: "耐力上限",
  staminaRegen: "耐力 / tick",
};
const tagNames = {
  weapon: "武器",
  melee: "近战",
  ranged: "远程",
  sword: "迅刀",
  dagger: "短刃",
  bow: "佩枪",
  magic: "共鸣",
  staff: "音感仪",
  orb: "音感仪",
  armor: "防御",
  shield: "护盾",
  trinket: "辅助",
  gem: "棱镜",
  holy: "治疗",
  food: "补给",
  fire: "热熔",
  storm: "衍射",
  charm: "增幅",
  herb: "回复",
  drink: "耐力",
  consumable: "补给",
  hammer: "臂铠",
  club: "长刃",
};
const fmt = (n) => Number(n.toFixed(1));
const name = (id) => assets[id]?.name || data.itemById.get(id)?.name || id;
const art = (id, props = {}) => (
  <img
    src={assets[id]?.path}
    alt={assets[id]?.name || ""}
    draggable="false"
    {...props}
  />
);
function readSave() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE));
    if (validateSave(s, data)) {
      s.undo = [];
      return s;
    }
  } catch {}
  return null;
}
function seed() {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}
let audioContext;
function tone(kind, volume) {
  if (!volume) return;
  try {
    audioContext ??= new AudioContext();
    audioContext.resume();
    const freqs = {
      place: [420, 640],
      error: [140, 95],
      buy: [540, 810],
      sell: [640, 420],
      merge: [520, 660, 790, 1040],
      hit: [180, 120],
      crit: [760, 240],
      win: [523, 659, 784, 1046],
      loss: [392, 330, 262],
      click: [420],
    };
    (freqs[kind] || freqs.click).forEach((f, i) => {
      const o = audioContext.createOscillator(),
        g = audioContext.createGain(),
        t = audioContext.currentTime + i * 0.065;
      o.type = kind === "hit" ? "triangle" : "sine";
      o.frequency.setValueAtTime(f, t);
      g.gain.setValueAtTime(volume * 0.085, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      o.connect(g);
      g.connect(audioContext.destination);
      o.start(t);
      o.stop(t + 0.18);
    });
  } catch {}
}
export function App({ launchMode = "resume", onTerminal }) {
  const [initialSave] = useState(readSave);
  const [run, setRun] = useState(
    () => initialSave || newRun("warrior", seed(), data),
  );
  const [modal, setModal] = useState(launchMode === "new" ? "characters" : initialSave ? null : "characters");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState(null);
  const [hover, setHover] = useState(null);
  const [pointer, setPointer] = useState(null);
  const [drag, setDrag] = useState(null);
  const [toast, setToast] = useState("");
  const [preview, setPreview] = useState(null);
  const [combat, setCombat] = useState(null);
  const [tick, setTick] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [lastBattle, setLastBattle] = useState(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [settings, setSettings] = useState(() => {
    try {
      return {
        volume: 0.35,
        music: false,
        motion: true,
        colorblind: false,
        autoMerge: false,
        ...JSON.parse(localStorage.getItem(SETTINGS) || "{}"),
      };
    } catch {
      return {
        volume: 0.35,
        music: false,
        motion: true,
        colorblind: false,
        autoMerge: false,
      };
    }
  });
  const gridRef = useRef(),
    current = useRef(),
    toastTimer = useRef(),
    justDropped = useRef(false),
    settling = useRef(false);
  current.current = { run, selected, drag, page, combat, modal };
  const notify = (message, kind = "error") => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 3200);
    tone(kind, settings.volume);
  };
  useEffect(() => {
    try {
      localStorage.setItem(SAVE, JSON.stringify(run));
      localStorage.setItem("wuwa-backpack-save-meta", JSON.stringify({ savedAt: Date.now() }));
    } catch {
      notify("浏览器无法保存进度，请保持此页面打开。");
    }
  }, [run]);
  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS, JSON.stringify(settings));
    } catch {}
  }, [settings]);
  useEffect(() => {
    document.documentElement.dataset.motion = String(settings.motion);
    document.documentElement.dataset.colorblind = String(settings.colorblind);
  }, [settings.motion, settings.colorblind]);
  useEffect(() => {
    if (!settings.music) return;
    const notes = [196, 246.94, 293.66, 369.99, 293.66, 246.94, 220, 293.66];
    let i = 0;
    const timer = setInterval(() => {
      if (!document.hidden)
        tone(i++ % 2 ? "place" : "click", settings.volume * 0.16);
    }, 1800);
    return () => clearInterval(timer);
  }, [settings.music, settings.volume]);
  function dispatch(action) {
    try {
      let next = act(current.current.run, action, data);
      let merged = false;
      if (settings.autoMerge && ["buy", "move", "equipReward"].includes(action.type)) {
        while (mergeGroups(next, data).length) {
          next = act(next, { type: "merge" }, data);
          merged = true;
        }
      }
      setRun(next);
      setSelected(null);
      setPreview(null);
      setHover(null);
      tone(
        merged
          ? "merge"
          : action.type === "buy"
            ? "buy"
            : action.type === "sell"
              ? "sell"
              : "place",
        settings.volume,
      );
      if (merged) notify("共鸣升阶！三件物品已合为更高星级。", "merge");
      return true;
    } catch (e) {
      notify(e.message);
      return false;
    }
  }
  function pick(kind, key, event) {
    if (run.phase !== "SHOP" || combat) return;
    const i =
      kind === "shop"
        ? { defId: run.shop.offers[key], rot: 0 }
        : kind === "reward" ? { defId: run.rewardStash[key], rot: 0 }
        : run.items.find((i) => i.uid === key);
    if (!i?.defId) return;
    const def = data.itemById.get(i.defId);
    if (kind === "shop" && run.gold < def.cost) {
      notify("贝币不足：需要 " + def.cost + " 贝币");
      return;
    }
    setSelected({ kind, key, defId: i.defId, rot: i.rot || 0 });
    setHover({ defId: i.defId, uid: i.uid });
    if (event?.button === 0) {
      setDrag({ x: event.clientX, y: event.clientY });
      setPointer({ x: event.clientX, y: event.clientY });
    }
  }
  function position(x, y, selection) {
    const box = gridRef.current?.getBoundingClientRect();
    if (!box) return null;
    const cols = run.pages[page][0],
      cell = box.width / cols;
    const col = Math.floor((x - box.left) / cell),
      row = Math.floor((y - box.top) / cell);
    const spec = {
      defId: selection.defId,
      stars: 1,
      page,
      col,
      row,
      rot: selection.rot,
    };
    return {
      spec,
      inside: x >= box.left && x < box.right && y >= box.top && y < box.bottom,
      valid: canPlace(
        run,
        spec,
        data,
        selection.kind === "bag" ? selection.key : undefined,
      ),
    };
  }
  function place(x, y) {
    const s = current.current.selected;
    if (!s) return;
    const p = position(x, y, s);
    if (!p?.inside) {
      setPreview(null);
      return;
    }
    if (!p.valid) {
      notify("无法放置：格子重叠或超出边界");
      return;
    }
    dispatch(
      s.kind === "shop"
        ? { type: "buy", index: s.key, ...p.spec }
        : s.kind === "reward" ? { type: "equipReward", index: s.key, ...p.spec }
        : { type: "move", uid: s.key, ...p.spec },
    );
  }
  function rotate() {
    setSelected((s) => (s ? { ...s, rot: (s.rot + 90) % 360 } : s));
    setPreview(null);
    tone("click", settings.volume);
  }
  useEffect(() => {
    const move = (e) => {
      const c = current.current;
      if (!c.selected || c.modal || c.combat) return;
      setPointer({ x: e.clientX, y: e.clientY });
      const p = position(e.clientX, e.clientY, c.selected);
      setPreview(p?.inside ? p : null);
    };
    const up = (e) => {
      const c = current.current;
      if (!c.drag) return;
      const moved = Math.hypot(e.clientX - c.drag.x, e.clientY - c.drag.y) > 6;
      setDrag(null);
      if (moved) {
        justDropped.current = true;
        setTimeout(() => (justDropped.current = false), 0);
        const sell = document
          .getElementById("sell-zone")
          ?.getBoundingClientRect();
        if (
          c.selected?.kind === "bag" &&
          sell &&
          e.clientX >= sell.left &&
          e.clientX <= sell.right &&
          e.clientY >= sell.top &&
          e.clientY <= sell.bottom
        )
          dispatch({ type: "sell", uid: c.selected.key });
        else place(e.clientX, e.clientY);
      }
    };
    const cancel = () => { setDrag(null); setPreview(null); setPointer(null); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
    };
  });
  useEffect(() => {
    const key = (e) => {
      if (["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName)) return;
      if (e.key === "Escape") {
        if (combat) return;
        setModal(null);
        setSelected(null);
        setPreview(null);
        return;
      }
      if (modal || combat || run.phase !== "SHOP") return;
      if (e.key.toLowerCase() === "r" && selected) {
        e.preventDefault();
        rotate();
      }
      if (e.key.toLowerCase() === "d") {
        e.preventDefault();
        dispatch({ type: "reroll" });
      }
      if (e.key === " ") {
        e.preventDefault();
        startBattle();
      }
      if (e.key.toLowerCase() === "z" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        dispatch({ type: "undo" });
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  function startBattle() {
    try {
      const ev = battle(current.current.run, data);
      setCombat(ev);
      setLastBattle(ev);
      setTick(-1);
      setSelected(null);
      setPreview(null);
      settling.current = false;
      setSpeed(1);
      tone("click", settings.volume);
    } catch (e) {
      notify(e.message);
    }
  }
  function finishBattle() {
    if (!combat || settling.current) return;
    settling.current = true;
    const next = settle(current.current.run, combat.log, data);
    setRun(next);
    setCombat(null);
    setTick(0);
    tone(next.result.winner === "A" ? "win" : "loss", settings.volume);
  }
  useEffect(() => {
    if (!combat) return;
    const timer = setInterval(
      () => setTick((t) => Math.min(combat.log.ticks, t + speed)),
      rules.battle.tickMs,
    );
    return () => clearInterval(timer);
  }, [combat, speed]);
  useEffect(() => {
    if (combat && tick >= combat.log.ticks) finishBattle();
  }, [tick, combat]);
  function newGame(cls) {
    setRun(newRun(cls, seed(), data));
    setPage(0);
    setModal(null);
    setSelected(null);
    setLastBattle(null);
    setHover(null);
    tone("win", settings.volume);
  }
  const c = chars[run.cls],
    Icon = c.icon,
    stats = initSide(playerBuild(run), 0, data, run.round),
    syn = computeSynergies(playerBuild(run), data.itemById, run.pages[0]);
  const occupied = run.items
    .filter((i) => i.page === page)
    .reduce((s, i) => {
      const d = data.itemById.get(i.defId);
      return s + d.size[0] * d.size[1];
    }, 0);
  const focused = selected
    ? {
        defId: selected.defId,
        uid: selected.kind === "bag" ? selected.key : null,
      }
    : hover;
  const sumSyn = {};
  for (const value of syn.values())
    for (const [key, n] of Object.entries(value))
      sumSyn[key] = (sumSyn[key] || 0) + n;
  const dps =
    run.items.reduce((sum, i) => {
      const d = data.itemById.get(i.defId);
      return (
        sum +
        d.effects
          .filter((e) => e.op === "damage")
          .reduce(
            (a, e) => a + e.value * rules.battle.starMult[i.stars - 1],
            0,
          ) /
          (d.cooldown || 1)
      );
    }, 0) *
    (1 + stats.buffs.atkPct / 100) *
    (1 + stats.buffs.speedPct / 100) * stats.atkScale;
  const switchModal = (m) => {
    setSelected(null);
    setPreview(null);
    setModal(m);
    tone("click", settings.volume);
  };
  return (
    <div className="app-shell">
      <header>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            switchModal("characters");
          }}
        >
          <span className="brand-symbol">
            <Radio size={28} />
          </span>
          <div>
            <b>
              共鸣行囊<span>鸣潮</span>
            </b>
            <small>RESONANCE · BACKPACK BRAWL</small>
          </div>
        </a>
        <nav>
          <button className="nav-active">
            <Swords size={16} />
            共鸣试炼
          </button>
          <button onClick={() => switchModal("codex")}>
            <BookOpen size={16} />
            物品图鉴
          </button>
          <button onClick={() => switchModal("help")}>
            <HelpCircle size={16} />
            玩法指南
          </button>
        </nav>
        <div className="header-tools">
          {onTerminal && <button className="icon-btn" title="返回启动终端" onClick={onTerminal}><Home size={19} /></button>}
          <span className="offline">本地单人试炼</span>
          <button
            className="icon-btn"
            title={settings.volume ? "静音" : "开启声音"}
            onClick={() =>
              setSettings((s) => ({ ...s, volume: s.volume ? 0 : 0.35 }))
            }
          >
            {settings.volume ? <Volume2 size={19} /> : <VolumeX size={19} />}
          </button>
          <button
            className="icon-btn"
            title="设置"
            onClick={() => switchModal("settings")}
          >
            <Settings size={19} />
          </button>
        </div>
      </header>
      <main>
        <div className="runbar">
          <div className="journey-title">
            <span className="eyebrow">SOLARIS-3 / SIMULATION</span>
            <h1>
              行囊就绪，共鸣将启<span>备战阶段</span>
            </h1>
          </div>
          <div className="run-numbers">
            <div>
              <span>试炼进度</span>
              <b>
                {String(run.round).padStart(2, "0")}
                <small> / {rules.enemyCurve.totalRounds}</small>
              </b>
            </div>
            <div>
              <span>剩余命值</span>
              <b className="hearts">
                {Array.from({ length: rules.economy.startHearts }, (_, i) => (
                  <Heart
                    key={i}
                    size={19}
                    fill={i < run.hearts ? "currentColor" : "none"}
                    className={i >= run.hearts ? "empty" : ""}
                  />
                ))}
              </b>
            </div>
            <div className="wallet">
              <span>贝币</span>
              <b>
                <Coins size={22} />
                {run.gold}
              </b>
            </div>
          </div>
        </div>
        <div className="round-track" aria-label="回合进度">
          {Array.from({ length: rules.enemyCurve.totalRounds }, (_, i) => (
            <span
              key={i}
              className={
                i + 1 === run.round
                  ? "current"
                  : i + 1 < run.round
                    ? "passed"
                    : ""
              }
            >
              <i title={(i + 1) % rules.rewards.everyRounds === 0 && i < 17 ? '本关结束后进入奖励关' : undefined}>
                {(i + 1) % rules.rewards.everyRounds === 0 && i < 17 && <Gift size={11} />}
              </i>
              {(i === 0 || i === 4 || i === 10 || i === 17) && (
                <small>
                  {i === 0
                    ? "启程"
                    : i === 17
                      ? "终局"
                      : i === 4
                        ? "第二行囊"
                        : "第三行囊"}
                </small>
              )}
            </span>
          ))}
        </div>
        <div className="workbench">
          <section className="shop-panel panel">
            <div className="panel-heading">
              <div>
                <span className="section-code">01 / SUPPLY</span>
                <h2>今州补给站</h2>
              </div>
              <span className="tiny-tag">第 {run.round} 批</span>
            </div>
            <div className="shop-intro">
              挑选装备，拖入行囊<span>锁定可保留至下一回合</span>
            </div>
            <div className="offers">
              {run.shop.offers.map((id, i) =>
                id ? (
                  <div
                    key={i}
                    className={
                      "offer " +
                      (selected?.kind === "shop" && selected.key === i
                        ? "chosen"
                        : "") +
                      (run.gold < data.itemById.get(id).cost
                        ? " unaffordable"
                        : "")
                    }
                    style={{
                      "--rarity": rarity[data.itemById.get(id).rarity][1],
                    }}
                  >
                    <button
                      className="offer-main"
                      onPointerDown={(e) => pick("shop", i, e)}
                      onClick={(e) => {
                        if (e.detail === 0) pick("shop", i);
                      }}
                      onMouseEnter={() => setHover({ defId: id })}
                      onMouseLeave={() => setHover(null)}
                      aria-label={"购买 " + name(id)}
                    >
                      <span className="item-tier">
                        {rarity[data.itemById.get(id).rarity][0]}
                      </span>
                      <div className="offer-art">{art(id)}</div>
                      <b>{name(id)}</b>
                      <span className="offer-bottom">
                        <span>{data.itemById.get(id).size.join(" × ")}</span>
                        <strong>
                          <Coins size={13} />
                          {data.itemById.get(id).cost}
                        </strong>
                      </span>
                    </button>
                    <button
                      className={
                        "freeze " + (run.shop.frozen[i] ? "frozen" : "")
                      }
                      title={run.shop.frozen[i] ? "取消锁定" : "锁定补给"}
                      aria-label={"锁定货架 " + (i + 1)}
                      onClick={() => dispatch({ type: "freeze", index: i })}
                    >
                      {run.shop.frozen[i] ? (
                        <Lock size={13} />
                      ) : (
                        <Unlock size={13} />
                      )}
                    </button>
                  </div>
                ) : (
                  <div key={i} className="sold">
                    <Check size={23} />
                    <span>已购入</span>
                  </div>
                ),
              )}
            </div>
            <button
              className="reroll"
              onClick={() => dispatch({ type: "reroll" })}
            >
              <RefreshCw size={16} />
              刷新补给
              <span>
                <Coins size={14} />
                {run.shop.rerollCost}
                <kbd>D</kbd>
              </span>
            </button>
            <div className="shop-footer">
              <Lock size={12} />
              {run.shop.frozen.filter(Boolean).length} /{" "}
              {rules.shop.freezeSlots} 已锁定
              <span>每次刷新费用 +{rules.shop.rerollCostStep}</span>
            </div>
            <div
              id="sell-zone"
              className={
                "sell-zone " + (selected?.kind === "bag" ? "ready" : "")
              }
            >
              <Trash2 size={17} />
              <span>将背包物品拖到这里出售</span>
              {selected?.kind === "bag" && (
                <button
                  onClick={() => dispatch({ type: "sell", uid: selected.key })}
                >
                  出售 +
                  {refund(
                    run.items.find((i) => i.uid === selected.key),
                    data,
                  )}
                </button>
              )}
            </div>
            {!!run.rewardStash?.length && <div className="reward-stash">
              <b><Gift size={14} />奖励寄存 · 放入背包后生效</b>
              <div>{run.rewardStash.map((id, index) => <button key={index}
                aria-label={'装备奖励 ' + name(id)}
                onPointerDown={e => pick('reward', index, e)}
                onClick={e => { if (e.detail === 0) pick('reward', index); }}
                onMouseEnter={() => setHover({ defId: id })} onMouseLeave={() => setHover(null)}>
                {art(id)}<span>{name(id)}</span><small>免费</small>
              </button>)}</div>
            </div>}
          </section>
          <section className="backpack-panel panel">
            <div className="panel-heading">
              <div>
                <span className="section-code">02 / BACKPACK</span>
                <h2>
                  共鸣行囊{" "}
                  <span className="capacity">
                    {occupied}
                    <small>
                      {" "}
                      / {run.pages[page][0] * run.pages[page][1]} 格
                    </small>
                  </span>
                </h2>
              </div>
              <button
                className="icon-btn"
                title="撤销 Ctrl+Z"
                disabled={!run.undo.length}
                onClick={() => dispatch({ type: "undo" })}
              >
                <Undo2 size={19} />
              </button>
            </div>
            <div className="bag-tabs">
              {rules.unlock.pageUnlockRounds.map((round, i) => (
                <button
                  key={i}
                  disabled={run.round < round}
                  className={page === i ? "active" : ""}
                  onClick={() => {
                    setPage(i);
                    setPreview(null);
                  }}
                >
                  {run.round < round ? (
                    <Lock size={12} />
                  ) : (
                    <Backpack size={14} />
                  )}
                  行囊 {["Ⅰ", "Ⅱ", "Ⅲ"][i]}
                  {run.round < round && <small>第{round}回合</small>}
                </button>
              ))}
            </div>
            <div className="grid-surround">
              <div className="grid-coordinates">
                {Array.from({ length: run.pages[page][0] }, (_, i) => (
                  <span key={i}>0{i + 1}</span>
                ))}
              </div>
              <div
                ref={gridRef}
                className="bag-grid"
                style={{
                  "--cols": run.pages[page][0],
                  "--rows": run.pages[page][1],
                }}
                onClick={(e) => {
                  if (selected && !justDropped.current)
                    place(e.clientX, e.clientY);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (selected) rotate();
                }}
              >
                {Array.from(
                  { length: run.pages[page][0] * run.pages[page][1] },
                  (_, i) => (
                    <button
                      key={"cell" + i}
                      className="grid-cell"
                      style={{
                        gridColumn: (i % run.pages[page][0]) + 1,
                        gridRow: Math.floor(i / run.pages[page][0]) + 1,
                      }}
                      tabIndex={selected ? 0 : -1}
                      aria-label={`放置到第${Math.floor(i / run.pages[page][0]) + 1}行第${(i % run.pages[page][0]) + 1}列`}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && selected) {
                          e.stopPropagation();
                          const r = e.currentTarget.getBoundingClientRect();
                          place(r.x + r.width / 2, r.y + r.height / 2);
                        }
                      }}
                    />
                  ),
                )}
                {run.items
                  .filter((i) => i.page === page)
                  .map((item) => {
                    const def = data.itemById.get(item.defId),
                      [w, h] = effectiveSize(def.size, item.rot),
                      idx = run.items.findIndex((i) => i.uid === item.uid);
                    return (
                      <button
                        key={item.uid}
                        data-uid={item.uid}
                        className={
                          "bag-item " +
                          (syn.has(idx) ? "synergized " : "") +
                          (selected?.kind === "bag" && selected.key === item.uid
                            ? "selected"
                            : "")
                        }
                        style={{
                          gridColumn: `${item.col + 1} / span ${w}`,
                          gridRow: `${item.row + 1} / span ${h}`,
                          "--rarity": rarity[def.rarity][1],
                        }}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          pick("bag", item.uid, e);
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (e.detail === 0) pick("bag", item.uid);
                        }}
                        onMouseEnter={() =>
                          setHover({ defId: item.defId, uid: item.uid })
                        }
                        onMouseLeave={() => setHover(null)}
                        aria-label={name(item.defId) + " " + item.stars + "星"}
                      >
                        {art(item.defId, {
                          style: {
                            transform:
                              item.rot % 180 ? `rotate(90deg)` : undefined,
                          },
                        })}
                        <span className="item-star">
                          {"✦".repeat(item.stars)}
                        </span>
                        {syn.has(idx) && (
                          <Sparkles className="syn-spark" size={13} />
                        )}
                        <span className="bag-item-name">
                          {name(item.defId)}
                        </span>
                      </button>
                    );
                  })}
                {preview && (
                  <div
                    className={
                      "placement-preview " +
                      (preview.valid ? "valid" : "invalid")
                    }
                    style={{
                      position: 'absolute',
                      left: `${preview.spec.col / run.pages[page][0] * 100}%`,
                      top: `${preview.spec.row / run.pages[page][1] * 100}%`,
                      width: `${effectiveSize(data.itemById.get(preview.spec.defId).size, preview.spec.rot)[0] / run.pages[page][0] * 100}%`,
                      height: `${effectiveSize(data.itemById.get(preview.spec.defId).size, preview.spec.rot)[1] / run.pages[page][1] * 100}%`,
                    }}
                  >
                    {preview.valid ? <Check size={22} /> : <X size={22} />}
                  </div>
                )}
              </div>
              <div className="grid-corner left" />
              <div className="grid-corner right" />
            </div>
            <div className="bag-actions">
              <button
                onClick={() => dispatch({ type: "expand", page })}
                disabled={run.round < rules.economy.expansion.unlockRound}
              >
                <Plus size={15} />
                {run.round < 3 ? "第 3 回合开放扩容" : "扩容一行"}
                {run.round >= 3 && (
                  <span>
                    <Coins size={13} />
                    {expansionCost(run, data)}
                  </span>
                )}
              </button>
              <button
                disabled={!mergeGroups(run, data).length}
                onClick={() => switchModal("merge")}
              >
                <ChevronsUp size={16} />
                共鸣升阶
                {mergeGroups(run, data).length > 0 && (
                  <i>{mergeGroups(run, data).length}</i>
                )}
              </button>
            </div>
            <div className="synergy-strip">
              <Sparkles size={18} />
              <div>
                <b>{syn.size ? "共鸣连接已激活" : "让装备产生共鸣"}</b>
                <p>
                  {Object.keys(sumSyn).length
                    ? Object.entries(sumSyn)
                        .map(([k, v]) => `${statNames[k]} +${fmt(v)}`)
                        .join(" · ")
                    : "把有协同效果的物品与对应装备上下左右贴边摆放。"}
                </p>
              </div>
            </div>
            <div className="keyboard-hints">
              {selected ? (
                <>
                  <b>{name(selected.defId)}</b>
                  <button onClick={rotate}>
                    <RotateCw size={13} />
                    旋转
                  </button>
                  <button
                    onClick={() => {
                      setSelected(null);
                      setPreview(null);
                    }}
                  >
                    取消
                  </button>
                </>
              ) : (
                <>
                  <span>
                    <kbd>R</kbd>旋转
                  </span>
                  <span>
                    <kbd>Ctrl</kbd> + <kbd>Z</kbd>撤销
                  </span>
                  <span>点击选中，再点格子也可放置</span>
                </>
              )}
            </div>
            {preview?.valid && (
              <div className="preview-note">
                {(() => {
                  const p = preview.spec;
                  const temp = {
                    ...playerBuild(run),
                    items: [
                      ...run.items.filter(
                        (i) =>
                          !(selected.kind === "bag" && i.uid === selected.key),
                      ),
                      p,
                    ],
                  };
                  const after = computeSynergies(
                    temp,
                    data.itemById,
                    run.pages[0],
                  );
                  return "放置后：" + after.size + " 件装备获得相邻加成";
                })()}
              </div>
            )}
          </section>
          <aside className="resonator-panel">
            <div
              className="resonator-card panel"
              style={{ "--character": c.color }}
            >
              <div className="resonator-heading">
                <span className="section-code">03 / RESONATOR</span>
                <button
                  className="text-button"
                  onClick={() => switchModal("characters")}
                >
                  更换共鸣者
                  <ArrowUpRight size={13} />
                </button>
              </div>
              <div className="portrait-stage">
                <span className="portrait-ring" />
                <span className="portrait-word">{c.en}</span>
                {art("character_" + run.cls, { className: "character-art" })}
                <span className="element">
                  <Icon size={14} />
                  {c.element}
                </span>
              </div>
              <div className="resonator-name">
                <div>
                  <span>{c.title}</span>
                  <h2>{c.name}</h2>
                </div>
                <span className="class-tag">{c.style.split(" · ")[0]}</span>
              </div>
              <div className="stat-grid">
                <div>
                  <Heart size={16} />
                  <span>生命</span>
                  <b>{stats.maxHp}</b>
                </div>
                <div>
                  <Zap size={16} />
                  <span>耐力</span>
                  <b>{stats.maxStamina}</b>
                </div>
                <div>
                  <Swords size={16} />
                  <span>预估 DPS</span>
                  <b>{fmt(dps)}</b>
                </div>
                <div>
                  <Target size={16} />
                  <span>暴击率</span>
                  <b>{stats.buffs.critChance}%</b>
                </div>
              </div>
              <div className="trait">
                <b>
                  <Sparkles size={13} />
                  {data.classById.get(run.cls).traits[0].name}
                </b>
                <p>{data.classById.get(run.cls).traits[0].desc}</p>
                <small>{run.blessings?.hpPct ? `共鸣祝福：生命 +${run.blessings.hpPct}% · 攻击 +${run.blessings.atkPct}%（本局）` : '每 3 关解锁一次奖励 · 本局永久成长'}</small>
              </div>
            </div>
            <div className="next-enemy panel">
              <span className="eyebrow">NEXT ENCOUNTER</span>
              <div>
                <span className="enemy-icon">
                  <Swords size={23} />
                </span>
                <div>
                  <b>
                    {
                      ["荒野残响", "巡游残象", "共鸣投影", "黑海试炼"][
                        Math.min(3, Math.floor((run.round - 1) / 5))
                      ]
                    }{" "}
                    · {String(run.round).padStart(2, "0")}
                  </b>
                  <p>
                    {
                      data.classById.get(data.enemyByRound.get(run.round).cls)
                        .name
                    }
                    构筑 · {data.enemyByRound.get(run.round).items.length}{" "}
                    件装备
                  </p>
                </div>
              </div>
              <button onClick={() => switchModal("enemy")}>
                侦察对手
                <ChevronRight size={15} />
              </button>
            </div>
            <button className="battle-button" onClick={startBattle}>
              <Swords size={22} />
              <span>
                进入共鸣试炼<small>装备就绪，自动战斗</small>
              </span>
              <ChevronRight size={24} />
            </button>
            <span className="battle-hint">
              <kbd>Space</kbd>快速开始 · 胜利保命 / 失败 -1 命
            </span>
          </aside>
        </div>
        <footer>
          <span>
            <Radio size={13} />
            共鸣终端 · 进度自动保存
          </span>
          <button onClick={() => switchModal("credits")}>素材来源与鸣谢</button>
          <span>同人试作 / FAN-MADE · v1.0</span>
        </footer>
      </main>
      {focused && !modal && !combat && (
        <ItemDetail focus={focused} run={run} syn={syn} />
      )}
      {drag &&
        selected &&
        pointer &&
        Math.hypot(pointer.x - drag.x, pointer.y - drag.y) > 6 && (
          <div
            className="drag-ghost"
            style={{
              left: pointer.x,
              top: pointer.y,
              transform: `translate(-50%,-80%) rotate(${selected.rot}deg)`,
            }}
          >
            {art(selected.defId)}
          </div>
        )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
      {combat && (
        <BattleView
          ev={combat}
          tick={tick}
          speed={speed}
          setSpeed={setSpeed}
          finish={finishBattle}
          settings={settings}
        />
      )}
      {!combat && run.phase === "RESULT" && !modal && (
        <div className="modal-backdrop">
          <section className="modal result-modal">
            <div className="result-emblem">
              {run.result.winner === "A" ? (
                <Trophy size={44} />
              ) : (
                <Shield size={44} />
              )}
            </div>
            <span className="eyebrow">
              ROUND {String(run.round).padStart(2, "0")} · COMPLETE
            </span>
            <h2>
              {run.result.winner === "A"
                ? "共鸣制胜"
                : run.result.winner === "draw"
                  ? "势均力敌"
                  : "暂且整备，再次出发"}
            </h2>
            <p>
              {run.result.winner === "A"
                ? "命值保留，补给已送达。"
                : "失去 1 点命值，调整摆放与协同迎接下一战。"}
            </p>
            <div className="receipt">
              {[
                ["基础补给", run.result.receipt.base],
                ["储蓄利息", run.result.receipt.interest],
                ["胜利奖励", run.result.receipt.victory],
                ["连胜奖励", run.result.receipt.streak],
              ].map(([label, value]) => (
                <div key={label}>
                  <span>{label}</span>
                  <b>+{value}</b>
                </div>
              ))}
              <div className="total">
                <span>本轮获得贝币</span>
                <b>+{run.result.receipt.total}</b>
              </div>
            </div>
            <div className="result-meta">
              <span>
                战斗 {fmt((run.result.ticks * rules.battle.tickMs) / 1000)} 秒
              </span>
              <span>剩余 {run.hearts} 命</span>
            </div>
            <button
              className="primary"
              onClick={() => {
                setRun(act(run, { type: "next" }, data));
                setPage(0);
              }}
            >
              {run.hearts <= 0 || run.round >= rules.enemyCurve.totalRounds
                ? "查看试炼总结"
                : isRewardRound(run, data) ? "前往奖励关 · 共鸣馈赠"
                : "继续整备 · 下一回合"}
              <ChevronRight size={18} />
            </button>
            {lastBattle && (
              <button
                className="text-button centered"
                onClick={() => downloadJSON(lastBattle)}
              >
                导出本轮完整战报
                <Download size={13} />
              </button>
            )}
          </section>
        </div>
      )}
      {!combat && run.phase === 'REWARD' && !modal && <div className="modal-backdrop">
        <section className="modal reward-modal">
          <div className="reward-emblem"><Gift size={40} /></div>
          <span className="eyebrow">RESONANCE GIFT · {String(run.round).padStart(2, '0')}</span>
          <h2>共鸣馈赠</h2>
          <p>已完成 {run.round} 关。选择一份奖励，继续你的旅途。</p>
          <div className="reward-choices">
            <button data-reward="weapon" disabled={!run.reward.weaponId} onClick={() => dispatch({ type: 'reward', choice: 'weapon' })}>
              <span className="reward-tier">{rarity[run.reward.rarity][0]}武器</span>
              {run.reward.weaponId ? art(run.reward.weaponId) : <Check size={64} />}
              <h3>{run.reward.weaponId ? name(run.reward.weaponId) : '本阶武器已集齐'}</h3>
              <p>全角色可装备 · 免费寄存<br />整理好背包后再放入，不会丢失</p>
              <strong>{run.reward.weaponId ? '领取武器' : '请选择另一份馈赠'}</strong>
            </button>
            <button data-reward="gold" onClick={() => dispatch({ type: 'reward', choice: 'gold' })}>
              <span className="reward-tier">补给资金</span><Coins size={64} />
              <h3>贝币 +{run.reward.gold}</h3><p>立即到账<br />用于购买、刷新或扩容</p><strong>领取贝币</strong>
            </button>
            <button data-reward="stats" onClick={() => dispatch({ type: 'reward', choice: 'stats' })}>
              <span className="reward-tier">角色成长</span><Sparkles size={64} />
              <h3>共鸣祝福</h3><p>最大生命 +{run.reward.hpPct}%<br />攻击伤害 +{run.reward.atkPct}% · 本局永久叠加</p><strong>接受祝福</strong>
            </button>
          </div>
          <p className="reward-note">每 3 关一次，三选一。第 6 关起提供史诗武器，第 12 关起提供传说武器。</p>
        </section>
      </div>}
      {!combat && run.phase === "END" && !modal && (
        <div className="modal-backdrop">
          <section className="modal result-modal">
            <Trophy size={48} className="gold" />
            <span className="eyebrow">RESONANCE ARCHIVE</span>
            <h2>
              {run.hearts > 0
                ? "十八重共鸣，试炼达成"
                : "这趟旅途，留作下一次的回响"}
            </h2>
            <div className="end-stats">
              {[
                ["抵达回合", run.round],
                ["胜利场次", run.wins],
                ["最高伤害", fmt(run.maxHit)],
                ["累计收入", run.income],
                ["图鉴收集", run.discovered.length + "/40"],
                ["构筑标签", buildTags(run)],
              ].map(([label, value]) => (
                <div key={label}>
                  <span>{label}</span>
                  <b>{value}</b>
                </div>
              ))}
            </div>
            <button className="primary" onClick={() => setModal("characters")}>
              再启旅途
              <ChevronRight size={18} />
            </button>
            <button
              className="text-button centered"
              onClick={() => downloadJSON(run)}
            >
              保存本局记录
              <Download size={13} />
            </button>
          </section>
        </div>
      )}
      {modal && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <section
            className={
              "modal " +
              (modal === "characters"
                ? "character-modal"
                : modal === "codex"
                  ? "codex-modal"
                  : "")
            }
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="close icon-btn"
              title="关闭"
              onClick={() => setModal(null)}
            >
              <X size={20} />
            </button>
            {modal === "characters" && (
              <>
                <span className="eyebrow">CHOOSE YOUR RESONATOR</span>
                <h2>选择与你同行的共鸣者</h2>
                <p className="muted">
                  不同的起始行囊，不同的共鸣方式。选择角色开始新一局。
                </p>
                <div className="character-options">
                  {Object.entries(chars).map(([key, ch]) => {
                    const ClIcon = ch.icon,
                      cl = data.classById.get(key);
                    return (
                      <button
                        className="character-option"
                        key={key}
                        style={{ "--character": ch.color }}
                        onClick={() => newGame(key)}
                      >
                        {art("character_" + key)}
                        <span className="element">
                          <ClIcon size={13} />
                          {ch.element}
                        </span>
                        <small>{ch.en}</small>
                        <h3>{ch.name}</h3>
                        <b>{ch.style}</b>
                        <p>{cl.traits[0].desc}</p>
                        <div className="start-items">
                          {cl.startItems.map((id) => (
                            <span key={id} title={name(id)}>
                              {art(id)}
                            </span>
                          ))}
                        </div>
                        <span className="choose-cta">
                          与她同行
                          <ChevronRight size={16} />
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="modal-bottom">
                  <span>以原策划职业数值为基础的鸣潮同人改编</span>
                  <button
                    className="text-button"
                    onClick={() => setModal(null)}
                  >
                    {initialSave || run.round > 1
                      ? "返回当前试炼"
                      : "先用长离开始"}
                    <ChevronRight size={15} />
                  </button>
                </div>
              </>
            )}
            {modal === "help" && (
              <>
                <span className="eyebrow">FIELD GUIDE</span>
                <h2>整理行囊，赢下共鸣试炼</h2>
                <div className="help-steps">
                  {[
                    [
                      "01",
                      "选购与摆放",
                      "把补给拖入空格，或先点击物品再点击格子。只有成功放入时才扣贝币。",
                    ],
                    [
                      "02",
                      "旋转与协同",
                      "按 R 或右键旋转选中的物品。上下左右贴边可触发对应协同，斜角与跨页无效。",
                    ],
                    [
                      "03",
                      "升阶与取舍",
                      "三件同名同星级物品可以升阶。拖到出售区回收贝币；Ctrl+Z 撤销最近 20 次摆放或买卖。刷新和合成会清空撤销记录。",
                    ],
                    [
                      "04",
                      "战斗与成长",
                      "按空格开战，可切换 1 / 2 / 4 倍速或跳过。每场结算获得收入与利息；存活到第 18 回合即通关。",
                    ],
                    [
                      "05",
                      "扩容与锁定",
                      "第 3 回合可购买扩容，第 5 / 11 回合解锁新背包页。最多锁定 3 件补给，刷新与下回合仍保留。",
                    ],
                    ["06", "共鸣馈赠", "完成第 3 / 6 / 9 / 12 / 15 关且仍有命值时进入奖励关：武器、贝币、属性三选一。武器先寄存，放入背包后生效；祝福本局永久叠加。奖励不另收命值，不替代原有战斗关卡。"],
                  ].map(([n, title, text]) => (
                    <div key={n}>
                      <b>{n}</b>
                      <section>
                        <h3>{title}</h3>
                        <p>{text}</p>
                      </section>
                    </div>
                  ))}
                </div>
                <p className="notice">
                  武器和声骸的效果、稀有度为本作平衡设计，与鸣潮原游戏不同。预估
                  DPS 不计耐力耗尽、暴击和敌方防御。
                </p>
              </>
            )}
            {modal === "settings" && (
              <>
                <span className="eyebrow">TERMINAL SETTINGS</span>
                <h2>终端设置</h2>
                <div className="setting-row">
                  <span>音效音量</span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    aria-label="音效音量"
                    value={settings.volume}
                    onChange={(e) =>
                      setSettings({ ...settings, volume: +e.target.value })
                    }
                  />
                  <b>{Math.round(settings.volume * 100)}%</b>
                </div>
                {[
                  ["music", "环境提示音", "轻柔循环音色，原创合成音"],
                  ["motion", "界面动效", "角色浮动、受击与按钮动画"],
                  [
                    "colorblind",
                    "色觉辅助",
                    "放置预览使用蓝 / 橙，并保留 ✓ / × 标记",
                  ],
                  [
                    "autoMerge",
                    "自动共鸣升阶",
                    "开启即同意三合一，保留最早物品的位置；合成不可撤销",
                  ],
                ].map(([key, label, desc]) => (
                  <label className="setting-row" key={key}>
                    <span>
                      <b>{label}</b>
                      <small>{desc}</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={settings[key]}
                      onChange={(e) =>
                        setSettings({ ...settings, [key]: e.target.checked })
                      }
                    />
                  </label>
                ))}
                <div className="setting-row">
                  <span>语言</span>
                  <span>简体中文</span>
                </div>
                <button
                  className="secondary"
                  onClick={() => setModal("characters")}
                >
                  <RefreshCw size={16} />
                  重新开始试炼
                </button>
              </>
            )}
            {modal === "codex" && (
              <>
                <span className="eyebrow">RESONANCE ARCHIVE / 40 ITEMS</span>
                <h2>共鸣物品图鉴</h2>
                <div className="codex-controls">
                  <input
                    placeholder="搜索武器、声骸…"
                    aria-label="搜索物品"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <select
                    aria-label="筛选稀有度"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  >
                    <option value="all">全部稀有度</option>
                    {Object.entries(rarity).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v[0]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="codex-grid">
                  {items.items
                    .filter(
                      (i) =>
                        name(i.id).includes(search) &&
                        (filter === "all" || filter === i.rarity),
                    )
                    .map((i) => (
                      <article
                        key={i.id}
                        style={{ "--rarity": rarity[i.rarity][1] }}
                      >
                        {art(i.id)}
                        <div>
                          <h3>{name(i.id)}</h3>
                          <span>
                            {rarity[i.rarity][0]} · {i.size.join("×")} 格 ·{" "}
                            {i.cost} 贝币
                          </span>
                          <p>{effectText(i, 1)}</p>
                          {i.synergy?.map((s, n) => (
                            <small key={n}>
                              相邻{tagNames[s.withTag] || s.withTag}：
                              {statNames[s.stat]} +{s.add}，最多 {s.maxStacks}{" "}
                              件
                            </small>
                          ))}
                        </div>
                      </article>
                    ))}
                  {!items.items.some(
                    (i) =>
                      name(i.id).includes(search) &&
                      (filter === "all" || filter === i.rarity),
                  ) && <p>没有匹配的物品</p>}
                </div>
              </>
            )}
            {modal === "enemy" && (
              <>
                <span className="eyebrow">ENEMY RECONNAISSANCE</span>
                <h2>第 {run.round} 回合 · 共鸣投影</h2>
                <p className="muted">
                  {data.classById.get(enemyBuild(run, data).cls).desc}
                </p>
                <div className="enemy-stats">
                  <span>
                    生命{" "}
                    <b>
                      {
                        initSide(enemyBuild(run, data), 1, data, run.round)
                          .maxHp
                      }
                    </b>
                  </span>
                  <span>
                    装备 <b>{enemyBuild(run, data).items.length}</b>
                  </span>
                </div>
                <div className="enemy-list">
                  {enemyBuild(run, data).items.map((i, n) => (
                    <div key={n}>
                      {art(i.defId)}
                      <span>
                        {name(i.defId)}
                        <small>{"✦".repeat(i.stars)}</small>
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
            {modal === "merge" && (
              <>
                <span className="eyebrow">RESONANCE UPGRADE</span>
                <h2>确认共鸣升阶</h2>
                <p className="muted">
                  三件同名、同星级物品合为一件更高星级物品。保留最早一件的位置与旋转，此操作不可撤销。
                </p>
                {mergeGroups(run, data)[0] && (
                  <div className="merge-preview">
                    {art(mergeGroups(run, data)[0][0].defId)}
                    <h3>{name(mergeGroups(run, data)[0][0].defId)}</h3>
                    <p>
                      {mergeGroups(run, data)[0][0].stars} 星 × 3 →{" "}
                      {mergeGroups(run, data)[0][0].stars + 1} 星
                    </p>
                    <b>
                      效果倍率 ×
                      {
                        rules.battle.starMult[
                          mergeGroups(run, data)[0][0].stars - 1
                        ]
                      }{" "}
                      → ×
                      {
                        rules.battle.starMult[
                          mergeGroups(run, data)[0][0].stars
                        ]
                      }
                    </b>
                  </div>
                )}
                <button
                  className="primary"
                  onClick={() => {
                    if (dispatch({ type: "merge" })) {
                      setModal(null);
                      notify("共鸣升阶完成！", "merge");
                    }
                  }}
                >
                  <ChevronsUp size={18} />
                  确认升阶
                </button>
              </>
            )}
            {modal === "credits" && (
              <>
                <span className="eyebrow">CREDITS & SOURCES</span>
                <h2>素材来源与鸣谢</h2>
                <p>
                  本作是非官方、非商业鸣潮主题玩法原型。鸣潮名称、角色及游戏美术版权归库洛游戏及相应权利人所有。
                </p>
                <h3>角色表情 · 呜哇小站</h3>
                <p>
                  来源：
                  <a
                    href="https://emoji.wuwa.games/characters"
                    target="_blank"
                    rel="noreferrer"
                  >
                    emoji.wuwa.games / 角色图鉴
                  </a>
                </p>
                {Object.keys(chars).map((k) => (
                  <p key={k}>
                    <a
                      href={assets["character_" + k].source}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {chars[k].name}
                    </a>{" "}
                    · {assets["character_" + k].author}
                  </p>
                ))}
                <p className="muted">
                  来源文章标示 CC BY-NC-SA
                  4.0；角色原作权利仍归库洛。图片未改绘，采用界面缩放展示。
                </p>
                <h3>武器与声骸</h3>
                <p>
                  <a
                    href="https://github.com/ryanbenson/wuthering-waves-assets"
                    target="_blank"
                    rel="noreferrer"
                  >
                    ryanbenson / wuthering-waves-assets
                  </a>{" "}
                  · 原始美术归库洛游戏。公开可获取不代表获得商业授权。
                </p>
                <p>
                  玩法、40 件物品数值及 18
                  关敌人：用户提供的《背包大乱斗》策划案。音效：程序合成。界面图标：Lucide（ISC）。完整来源、下载地址和权利说明见随附素材清单。
                </p>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
function effectText(def, stars) {
  return (
    def.effects
      .map(
        (e) =>
          `${e.trigger === "on_battle_start" ? "开场" : "激活"}${e.op === "buff" ? statNames[e.stat] : statNames[e.op] || e.op} ${e.op === "buff" ? "+" : ""}${fmt(e.value * rules.battle.starMult[stars - 1])}`,
      )
      .join("；") || "通过相邻协同为装备提供加成"
  );
}
function ItemDetail({ focus, run, syn }) {
  const def = data.itemById.get(focus.defId),
    item = run.items.find((i) => i.uid === focus.uid),
    stars = item?.stars || 1,
    received = syn.get(run.items.indexOf(item));
  return (
    <aside
      className="item-detail"
      style={{ "--rarity": rarity[def.rarity][1] }}
    >
      <div>
        {art(def.id)}
        <section>
          <small>
            {rarity[def.rarity][0]} · {def.size.join("×")} 格
          </small>
          <h3>{name(def.id)}</h3>
          <b>{"✦".repeat(stars)}</b>
        </section>
      </div>
      <p>{effectText(def, stars)}</p>
      {def.cooldown > 0 && (
        <div className="detail-cooldown">
          <span>基础冷却 {def.cooldown}s</span>
          <span>消耗耐力 {def.staminaCost}</span>
        </div>
      )}
      {def.synergy?.map((s, i) => (
        <p className="detail-synergy" key={i}>
          <Sparkles size={13} />
          相邻{tagNames[s.withTag] || s.withTag}获得 {statNames[s.stat]} +
          {s.add}（最多 {s.maxStacks} 件）
        </p>
      ))}
      {received && (
        <p className="detail-synergy">
          已获得：
          {Object.entries(received)
            .map(([k, v]) => `${statNames[k]} +${v}`)
            .join(" · ")}
        </p>
      )}
      <small>相邻加成在战斗开始时汇入角色总属性</small>
    </aside>
  );
}
function buildTags(run) {
  const counts = {};
  run.items.forEach((i) =>
    data.itemById
      .get(i.defId)
      .tags.forEach((t) => (counts[t] = (counts[t] || 0) + 1)),
  );
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([k]) => tagNames[k] || k)
    .join(" · ");
}
function downloadJSON(value) {
  const a = document.createElement("a"),
    url = URL.createObjectURL(
      new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
    );
  a.href = url;
  a.download = `wuwa-round-${value.round || "run"}-seed-${value.seed}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function BattleView({ ev, tick, speed, setSpeed, finish, settings }) {
  const states = ev.log.events.filter((e) => e.type === "state"),
    state = states[Math.max(0, Math.min(tick, states.length - 1))];
  const start = [
    initSide(ev.a, 0, data, ev.round),
    initSide(ev.b, 1, data, ev.round),
  ];
  const recent = ev.log.events.filter(
    (e) => e.t <= tick && e.t > tick - 4 && ["damage", "heal"].includes(e.type),
  );
  const active = ev.log.events.filter(
    (e) => e.type === "activate" && e.t <= tick && e.t > tick - 3,
  );
  useEffect(() => {
    const e = recent.find((e) => e.type === "damage");
    if (e) tone(e.crit ? "crit" : "hit", settings.volume * 0.5);
  }, [tick]);
  return (
    <div className="modal-backdrop battle-backdrop">
      <section
        className={
          "battle-view " +
          (tick >= rules.battle.suddenDeath.fromTick ? "sudden" : "")
        }
      >
        <div className="battle-top">
          <div>
            <span className="eyebrow">RESONANCE IN PROGRESS</span>
            <h2>
              共鸣交锋 <small>第 {ev.round} 回合</small>
            </h2>
          </div>
          <div className="battle-timer">
            {fmt((Math.max(0, tick) * rules.battle.tickMs) / 1000).toFixed(1)}
            <small>s</small>
          </div>
          <div className="playback">
            {[1, 2, 4].map((n) => (
              <button
                key={n}
                className={speed === n ? "active" : ""}
                onClick={() => setSpeed(n)}
              >
                {n}×
              </button>
            ))}
            <button onClick={finish}>
              <FastForward size={16} />
              跳过
            </button>
          </div>
        </div>
        {tick >= rules.battle.suddenDeath.fromTick && (
          <div className="sudden-label">决死时刻 · 双方伤害翻倍</div>
        )}
        <div className="battle-sides">
          {[ev.a, ev.b].map((side, si) => (
            <div
              key={si}
              className={"fighter fighter-" + si}
              style={{ "--character": chars[side.cls].color }}
            >
              <div className="fighter-heading">
                <div>
                  <span>{si ? "敌方投影" : "你的共鸣者"}</span>
                  <h3>{chars[side.cls].name}</h3>
                </div>
                <b>
                  {Math.ceil(tick < 0 ? start[si].maxHp : state.hp[si])}
                  <small> / {start[si].maxHp}</small>
                </b>
              </div>
              <div className="hp-bar">
                <i
                  style={{
                    width: `${(tick < 0 ? 1 : state.hp[si] / start[si].maxHp) * 100}%`,
                  }}
                />
              </div>
              <div className="combat-resources">
                <span>
                  <Shield size={14} />
                  {Math.floor(tick < 0 ? start[si].block : state.block[si])}
                </span>
                <span>
                  <Zap size={14} />
                  {fmt(tick < 0 ? start[si].stamina : state.stamina[si])} /{" "}
                  {start[si].maxStamina}
                </span>
              </div>
              <div
                className={
                  "fighter-stage " +
                  (active.some((e) => e.side === si) ? "attacking" : "")
                }
              >
                {art("character_" + side.cls)}
                <span className="floor-ring" />
                {recent
                  .filter((e) =>
                    e.type === "heal" ? e.side === si : e.target === si,
                  )
                  .slice(-3)
                  .map((e, i) => (
                    <span
                      className={
                        "damage-number " +
                        (e.type === "heal" ? "healing" : "") +
                        (e.crit ? " critical" : "")
                      }
                      style={{
                        left: 40 + i * 12 + "%",
                        top: 30 + i * 18 + "%",
                      }}
                      key={e.t + "-" + i}
                    >
                      {e.type === "heal" ? "+" : "−"}
                      {Math.round(e.amount)}
                      {e.crit ? "!" : ""}
                    </span>
                  ))}
              </div>
              <div className="combat-bags">
                {side.pages.map((p, pi) => (
                  <div
                    className="mini-bag"
                    key={pi}
                    style={{
                      gridTemplateColumns: `repeat(${p[0]},1fr)`,
                      gridTemplateRows: `repeat(${p[1]},1fr)`,
                    }}
                  >
                    {Array.from({ length: p[0] * p[1] }, (_, i) => (
                      <i
                        key={"g" + i}
                        style={{
                          gridColumn: (i % p[0]) + 1,
                          gridRow: Math.floor(i / p[0]) + 1,
                        }}
                      />
                    ))}
                    {side.items
                      .filter((i) => (i.page || 0) === pi)
                      .map((it, k) => {
                        const [w, h] = effectiveSize(
                          data.itemById.get(it.defId).size,
                          it.rot,
                        );
                        const last = ev.log.events
                          .filter(
                            (e) =>
                              e.type === "activate" &&
                              e.side === si &&
                              e.slot === side.items.indexOf(it) &&
                              e.t <= tick,
                          )
                          .at(-1);
                        const cd =
                          ((data.itemById.get(it.defId).cooldown /
                            (1 + start[si].buffs.speedPct / 100)) *
                            1000) /
                          rules.battle.tickMs;
                        const ratio =
                          last && cd > 0
                            ? Math.max(0, 1 - (tick - last.t) / cd)
                            : 0;
                        return (
                          <div
                            title={name(it.defId)}
                            key={k}
                            className={
                              "combat-item " +
                              (active.some(
                                (e) =>
                                  e.side === si &&
                                  e.slot === side.items.indexOf(it),
                              )
                                ? "firing"
                                : "")
                            }
                            style={{
                              gridColumn: `${it.col + 1}/span ${w}`,
                              gridRow: `${it.row + 1}/span ${h}`,
                            }}
                          >
                            {art(it.defId)}
                            <span
                              className="cd-shade"
                              style={{ height: ratio * 100 + "%" }}
                            />
                          </div>
                        );
                      })}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="battle-divider">VS</div>
        <div className="battle-log">
          {recent.slice(-3).map((e, i) => (
            <span key={i}>
              {e.side === 0 ? "我方" : "敌方"}
              {e.type === "heal" ? "回复" : "造成"} <b>{fmt(e.amount)}</b>{" "}
              {e.type === "heal" ? "生命" : "伤害"}
              {e.crit ? " · 暴击" : ""}
            </span>
          ))}
          {!recent.length && <span>装备蓄能中 · 战斗自动进行</span>}
        </div>
      </section>
    </div>
  );
}
