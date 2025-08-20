import { initMonaco, setLanguage, getValue } from '../core/editor.js';
const SAMPLE=`-- In-browser SQL (sql.js via CDN)\nCREATE TABLE users(id INTEGER, name TEXT);\nINSERT INTO users VALUES (1,'Alice'),(2,'Bob');\nSELECT * FROM users;`;
let db=null;
async function ensure(){ if(window.initSqlJs) return; const s=document.createElement('script'); s.src='https://cdn.jsdelivr.net/npm/sql.js@1.10.2/dist/sql-wasm.js'; document.head.appendChild(s); await new Promise(r=>s.onload=r); }
export async function activate(){ await initMonaco(SAMPLE,'sql'); setLanguage('sql'); await ensure(); if(!db){ const SQL=await window.initSqlJs({ locateFile:f=>'https://cdn.jsdelivr.net/npm/sql.js@1.10.2/dist/'+f }); db=new SQL.Database(); } }
export async function run(){
  await activate();
  const out=document.getElementById('sqlout'); out.innerHTML='';
  try{
    const res=db.exec(getValue());
    if(!res.length){ out.textContent='(no rows)'; return; }
    const { columns, values } = res[0];
    const table=document.createElement('table'); table.border='1'; table.cellPadding='6';
    const thead=document.createElement('thead'); const trh=document.createElement('tr');
    columns.forEach(c=>{ const th=document.createElement('th'); th.textContent=c; trh.appendChild(th); });
    thead.appendChild(trh);
    const tb=document.createElement('tbody');
    values.forEach(row=>{ const tr=document.createElement('tr'); row.forEach(v=>{ const td=document.createElement('td'); td.textContent=v; tr.appendChild(td); }); tb.appendChild(tr); });
    table.appendChild(thead); table.appendChild(tb);
    out.appendChild(table);
  }catch(e){ out.textContent='SQL error: '+e.message; }
}
export function stop(){ const out=document.getElementById('sqlout'); if(out) out.innerHTML=''; }
