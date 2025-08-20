import { initMonaco, setLanguage, getValue } from '../core/editor.js';
import { clearPreview } from '../core/ui.js';
const HTML=`<!doctype html><html><head><meta charset='utf-8'><title>Web Preview</title><style>body{font-family:system-ui;padding:20px}h1{color:#2a6df4}</style></head><body><h1>Hello Web!</h1><p>Edit the HTML and click Run.</p></body></html>`;
export async function activate(){ await initMonaco(HTML,'html'); setLanguage('html'); }
export async function run(){ document.getElementById('preview').srcdoc = getValue(); }
export function stop(){ clearPreview(); }
