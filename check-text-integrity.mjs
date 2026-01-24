import fs from "fs";
import path from "path";

const ROOT_DIR = process.cwd();
const INCLUDE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);
const EXCLUDE_DIRS = new Set([
  "node_modules",
  "dist",
  ".next",
  "artifacts",
  "docs",
  "tmp",
  "storage",
  ".git",
]);

const mojibakeRe = /\u0401\u042F|\u2568|\u0442\u0410|\u06AF\?|\uFFFD|\u0420\u2019\u0421|\u0420\u045C\u0420|\u0420\u0406\u0432\u0402|\u0432\u2020\u0452/;
const tsxBadEscapeRe = /\\u[0-9a-fA-F]{4}|\\u1f/i;
const questionMarkRunRe = /\?{3,}/;

const findings = [];

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) {
        continue;
      }
      walk(fullPath);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const ext = path.extname(entry.name);
    if (!INCLUDE_EXTS.has(ext)) {
      continue;
    }
    checkFile(fullPath, ext);
  }
}

function checkFile(filePath, ext) {
  const normalizedPath = path.normalize(filePath);
  if (normalizedPath.endsWith(`${path.sep}check-text-integrity.mjs`)) {
    return;
  }
  let content = "";
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    findings.push({
      file: filePath,
      line: 0,
      reason: `read_error: ${err.message}`,
    });
    return;
  }

  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (mojibakeRe.test(line)) {
      findings.push({
        file: filePath,
        line: i + 1,
        reason: "mojibake_pattern",
      });
    }
    if (ext === ".tsx" && tsxBadEscapeRe.test(line)) {
      findings.push({
        file: filePath,
        line: i + 1,
        reason: "tsx_raw_escape",
      });
    }
    if (questionMarkRunRe.test(line) && /["'`]/.test(line)) {
      findings.push({
        file: filePath,
        line: i + 1,
        reason: "question_marks_literal",
      });
    }
  }
}

walk(ROOT_DIR);

if (findings.length > 0) {
  console.error("Text integrity guard failed.");
  for (const item of findings) {
    const relPath = path.relative(ROOT_DIR, item.file);
    console.error(`${relPath}:${item.line} ${item.reason}`);
  }
  process.exit(1);
}

console.log("Text integrity guard OK.");
