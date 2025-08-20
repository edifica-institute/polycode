import { API_BASE, WS_BASE } from '../config.js';
import { setStatus, showSpinner } from '../core/ui.js';
import { attachInput, detachInput, clearTerminal, getTerminal } from '../core/terminal.js';
import { initMonaco, setLanguage, getCode, clearMarkers, setMarkers } from '../core/editor.js';

let ws=null;
const SAMPLE=`// Simple Java program
import java.util.*;
public class Main {
  public static void main(String[] args){
    Scanner sc=new Scanner(System.in);
    System.out.print("Enter your name: ");
    String name=sc.nextLine();
    System.out.println("Hello, "+name+"!");
  }
}`;

export async function activate(){ await initMonaco(SAMPLE,'java'); setLanguage('java'); }
export async function run(){
  try{
    clearTerminal(); clearMarkers('javac'); setStatus('Compiling...','ok'); showSpinner(true);
    const files=[{ path:'Main.java', content:getCode() }];
    const r=await fetch(`${API_BASE}/api/java/prepare`,{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ files, mainClass:'Main' }) });
    const d=await r.json();
    if(d.diagnostics) setMarkers(d.diagnostics,'javac');
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
