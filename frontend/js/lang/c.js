/*import { API_BASE, WS_BASE } from '../config.js';
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
export function stop(){ if(ws){ try{ ws.close(); }catch{} ws=null; } detachInput(); setStatus('Stopped.','err'); showSpinner(false); }*/




// frontend/js/lang/c.js
import { API_BASE, WS_BASE } from '../config.js';
import { setStatus, showSpinner } from '../core/ui.js';
import { attachInput, detachInput, clearTerminal, getTerminal } from '../core/terminal.js';
import { initMonaco, setLanguage, getCode, clearMarkers, setMarkers } from '../core/editor.js';

let ws = null;

const SAMPLE = `#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void){
  // Pointer + file I/O demo
  int n;
  printf("Enter count: ");
  fflush(stdout);
  if (scanf("%d", &n) != 1) return 0;

  int *arr = (int*)malloc((size_t)n * sizeof(int));
  if (!arr) { perror("malloc"); return 1; }
  for (int i=0;i<n;i++) arr[i] = (i+1)*(i+1);

  // Write to a file
  FILE *fp = fopen("numbers.txt", "w");
  if (!fp) { perror("fopen"); free(arr); return 1; }
  for (int i=0;i<n;i++) fprintf(fp, "%d\n", arr[i]);
  fclose(fp);

  // Read first few numbers back using pointer iteration
  fp = fopen("numbers.txt","r");
  if (!fp) { perror("fopen"); free(arr); return 1; }
  int x, cnt = 0;
  printf("First few squares from file: ");
  while (cnt < 5 && fscanf(fp, "%d", &x) == 1) {
    printf("%d ", x);
    cnt++;
  }
  printf("\\n");
  fclose(fp);

  // Show pointer arithmetic
  int *p = arr;
  long sum = 0;
  for (int i=0;i<n;i++, p++) sum += *p;
  printf("Sum via pointer walk = %ld\\n", sum);

  free(arr);
  return 0;
}`;

export async function start(){
  await initMonaco(SAMPLE, 'c');
  setLanguage('c');
  setStatus('Ready.', 'ok');
}

export async function run(){
  try{
    showSpinner(true);
    setStatus('Compiling...', 'ok');
    clearMarkers('gcc');
    clearTerminal(true);

    const files = [{ path:'main.c', content: getCode() }];
    const r = await fetch(`${API_BASE}/api/c/prepare`, {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ files })
    });
    const d = await r.json();

    // Show any diagnostics and compile log
    if (d.diagnostics) setMarkers(d.diagnostics, 'gcc');
    getTerminal().writeln((d.compileLog || '').replace(/\\r?\\n/g, '\\r\\n'));
    if (!d.ok) { setStatus('Compilation failed.', 'err'); showSpinner(false); return; }

    setStatus('Running...', 'ok');
    const base = WS_BASE || ((location.protocol==='https:')?'wss://':'ws://') + location.host;
    ws = new WebSocket(`${base}/term?token=${encodeURIComponent(d.token)}`);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => attachInput(ws);
    ws.onmessage = (ev) => {
      const text = (typeof ev.data === 'string') ? ev.data : new TextDecoder().decode(ev.data);
      getTerminal().write(text);
    };
    ws.onclose = () => { detachInput(); setStatus('Program finished.', 'ok'); showSpinner(false); };
    ws.onerror = () => { detachInput(); setStatus('Run error.', 'err'); showSpinner(false); };
  }catch(err){
    console.error(err);
    setStatus('Network error.', 'err');
    showSpinner(false);
    detachInput();
  }
}

export function stop(){
  if (ws) { try{ ws.close(); }catch{} ws = null; }
  detachInput();
  setStatus('Stopped.', 'err');
  showSpinner(false);
}

// Bootstrap for index-c.html
(function(){
  function boot(){
    // Init terminal immediately so user can see logs
    getTerminal();
    start();
    const runBtn = document.getElementById('runBtn');
    const stopBtn = document.getElementById('stopBtn');
    if (runBtn) runBtn.addEventListener('click', run);
    if (stopBtn) stopBtn.addEventListener('click', stop);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})();

