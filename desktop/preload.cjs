const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('resonanceDesktop',Object.freeze({close:()=>ipcRenderer.send('terminal:close'),toggleFullscreen:()=>ipcRenderer.send('terminal:fullscreen')}));
