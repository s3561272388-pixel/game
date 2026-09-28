// Optional Playwright test of the packaged Windows application, isolated from player saves.
const {_electron}=require('playwright');
const assert=require('assert/strict'),fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..');
(async()=>{
 const packaged=process.argv.includes('--packaged');
 const executablePath=packaged?path.join(root,'release/win-unpacked/共鸣行囊.exe'):path.join(root,'node_modules/electron/dist/electron.exe');
 const env={...process.env,RESONANCE_TEST_PROFILE:path.resolve(root,'../../..','work','desktop-test-'+Date.now()),RESONANCE_TEST_HIDDEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
 let app;const errors=[],checks=[];
 try{
  app=await _electron.launch({executablePath,args:packaged?[]:[root],env,timeout:30000});
  const page=await app.firstWindow();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
  await page.locator('.terminal').waitFor();await page.keyboard.press('x');await page.locator('.terminal[data-phase=IDLE]').waitFor();
  assert.equal(new URL(page.url()).protocol,'resonance:');
  const isolation=await page.evaluate(()=>({require:typeof require,process:typeof process,bridge:Object.keys(window.resonanceDesktop),images:[...document.images].filter(i=>i.complete&&i.naturalWidth===0).length}));
  assert.equal(isolation.require,'undefined');assert.equal(isolation.process,'undefined');assert.deepEqual(isolation.bridge,['close','toggleFullscreen']);assert.equal(isolation.images,0);checks.push('packaged local assets load under isolated custom protocol with no Node access');
  const prefs=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences());assert(prefs.contextIsolation&&prefs.sandbox&&prefs.webSecurity&&!prefs.nodeIntegration);checks.push('context isolation, sandbox and web security are enabled');
  const waitFullscreen=async expected=>{const until=Date.now()+5000;while(Date.now()<until){if(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isFullScreen())===expected)return;await new Promise(resolve=>setTimeout(resolve,50));}assert.fail('Fullscreen did not become '+expected);};
  // Native window transitions require a visible window; CDP keyboard events bypass Electron's input hook.
  const pressF11=()=>app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.showInactive();w.webContents.sendInputEvent({type:'keyDown',keyCode:'F11'});w.webContents.sendInputEvent({type:'keyUp',keyCode:'F11'});});
  await pressF11();await waitFullscreen(true);await pressF11();await waitFullscreen(false);checks.push('F11 toggles fullscreen for small desktop work areas');
  await page.locator('[data-menu=start]').click();await page.locator('.character-modal').waitFor();await page.getByRole('button',{name:/CHANGLI/}).click();const before=await page.evaluate(()=>JSON.parse(localStorage.getItem('wuwa-backpack-v1')));
  await page.getByTitle('返回启动终端',{exact:true}).click();await page.locator('.terminal[data-phase=IDLE]').waitFor();await page.locator('[data-menu=resume]').click();await page.locator('.app-shell').waitFor();assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('wuwa-backpack-v1')).seed),before.seed);checks.push('desktop new run, return and continue preserve the game state');
  await page.reload();await page.locator('.app-shell').waitFor();assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('wuwa-backpack-v1')).seed),before.seed);checks.push('desktop reload preserves the local save');
  await page.getByTitle('返回启动终端',{exact:true}).click();await page.locator('.terminal[data-phase=IDLE]').waitFor();await page.screenshot({path:path.join(root,'reports/desktop-terminal.png')});
  await page.locator('[data-menu=exit]').click();const closed=app.waitForEvent('close');await page.getByRole('dialog').getByRole('button',{name:'退出终端'}).click();await closed;checks.push('desktop exit closes its native window');app=null;
  assert.deepEqual(errors,[]);checks.push('no renderer runtime exceptions');
  fs.writeFileSync(path.join(root,'reports/desktop-checks.json'),JSON.stringify({packaged,checks,errors},null,2));console.log(JSON.stringify({packaged,checks,errors},null,2));
 }finally{if(app)await app.close();}
})().catch(e=>{console.error(e);process.exit(1)});
