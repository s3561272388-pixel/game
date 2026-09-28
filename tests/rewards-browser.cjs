// Optional: install playwright and Chrome; node tests/rewards-browser.cjs.
const {chromium}=require('playwright');
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),{pathToFileURL}=require('url');
const root=path.resolve(__dirname,'..'),url=pathToFileURL(path.join(root,'开始游戏.html')).href+'#trial';
(async()=>{
 const {loadData}=await import(pathToFileURL(path.join(root,'tools/lib/data.mjs')));
 const {newRun,act,validateSave,battle,settle}=await import(pathToFileURL(path.join(root,'packages/engine/game.mjs')));
 const {nextPurchase,rewardChoice,campaign}=await import(pathToFileURL(path.join(root,'tools/difficulty-test.mjs')));
 const d=loadData(),browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage({viewport:{width:1280,height:720}});page.setDefaultTimeout(8000);
 const errors=[],checks=[],campaigns=[];page.on('pageerror',e=>errors.push(e.message));
 const state=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('wuwa-backpack-v1')));
 async function fixture(s){await page.goto(url);await page.evaluate(s=>{localStorage.setItem('wuwa-backpack-v1',JSON.stringify(s));localStorage.setItem('wuwa-backpack-settings',JSON.stringify({volume:0,motion:false}))},s);await page.reload();await page.locator('.bag-grid').waitFor();}
 async function same(expected){await page.waitForTimeout(20);const actual=await state();assert.deepEqual(actual,expected);assert(validateSave(actual,d));}
 for(const [cls,seed] of [['warrior',17043],['ranger',17043],['mage',9124],['cleric',9124]]) {
  await fixture(newRun(cls,seed,d));let rounds=0,actions=0,rewards=0;
  while(true){let s=await state();assert(validateSave(s,d));if(s.phase==='END')break;
   if(s.phase==='REWARD'){
    await page.locator('.reward-modal').waitFor();
    if(cls==='warrior'&&s.round===3){
     await page.screenshot({path:path.join(root,'reports/reward-desktop.png')});
     await page.reload();await page.locator('.reward-modal').waitFor();assert.deepEqual((await state()).reward,s.reward);
     checks.push('unclaimed reward survives reload with unchanged options');
     await page.setViewportSize({width:390,height:844});
     assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
     for(const choice of ['weapon','gold','stats']){await page.locator(`[data-reward="${choice}"]`).scrollIntoViewIfNeeded();assert(await page.locator(`[data-reward="${choice}"]`).isVisible());}
     await page.locator('[data-reward="weapon"]').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(root,'reports/reward-mobile.png')});
     checks.push('all three reward choices reachable at 390px without horizontal overflow');
     await page.setViewportSize({width:1280,height:720});s=await state();
    }
    const a={type:'reward',choice:rewardChoice(s)};await page.locator(`[data-reward="${a.choice}"]`).click();await same(act(s,a,d));rewards++;continue;
   }
   assert.equal(s.phase,'SHOP');
   for(let i=0;i<100;i++){
    s=await state();const a=nextPurchase(s,d);if(!a)break;
    if(a.type==='merge'){await page.getByRole('button',{name:/共鸣升阶/}).click();await page.getByRole('button',{name:'确认升阶'}).click();}
    else {
     await page.locator('.bag-tabs button').nth(a.page).click();
     if(a.type==='expand')await page.getByRole('button',{name:/扩容一行/}).click();
     else {
      if(a.type==='buy')await page.locator('.offers > div').nth(a.index).locator('.offer-main').click();
      else await page.locator('.reward-stash button').nth(a.index).click();
      if(a.rot)await page.keyboard.press('r');
      const g=await page.locator('.bag-grid').boundingBox();await page.mouse.click(g.x+(a.col+.5)*g.width/s.pages[a.page][0],g.y+(a.row+.5)*g.height/s.pages[a.page][1]);
     }
    }
    await same(act(s,a,d));actions++;
   }
   await page.keyboard.press('Escape');s=await state();
   await page.keyboard.press('Space');await page.locator('.battle-view').waitFor();
   const skip=page.getByRole('button',{name:'跳过',exact:true}),b=await skip.boundingBox();assert(b.y>=0&&b.y+b.height<=720);
   await skip.click();await same(settle(s,battle(s,d).log,d));
   s=await state();await page.locator('.result-modal .primary').click();await same(act(s,{type:'next'},d));
   rounds++;assert(rounds<=18);
  }
  const end=await state(),expected=campaign(cls,seed,d);
  assert.equal(end.round,18);assert(end.hearts>0);assert.equal(end.result.winner,'A');assert.equal(rounds,18);assert.equal(rewards,5);
  assert.equal(end.hearts,expected.hearts);assert.equal(end.wins,expected.wins);
  await page.screenshot({path:path.join(root,`reports/cleared-${cls}.png`)});
  campaigns.push({cls,seed,rounds,actions,rewards,hearts:end.hearts,wins:end.wins,finalWinner:end.result.winner});
  checks.push(cls+' completed all 18 rounds and defeated final enemy through UI');
 }
 checks.push('weapons equip freely from stash; gold and blessings match actual battle state');
 checks.push('all 5 reward milestones processed in each of 4 complete runs');
 assert.deepEqual(errors,[]);checks.push('no browser runtime exceptions');
 fs.writeFileSync(path.join(root,'reports/rewards-browser-checks.json'),JSON.stringify({checks,campaigns,errors},null,2));
 console.log(JSON.stringify({checks,campaigns,errors},null,2));await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
