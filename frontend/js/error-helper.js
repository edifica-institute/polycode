/* =======================================================================
   PolyCode Error Helper
   - Parse stderr/stdout from real compilers (C/C++/Java/Python)
   - Produce student-friendly explanations, quick fixes, and annotations
   - No deps. Works in browser.
   ======================================================================= */

const EH_VERSION = "1.0.0";

/** Utility: safe string ops */
const _u = {
  toLines: (s) => (s || "").replace(/\r\n/g, "\n").split("\n"),
  num: (x, d=0) => (isFinite(+x) ? +x : d),
  clamp: (n, a, b) => Math.max(a, Math.min(b, n)),
  trim: (s) => (s || "").trim(),
  take: (arr, n) => (arr || []).slice(0, n),
  uniq: (arr) => Array.from(new Set(arr || [])),
  normalizePath: (p) => (p || "").replace(/^\.?\/+/, ""),
};

/** A parsed & interpreted error item */
class ErrorHint {
  constructor({
    lang, severity="error", title, detail, fix, line=null, column=null,
    ruleId=null, raw=null, confidence=0.6
  } = {}) {
    this.lang = lang;
    this.severity = severity;        // "error" | "warning" | "note"
    this.title = title;              // short, student friendly
    this.detail = detail;            // a few sentences
    this.fix = fix;                  // concrete suggestion(s)
    this.line = line;                // 1-based
    this.column = column;            // 1-based, optional
    this.ruleId = ruleId;            // stable id for analytics/telemetry
    this.raw = raw;                  // the matched raw compiler line
    this.confidence = confidence;    // 0..1 (heuristic)
  }
}

/** Common helpers: extract code snippet around a line */
function extractSnippet(code, line, context=1) {
  const lines = _u.toLines(code);
  const L = lines.length;
  const i = _u.clamp((line || 1) - 1, 0, L - 1);
  const from = _u.clamp(i - context, 0, L - 1);
  const to   = _u.clamp(i + context, 0, L - 1);
  const snippet = [];
  for (let k = from; k <= to; k++) {
    snippet.push({ n: k + 1, text: lines[k] });
  }
  return snippet;
}

/* ---------------------------- RULE SETS ------------------------------- */
/* Each rule:
   - lang: "c" | "cpp" | "java" | "python" | "*"
   - test(line) => match or null (use regex)
   - build(match, ctx) => ErrorHint
*/

const RULES = [
  /* ====================== C / C++ ======================= */

  // Missing semicolon
  {
    lang: "c*",
    id: "c.missing_semicolon",
    test: /(error|fatal error).*expected\s*['‘’`"]?;['‘’`"]?\s*(before|after)?/i,
    build: (m, ctx) =>
      new ErrorHint({
        lang: ctx.lang, ruleId: "c.missing_semicolon",
        title: "Missing semicolon ;",
        detail: "The compiler expected a semicolon to end the previous statement.",
        fix: "Add ';' at the end of the reported line (or just before the indicated token).",
        line: ctx.lineGuess, raw: ctx.raw, confidence: 0.85
      })
  },

  // Undeclared identifier / not declared
  {
    lang: "c*",
    id: "c.undeclared_identifier",
    test: /(‘|')?([A-Za-z_]\w*)(’|')?\s+(was|is)\s+not\s+declared|undeclared\s*\(first use/i,
    build: (m, ctx) =>
      new ErrorHint({
        lang: ctx.lang, ruleId: "c.undeclared_identifier",
        title: `Undeclared identifier '${ctx.token || m[2] || "name"}'`,
        detail: "You are using a variable or function name before declaring or including its definition.",
        fix: "Declare the variable/function or include the correct header. For printf/scanf use #include <stdio.h>.",
        line: ctx.lineGuess, raw: ctx.raw, confidence: 0.8
      })
  },

  // Type mismatch / invalid conversion
  {
    lang: "c*",
    id: "c.type_mismatch",
    test: /(invalid conversion|incompatible\s+types|conflicting\s+types)/i,
    build: (m, ctx) =>
      new ErrorHint({
        lang: ctx.lang, ruleId: "c.type_mismatch",
        title: "Type mismatch in assignment or call",
        detail: "A value of one type is being used where another type is required.",
        fix: "Check function signatures and variable types; cast carefully only if safe.",
        line: ctx.lineGuess, raw: ctx.raw, confidence: 0.7
      })
  },

  // Missing main
  {
    lang: "c*",
    id: "c.missing_main",
    test: /undefined reference to `?main'?|multiple definition of `?main'?/i,
    build: (m, ctx) =>
      new ErrorHint({
        lang: ctx.lang, ruleId: "c.missing_main",
        title: "Problem with main()",
        detail: "The linker can't find a valid main() entry point, or it found more than one.",
        fix: "Ensure exactly one 'int main(void){...}' or 'int main(int argc,char** argv){...}' exists.",
        line: null, raw: ctx.raw, confidence: 0.75
      })
  },

  // Array out of bounds (UB, often runtime or sanitizer)
  {
    lang: "c*",
    id: "c.out_of_bounds",
    test: /(stack[- ]?smashing detected|AddressSanitizer).*out of bounds/i,
    build: (m, ctx) =>
      new ErrorHint({
        lang: ctx.lang, ruleId: "c.out_of_bounds",
        title: "Array/string out of bounds",
        detail: "Code wrote or read past the end of an array/string.",
        fix: "Check loop bounds and indexes; ensure buffers are large enough.",
        line: ctx.lineGuess, raw: ctx.raw, confidence: 0.8
      })
  },

  /* ========================== Java ========================= */

  // cannot find symbol
  {
    lang: "java",
    id: "java.cannot_find_symbol",
    test: /error:\s+cannot\s+find\s+symbol/i,
    build: (m, ctx) =>
      new ErrorHint({
        lang: "java", ruleId: "java.cannot_find_symbol",
        title: "Cannot find symbol",
        detail: "You referenced a class/variable/method that isn’t visible or doesn’t exist.",
        fix: "Check spelling, imports (import pkg.Class;), and access modifiers.",
        line: ctx.lineGuess, raw: ctx.raw, confidence: 0.8
      })
  },

  // class not found / wrong file name
  {
    lang: "java",
    id: "java.class_name_file_mismatch",
    test: /class\s+([A-Za-z_]\w*)\s+is\s+public.*should\s+be\s+declared\s+in\s+a\s+file\s+named\s+\1\.java/i,
    build: (m, ctx) =>
      new ErrorHint({
        lang: "java", ruleId: "java.class_name_file_mismatch",
        title: "Public class/file name mismatch",
        detail: "In Java, a public class must be in a file with the same name.",
        fix: "Rename the file to match the public class name.",
        line: ctx.lineGuess, raw: ctx.raw, confidence: 0.95
      })
  },

  // Missing return / incompatible types
  {
    lang: "java",
    id: "java.incompatible_types",
    test: /error:\s+incompatible\s+types|missing\s+return\s+statement/i,
    build: (m, ctx) =>
      new ErrorHint({
        lang: "java", ruleId: "java.incompatible_types",
        title: "Incompatible types or missing return",
        detail: "Method return type doesn't match, or a non-void method is missing a return.",
        fix: "Adjust the return type or add a proper 'return' statement in all paths.",
        line: ctx.lineGuess, raw: ctx.raw, confidence: 0.75
      })
  },

  // NullPointerException (runtime)
  {
    lang: "java",
    id: "java.npe",
    test: /Exception\s+in\s+thread.*NullPointerException/i,
    build: (m, ctx) =>
      new ErrorHint({
        lang: "java", ruleId: "java.npe",
        title: "NullPointerException",
        detail: "You're using an object reference that is null.",
        fix: "Initialize the object before use; add null checks.",
        line: ctx.lineGuess, raw: ctx.raw, confidence: 0.7
      })
  },

  /* ========================= Python ========================= */

  // IndentationError
  {
    lang: "python",
    id: "py.indentation",
    test: /IndentationError:/,
    build: (m, ctx) =>
      new ErrorHint({
        lang: "python", ruleId: "py.indentation",
        title: "Indentation error",
        detail: "Python relies on consistent indentation to define blocks.",
        fix: "Use spaces consistently (e.g., 4 spaces). Don’t mix tabs and spaces.",
        line: ctx.lineGuess, raw: ctx.raw, confidence: 0.95
      })
  },

  // NameError
  {
    lang: "python",
    id: "py.name_error",
    test: /NameError:\s+name\s+'?([A-Za-z_]\w*)'?\s+is\s+not\s+defined/i,
    build: (m, ctx) =>
      new ErrorHint({
        lang: "python", ruleId: "py.name_error",
        title: `Name not defined`,
        detail: "You're using a variable/function before it’s defined or imported.",
        fix: "Define it, assign to it first, or import from the right module.",
        line: ctx.lineGuess, raw: ctx.raw, confidence: 0.9
      })
  },

  // SyntaxError (common)
  {
    lang: "python",
    id: "py.syntax",
    test: /SyntaxError:/,
    build: (m, ctx) =>
      new ErrorHint({
        lang: "python", ruleId: "py.syntax",
        title: "Syntax error",
        detail: "There’s a typo or invalid Python syntax.",
        fix: "Check for missing ':' after if/for/while/def/class, mismatched quotes, or parentheses.",
        line: ctx.lineGuess, raw: ctx.raw, confidence: 0.8
      })
  },

  // ModuleNotFoundError / ImportError
  {
    lang: "python",
    id: "py.module_not_found",
    test: /(ModuleNotFoundError|ImportError):\s+No module named ['"]([^'"]+)['"]/,
    build: (m, ctx) =>
      new ErrorHint({
        lang: "python", ruleId: "py.module_not_found",
        title: "Module not found",
        detail: `Python can’t import a module (${m[2]}).`,
        fix: "Install it (pip), add to requirements, or fix the import name.",
        line: ctx.lineGuess, raw: ctx.raw, confidence: 0.85
      })
  },

  // TypeError common (runtime)
  {
    lang: "python",
    id: "py.type_error",
    test: /TypeError:/,
    build: (m, ctx) =>
      new ErrorHint({
        lang: "python", ruleId: "py.type_error",
        title: "Type error",
        detail: "An operation or function received a value of an unexpected type.",
        fix: "Check argument types and count. Convert types where appropriate.",
        line: ctx.lineGuess, raw: ctx.raw, confidence: 0.7
      })
  },

  /* =================== Generic (all langs) =================== */

  // Line extractors to help lineGuess (not producing hints themselves)
];

/* ------------------- LINE/CONTEXT EXTRACTORS ------------------- */

/** Try to extract file:line[:col] from a raw diagnostic line */
function sniffLocation(raw) {
  // gcc/clang: path:line:col: error: ...
  let m = raw.match(/(^|\/|\s)([^:\s]+):(\d+):(?:(\d+):)?\s*(?:fatal\s+error|error|warning|note)?/i);
  if (m) return { file: _u.normalizePath(m[2]), line: _u.num(m[3], null), column: _u.num(m[4], null) || null };

  // Python tracebacks: File "...", line N
  m = raw.match(/File\s+"([^"]+)",\s+line\s+(\d+)/i);
  if (m) return { file: _u.normalizePath(m[1]), line: _u.num(m[2], null), column: null };

  // javac: path:line: error: ...
  m = raw.match(/(^|\/|\s)([^:\s]+):(\d+):\s+error:/i);
  if (m) return { file: _u.normalizePath(m[2]), line: _u.num(m[3], null), column: null };

  return { file: null, line: null, column: null };
}

/** Map a language label to a rule-language selector */
function langKey(lang) {
  if (!lang) return "*";
  const L = lang.toLowerCase();
  if (L.startsWith("c++") || L === "cpp" || L === "g++") return "c*";
  if (L.startsWith("c")) return "c*";
  if (L.startsWith("java")) return "java";
  if (L.startsWith("py")) return "python";
  return "*";
}

/* ---------------------------- CORE ------------------------------ */

/**
 * Parse and interpret compiler output.
 * @param {Object} params
 * @param {string} params.lang     - "c" | "cpp" | "java" | "python" | ...
 * @param {string} params.stderr   - raw stderr from compiler/runtime
 * @param {string} [params.stdout] - raw stdout (optional, for runtime exceptions mixed in)
 * @param {string} [params.code]   - source code (for snippets)
 * @returns {{
 *   hints: ErrorHint[],
 *   annotations: {line:number, message:string, severity:'error'|'warning'|'info'}[],
 *   summary: string
 * }}
 */
// =======================
// Drop-in: parseCompilerOutput
// =======================


/* ============================================================
   parseCompilerOutput v1.2  (Polycode drop-in)
   - Multi-lang error parsing with suggested quick fixes
   - Returns: { issues: Array<Issue>, summary: string }
   - Issue: { title, message, severity, line, col, codeFrame?, quickFixes?: QuickFix[] }
   ============================================================ */

export function parseCompilerOutput({ lang, stdout = '', stderr = '', code = '' }) {
  const issues = [];
  const push = (title, message, severity='error', line=null, col=null, quickFixes=[]) => {
    issues.push({ title, message, severity, line, col, quickFixes });
  };

  const firstLine = (s) => (s || '').split(/\r?\n/)[0] || '';
  const lines = (s) => (s || '').split(/\r?\n/);

  const addRangeFromPattern = (text, re, lineGroup, colGroup) => {
    const m = re.exec(text);
    return m ? { line: toNum(m[lineGroup]), col: toNum(m[colGroup], 1) } : {};
  };
  const toNum = (x, d= null) => isFinite(+x) ? +x : d;

  const lower = (stderr || '').toLowerCase();
  const codeLines = lines(code);

  // ---------- Helpers for Quick Fix creation ----------
  const mkFix = (label, applyFnName, meta={}) => ({ label, apply: applyFnName, meta });

  // ====== LANGUAGE ROUTERS ======
  switch ((lang || '').toLowerCase()) {
    case 'c':
    case 'cpp':
    case 'c++':
      parseCLike(stderr, code);
      break;
    case 'java':
      parseJava(stderr, code);
      break;
    case 'python':
      parsePython(stderr, code);
      break;
    case 'sql':
      parseSql(stderr, code, stdout);
      break;
    default:
      if (stderr.trim()) {
        push('Program error', firstLine(stderr));
      }
  }

  // ---- Parsers ----
  function parseCLike(err, src) {
    // file:line:col: error: message
    const m1 = /(?:^|\n)(?:[^:\n]*):(\d+):(\d+):\s+(fatal error|error|warning):\s+(.+?)\s*$/im.exec(err);
    if (m1) {
      const [, line, col, sev, msg] = m1;
      const severity = /warning/i.test(sev) ? 'warning' : 'error';
      const fixes = [];

      // Missing include for common identifiers (string, vector, iostream)
      const missingHeader = /‘?([A-Za-z_][A-Za-z0-9_]*)’? was not declared in this scope/.exec(err) ||
                            /implicit declaration of function ‘([A-Za-z_][A-Za-z0-9_]*)’/.exec(err);
      if (missingHeader) {
        const sym = missingHeader[1];
        const headerMap = {
          printf: '<stdio.h>', scanf: '<stdio.h>',
          strlen: '<string.h>', strcpy: '<string.h>',
          vector: '<vector>', string: '<string>',
          cout: '<iostream>', cin: '<iostream>'
        };
        const hdr = headerMap[sym];
        if (hdr) fixes.push(mkFix(`Add #include ${hdr}`, 'addInclude', { header: hdr }));
      }

      // Missing main
      if (/undefined reference to `?main'?/i.test(err)) {
        fixes.push(mkFix('Insert a basic main()', 'insertMain', { lang: 'c' }));
      }

      push('C/C++ compilation', msg, severity, toNum(line), toNum(col), fixes);
      return;
    }

    // Linker undefined reference (likely missing -lm or function)
    if (/undefined reference to/i.test(err)) {
      const sym = /undefined reference to `([^']+)'/.exec(err)?.[1];
      const fixes = [];
      if (sym && /sin|cos|pow|sqrt|log|exp/.test(sym)) {
        fixes.push(mkFix('Link libm (add -lm)', 'noteBuildFlag', { flag: '-lm' }));
      }
      push('Linker error', firstLine(err), 'error', null, null, fixes);
      return;
    }

    // Generic
    if (err.trim()) push('C/C++ error', firstLine(err));
  }

  function parseJava(err, src) {
    // Common: "error: class X is public, should be declared in a file named X.java"
    const pub = /error:\s+class\s+([A-Za-z0-9_]+)\s+is\s+public,\s+should be declared in a file named\s+\1\.java/.exec(err);
    if (pub) {
      const cls = pub[1];
      const fixes = [ mkFix(`Rename public class to Main`, 'renamePublicClass', { newName: 'Main' }) ];
      push('Public class name mismatch', firstLine(err), 'error', null, null, fixes);
      return;
    }

    // "cannot find symbol" with line info like: File.java:12: error: cannot find symbol
    const m = /:(\d+):\s+error:\s+cannot find symbol/.exec(err);
    if (m) {
      const line = toNum(m[1]);
      const sym = /symbol:\s+([^\n]+)/.exec(err)?.[1]?.trim();
      const fixes = [];

      // Missing import suggestions
      const importMap = {
        'Scanner': 'java.util.Scanner',
        'ArrayList': 'java.util.ArrayList',
        'List': 'java.util.List',
        'Map': 'java.util.Map',
        'HashMap': 'java.util.HashMap'
      };
      const name = /([A-Za-z_][A-Za-z0-9_]*)$/.exec(sym || '')?.[1];
      if (name && importMap[name]) {
        fixes.push(mkFix(`Add import ${importMap[name]}`, 'addJavaImport', { fqn: importMap[name] }));
      }

      push('Java: cannot find symbol', firstLine(err), 'error', line, 1, fixes);
      return;
    }

    // Missing main method
    if (/main method not found in class/i.test(err)) {
      push('No main method', firstLine(err), 'error', null, null, [
        mkFix('Insert standard public static void main', 'insertJavaMain', {})
      ]);
      return;
    }

    if (err.trim()) push('Java error', firstLine(err));
  }

  function parsePython(err, src) {
    // IndentationError/File "stdin", line X
    //const ind = /File ".*", line (\d+)\n\s*([^\n]*)\n\s*^(IndentationError: .+)$/ims.exec(err);
     // Take the LAST Python frame before an IndentationError line
const indAll = [...(err || '').matchAll(/File "([^"]+)", line (\d+)\n\s*([^\n]*)\n\s*(IndentationError:[^\n]+)/g)];
const ind = indAll.length ? indAll[indAll.length - 1] : null;

    if (ind) {
      const [, line, codeLine, msg] = ind;
      push('Indentation error', msg, 'error', toNum(line), 1, [
        mkFix('Normalize indentation (4 spaces)', 'normalizeIndent', { line: toNum(line) })
      ]);
      return;
    }

    // NameError: name 'x' is not defined
    const nameErr = /NameError:\s+name '([A-Za-z_][A-Za-z0-9_]*)' is not defined/.exec(err);
    if (nameErr) {
      const sym = nameErr[1];
      push('NameError', firstLine(err), 'error', null, null, [
        mkFix(`Define variable "${sym}" above first use`, 'insertPythonVar', { name: sym })
      ]);
      return;
    }

    // ModuleNotFoundError: No module named 'X'
    const modErr = /ModuleNotFoundError:\s+No module named '([^']+)'/.exec(err);
    if (modErr) {
      const mod = modErr[1];
      push('Missing module', firstLine(err), 'error', null, null, [
        mkFix(`Use built-in alternative or remove import`, 'commentOutImport', { module: mod })
      ]);
      return;
    }

    // SyntaxError with caret
    //const syn = /File ".*", line (\d+)[\s\S]*?^\s*\^\s*$[\r\n]+(SyntaxError:[^\n]+)/m.exec(err);

     // Take the LAST Python frame before the caret + SyntaxError line
const synAll = [...(err || '').matchAll(/File "([^"]+)", line (\d+)\n([^\n]*)\n\s*\^\s*\n(SyntaxError:[^\n]+)/g)];
const syn = synAll.length ? synAll[synAll.length - 1] : null;

    if (syn) {
      const [, line, msg] = syn;
      push('SyntaxError', msg, 'error', toNum(line), 1, []);
      return;
    }

    if (err.trim()) push('Python error', firstLine(err));
  }

  function parseSql(err, src, out) {
    // sqlite.js common: "near 'XXX': syntax error"
    const near = /near ["“”']?([A-Za-z0-9_*]+)["“”']?\s*:\s*syntax error/i.exec(err);
    if (near) {
      const tok = near[1];
      push('SQL syntax error', `Problem near \`${tok}\`.`, 'error', null, null, []);
      return;
    }
    if (/no such table:\s*([A-Za-z0-9_]+)/i.test(err)) {
      const t = /no such table:\s*([A-Za-z0-9_]+)/i.exec(err)[1];
      push('SQL: missing table', `Table \`${t}\` does not exist.`, 'error', null, null, [
        mkFix(`Create table ${t}…`, 'insertCreateTableStub', { table: t })
      ]);
      return;
    }
    if (err.trim()) push('SQL error', firstLine(err));
  }

 // Adapter: map `issues` → `hints` + `annotations`
const hints = issues.map(i => ({
  lang: (lang || '').toLowerCase(),
  severity: /warn/i.test(i.severity) ? 'warning' : 'error',
  title: i.title || 'Issue',
  detail: i.message || '',
  fix: i.quickFixes?.[0]?.label || '',
  line: i.line ?? null,
  column: i.col ?? null,
  ruleId: i.ruleId ?? null,
  raw: (stderr || '').split(/\r?\n/)[0] || '',
  confidence: 0.75
}));

const annotations = issues.map(i => ({
  line: i.line ?? 1,
  col: i.col ?? 1,
  message: i.message || i.title || 'Issue'
}));

return {
  hints,
  annotations,
  summary: issues.length ? `${issues.length} issue(s) detected` : 'No issues',
  // keep `issues` too for the quick-fix pipeline used elsewhere
  issues
};

}

/* ---------------- Quick-Fix Applicators (examples) ----------------
   You can place these in a shared module (same file for convenience).
   Apply them in your UI by calling: newCode = applyQuickFix(oldCode, fix)
------------------------------------------------------------------- */
export function applyQuickFix(code, fix) {
  if (!fix?.apply) return code;
  switch (fix.apply) {
    case 'addInclude': {
      const hdr = fix.meta.header;
      if (!hdr) return code;
      const has = new RegExp(`^\\s*#\\s*include\\s*${escapeReg(hdr)}`, 'm').test(code);
      if (has) return code;
      return `#include ${hdr}\n` + code;
    }
    case 'insertMain': {
      if (/int\s+main\s*\(/.test(code)) return code;
      return (
`#include <stdio.h>
int main(void){
    // TODO: your code
    printf("Hello, World!\\n");
    return 0;
}
`);
    }
    case 'noteBuildFlag': {
      // This fix only annotates; your runner should surface a note to add -lm, etc.
      return code; // (no-op in source)
    }
    case 'renamePublicClass': {
      const newName = fix.meta.newName || 'Main';
      // Replace `public class Something` -> `public class Main`
      return code.replace(/public\s+class\s+([A-Za-z0-9_]+)/, `public class ${newName}`);
    }
    case 'addJavaImport': {
      const fqn = fix.meta.fqn;
      if (!fqn) return code;
      if (new RegExp(`^\\s*import\\s+${escapeReg(fqn)}\\s*;`, 'm').test(code)) return code;
      const pkgIdx = code.match(/^\s*package\s+[^\n]+;?/m)?.index ?? -1;
      const insertAtTop = pkgIdx >= 0 ? code.indexOf('\n', pkgIdx) + 1 : 0;
      return splice(code, insertAtTop, 0, `import ${fqn};\n`);
    }
    case 'insertJavaMain': {
      if (/public\s+static\s+void\s+main\s*\(\s*String\s*\[\]\s*\w*\s*\)/.test(code)) return code;
      return code + `

public class Main {
  public static void main(String[] args) {
    // TODO
    System.out.println("Hello, World!");
  }
}
`;
    }
    case 'normalizeIndent': {
      // Simple: convert tabs to 4 spaces
      return code.replace(/\t/g, '    ');
    }
    case 'insertPythonVar': {
      const name = fix.meta.name || 'x';
      return `# TODO: define ${name}\n${name} = None\n` + code;
    }
    case 'commentOutImport': {
      const mod = fix.meta.module;
      const re = new RegExp(`^\\s*(from\\s+${escapeReg(mod)}\\s+import\\s+.*|import\\s+${escapeReg(mod)}\\s*)$`, 'm');
      return code.replace(re, m => `# ${m}  # module not available in sandbox`);
    }
    case 'insertCreateTableStub': {
      const t = fix.meta.table || 'my_table';
      const stub = `\n-- Quick stub for missing table
CREATE TABLE ${t} (id INTEGER PRIMARY KEY, name TEXT);
`;
      return code + stub;
    }
    default:
      return code;
  }
}

// ---------- Tiny utilities ----------
function splice(str, idx, del, ins){ return str.slice(0, idx) + (ins||'') + str.slice(idx + (del||0)); }
function escapeReg(s){ return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }



































/* ---------------------- Rendering Helpers (optional) ---------------------- */
function findFirstLine(regex, code) {
  try {
    const src = String(code || '');
    const m = regex.exec(src);
    if (!m) return 1;
    // count newlines up to the match
    const upto = src.slice(0, m.index);
    return 1 + (upto.match(/\n/g) || []).length;
  } catch { return 1; }
}



// --- SQL (sqlite/sql.js) friendly parsing ---
function explainSql(rawMsg = '', src = '') {
  const msg = String(rawMsg || '').trim();
  const lower = msg.toLowerCase();

  const pickFirstLine = s => (String(s).split('\n')[0] || '').trim();
  const codeSample = (t) => `<pre class="eh-snippet">${escapeHtml(t)}</pre>`;

  // Helpers to extract names
  const tbl = (msg.match(/table\s+([`"'[\]A-Za-z0-9_.-]+)/i) || [])[1];
  const col = (msg.match(/column\s+([`"'[\]A-Za-z0-9_.-]+)/i) || [])[1];
  const nearTok = (msg.match(/near\s+"?([^"']+)"?\s*:/i) || [])[1];

  // 1) Table already exists
  if (lower.includes('table') && lower.includes('already exists')) {
    const name = tbl || 'that table';
    return {
      kind: 'sql',
      title: 'Table Already Exists',
      summary: `You’re trying to create ${name}, but it already exists in the current database.`,
      fixes: [
        'Use `CREATE TABLE IF NOT EXISTS …` to avoid failing when it already exists.',
        'Or drop the existing table first: `DROP TABLE ' + (tbl||'table_name') + ';` (⚠ will delete its data).'
      ],
      html: codeSample(
`-- safer create
CREATE TABLE IF NOT EXISTS ${tbl || 'users'}(...);

-- OR (destructive)
DROP TABLE ${tbl || 'users'};
CREATE TABLE ${tbl || 'users'}(...);`)
    };
  }

  // 2) No such table
  if (lower.includes('no such table')) {
    const name = (msg.match(/no such table:\s*([^\s]+)/i) || [])[1] || tbl || 'that table';
    return {
      kind: 'sql',
      title: 'No Such Table',
      summary: `The query references ${name}, but it hasn’t been created in this session.`,
      fixes: [
        'Create the table before using it.',
        'Ensure your CREATE statement ran successfully and in this same in-memory database.'
      ],
      html: codeSample(
`CREATE TABLE ${name}(...);
-- then
SELECT * FROM ${name};`)
    };
  }

  // 3) No such column
  if (lower.includes('no such column')) {
    const name = col || (msg.match(/no such column:\s*([^\s]+)/i) || [])[1] || 'that column';
    return {
      kind: 'sql',
      title: 'No Such Column',
      summary: `Column ${name} doesn’t exist in the referenced table.`,
      fixes: [
        'Check the column name (spelling/case).',
        'Verify the table schema and that you’re selecting from the correct table alias.'
      ]
    };
  }

  // 4) Ambiguous column name
  if (lower.includes('ambiguous column name')) {
    const name = col || (msg.match(/ambiguous column name:\s*([^\s]+)/i) || [])[1] || 'this column';
    return {
      kind: 'sql',
      title: 'Ambiguous Column Name',
      summary: `The column ${name} exists in more than one joined table.`,
      fixes: [
        `Qualify the column with its table or alias, e.g. \`t1.${name}\` or \`users.${name}\`.`
      ],
      html: codeSample(
`SELECT u.id, o.id
FROM users u
JOIN orders o ON o.user_id = u.id;`)
    };
  }

  // 5) UNIQUE constraint failed
  if (lower.includes('unique constraint failed')) {
    return {
      kind: 'sql',
      title: 'UNIQUE Constraint Failed',
      summary: 'You’re inserting/updating a row that duplicates a value in a UNIQUE column.',
      fixes: [
        'Ensure the value is unique before inserting.',
        'Use UPSERT to handle duplicates gracefully.'
      ],
      html: codeSample(
`INSERT INTO users(id,name) VALUES (1,'Alice')
ON CONFLICT(id) DO UPDATE SET name=excluded.name;`)
    };
  }

  // 6) FOREIGN KEY constraint failed
  if (lower.includes('foreign key constraint failed')) {
    return {
      kind: 'sql',
      title: 'FOREIGN KEY Constraint Failed',
      summary: 'You inserted/updated a child row whose foreign key doesn’t match a parent row.',
      fixes: [
        'Insert the parent row first.',
        'Ensure the foreign key value exists in the referenced table.'
      ]
    };
  }

  // 7) Syntax error near ...
  if (lower.includes('syntax error') || lower.includes('parse error')) {
    return {
      kind: 'sql',
      title: 'SQL Syntax Error',
      summary: `There’s a syntax problem ${nearTok ? `near “${nearTok}”` : 'in your statement'}.`,
      fixes: [
        'Check for missing commas, parentheses, or keywords.',
        'Verify the order of clauses: SELECT … FROM … WHERE … GROUP BY … HAVING … ORDER BY …;'
      ]
    };
  }

  // 8) GROUP BY / aggregate misuse
  if (lower.includes('group by') || lower.includes('aggregate')) {
    return {
      kind: 'sql',
      title: 'Aggregate / GROUP BY Issue',
      summary: 'Non-aggregated columns in the SELECT list must appear in GROUP BY.',
      fixes: [
        'Either aggregate the column (e.g. COUNT, SUM, MAX) or include it in GROUP BY.',
      ],
      html: codeSample(
`-- Good
SELECT dept, COUNT(*) AS n
FROM employees
GROUP BY dept;`)
    };
  }

  // 9) Datatype mismatch
  if (lower.includes('datatype mismatch')) {
    return {
      kind: 'sql',
      title: 'Datatype Mismatch',
      summary: 'A value’s type is incompatible with the column or operation.',
      fixes: [
        'Cast to a compatible type, or insert a proper value.',
      ],
      html: codeSample(
`SELECT CAST('42' AS INTEGER);`)
    };
  }

  // 10) Incomplete input (often missing ; or ) )
  if (lower.includes('incomplete input')) {
    return {
      kind: 'sql',
      title: 'Incomplete Statement',
      summary: 'The SQL statement appears truncated (missing `)` or `;`).',
      fixes: [
        'Close all parentheses and terminate statements with a semicolon.',
      ]
    };
  }

  // Fallback (generic)
  return {
    kind: 'sql',
    title: pickFirstLine(msg) || 'SQL Error',
    summary: 'The database reported an error. Review the message and your statement.',
    fixes: []
  };
}



















/** Turn a hint into minimal HTML (safe string; you can style with your CSS) */
export function renderHintHTML(hint) {
  const line = hint.line ? `Line ${hint.line}` : "";
  const conf = `Confidence: ${(hint.confidence * 100 | 0)}%`;
  const rule = hint.ruleId ? `<code>${hint.ruleId}</code>` : "";
  const snip = (hint.snippet || [])
    .map(s => `<div class="eh-snip-line"><em>${s.n}</em> ${escapeHtml(s.text)}</div>`)
    .join("");

  return `
  <div class="eh-hint ${hint.severity}">
    <div class="eh-hdr">
      <strong>${escapeHtml(hint.title)}</strong>
      <span class="eh-meta">${[line, conf, rule].filter(Boolean).join(" · ")}</span>
    </div>
    <div class="eh-detail">${escapeHtml(hint.detail)}</div>
    ${hint.fix ? `<div class="eh-fix"><span>Try:</span> ${escapeHtml(hint.fix)}</div>` : ""}
    ${snip ? `<div class="eh-snip">${snip}</div>` : ""}
  </div>`;
}

function escapeHtml(s) {
  return (s || "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#39;");
}


// At the very end of error-helper.js
try {
  if (typeof window !== 'undefined') {
    window.PolyErrorHelper = window.PolyErrorHelper || {
      parseCompilerOutput,
      applyQuickFix,
      renderHintHTML,
    };
  }
} catch {}
