import { API_BASE, WS_BASE } from '../config.js';
import { setStatus, showSpinner } from '../core/ui.js';
import { attachInput, detachInput, clearTerminal, getTerminal } from '../core/terminal.js';
import { initMonaco, setLanguage, getCode, clearMarkers, setMarkers } from '../core/editor.js';

let ws=null;
const SAMPLE=`#include <stdio.h>
int main(void){
  char name[128];
  printf("Enter your name: ");
  fflush(stdout);
  if(!fgets(name,sizeof(name),stdin)) return 0;
  printf("Hello, %s", name);
  return 0;
}`;

export async function activate(){ await initMonaco(SAMPLE,'c'); setLanguage('c'); }
export async function run(){
  try{
    clearTerminal(); clearMarkers('gcc'); setStatus('Compiling...','ok'); showSpinner(true);
    const files=[{ path:'main.c', content:getCode() }];
    const r=await fetch(`${API_BASE}/api/c/prepare`,{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ files }) });
    const d=await r.json();
    if(d.diagnostics) setMarkers(d.diagnostics,'gcc');
    getTerminal().write((d.compileLog||'')+'\r\n');
    if(!d.ok){ setStatus('Compilation failed.','err'); showSpinner(false); return; }
    setStatus('Running...','ok');
    const base = WS_BASE || (location.protocol==='https:'?'wss://':'ws://')+location.host;
    ws = new WebSocket(`${base}/term?token=${encodeURIComponent(d.token)}`);
    ws.onopen = ()=> attachInput(ws);
    ws.onmessage = ev => getTerminal().write(typeof ev.data==='string'?ev.data:new TextDecoder().decode(ev.data));
    ws.onclose = ()=>{ detachInput(); setStatus('Program finished.','ok'); showSpinner(false); };
    ws.onerror = ()=>{ detachInput(); setStatus('Run error.','err'); showSpinner(false); };
  }catch(e){ console.error(e); setStatus('Network error','err'); showSpinner(false); detachInput(); }
}
export function stop(){ if(ws){ try{ ws.close(); }catch{} ws=null; } detachInput(); setStatus('Stopped.','err'); showSpinner(false); }
