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
export function parseCompilerOutput({ lang, stderr, stdout="", code="" }) {
  const L = langKey(lang);
  const lines = _u.toLines(`${stderr || ""}\n${stdout || ""}`);
  const hints = [];
  const annotations = [];

  // pass 1: build hints by matching rules
  for (const raw of lines) {
    const loc = sniffLocation(raw);
    const ctx = {
      lang: L === "c*" ? (lang.toLowerCase().includes("++") ? "cpp" : "c") : L,
      raw,
      lineGuess: loc.line,
      columnGuess: loc.column,
      token: null,
    };

    for (const rule of RULES) {
      const target = rule.lang;
      if (!(target === "*" || target === L || (target === "c*" && L === "c*") || (target === "java" && L === "java") || (target === "python" && L === "python")))
        continue;

      const m = raw.match(rule.test);
      if (!m) continue;

      const hint = rule.build(m, ctx);
      if (!hint) continue;

      // add annotation if line present
      if (hint.line) {
        annotations.push({
          line: hint.line,
          message: hint.title,
          severity: hint.severity === "warning" ? "warning" : "error"
        });
      }

      hints.push(hint);
      break; // one rule per line is enough
    }
  }

  // Consolidate: dedupe by ruleId+line to avoid noise
  const seen = new Set();
  const filtered = [];
  for (const h of hints) {
    const key = `${h.ruleId || h.title}:${h.line || 0}`;
    if (seen.has(key)) continue;
    seen.add(key);
    filtered.push(h);
  }

  // Build summary (top 3)
  const bullets = _u.take(filtered, 3).map(h => `• ${h.title}${h.line ? ` (line ${h.line})` : ""}`);
  const summary = bullets.length
    ? `I found ${filtered.length} issue(s). Top items:\n${bullets.join("\n")}`
    : (stderr?.trim() ? "The compiler reported errors, but I couldn’t confidently interpret them." : "No errors detected.");

  // Attach snippets for UI consumption (optional)
  filtered.forEach(h => {
    if (h.line && code) h.snippet = extractSnippet(code, h.line, 1);
  });

  return { hints: filtered, annotations, summary, version: EH_VERSION };
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
