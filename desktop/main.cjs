const {app,BrowserWindow,protocol,net,session,shell,ipcMain}=require('electron');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {existsSync}=require('node:fs');
protocol.registerSchemesAsPrivileged([{scheme:'resonance',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
if(process.env.RESONANCE_TEST_PROFILE)app.setPath('userData',path.resolve(process.env.RESONANCE_TEST_PROFILE));
const trusted=value=>{try{const u=new URL(value);return u.protocol==='resonance:'&&u.host==='app';}catch{return false;}};
const external=value=>{try{const u=new URL(value);return u.protocol==='https:'&&['emoji.wuwa.games','github.com','creativecommons.org'].includes(u.hostname);}catch{return false;}};
let win;
app.whenReady().then(()=>{
  const base=path.join(app.getAppPath(),'dist');
  protocol.handle('resonance',request=>{
    try{
      const u=new URL(request.url);if(!trusted(request.url))return new Response('Forbidden',{status:403});
      const decoded=decodeURIComponent(u.pathname),file=path.resolve(base,'.'+(decoded==='/'?'/desktop.html':decoded));
      const rel=path.relative(base,file);
      if(rel.startsWith('..')||path.isAbsolute(rel)||!existsSync(file))return new Response('Not found',{status:404});
      return net.fetch(pathToFileURL(file).href);
    }catch{return new Response('Bad request',{status:400});}
  });
  session.defaultSession.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  session.defaultSession.setPermissionCheckHandler(()=>false);
  win=new BrowserWindow({width:1440,height:900,minWidth:1000,minHeight:650,show:false,
    title:'共鸣行囊 · 共鸣终端',icon:path.join(app.getAppPath(),'desktop/icon.png'),autoHideMenuBar:true,
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
  win.removeMenu();
  win.webContents.setWindowOpenHandler(({url})=>{if(external(url))shell.openExternal(url);return {action:'deny'};});
  win.webContents.on('will-navigate',(event,url)=>{if(!trusted(url)){event.preventDefault();if(external(url))shell.openExternal(url);}});
  ipcMain.on('terminal:close',event=>{if(event.sender===win.webContents&&trusted(event.senderFrame?.url||''))win.close();});
  ipcMain.on('terminal:fullscreen',event=>{if(event.sender===win.webContents&&trusted(event.senderFrame?.url||''))win.setFullScreen(!win.isFullScreen());});
  win.webContents.on('before-input-event',(event,input)=>{if(input.type==='keyDown'&&input.key==='F11'){event.preventDefault();win.setFullScreen(!win.isFullScreen());}});
  win.once('ready-to-show',()=>{if(!process.env.RESONANCE_TEST_HIDDEN)win.show();});
  win.loadURL('resonance://app/desktop.html');
});
app.on('window-all-closed',()=>app.quit());
