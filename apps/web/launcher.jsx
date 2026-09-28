import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {App} from './main.jsx';
import Terminal from './terminal/Terminal.jsx';
function Launcher(){
  const [mode,setMode]=useState(location.hash==='#trial'?'resume':null);
  const launch=value=>{history.replaceState(null,'',value?'#trial':location.pathname+location.search);setMode(value);};
  return mode?<App launchMode={mode} onTerminal={()=>launch(null)}/>:<Terminal onLaunch={launch}/>;
}
createRoot(document.getElementById('root')).render(<Launcher/>);
