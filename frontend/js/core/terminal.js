let term=null, inputDisposable=null;
export function initTerminal(){
  if (term) return term;
  term=new Terminal({ convertEol:true, cols:80, rows:24, fontFamily:'ui-monospace, monospace', fontSize:13 });
  term.open(document.getElementById('term'));
  term.writeln('PolyCode Terminal — type when your program asks for input.');
  return term;
}
export function clearTerminal(full=false){ if(!term) return; if(full) term.reset(); else term.clear(); }
export function attachInput(ws){
  if(!term) initTerminal();
  detachInput();
  inputDisposable=term.onData(data=>ws.send(JSON.stringify({ type:'stdin', data })));
}
export function detachInput(){ if(inputDisposable){ try{ inputDisposable.dispose(); }catch{} inputDisposable=null; } }
export function getTerminal(){ if(!term) initTerminal(); return term; }
