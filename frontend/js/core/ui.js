export function setStatus(text, kind='ok'){ const el=document.getElementById('status'); if(!el) return; el.textContent=text; el.className=kind; }
export function showSpinner(on){ const s=document.getElementById('spinner'); if(s) s.style.display=on?'inline-block':'none'; }
export function clearPreview(){ const ifr=document.getElementById('preview'); if(ifr) ifr.srcdoc=''; }
