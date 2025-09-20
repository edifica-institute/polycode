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


// === Generic utilities ===
const RE_EXIT = /process exited with code\s+(-?\d+)/i;
const add = (arr, {title, detail, line=null, fix=null, severity='error', confidence='high'}) =>
  arr.push({ title, detail, line, fix, severity, confidence });

// Collapse duplicate "[process exited ...]" trailers

// === DETECTOR A: POSIX runtime crashes (all langs that run native) ===
// Maps Linux "128 + signal" exit codes -> signal names

// === DETECTOR B: Sanitizers (C/C++) ===
function detectSanitizers(text, hints) {
  const t = String(text||'');
  // AddressSanitizer
  if (/AddressSanitizer/i.test(t)) {
    const m = /AddressSanitizer: ([^\n]+)/i.exec(t);
    add(hints, {
      title: 'AddressSanitizer: ' + (m ? m[1] : 'memory error'),
      detail: 'ASan found invalid memory access (use-after-free, OOB, etc.).',
      fix: 'Read the stack in the log; fix the access; keep -fsanitize=address while testing.'
    });
    return true;
  }
  // UndefinedBehaviorSanitizer
  if (/UndefinedBehaviorSanitizer|undefined behavior/i.test(t)) {
    add(hints, {
      title: 'UndefinedBehaviorSanitizer: undefined behavior',
      detail: 'UBSan detected undefined behavior (e.g., signed overflow, null deref).',
      fix: 'Follow the file:line shown by UBSan and correct the operation.'
    });
    return true;
  }
  // ThreadSanitizer
  if (/ThreadSanitizer|data race/i.test(t)) {
    add(hints, {
      title: 'ThreadSanitizer: data race',
      detail: 'Concurrent access without synchronization.',
      fix: 'Protect shared data with mutexes/atomics or redesign concurrency.'
    });
    return true;
  }
  return false;
}

// === DETECTOR C: GCC/Clang compile & link (C/C++) ===
function detectGccClang(text, hints) {
  const lines = String(text||'').split('\n');
  let hit=false;
  for (const ln of lines) {
    // file:line:col: error: message
    let m = /^(.+?):(\d+):(\d+):\s+(fatal error|error|warning):\s+(.*)$/i.exec(ln);
   if (m) {
  const [,file,row,col,kind,msg] = m;
  const sev = /warning/i.test(kind) ? 'warning' : 'error';
  let fix = null;

  // ✅ check for compile-time divide-by-zero first
  if (/division by zero/i.test(msg)) {
    add(hints, {
      title: 'Division by zero (compile-time)',
      detail: msg,
      line: parseInt(row,10),
      fix: 'Guard the divisor or restructure the expression so the divisor is non-zero at compile time.',
      severity: sev,
      confidence: 'high'
    });
    hit = true; 
    continue;
  }

  if (/expected.*';'/.test(msg)) fix='Add a missing semicolon at the end of the statement.';
  else if (/undeclared|not declared/i.test(msg)) fix='Declare the variable/function before use or include the right header.';
  else if (/assignment of read-only/i.test(msg)) fix='Do not modify const data; remove const or copy into a mutable variable.';

  add(hints, {
    title: `${kind.toUpperCase()} in ${file}:${row}:${col}`,
    detail: msg,
    line: parseInt(row,10),
    fix,
    severity: sev,
    confidence: 'high'
  });
  hit = true; 
  continue;
}


    // linker: undefined reference to `...`
    m = /undefined reference to\s*`([^']+)'/i.exec(ln);
    if (m) {
      add(hints, {
        title: 'Linker error: undefined reference',
        detail: `Missing symbol: ${m[1]}`,
        fix: 'Link the correct library/object file or provide the function definition.'
      });
      hit=true;
    }
  }
  return hit;
}

// === DETECTOR D: Java (javac + JVM runtime) ===
function detectJava(text, codeText, hints) {
  const t = String(text||'');
  let hit=false;

  // javac: Foo.java:12: error: ...
  const reJavac = /^(.+?):(\d+):\s+error:\s+(.*)$/im;
  let m = reJavac.exec(t);
  while (m) {
    add(hints, {
      title: 'Compilation error',
      detail: m[3],
      line: parseInt(m[2],10),
      fix: /';' expected/.test(m[3]) ? 'Insert a missing semicolon.' : null
    });
    hit=true;
    m = reJavac.exec(t.substring(m.index + 1));
  }

  // JVM runtime exceptions
  // Example: Exception in thread "main" java.lang.ArithmeticException: / by zero
  const reEx = /Exception in thread ".*?" ([\w.$]+):\s*(.*)/i;
  const reAt = /\s*at\s+([^\s(]+)\(([^:]+):(\d+)\)/; // stack frame
  const e = reEx.exec(t);
  if (e) {
    const ex = e[1], msg = e[2] || '';
    let fix=null;
    if (/NullPointerException/i.test(ex)) fix='Check for null before dereferencing; ensure objects are initialized.';
    else if (/ArrayIndexOutOfBoundsException/i.test(ex)) fix='Check array indices and bounds.';
    else if (/ArithmeticException/i.test(ex)) fix='Guard divisors; avoid / by zero.';
    else if (/InputMismatchException/i.test(ex)) fix='Validate Scanner input types before parsing.';
    add(hints, { title: ex.replace(/^java\.lang\./,''), detail: msg || 'Runtime exception', fix });
    // try to pin first source frame
    const s = reAt.exec(t);
    if (s) hints[hints.length-1].line = parseInt(s[3],10);
    hit=true;
  }

  return hit;
}

// === DETECTOR E: Python (Traceback) ===
function detectPython(text, hints) {
  const t = String(text||'');
  if (!/Traceback \(most recent call last\):/i.test(t) && !/File ".*", line \d+/.test(t)) return false;

  // capture last frame
  const frames = Array.from(t.matchAll(/File "([^"]+)", line (\d+), in ([^\n]+)\n([\s\S]*?)(?=File "|[A-Za-z]+Error:|$)/g));
  const last = frames.length ? frames[frames.length-1] : null;

  // final exception line
  const mExc = /([A-Za-z_]+Error):\s*([^\n]*)/i.exec(t);
  let title='Python error', detail=mExc ? mExc[2] : 'Uncaught exception', fix=null;
  if (mExc) {
    const ex = mExc[1];
    if (/ZeroDivisionError/i.test(ex)) fix='Guard divisors against zero.';
    else if (/IndexError/i.test(ex)) fix='Check list/tuple index bounds.';
    else if (/KeyError/i.test(ex)) fix='Ensure dictionary key exists before access or use dict.get().';
    else if (/TypeError/i.test(ex)) fix='Check argument types; convert/parse inputs.';
    else if (/ValueError/i.test(ex)) fix='Validate/parse your inputs before converting.';
    else if (/ModuleNotFoundError/i.test(ex)) fix='Install or include the missing module; check the module name.';
    else if (/MemoryError/i.test(ex)) fix='Reduce data size or algorithmic memory use.';
    add(hints, { title, detail, line: last ? parseInt(last[2],10) : null, fix, confidence:'high' });
  } else {
    add(hints, { title, detail, line: last ? parseInt(last[2],10) : null });
  }
  return true;
}



// --- POSIX runtime crash detector (for native langs like C/C++) ---
function detectPosixCrash(text, opts, hints) {
  const before = hints.length;
  // ... existing code ...
  if (!sig) return false;

  const detail =
    sig === 'SIGFPE' ? 'Most commonly divide-by-zero or invalid arithmetic.' :
    sig === 'SIGSEGV'? 'Invalid memory access (NULL deref or out-of-bounds).' :
    sig === 'SIGABRT'? 'Program aborted itself (often via assert()).' :
                       'Process terminated by a POSIX signal.';

  const fix =
    sig === 'SIGFPE' ? 'Guard divisors against zero; validate arithmetic operands.' :
    sig === 'SIGSEGV'? 'Check pointer init and bounds; try AddressSanitizer.' :
    sig === 'SIGABRT'? 'Check failed assertions and abort() calls.' :
                        null;

  add(hints, { title: `Runtime crash: ${sig}`, detail, fix, severity: 'error', confidence: 'high' });
  return hints.length > before;  // <— NEW
}




// (optional) collapse duplicate “[process exited …]” lines
function dedupeExitTrailers(s) {
  return String(s||'').replace(
    /\n*\[process exited with code\s+(-?\d+)\][^\n]*\n(?:\s*\[process exited with code\s+\1\][^\n]*\n)+/i,
    '\n[process exited with code $1]\n'
  );
}

function detectJavaRuntime(text, push) {
  const t = String(text||'');
  const m = /Exception in thread ".*?" ([\w.$]+):\s*(.*)/i.exec(t);
  if (!m) return false;
  const ex = m[1], msg = m[2] || '';
  let fix=null;
  if (/NullPointerException/i.test(ex)) fix='Check for null before dereferencing; ensure objects are initialized.';
  else if (/ArrayIndexOutOfBoundsException/i.test(ex)) fix='Validate array indices and bounds.';
  else if (/ArithmeticException/i.test(ex)) fix='Guard divisors against zero.';
  else if (/InputMismatchException/i.test(ex)) fix='Validate Scanner inputs before parsing.';
  push(ex.replace(/^java\.lang\./,''), msg || 'Runtime exception', null, fix, 'error', null, 'high');
  return true;
}

function detectPythonTraceback(text, push) {
  const t = String(text||''); if (!/Traceback \(most recent call last\):/i.test(t)) return false;
  const frames = Array.from(t.matchAll(/File "([^"]+)", line (\d+), in ([^\n]+)/g));
  const last = frames[frames.length-1];
  const mExc = /([A-Za-z_]+Error):\s*([^\n]*)/i.exec(t);
  if (!mExc) return false;
  const ex = mExc[1], msg = mExc[2] || '';
  let fix=null;
  if (/ZeroDivisionError/i.test(ex)) fix='Guard divisors against zero.';
  else if (/IndexError/i.test(ex)) fix='Check list/tuple index bounds.';
  else if (/KeyError/i.test(ex)) fix='Ensure key exists or use dict.get().';
  else if (/TypeError/i.test(ex)) fix='Check argument counts and types.';
  else if (/ValueError/i.test(ex)) fix='Validate/parse inputs before converting.';
  push(ex, msg, last ? parseInt(last[2],10) : null, fix, 'error', null, 'high');
  return true;
}





// --- DROP-IN HELPER ---
function explainPyTypeOrAttr(errMsgRaw) {
  const msg = String(errMsgRaw || "");
  let detail = msg.replace(/^.*?:\s*/i, ""); // strip "TypeError:" / "AttributeError:"
  let fix = null;
  let confidence = 'high';

  // —— AttributeError patterns ——
  // 'NoneType' object has no attribute 'x'
  if (/'NoneType' object has no attribute '([^']+)'/i.test(msg)) {
    const attr = (/'NoneType' object has no attribute '([^']+)'/i.exec(msg) || [])[1];
    fix = [
      `The object is \`None\` before access${attr ? ` (attribute \`${attr}\`)` : ""}.`,
      '• Ensure the function you called returns a value (not None).',
      '• Initialize the object before use.',
      '• Add a guard: `if obj is None: ...`'
    ].join('\n');
    return { detail, fix, confidence };
  }

  // 'dict' object has no attribute 'x'  → probably using dot-access
  if (/'dict' object has no attribute '([^']+)'/i.test(msg)) {
    const key = (/'dict' object has no attribute '([^']+)'/i.exec(msg) || [])[1];
    fix = `Use key access on dicts (e.g., \`d['${key || 'key'}']\`) rather than dot access.`;
    return { detail, fix, confidence };
  }

  // 'list' object has no attribute 'split' | 'keys' etc.
  if (/'list' object has no attribute '([^']+)'/i.test(msg)) {
    const a = (/'list' object has no attribute '([^']+)'/i.exec(msg) || [])[1];
    fix = [
      `You're calling \`${a}\` on a list.`,
      '• If you meant a string, select the string item first: `my_list[i].split(...)`.',
      '• Or convert to the right type before calling methods.'
    ].join('\n');
    return { detail, fix, confidence };
  }

  // 'str' object has no attribute 'append'
  if (/'str' object has no attribute '([^']+)'/i.test(msg)) {
    const a = (/'str' object has no attribute '([^']+)'/i.exec(msg) || [])[1];
    fix = `Strings are immutable and lack \`${a}\`. For building text, use concatenation or \`str.join\`; for collections, use a list.`;
    return { detail, fix, confidence };
  }

  // —— TypeError patterns ——
  // str + int or "can only concatenate str (not 'int')"
  if (/can only concatenate str .* not '.*' to str/i.test(msg) ||
      /unsupported operand type\(s\) for \+:\s*'str'\s*and\s*'int'/i.test(msg)) {
    fix = 'Cast before using `+`: e.g., `str(x) + " years"` or convert inputs with `int()`/`float()` for numeric addition.';
    return { detail, fix, confidence };
  }

  // unsupported operand types for arithmetic
  if (/unsupported operand type\(s\) for [+\-*/]/i.test(msg)) {
    fix = 'Make operand types compatible (e.g., convert with `int()`, `float()`, or parse input before arithmetic).';
    return { detail, fix, confidence };
  }

  // list/tuple/string indices must be integers, not str
  if (/(indices must be integers|list indices must be integers|slice indices must be integers)/i.test(msg)) {
    fix = 'Convert the index to an integer (e.g., `seq[int(i)]`) or ensure you’re indexing the right structure.';
    return { detail, fix, confidence };
  }

  // 'int' object is not subscriptable
  if (/'int' object is not subscriptable/i.test(msg)) {
    fix = 'You tried to index an int. Index the sequence instead, or compute the int value first and don’t subscript it.';
    return { detail, fix, confidence };
  }

  // 'str' object is not callable (using "x(...)" where x is a string)
  if (/'str' object is not callable/i.test(msg)) {
    fix = 'You’re calling a string like a function. Remove the parentheses or rename a variable that shadows a function name.';
    return { detail, fix, confidence };
  }

  // takes N positional arguments but M were given / missing required positional arg
  if (/takes \d+ positional arguments but \d+ were given/i.test(msg) ||
      /missing \d+ required positional argument/i.test(msg)) {
    fix = [
      'Check the function signature and your call.',
      'Common pitfall: instance methods need `self`; call them on an instance (e.g., `obj.method(...)`) not the class, or add `@staticmethod` if `self` is not used.'
    ].join('\n');
    return { detail, fix, confidence };
  }

  // got an unexpected keyword argument 'x'
  if (/got an unexpected keyword argument\s+'([^']+)'/i.test(msg)) {
    const kw = (/got an unexpected keyword argument\s+'([^']+)'/i.exec(msg) || [])[1];
    fix = `The callee doesn’t accept \`${kw}\`. Rename the argument to match the function’s parameter name or upgrade/downgrade to a matching API version.`;
    return { detail, fix, confidence };
  }

  // cannot unpack non-iterable X object
  if (/cannot unpack non-iterable .* object/i.test(msg)) {
    fix = 'The right side isn’t a tuple/iterable. Make the function return multiple values (tuple) or unpack one variable only.';
    return { detail, fix, confidence };
  }

  // slice step cannot be zero
  if (/slice step cannot be zero/i.test(msg)) {
    fix = 'Use a non-zero step in slicing (e.g., `a[::1]`).';
    return { detail, fix, confidence };
  }

  // Fallback
  return { detail, fix: 'Check argument counts and operand types; convert or validate inputs where needed.', confidence: 'medium' };
}





function detectCommonRuntimeErrors(text, push) {
  const t = String(text || '');

  // fopen/open: No such file or directory
  if (/(^|\n)\s*(f?open|fopen64|read|write|stat|access)\s*:\s*No such file or directory/i.test(t) ||
      /No such file or directory/i.test(t)) {
    push(
      'File not found',
      'The program tried to open a file that does not exist (often using mode "r").',
      null,
      'Create the file first, check the path/working directory, or open with "w"/"a" to create it.'
    );
    return true;
  }

  // Permission denied
  if (/(^|\n)\s*(f?open|fopen64|read|write|stat|access)\s*:\s*Permission denied/i.test(t) ||
      /Permission denied/i.test(t)) {
    push(
      'Permission denied',
      'The OS blocked access to the file/path.',
      null,
      'Use a writable location, adjust permissions, or run with appropriate rights.'
    );
    return true;
  }

  return false;
}



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
// =======================
// Drop-in: parseCompilerOutput (fixed)
// =======================
export function parseCompilerOutput({
  lang,
  stderr = "",
  stdout = "",
  code = "",
  phase = "compile",             // "compile" | "runtime"
  status = null                  // { exitCode, signal, timedOut } from the runner
}) {
  const text = dedupeExitTrailers([stderr, stdout].filter(Boolean).join("\n"));
  const hints = [];
  const annotations = [];

  // ---------- small utilities ----------
  const push = (title, detail, line = null, fix = null, severity = "error", column = null, confidence = "medium") => {
    hints.push({ title, detail, fix, line, column, severity, confidence });
    const msg = `${title}${detail ? ": " + detail : ""}`;
    annotations.push({ line, column, message: msg, severity });
  };
  const firstLine = (s) => (String(s || "").split("\n").find(Boolean) || "").trim();
  const asInt = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : null; };
  const L = (s) => String(s || "").toLowerCase();

  // ---------- optional JSON diagnostics (clang/gcc/tsc) ----------
  try {
    const trimmed = text.replace(/^\u001b\[[0-9;]*m/g, "").trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      const j = JSON.parse(trimmed);
      const diags = Array.isArray(j) ? j : j?.diagnostics || [];
      if (Array.isArray(diags) && diags.length) {
        for (const d of diags) {
          const msg = (d.message || d.text || d.rendered || "").trim();
          const severity = L(d.severity || d.level || "error").includes("warn") ? "warning" : "error";
          const loc = d.location || d.loc || d.range?.start || {};
          const line = asInt(loc.line || loc.row);
          const column = asInt(loc.column || loc.col);
          let title = "Compiler diagnostic";
          const codeId = d.code || d.diagnosticId || null;
          if (codeId) title += ` (${codeId})`;

          let fix = null, confidence = "medium";
          if (/expected ['"`;)]/i.test(msg)) { title = "Missing token"; fix = "Insert the expected token."; confidence = "high"; }
          if (/undeclared|not declared|cannot find name/i.test(msg)) { title = "Undeclared identifier"; fix = "Declare it or include/import the correct symbol."; confidence = "high"; }
          if (/incompatible|mismatch|cannot convert/i.test(msg)) { title = "Type mismatch"; fix = "Adjust type or cast appropriately."; }

          push(title, msg, line, fix, severity, column, confidence);
        }
      }
    }
  } catch { /* ignore non-JSON */ }

  // Catch simple perror-style runtime errors across languages
  if (detectCommonRuntimeErrors(text, push)) return finalize();

  // ---------- runtime phase (from program execution) ----------
  if (phase === "runtime") {
    detectSanitizers(text, hints);               // concrete ASan/UBSan/Tsan messages
    detectPosixCrash(text, status || {}, hints); // SIGFPE/SIGSEGV/SIGABRT mapping
    // (Optional) add Java/Python special cases if you run those here:
    // detectJavaRuntime(text, (t,d,l,f,s,r,c) => push(t,d,l,f,s));
    // detectPythonTraceback(text, (t,d,l,f,s,r,c) => push(t,d,l,f,s));
    return finalize();
  }

  // ---------- language-specific text parsers (compile phase) ----------
  switch ((lang || "").toLowerCase()) {
    case "c":
    case "cpp":
    case "c++":
    case "cc": {
      // GCC/Clang styled diagnostics
      detectGccClang(text, hints);
      const hadSan = detectSanitizers(text, hints);
      const hadPosix = detectPosixCrash(text, status || {}, hints); // <-- fixed call

      // Prefer DZ over generic UBSan if both present
      if (hadPosix && hadSan) {
        const dzIdx = hints.findIndex(h => /divide by zero/i.test(h.title) || /divide by zero/i.test(h.detail));
        const ubIdx = hints.findIndex(h => /UndefinedBehaviorSanitizer/i.test(h.title));
        if (dzIdx >= 0 && ubIdx >= 0) {
          const dz = hints.splice(dzIdx, 1)[0];
          hints.unshift(dz);
        }
      }

      // Fallback line-specific parse for gcc/clang text
      if (!hints.length) {
        const main = text.match(/^(.*?):(\d+)(?::(\d+))?:\s*(error|fatal error|warning):\s*(.+)$/m);
        if (main) {
          const line = asInt(main[2]), col = asInt(main[3]);
          const level = L(main[4]), msg = main[5].trim();

          if (/implicit declaration of function\s+['"`]?([A-Za-z_]\w*)['"`]?/i.test(msg)) {
            push("Missing function prototype", "You called a function before it was declared or included.", line, "Add a prototype or include the header.", "error", col, "high");
          }
          if (/expected\s*['‘’"]?;['‘’"]?\s*(?:before|after)?/i.test(msg)) {
            push("Missing semicolon", "Add a `;` at the end of the statement.", line, "Insert `;`.", "error", col, "high");
          }
          if (/['‘’"`]?([A-Za-z_]\w*)['‘’"`]?\s*(?:undeclared|was not declared)/i.test(msg) ||
              /use of undeclared identifier/i.test(msg)) {
            push("Undeclared identifier", "Declare the name or include the correct header.", line, "Declare it or include the header.", "error", col, "high");
          }
          if (/no such file or directory/i.test(msg) && /include/i.test(msg)) {
            push("Header not found", "The included header file was not found.", line, "Fix the `#include` path or add the missing header.", "error", col, "high");
          }
          if (/format specifies type.*but the argument has type/i.test(msg)) {
            push("printf/scanf format mismatch", "Your `%` format and argument types don’t match.", line, "Fix the format specifier or cast the argument.", "error", col, "high");
          }
          if (/conflicting types|redefinition/i.test(msg)) {
            push("Conflicting types / Redefinition", "The same symbol is declared incompatibly.", line, "Use a single consistent declaration and remove duplicates.", "error", col, "medium");
          }
          if (!hints.length && (level === "error" || level === "fatal error")) {
            push("Compiler error", msg, line, "Fix at the highlighted line.", "error", col, "low");
          }
        }
      }

      // Linker: undefined reference to `foo`
      if (!hints.length) {
        const links = [...text.matchAll(/undefined reference to `?([A-Za-z_]\w*)`?/g)];
        if (links.length) {
          const names = Array.from(new Set(links.map(m => m[1]))).slice(0, 5);
          push("Linker error: undefined reference", `Missing implementation or library for: ${names.join(", ")}`, null, "Provide the function(s) or link the correct library.", "error", null, "high");
        }
      }
      break;
    }

    case "java": {
      // compile errors first
      const m = text.match(/^(.*?):(\d+):\s*error:\s*(.+)$/m);
      if (m) {
        const line = asInt(m[2]), msg = m[3].trim();
        if (/cannot find symbol/i.test(msg)) {
          const name = text.match(/symbol:\s*(?:class|variable|method)\s+([A-Za-z_]\w*)/i)?.[1];
          push("Cannot find symbol", name ? `Symbol \`${name}\` is not declared or not imported.` : "A symbol is not declared or not imported.", line, "Declare it or import the right package.", "error");
        }
        if (/package .* does not exist/i.test(msg)) push("Package not found", "The package is not on the classpath.", line, "Add the dependency or correct the import.", "error");
        if (/';' expected/i.test(msg))          push("Missing semicolon", "Add a `;` at the end of the statement.", line, "Insert `;`.", "error");
        if (/incompatible types/i.test(msg))    push("Incompatible types", "The assigned expression type does not match the variable type.", line, "Adjust the type or cast safely.", "error");
        if (/missing return statement/i.test(msg)) push("Missing return", "A non-void method must return a value on all paths.", line, "Return a value or change the method to void.", "error");
        if (/unreported exception .*; must be caught or declared to be thrown/i.test(msg))
          push("Unchecked exception handling", "You must catch or declare the checked exception.", line, "Wrap in try-catch or add `throws` to the method.", "error");
        if (!hints.length) push("Compiler error", firstLine(msg), line, "Fix at the highlighted line.", "error");
      }
      if (!hints.length) detectJava(text, code, hints); // runtime exception shape
      break;
    }

    case "python": {
      // Use your existing Python logic
      detectPython(text, hints) || detectPythonTraceback(text, (t, d, l, f, s, r, c) => push(t, d, l, f, s));
      break;
    }

    case "js":
    case "javascript":
    case "ts":
    case "typescript":
      // keep your TS/JS branch unchanged…
      // (omitted here for brevity)
      break;

    case "sql":
      // keep your SQL branch unchanged…
      break;
  }

  // ---------- generic fallback ----------
  if (!hints.length) {
    if (/error/i.test(text) || /exception/i.test(text) || /traceback/i.test(text)) {
      push("Error reported", firstLine(text) || "The tool reported an error.", null, "Inspect the first error and fix it.", "error");
    }
  }

  // ---------- enrich hints with code snippets ----------
  for (const h of hints) {
    if (h && h.line && code) h.snippet = extractSnippet(code, h.line, 1);
  }

  return finalize();

  // ---------- summarizer ----------
  function finalize() {
    const seen = new Set(); const ann = [];
    for (const a of annotations) {
      const key = `${a.line || 0}:${a.column || 0}:${a.message}`;
      if (!seen.has(key)) { seen.add(key); ann.push(a); }
    }
    const top = hints[0];
    const summary = hints.length
      ? `${top.title}${top.detail ? " — " + top.detail : ""}`
      : `The compiler reported errors, but I couldn’t interpret them confidently.`;
    return { hints, summary, annotations: ann };
  }
}




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
// --- DROP-IN REPLACEMENT ---
export function renderHintHTML(hint) {
  const sev = hint.severity || hint.kind || "error";

  const hasLine = Number.isFinite(hint.line);
  const hasCol  = Number.isFinite(hint.column);
  const lineCol = hasLine ? `Line ${hint.line}${hasCol ? ':' + hint.column : ''}` : "";

  const confText =
  typeof hint.confidence === "number"
    ? `${(hint.confidence * 100) | 0}%`
    : (hint.confidence
        ? String(hint.confidence).charAt(0).toUpperCase() +
          String(hint.confidence).slice(1).toLowerCase()
        : "");

  const rule = hint.ruleId ? `<code>${escapeHtml(hint.ruleId)}</code>` : "";

  const meta = [lineCol, confText && `Confidence: ${confText}`, rule]
    .filter(Boolean)
    .join(" \u00A0·\u00A0 ");

  const fixes = Array.isArray(hint.fix) ? hint.fix
              : hint.fix ? [hint.fix]
              : [];

  const snip = (hint.snippet || [])
    .map(s => `<div class="eh-snip-line"><em>${s.n}</em> ${escapeHtml(s.text)}</div>`)
    .join("");

  return `
  <div class="eh-hint ${sev}">
    <div class="eh-hdr">
      <strong>${escapeHtml(hint.title || 'Issue')}</strong>
      ${meta ? `<span class="eh-meta">${meta}</span>` : ""}
    </div>
    ${hint.detail ? `<div class="eh-detail">${escapeHtml(hint.detail)}</div>` : ""}
    ${fixes.length ? `<div class="eh-fix"><span>Try:</span> ${fixes.map(f => `<div class="eh-fix-line">${escapeHtml(f)}</div>`).join("")}</div>` : ""}
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
