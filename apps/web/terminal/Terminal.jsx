import React, {useEffect,useRef,useState} from 'react';
import {ArrowUpRight,ArrowRight,Volume2,VolumeX,Settings,HelpCircle,Radio,ChevronRight,BookOpen,Power,Play,RotateCw,X,Heart,Coins,Monitor,Shield,Check,Flame} from 'lucide-react';
import {theme,themeVariables} from './tokens.mjs';
import {readTerminalSave,readSettings,SETTINGS_KEY,browserStorage} from './storage.mjs';
import assets from '../../../assets/manifest.json';
import terminalAssets from '../../../assets/terminal/manifest.json';
import emoji from '../../../assets/emoji/manifest.json';
import itemData from '../../../data/items.json';
import pkg from '../../../package.json';
import './terminal.css';

const timing=theme.terminal.timing,icons=[Play,RotateCw,BookOpen,HelpCircle,Settings,Power];
const clsNames={warrior:'长离',ranger:'炽霞',mage:'安可',cleric:'维里奈'};
const rarityNames={common:'普通',uncommon:'精良',rare:'稀有',epic:'史诗',legendary:'传说'};
let audio;
function sound(type,volume) {
  if(!volume)return;
  try{
    audio??=new AudioContext();audio.resume();
    const frequencies=type==='deny'?[180,110]:type==='confirm'?[420,630,840]:[620];
    frequencies.forEach((hz,i)=>{const o=audio.createOscillator(),g=audio.createGain(),start=audio.currentTime+i*theme.sound.hover.durationMs/1000;
      o.type='sine';o.frequency.setValueAtTime(hz,start);g.gain.setValueAtTime(volume*.06,start);
      g.gain.exponentialRampToValueAtTime(.001,start+theme.sound.confirm.durationMs/1000);
      o.connect(g);g.connect(audio.destination);o.start(start);o.stop(start+theme.sound.confirm.durationMs/1000);
    });
  }catch{}
}
function SafeImage({entry,...props}) {
  const [failed,setFailed]=useState(false);
  useEffect(()=>setFailed(false),[entry?.path]);
  return !failed&&entry?.path?<img {...props} src={entry.path} alt={props.alt||''} draggable="false" onError={()=>setFailed(true)} />:null;
}
function Logo(){return <svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M24 3 45 24 24 45 3 24Z M24 11 37 24 24 37 11 24Z M3 24h12m18 0h12M24 3v12m0 18v12" stroke="currentColor" strokeWidth="1.5"/><path d="m19 24 5-6 5 6-5 6Z" fill="currentColor"/></svg>}
function Spectrum(){return <svg className="term-spectrum" viewBox="0 0 600 600" fill="none" aria-hidden="true">
  <circle cx="300" cy="300" r="240"/><circle cx="300" cy="300" r="210" strokeDasharray="3 12"/><circle cx="300" cy="300" r="270" strokeDasharray="110 26 2 26"/>
  {Array.from({length:64},(_,i)=>{const a=i*Math.PI/32,r=i%4===0?252:260;return <line key={i} x1={300+Math.cos(a)*r} y1={300+Math.sin(a)*r} x2={300+Math.cos(a)*270} y2={300+Math.sin(a)*270}/>})}
  <path d="M300 16v22M300 562v22M16 300h22M562 300h22"/>
</svg>}
function Dialog({title,onClose,children}) {
  const ref=useRef();
  useEffect(()=>{
    const previous=document.activeElement;
    ref.current.querySelector('button,input,a')?.focus();
    const key=e=>{
      if(e.key==='Escape'){e.preventDefault();e.stopPropagation();onClose();}
      if(e.key==='Tab'){
        const nodes=[...ref.current.querySelectorAll('button:not(:disabled),input,a[href],select')];
        if(e.shiftKey&&document.activeElement===nodes[0]){e.preventDefault();nodes.at(-1)?.focus();}
        else if(!e.shiftKey&&document.activeElement===nodes.at(-1)){e.preventDefault();nodes[0]?.focus();}
      }
    };
    document.addEventListener('keydown',key,true);
    return()=>{document.removeEventListener('keydown',key,true);previous?.focus();};
  },[]);
  return <div className="term-dialog-backdrop" onClick={onClose}><section className="term-dialog" role="dialog" aria-modal="true" aria-label={title} ref={ref} onClick={e=>e.stopPropagation()}>
    <div className="term-dialog-heading"><span>RESONANCE TERMINAL</span><button aria-label="关闭弹窗" onClick={onClose}><X/></button></div><h2>{title}</h2>{children}
  </section></div>;
}
export default function Terminal({onLaunch}) {
  const [save,setSave]=useState(()=>readTerminalSave(browserStorage()));
  const [settings,setSettings]=useState(()=>readSettings(browserStorage()));
  const [systemReduced,setSystemReduced]=useState(()=>matchMedia('(prefers-reduced-motion: reduce)').matches);
  const reduced=systemReduced||!settings.motion;
  const [phase,setPhase]=useState(reduced?'IDLE':'BOOT');
  const [selected,setSelected]=useState(save.status==='valid'?1:0);
  const [dialog,setDialog]=useState(null),[message,setMessage]=useState(''),[query,setQuery]=useState('');
  const [size,setSize]=useState({width:innerWidth,height:innerHeight});
  const [bubble,setBubble]=useState(null),[bootEmoji,setBootEmoji]=useState(0),[deny,setDeny]=useState(0);
  const root=useRef(),menu=useRef([]),timers=useRef([]),lastActivity=useRef(performance.now()),idleShown=useRef(false),clicks=useRef(0),messageTimer=useRef();
  const small=size.width<theme.meta.minResolution[0]||size.height<theme.meta.minResolution[1];
  const later=(fn,ms)=>{const id=setTimeout(fn,ms);timers.current.push(id);return id;};
  const notify=text=>{setMessage(text);clearTimeout(messageTimer.current);messageTimer.current=later(()=>setMessage(''),timing.bubbleHold);};
  useEffect(()=>()=>{timers.current.forEach(clearTimeout);clearTimeout(messageTimer.current);},[]);
  useEffect(()=>{
    const media=matchMedia('(prefers-reduced-motion: reduce)'),change=()=>setSystemReduced(media.matches),resize=()=>setSize({width:innerWidth,height:innerHeight});
    media.addEventListener('change',change);window.addEventListener('resize',resize);
    const refresh=()=>setSave(readTerminalSave(browserStorage()));window.addEventListener('storage',refresh);window.addEventListener('focus',refresh);
    return()=>{media.removeEventListener('change',change);window.removeEventListener('resize',resize);window.removeEventListener('storage',refresh);window.removeEventListener('focus',refresh);};
  },[]);
  useEffect(()=>{
    if(reduced&&phase==='BOOT')setPhase('IDLE');
    if(phase!=='BOOT')return;
    const done=()=>setPhase('IDLE');
    const skip=e=>{e.preventDefault();e.stopImmediatePropagation();done();};
    const t=setTimeout(done,theme.motion.duration.boot),cycle=setInterval(()=>setBootEmoji(n=>n+1),timing.emojiCycle);
    document.addEventListener('keydown',skip,true);document.addEventListener('click',skip,true);
    return()=>{clearTimeout(t);clearInterval(cycle);document.removeEventListener('keydown',skip,true);document.removeEventListener('click',skip,true);};
  },[phase,reduced]);
  useEffect(()=>{
    if(reduced||small)return;
    let frame,x=0,y=0,tx=0,ty=0;
    const move=e=>{tx=(e.clientX/innerWidth-.5)*2;ty=(e.clientY/innerHeight-.5)*2;lastActivity.current=performance.now();};
    const loop=()=>{x+=(tx-x)*timing.parallaxLerp;y+=(ty-y)*timing.parallaxLerp;root.current?.style.setProperty('--term-x',x);root.current?.style.setProperty('--term-y',y);frame=requestAnimationFrame(loop);};
    frame=requestAnimationFrame(loop);window.addEventListener('pointermove',move);
    return()=>{cancelAnimationFrame(frame);window.removeEventListener('pointermove',move);root.current?.style.setProperty('--term-x',0);root.current?.style.setProperty('--term-y',0);};
  },[reduced,small]);
  useEffect(()=>{
    if(phase!=='IDLE'||reduced)return;
    const id=setInterval(()=>{
      if(!idleShown.current&&performance.now()-lastActivity.current>timing.idleBubble){idleShown.current=true;setBubble({mood:'idle',text:'行囊就绪，等你启程。'});later(()=>setBubble(null),timing.bubbleHold);}
    },theme.motion.duration.base);
    return()=>clearInterval(id);
  },[phase,reduced]);
  function updateSettings(patch){
    const next={...settings,...patch};setSettings(next);
    try{localStorage.setItem(SETTINGS_KEY,JSON.stringify(next));}catch{notify('设置暂时无法保存，当前窗口内仍会生效。');}
  }
  function select(index,focus=false){
    if(phase!=='IDLE')return;
    lastActivity.current=performance.now();
    if(index!==selected){
      sound('hover',settings.volume);
      const feedback={0:['excited','行囊就绪。随时可以出发。'],1:['curious',save.status==='valid'?'欢迎回来，继续这一趟旅途。':'还没有行囊记录'],2:['curious','新的共鸣，也许就藏在这些装备里。'],5:['farewell','回响会留在这里。']};
      if(feedback[index]){setBubble({mood:feedback[index][0],text:feedback[index][1]});later(()=>setBubble(null),timing.bubbleHold);}
    }
    setSelected(index);if(focus)menu.current[index]?.focus();
  }
  function launch(mode){
    if(phase==='CONFIRM')return;
    setDialog(null);setPhase('CONFIRM');sound('confirm',settings.volume);
    later(()=>onLaunch(mode),reduced?theme.motion.duration.instant:timing.confirmFill+timing.confirmFlash+theme.motion.duration.base);
  }
  function activate(index){
    if(phase!=='IDLE'||small)return;
    const id=theme.startScreen.menuItems[index].id;
    if(id==='resume'){
      const latest=readTerminalSave(browserStorage());setSave(latest);
      if(latest.status!=='valid'){
        setDeny(n=>n+1);sound('deny',settings.volume);setBubble({mood:'curious',text:latest.status==='ended'?'上一趟旅途已经结束，开启新试炼吧。':'还没有行囊记录'});later(()=>setBubble(null),timing.bubbleHold);return;
      }
      launch('resume');
    }else if(id==='start'){
      const latest=readTerminalSave(browserStorage());setSave(latest);
      if(latest.status==='valid')setDialog('overwrite');else launch('new');
    }else setDialog(id);
  }
  useEffect(()=>{
    const key=e=>{
      if(phase!=='IDLE'||dialog||small)return;
      lastActivity.current=performance.now();
      if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();select(Math.max(0,Math.min(5,selected+(e.key==='ArrowDown'?1:-1))),true);}
      if((e.key==='Enter'||e.key===' ')&&(e.target===document.body||e.target.dataset?.menu!==undefined)){e.preventDefault();activate(selected);}
      if(e.key==='Escape'){e.preventDefault();setDialog('exit');}
    };
    window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
  },[phase,selected,dialog,small,save,settings]);
  const current=theme.startScreen.menuItems[selected];
  const age=save.savedAt?Math.max(0,Math.floor((Date.now()-save.savedAt)/60000)):null;
  const resumeHint=save.status==='valid'?`第 ${String(save.run.round).padStart(2,'0')} 关 · 命值 ${save.run.hearts}/5`:save.status==='ended'?'上次试炼已结束':save.status==='corrupt'?'存档损坏，已尝试备份':'暂无可继续的存档';
  const mood=bubble?.mood||(selected===2?'curious':selected===5?'farewell':'excited');
  const style={...themeVariables(),
    '--t-boot-grid':timing.bootGrid+'ms','--t-boot-portrait':timing.bootPortrait+'ms','--t-boot-title':timing.bootTitle+'ms','--t-boot-menu':timing.bootMenu+'ms','--t-boot-frame':timing.bootFrame+'ms',
    '--t-ring-cycle':timing.ringCycle+'ms','--t-grid-cycle':timing.gridCycle+'ms','--t-scan-cycle':timing.scanCycle+'ms','--t-confirm-fill':timing.confirmFill+'ms','--t-confirm-flash':timing.confirmFlash+'ms',
    '--t-selected':selected,'--t-parallax-grid':theme.startScreen.layers[0].parallaxPx+'px','--t-parallax-ring':theme.startScreen.layers[1].parallaxPx+'px','--t-parallax-portrait':theme.startScreen.layers[2].parallaxPx+'px'};
  return <div ref={root} className="terminal" style={style} data-phase={phase} data-reduced={reduced} data-colorblind={settings.colorblind} data-shake={settings.screenShake}>
    <div className="term-grid" aria-hidden="true"/><div className="term-rings"><Spectrum/></div>
    {!reduced&&!small&&<div className="term-particles" aria-hidden="true">{Array.from({length:theme.terminal.particleCount},(_,i)=><i key={i} style={{left:(i*37%100)+'%',animationDuration:(timing.particleMin+i*timing.particleStep)+'ms',animationDelay:-(i*timing.particleStep)+'ms'}}/>)}</div>}
    <div className="term-scan" aria-hidden="true"/>
    <header className="term-topbar"><a className="term-brand" href="#" onClick={e=>{e.preventDefault();setDialog(null);}}><Logo/><span>共鸣行囊<small>RESONANCE TERMINAL</small></span></a>
      <div className="term-top-tools"><span className="term-build">v{pkg.version} <i/> LOCAL / OFFLINE</span><button aria-label="启动页帮助" onClick={()=>setDialog('guide')}><HelpCircle/></button><button aria-label="启动页设置" onClick={()=>setDialog('settings')}><Settings/></button><button aria-label={settings.volume?'启动页静音':'启动页开启声音'} onClick={()=>updateSettings({volume:settings.volume?0:.35})}>{settings.volume?<Volume2/>:<VolumeX/>}</button></div>
    </header>
    {small?<main className="term-small"><Monitor/><span>SYSTEM NOTICE</span><h1>终端分辨率不足</h1><p>请使用 ≥ 1280 × 720 的窗口</p><strong>{size.width} × {size.height}</strong><p>放大窗口后将自动继续。</p>{window.resonanceDesktop?.toggleFullscreen&&<button className="term-primary" onClick={()=>window.resonanceDesktop.toggleFullscreen()}>切换全屏 · F11</button>}</main>:<>
      <div className="term-portrait-layer">
        <div className="term-portrait-index">01<span>/ RESONATOR</span></div>
        <button className="term-portrait" aria-label="与长离互动" onClick={()=>{clicks.current++;if(clicks.current%theme.terminal.easterClicks===0){setBubble({mood:'excited',text:'落子无悔。下一步，就交给你了。'});sound('confirm',settings.volume);later(()=>setBubble(null),timing.bubbleHold);}}}>
          <SafeImage entry={terminalAssets.hero} alt="长离 · 丹煌离火" fetchPriority="high"/><span className="term-portrait-fallback">丹煌离火</span>
        </button>
        <div className="term-hero-marker"><span>RESONATOR 1205</span><h2>长离 <small>CHANGLI</small></h2><p><Flame/> 热熔共鸣者 <i/> 离火未熄，棋局未终</p></div>
        <div className="term-emote" data-visible={!!bubble||phase==='BOOT'} aria-live="polite">
          <SafeImage entry={emoji[phase==='BOOT'?Object.keys(emoji)[bootEmoji%Object.keys(emoji).length]:mood]} width={theme.terminal.layout.emojiSize} height={theme.terminal.layout.emojiSize} loading="lazy"/>
          <span>{bubble?.text||(phase==='BOOT'?'共鸣链路接入中':'行囊就绪')}</span>
        </div>
        <div className="term-side-readout"><span>SIGNAL STRENGTH</span><b>99.8 <small>%</small></b><div>{Array.from({length:18},(_,i)=><i key={i}/>)}</div><span>RESONANCE LINK / STABLE</span></div>
      </div>
      <main className="term-content">
        <div className="term-heading"><span className="term-eyebrow"><i/> SOLARIS-3 / TERMINAL <span>终端已就绪</span></span>
          <h1>{'共鸣行囊'.split('').map((letter,i)=><span key={i} style={{'--t-letter-delay':(timing.bootTitle+i*timing.letterStagger)+'ms'}}>{letter}</span>)}</h1>
          <p className="term-subtitle">RESONANCE BACKPACK BRAWL</p><p className="term-tagline">在有限的格子里，构建你的共鸣链路。</p>
        </div>
        <nav className="term-menu" aria-label="启动菜单"><div className="term-menu-indicator" aria-hidden="true"/>
          {theme.startScreen.menuItems.map((m,i)=>{const Icon=icons[i];return <button key={m.id} data-menu={m.id} ref={e=>menu.current[i]=e} className={'term-menu-row '+(i===selected?'active':'')} aria-disabled={m.id==='resume'&&save.status!=='valid'}
            style={{'--t-row-delay':(timing.bootMenu+i*timing.menuStagger)+'ms'}} onFocus={()=>select(i)} onMouseEnter={()=>select(i)} onClick={()=>activate(i)}>
            <span className="term-row-number">0{i+1}</span><Icon/><b>{m.label}</b><small>{m.en}</small><ChevronRight/>
          </button>;})}
        </nav>
        <div className="term-menu-description" key={deny} data-deny={deny>0&&selected===1}><span>{current.id==='resume'?resumeHint:current.id==='codex'?`本局已发现 ${save.run?.discovered.length||0} / ${itemData.items.length} 件物品`:current.id==='settings'?'音量 · 色觉辅助 · 动态效果':current.hint}</span>
          {current.id==='resume'&&save.status==='valid'&&<small>{clsNames[save.run.cls]} · {age===null?'历史存档':age===0?'刚刚保存':`${age} 分钟前保存`}</small>}
        </div>
        <div className="term-actions"><button className="term-primary" data-testid="terminal-primary" aria-disabled={selected===1&&save.status!=='valid'} onClick={()=>activate(selected)}><span>{current.label}</span><ArrowRight/></button><div className="term-key-hints"><span><kbd>↑</kbd><kbd>↓</kbd> 选择</span><span><kbd>ENTER</kbd> 确认</span><span><kbd>ESC</kbd> 返回</span></div></div>
      </main>
      <div className="term-mission-card"><span>SIMULATION PROTOCOL</span><div><b>18</b><span>重共鸣试炼</span><i/><b>05</b><span>次旅途馈赠</span></div><p>整理行囊 · 连接共鸣 · 穿越残响</p></div>
    </>}
    <footer className="term-footer"><button onClick={()=>setDialog('credits')}>素材来源与授权 <ArrowUpRight/></button><span>本作为个人学习作品，与库洛游戏无关 · 非官方</span><small>© 2026 · RESONANCE PROJECT</small></footer>
    {phase==='BOOT'&&!small&&<button className="term-boot-skip" onClick={()=>setPhase('IDLE')}>按任意键或点击跳过启动动画</button>}
    {!!message&&<div className="term-toast" role="status">{message}</div>}
    {dialog&&<Dialog title={{settings:'终端设置',guide:'玩法指南',codex:'物品图鉴',exit:'退出终端',overwrite:'开启新的共鸣',credits:'素材来源与授权'}[dialog]} onClose={()=>setDialog(null)}>
      {dialog==='settings'&&<div className="term-settings">
        <label><span>音量 <small>{Math.round(settings.volume*100)}%</small></span><input aria-label="终端音量" type="range" min="0" max="1" step="0.05" value={settings.volume} onChange={e=>updateSettings({volume:+e.target.value})}/></label>
        {[['colorblind','色觉辅助','使用青蓝色主按钮，并保留文字标识'],['screenShake','屏幕震动','不可用操作的轻微震动反馈'],['motion','动态效果','视差、粒子、扫描线与开场动画']].map(([key,title,desc])=><label key={key}><span>{title}<small>{desc}</small></span><input type="checkbox" checked={settings[key]} onChange={e=>updateSettings({[key]:e.target.checked})}/></label>)}
        {systemReduced&&<p className="term-notice">系统已启用“减少动态效果”，启动页将优先关闭动画。</p>}
      </div>}
      {dialog==='guide'&&<div className="term-guide">{[['01','摆放与协同','购买装备并放入背包。R 旋转，正交相邻的物品可触发协同。'],['02','成长与取舍','三件同名同星级物品可以升阶；出售回收贝币，Ctrl+Z 可撤销近期摆放和买卖。'],['03','自动战斗','空格开战，可调整倍速或跳过。每场获得收入；保留命值完成 18 回合。'],['04','共鸣馈赠','第 3、6、9、12、15 关后选择武器、金币或本局属性提升。武器可免费寄存。']].map(([n,title,text])=><div key={n}><b>{n}</b><section><h3>{title}</h3><p>{text}</p></section></div>)}<p className="term-notice">已有游戏的规则、战斗与数值保持不变。</p></div>}
      {dialog==='codex'&&<><input className="term-search" placeholder="搜索武器或声骸" aria-label="启动图鉴搜索" value={query} onChange={e=>setQuery(e.target.value)}/><div className="term-codex">{itemData.items.filter(i=>(assets[i.id]?.name||i.name).includes(query.trim())).map(i=><article key={i.id}><SafeImage entry={assets[i.id]} loading="lazy"/><span>{assets[i.id]?.name||i.name}</span><small>{rarityNames[i.rarity]} · {i.size.join(' × ')} 格</small></article>)}</div></>}
      {dialog==='overwrite'&&<><p className="term-dialog-copy">当前记录：{clsNames[save.run?.cls]}，第 {save.run?.round} 关。选择新的共鸣者后，将覆盖这份试炼记录。</p><div className="term-dialog-actions"><button onClick={()=>setDialog(null)}>保留记录</button><button className="term-primary" onClick={()=>launch('new')}>选择新共鸣者 <ArrowRight/></button></div></>}
      {dialog==='exit'&&<><p className="term-dialog-copy">当前试炼记录会保留。确定退出共鸣终端吗？</p><div className="term-dialog-actions"><button onClick={()=>setDialog(null)}>继续停留</button><button className="term-primary" onClick={()=>{if(window.resonanceDesktop?.close)window.resonanceDesktop.close();else{window.close();notify('浏览器未允许自动关闭，请手动关闭此标签页。');setDialog(null);}}}>退出终端 <Power/></button></div></>}
      {dialog==='credits'&&<div className="term-credits"><p>非官方、非商业个人学习作品，与库洛游戏无关。鸣潮名称、角色、武器与原作美术归库洛游戏及相应权利人所有。</p><p>表情包来源：<a href="https://emoji.wuwa.games/" target="_blank" rel="noreferrer">呜哇小站 · 表情包仓鼠库</a>及各原作者。长离：九个西瓜；炽霞、安可：雾雪；维里奈：猫屋敷梨梨 & 春也 Haruya。</p><p>启动页立绘：<a href={terminalAssets.hero.source} target="_blank" rel="noreferrer">{terminalAssets.hero.author}</a>，原作美术归库洛游戏。表情仅作为反馈气泡使用。</p><p>武器与声骸素材：ryanbenson / wuthering-waves-assets。完整逐项来源见随包 ATTRIBUTIONS.md 与素材清单。界面音效由程序合成。</p><p className="term-notice">非官方同人作品；请保留素材署名，商业使用需另行获得权利人的许可。</p></div>}
    </Dialog>}
  </div>;
}
