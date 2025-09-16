// frontend/js/core/editor.js

let monacoRef = null, editor = null, model = null;
let ctxQuickFixBound = false;
export async function initMonaco(sample='// Hello', lang='plaintext'){
  if (editor) return editor;

  // Wait until AMD loader + monaco globals are ready
  await new Promise(r=>{
    const tick=()=> (window.require && window.monaco) ? r() : setTimeout(tick, 20);
    tick();
  });

  // Monaco loader config (kept as-is)
  require.config({ paths: { 'vs': 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs' }});

  return new Promise(resolve=>{
    require(['vs/editor/editor.main'], ()=>{
      monacoRef = monaco;

      monacoRef.editor.defineTheme('polyDark', {
        base:'vs-dark', inherit:true, rules:[],
        colors:{ 'editor.background':'#0b1220' }
      });

      // Create a stable in-memory model for diagnostics
      model = monacoRef.editor.createModel(sample, lang, monacoRef.Uri.parse('inmemory://model/main'));

      editor = monacoRef.editor.create(document.getElementById('editor'), {
        model,
        theme:'polyDark',
        automaticLayout:true,
        fontSize:14,
        minimap:{ enabled:false }
      });

       if (!ctxQuickFixBound) {
        ctxQuickFixBound = true;
        editor.addAction({
          id: 'polycode.quickFix.context',
          label: 'Quick Fix…',
          contextMenuGroupId: 'navigation',
          contextMenuOrder: 0.1,
          run: () => editor.getAction('polycode.quickFix')?.run()
        });
      }

      resolve(editor);
    });
  });
}

// ---- Existing helpers (kept) ----
export function setLanguage(lang){
  if (monacoRef && model) monacoRef.editor.setModelLanguage(model, lang);
}
export function setValue(text){ if (model) model.setValue(text); }
export function getValue(){ return model ? model.getValue() : ''; }
export const getCode = getValue;

// ---- NEW: expose editor/monaco and selection text ----
export function getEditor(){ return editor; }
export function getMonaco(){ return monacoRef; }
export function getSelection(){
  if (!editor || !model) return '';
  const sel = editor.getSelection();
  if (!sel || sel.isEmpty()) return '';
  return model.getValueInRange(sel);
}

// ---- Diagnostics (owner defaults unified to 'polycode') ----
export function clearMarkers(owner='polycode'){
  if (monacoRef && model) monacoRef.editor.setModelMarkers(model, owner, []);
}

export function setMarkers(diags=[], owner='polycode'){
  if (!monacoRef || !model) return;

  const markers = diags.map(d=>{
    // accept both {col} and {column} shapes
    const line = d.line || d.startLine || 1;
    const col  = d.col  || d.column    || d.startColumn || 1;
    const endL = d.endLine || line;
    const endC = d.endColumn || (col + 1);

    return {
      message: d.message || String(d),
      startLineNumber: line,
      startColumn: col,
      endLineNumber: endL,
      endColumn: endC,
      severity: /warn/i.test(d.severity)
        ? monacoRef.MarkerSeverity.Warning
        : monacoRef.MarkerSeverity.Error,
      source: d.title || 'polycode'
    };
  });

  monacoRef.editor.setModelMarkers(model, owner, markers);
}

// ---- NEW: let other modules add editor actions (e.g., Quick Fix) ----
export function addEditorAction(action){
  // action: { id, label, keybindings?, contextMenuGroupId?, run: (editor)=>any }
  editor?.addAction(action);
}



