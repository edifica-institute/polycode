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
export function parseCompilerOutput({ lang, stderr = '', stdout = '', code = '' }) {
  const text = String((stderr || stdout || '')).trim();
  const hints = [];
  const annotations = [];

  // ---------- small utilities ----------
  const push = (title, detail, line=null, fix=null, kind='error', column=null, confidence='medium') => {
    hints.push({ title, detail, fix, line, column, kind, confidence });
    const msg = `${title}${detail ? ': ' + detail : ''}`;
    annotations.push({ line, column, message: msg, kind });
  };
  const firstLine = (s) => (String(s||'').split('\n').find(Boolean) || '').trim();
  const asInt = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : null; };
  const L = (s) => String(s||'').toLowerCase();

  // ---------- optional JSON diagnostics (clang/gcc/tsc) ----------
  try {
    const trimmed = text.replace(/^\u001b\[[0-9;]*m/g, '').trim(); // strip ANSI if any
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      const j = JSON.parse(trimmed);
      // clang/gcc JSON can be array or obj with "diagnostics"
      const diags = Array.isArray(j) ? j : j?.diagnostics || [];
      if (Array.isArray(diags) && diags.length) {
        for (const d of diags) {
          const msg = (d.message || d.text || d.rendered || '').trim();
          const kind = L(d.severity || d.level || 'error').includes('warn') ? 'warning' : 'error';
          const loc = d.location || d.loc || d.range?.start || {};
          const line = asInt(loc.line || loc.row);
          const column = asInt(loc.column || loc.col);
          const codeId = d.code || d.diagnosticId || null;
          let title = 'Compiler diagnostic';
          if (codeId) title += ` (${codeId})`;

          // light classification for JSON path
          let fix = null, confidence = 'medium';
          if (/expected ['"`;)]/i.test(msg)) { title = 'Missing token'; fix = 'Insert the expected token.'; confidence='high'; }
          if (/undeclared|not declared|cannot find name/i.test(msg)) { title='Undeclared identifier'; fix='Declare it or include/import the correct symbol.'; confidence='high'; }
          if (/incompatible|mismatch|cannot convert/i.test(msg)) { title='Type mismatch'; fix='Adjust type or cast appropriately.'; confidence='medium'; }

          push(title, msg, line, fix, kind, column, confidence);
        }
        return finalize();
      }
    }
  } catch { /* non-JSON; continue */ }

  // ---------- language-specific text parsers ----------
  switch ((lang||'').toLowerCase()) {
    case 'c':
    case 'cpp':
    case 'c++':
    case 'cc': {
      // --- keyword typo detector (e.g., "fore" vs "for") ---
      const C_KEYWORDS = ['for','if','while','switch','return','break','continue','sizeof','struct','enum','typedef','do','goto','case','default','else','volatile','static','const','unsigned','signed','long','short','auto','register','extern','union'];
      const lev = (a,b) => {
        a=String(a||''); b=String(b||'');
        const m=a.length, n=b.length; if(!m) return n; if(!n) return m;
        const dp=Array.from({length:m+1},(_,i)=>Array(n+1).fill(0));
        for(let i=0;i<=m;i++) dp[i][0]=i;
        for(let j=0;j<=n;j++) dp[0][j]=j;
        for(let i=1;i<=m;i++) for(let j=1;j<=n;j++){
          const cost = a[i-1]===b[j-1] ? 0 : 1;
          dp[i][j] = Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1]+cost);
        }
        return dp[m][n];
      };
      const nearestKw = (name) => {
        let best=null, dist=1e9;
        for (const k of C_KEYWORDS) { const d=lev(name,k); if (d<dist){ dist=d; best=k; } }
        return dist<=1 ? best : null; // one edit away → likely typo
      };

      // gcc/clang: file:line:col: error: message
      const main = text.match(/^(.*?):(\d+)(?::(\d+))?:\s*(error|fatal error|warning):\s*(.+)$/m);
      if (main) {
        const line = asInt(main[2]), col = asInt(main[3]);
        const level = L(main[4]), msg = main[5].trim();

        // implicit declaration (function) — check for keyword near-miss first
        const imp = /implicit declaration of function\s+['"`]?([A-Za-z_]\w*)['"`]?/i.exec(msg);
        if (imp) {
          const name = imp[1], kw = nearestKw(name);
          if (kw) {
            push('Keyword typo', `Looks like \`${name}\` should be the keyword \`${kw}\`.`, line, `Replace \`${name}\` with \`${kw}\`.`, 'error', col, 'high');
          } else {
            push('Missing function prototype', 'You called a function before it was declared or included.', line, 'Add a prototype or include the header.', 'error', col, 'high');
          }
        }
        // expected ';'
        if (/expected\s*['‘’"]?;['‘’"]?\s*(?:before|after)?/i.test(msg)) {
          push('Missing semicolon', 'Add a `;` at the end of the statement.', line, 'Insert `;`.', 'error', col, 'high');
        }
        // undeclared identifier
        if (/['‘’"`]?([A-Za-z_]\w*)['‘’"`]?\s*(?:undeclared|was not declared)/i.test(msg) ||
            /use of undeclared identifier/i.test(msg)) {
          push('Undeclared identifier', 'Declare the name or include the correct header.', line, 'Declare it or include the header.', 'error', col, 'high');
        }
        // include not found
        if (/no such file or directory/i.test(msg) && /include/i.test(msg)) {
          push('Header not found', 'The included header file was not found.', line, 'Fix the `#include` path or add the missing header.', 'error', col, 'high');
        }
        // format mismatch
        if (/format specifies type.*but the argument has type/i.test(msg)) {
          push('printf/scanf format mismatch', 'Your `%` format and argument types don’t match.', line, 'Fix the format specifier or cast the argument.', 'error', col, 'high');
        }
        // conflicting types / redefinition
        if (/conflicting types|redefinition/i.test(msg)) {
          push('Conflicting types / Redefinition', 'The same symbol is declared incompatibly.', line, 'Use a single consistent declaration and remove duplicates.', 'error', col, 'medium');
        }
        // generic line-specific
        if (!hints.length && (level==='error' || level==='fatal error')) {
          push('Compiler error', msg, line, 'Fix at the highlighted line.', 'error', col, 'low');
        }
      }
      // linker: undefined reference to `foo`
      const links = [...text.matchAll(/undefined reference to `?([A-Za-z_]\w*)`?/g)];
      if (links.length) {
        const names = Array.from(new Set(links.map(m => m[1]))).slice(0,5);
        push('Linker error: undefined reference', `Missing implementation or library for: ${names.join(', ')}`, null, 'Provide the function(s) or link the correct library.', 'error', null, 'high');
      }
      break;
    }

    case 'java': {
      // javac: file:line: error: message
      const m = text.match(/^(.*?):(\d+):\s*error:\s*(.+)$/m);
      if (m) {
        const line = asInt(m[2]), msg = m[3].trim();

        // cannot find symbol
        const sym = /cannot find symbol/i.test(msg);
        if (sym) {
          // Try to capture symbol name from following lines
          const nameMatch = text.match(/symbol:\s*(?:class|variable|method)\s+([A-Za-z_]\w*)/i);
          const name = nameMatch?.[1];
          push('Cannot find symbol', name ? `Symbol \`${name}\` is not declared or not imported.` : 'A symbol is not declared or not imported.', line, 'Declare it or import the right package.', 'error', null, 'high');
        }
        // package does not exist
        if (/package .* does not exist/i.test(msg)) {
          push('Package not found', 'The package is not on the classpath.', line, 'Add the dependency or correct the import.', 'error', null, 'high');
        }
        // ';' expected
        if (/';' expected/i.test(msg)) {
          push('Missing semicolon', 'Add a `;` at the end of the statement.', line, 'Insert `;`.', 'error', null, 'high');
        }
        // incompatible types
        if (/incompatible types/i.test(msg)) {
          push('Incompatible types', 'The assigned expression type does not match the variable type.', line, 'Adjust the type or cast safely.', 'error', null, 'high');
        }
        // missing return statement
        if (/missing return statement/i.test(msg)) {
          push('Missing return', 'A non-void method must return a value on all paths.', line, 'Return a value or change the method to void.', 'error', null, 'high');
        }
        // unreported exception
        if (/unreported exception .*; must be caught or declared to be thrown/i.test(msg)) {
          push('Unchecked exception handling', 'You must catch or declare the checked exception.', line, 'Wrap in try-catch or add `throws` to the method.', 'error', null, 'high');
        }
        if (!hints.length) push('Compiler error', firstLine(msg), line, 'Fix at the highlighted line.', 'error', null, 'low');
      }
      break;
    }

    case 'python': {
      // Extract last frame from traceback
      // File "main.py", line X
      const frame = [...text.matchAll(/File\s+"([^"]+)",\s+line\s+(\d+)(?:,\s+in\s+([^\n]+))?/g)].pop();
      const errLine = frame ? asInt(frame[2]) : null;
      const errMsg = (text.split('\n').reverse().find(l => /\w+Error:/.test(l)) || '').trim();

      if (/SyntaxError:/i.test(errMsg)) {
        // Common details: unexpected EOF/indent/':' expected etc.
        if (/unexpected EOF/i.test(errMsg)) {
          push('SyntaxError: unexpected end of file', 'You likely missed a closing bracket, quote, or block.', errLine, 'Close the bracket/quote or complete the block.', 'error', null, 'high');
        } else if (/expected ':'/i.test(errMsg)) {
          push('SyntaxError: missing colon', 'Statements like `if`, `for`, `def`, `class` require a `:`.', errLine, 'Add the colon `:` at the end of the header line.', 'error', null, 'high');
        } else if (/invalid syntax/i.test(errMsg)) {
          push('SyntaxError: invalid syntax', 'There is a syntax error on this line.', errLine, 'Fix the syntax near the caret.', 'error', null, 'medium');
        } else {
          push('SyntaxError', errMsg.replace(/^\w+Error:\s*/,''), errLine, 'Fix the syntax on this line.', 'error', null, 'medium');
        }
      } else if (/IndentationError:/i.test(errMsg)) {
        push('IndentationError', 'Block indentation is incorrect or inconsistent (tabs/spaces).', errLine, 'Use consistent 4-space indents and align blocks.', 'error', null, 'high');
      } else if (/NameError:/i.test(errMsg)) {
        const nm = /NameError:\s*name\s*'([^']+)'/i.exec(errMsg)?.[1];
        push('NameError', nm ? `\`${nm}\` is not defined.` : 'A name is not defined.', errLine, 'Define the variable/function or import it.', 'error', null, 'high');
      } else if (/TypeError:/i.test(errMsg)) {
        push('TypeError', errMsg.replace(/^TypeError:\s*/i,''), errLine, 'Check argument counts and operand types.', 'error', null, 'medium');
      } else if (/AttributeError:/i.test(errMsg)) {
        push('AttributeError', errMsg.replace(/^AttributeError:\s*/i,''), errLine, 'Ensure the object is not `None` and has this attribute.', 'error', null, 'medium');
      } else if (errMsg) {
        push('Runtime error', errMsg, errLine, 'Fix the error at this line.', 'error', null, 'low');
      }
      break;
    }

    case 'js':
    case 'javascript':
    case 'ts':
    case 'typescript': {
      // tsc: file(line,col): error TSxxxx: message
      const tsc = text.match(/^(.*)\((\d+),(\d+)\):\s*error\s*TS(\d+):\s*(.+)$/m);
      if (tsc) {
        const line = asInt(tsc[2]), col = asInt(tsc[3]);
        const msg = tsc[5].trim();
        // common TS classifications
        if (/cannot find name/i.test(msg)) {
          push('Cannot find name', 'This identifier is not declared in the current scope.', line, 'Declare it or import the symbol.', 'error', col, 'high');
        } else if (/type .* is not assignable to type/i.test(msg)) {
          push('Type mismatch', 'Assigned value type is incompatible.', line, 'Adjust types or add a safe cast.', 'error', col, 'high');
        } else if (/property .* does not exist on type/i.test(msg)) {
          push('Unknown property', 'The property/method is not part of this type.', line, 'Narrow the type or add the property.', 'error', col, 'high');
        } else if (/cannot find module/i.test(msg)) {
          push('Module not found', 'Import path or dependency is missing.', line, 'Fix import path or install the dependency.', 'error', col, 'high');
        } else {
          push('TypeScript error', msg, line, 'Fix at the highlighted location.', 'error', col, 'medium');
        }
      } else {
        // Generic JS parse/runtime shapes
        if (/Unexpected token/i.test(text)) {
          push('Syntax error', firstLine(text), null, 'Check for a missing/extra token.', 'error', null, 'medium');
        } else if (/is not defined/i.test(text)) {
          push('ReferenceError', firstLine(text), null, 'Declare the variable or import it.', 'error', null, 'high');
        } else if (/cannot read (?:properties|property) of undefined/i.test(text)) {
          push('Undefined value', firstLine(text), null, 'Ensure the value is defined before accessing properties.', 'error', null, 'high');
        }
      }
      break;
    }

    case 'sql': {
      // Postgres/MySQL common messages
      if (/syntax error at or near/i.test(text)) {
        const near = /syntax error at or near "([^"]+)"/i.exec(text)?.[1];
        push('SQL syntax error', near ? `Problem near \`${near}\`.` : firstLine(text), null, 'Check SQL syntax near the token.', 'error', null, 'high');
      }
      if (/column .* does not exist/i.test(text)) {
        const col = /column\s+("?[\w.]+"?)/i.exec(text)?.[1];
        push('Unknown column', col ? `Column ${col} does not exist.` : 'A referenced column does not exist.', null, 'Fix the column name or add it.', 'error', null, 'high');
      }
      if (/relation .* does not exist/i.test(text)) {
        const rel = /relation\s+("?[\w.]+"?)/i.exec(text)?.[1];
        push('Unknown table', rel ? `Table ${rel} does not exist.` : 'A referenced table does not exist.', null, 'Fix the table name or create it.', 'error', null, 'high');
      }
      if (/duplicate key value violates unique constraint/i.test(text)) {
        push('Unique constraint violation', firstLine(text), null, 'Insert a different value or change the constraint.', 'error', null, 'high');
      }
      if (/null value in column .* violates not-null constraint/i.test(text)) {
        push('NOT NULL violation', firstLine(text), null, 'Provide a value for the NOT NULL column.', 'error', null, 'high');
      }
      break;
    }
  }

  // ---------- generic fallback ----------
  if (!hints.length) {
    if (/error/i.test(text) || /exception/i.test(text) || /traceback/i.test(text)) {
      push('Error reported', firstLine(text) || 'The tool reported an error.', null, 'Inspect the first error and fix it.', 'error', null, 'low');
    }
  }

  return finalize();

  // ---------- summarizer ----------
  function finalize() {
    // de-dup annotations with same (line,column,message)
    const seen = new Set();
    const ann = [];
    for (const a of annotations) {
      const key = `${a.line||0}:${a.column||0}:${a.message}`;
      if (!seen.has(key)) { seen.add(key); ann.push(a); }
    }

    const strong = hints.filter(h => h.confidence === 'high').length;
    const summary = hints.length
      ? `Found ${hints.length} issue${hints.length>1?'s':''}${strong?` (${strong} high confidence)`:''}. Fix the first error first; later errors may be a cascade.`
      : `The compiler reported errors, but I couldn’t interpret them confidently.`;

    return { hints, summary, annotations: ann };
  }
}



/* ---------------------- Rendering Helpers (optional) ---------------------- */

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
