let monacoRef=null, editor=null, model=null;
export async function initMonaco(sample='// Hello', lang='plaintext'){
  if (editor) return editor;
  await new Promise(r=>{const tick=()=> (window.require&&window.monaco)?r():setTimeout(tick,20); tick();});
  require.config({ paths: { 'vs': 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs' }});
  return new Promise(resolve=>{
    require(['vs/editor/editor.main'], ()=>{
      monacoRef=monaco;
      monacoRef.editor.defineTheme('polyDark',{ base:'vs-dark', inherit:true, rules:[], colors:{'editor.background':'#0b1220'} });
      model=monacoRef.editor.createModel(sample, lang, monacoRef.Uri.parse('inmemory://model/main'));
      editor=monacoRef.editor.create(document.getElementById('editor'),{
        model, theme:'polyDark', automaticLayout:true, fontSize:14, minimap:{enabled:false}
      });
      resolve(editor);
    });
  });
}
export function setLanguage(lang){ if(monacoRef&&model) monacoRef.editor.setModelLanguage(model, lang); }
export function setValue(text){ model&&model.setValue(text); }
export function getValue(){ return model?model.getValue():''; }
export const getCode=getValue;
export function clearMarkers(owner='diag'){ if(monacoRef&&model) monacoRef.editor.setModelMarkers(model, owner, []); }
export function setMarkers(diags=[], owner='diag'){
  if(!monacoRef||!model) return;
  const markers=diags.map(d=>({
    message:d.message||String(d),
    startLineNumber:d.line||1,
    startColumn:d.column||1,
    endLineNumber:d.endLine||d.line||1,
    endColumn:d.endColumn||(d.column||1)+1,
    severity:/warn/i.test(d.severity)?monacoRef.MarkerSeverity.Warning:monacoRef.MarkerSeverity.Error,
  }));
  monacoRef.editor.setModelMarkers(model, owner, markers);
}
