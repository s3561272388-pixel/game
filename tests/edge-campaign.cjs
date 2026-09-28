// Optional browser regression: install playwright and Chrome, then run node tests/edge-campaign.cjs.
const {chromium}=require('playwright');
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),{pathToFileURL}=require('url');
const root=path.resolve(__dirname,'..'),url=pathToFileURL(path.join(root,'开始游戏.html')).href+'#trial';
(async()=>{const {loadData}=await import(pathToFileURL(path.join(root,'tools/lib/data.mjs')));const {newRun,canPlace,validateSave}=await import(pathToFileURL(path.join(root,'packages/engine/game.mjs')));const d=loadData();const browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1280,height:720}});page.setDefaultTimeout(6000);const checks=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
const state=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('wuwa-backpack-v1')));
const load=async(s)=>{await page.goto(url);await page.evaluate(s=>{localStorage.setItem('wuwa-backpack-v1',JSON.stringify(s));localStorage.setItem('wuwa-backpack-settings',JSON.stringify({volume:0,motion:false}))},s);await page.reload();await page.locator('.bag-grid').waitFor()};
let s=newRun('warrior',42,d);s.shop.offers[0]='arm_wood_shield';await load(s);
const cells=()=>page.locator('.grid-cell').evaluateAll(xs=>xs.map(x=>{const b=x.getBoundingClientRect();return [b.x,b.y,b.width,b.height]}));const before=await cells();await page.locator('.offer-main').first().click();const g=await page.locator('.bag-grid').boundingBox();await page.mouse.move(g.x+g.width-8,g.y+g.height-8);await page.locator('.placement-preview.invalid').waitFor();assert.deepEqual(await cells(),before);checks.push('out-of-bounds 2x2 preview leaves all 30 cells unchanged');
await page.keyboard.press('Escape');const ob=await page.locator('.offer-main').first().boundingBox();await page.mouse.move(ob.x+ob.width/2,ob.y+ob.height/2);await page.mouse.down();await page.mouse.move(g.x+g.width-8,g.y+g.height-8,{steps:4});await page.locator('.drag-ghost').waitFor();await page.evaluate(()=>window.dispatchEvent(new PointerEvent('pointercancel')));await page.mouse.up();assert.equal(await page.locator('.drag-ghost').count(),0);assert.equal((await state()).gold,10);checks.push('cancelled drag clears ghost and does not debit');
s=newRun('warrior',88,d);s.nextId=1;await load(s);await page.locator('.character-modal').waitFor();assert(validateSave(await state(),d));await page.getByRole('button',{name:/CHANGLI/}).click();checks.push('corrupt save safely starts a valid run');
// One real browser campaign: all round changes happen through the visible controls.
await load(newRun('warrior',9124,d));let transitions=0,purchases=0;
while(true){s=await state();assert(validateSave(s,d));if(s.phase==='END')break;if(s.phase==='REWARD'){await page.locator('[data-reward=gold]').click();continue;}assert.equal(s.phase,'SHOP');
for(let attempts=0;attempts<12;attempts++){
 s=await state();let candidate=null;
 const offers=s.shop.offers.map((id,index)=>({id,index})).filter(x=>x.id&&d.itemById.get(x.id).cost<=s.gold).sort((a,b)=>{const score=x=>{const i=d.itemById.get(x.id);return i.effects.reduce((n,e)=>n+(e.op==='damage'?e.value*2:e.op==='block'||e.op==='heal'?e.value:1),0)/(Math.max(.5,i.cooldown)*i.cost)};return score(b)-score(a)});
 for(const o of offers){for(let p=0;p<s.pages.length&&!candidate;p++)for(const rot of [0,90]){for(let row=0;row<s.pages[p][1]&&!candidate;row++)for(let col=0;col<s.pages[p][0]&&!candidate;col++){const spec={defId:o.id,stars:1,page:p,col,row,rot};if(canPlace(s,spec,d))candidate={...o,...spec}}if(candidate)break}}
 if(!candidate)break;const p=candidate;await page.locator('.bag-tabs button').nth(p.page).click();await page.locator('.offers > div').nth(p.index).locator('.offer-main').click();if(p.rot)await page.keyboard.press('r');const box=await page.locator('.bag-grid').boundingBox();await page.mouse.click(box.x+(p.col+.5)*box.width/s.pages[p.page][0],box.y+(p.row+.5)*box.height/s.pages[p.page][1]);await page.waitForTimeout(25);assert.equal((await state()).gold,s.gold-d.itemById.get(p.id).cost);purchases++;
 if(await page.getByRole('button',{name:/共鸣升阶/}).isEnabled()){await page.getByRole('button',{name:/共鸣升阶/}).click();await page.getByRole('button',{name:'确认升阶'}).click()}
}
 await page.keyboard.press('Escape');await page.keyboard.press('Space');await page.locator('.battle-view').waitFor();const skip=await page.getByRole('button',{name:'跳过',exact:true}).boundingBox();assert(skip.y>=0&&skip.y+skip.height<=720);await page.getByRole('button',{name:'跳过',exact:true}).click();await page.locator('.result-modal .primary').click();await page.waitForTimeout(20);transitions++;assert(transitions<=18);
}
checks.push('unmodified campaign reaches its ending through normal purchases, merges and round controls');checks.push('battle skip remains visible at 1280x720 across campaign');assert.deepEqual(errors,[]);
const report={checks,errors,campaign:{seed:9124,rounds:transitions,purchases,wins:s.wins,hearts:s.hearts,result:s.phase}};fs.writeFileSync(path.join(root,'reports/edge-campaign-checks.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await browser.close()})().catch(e=>{console.error(e);process.exit(1)});


