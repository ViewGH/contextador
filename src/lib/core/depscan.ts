import { readdir, readFile } from "fs/promises";
import { join, extname, relative, dirname } from "path";

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "target", "__pycache__"]);
const SCAN_EXTS = new Set([".py", ".ts", ".tsx", ".js", ".jsx", ".go", ".rs", ".cs"]);

// Language-specific import regexes — each captures the imported path in group 1
const IMPORT_PATTERNS: Record<string, RegExp[]> = {
  ".py": [
    /^from\s+([\w.]+)\s+import\b/gm,           // from x.y.z import ...
    /^import\s+([\w.]+)/gm,                      // import x.y.z
  ],
  ".ts": [
    /import\s+.*?\s+from\s+["']([^"']+)["']/g,  // import ... from "path"
    /require\s*\(\s*["']([^"']+)["']\s*\)/g,     // require("path")
  ],
  ".go": [
    /import\s+"([^"]+)"/g,                        // import "path"
    /import\s+\w+\s+"([^"]+)"/g,                  // import alias "path"
    /\t"([^"]+)"/g,                                // inside import () block
  ],
  ".rs": [
    /use\s+([\w:]+)::/g,                           // use path::item
  ],
  ".cs": [
    /using\s+([\w.]+)\s*;/g,                       // using Namespace.Sub;
  ],
};

// Map extensions that share patterns
IMPORT_PATTERNS[".tsx"] = IMPORT_PATTERNS[".ts"];
IMPORT_PATTERNS[".js"] = IMPORT_PATTERNS[".ts"];
IMPORT_PATTERNS[".jsx"] = IMPORT_PATTERNS[".ts"];

function isRelativeImport(imp: string): boolean {
  return imp.startsWith(".") || imp.startsWith("..");
}

function isSingleSegment(imp: string): boolean {
  // No separator at all — likely stdlib
  return !imp.includes("/") && !imp.includes(".") && !imp.includes("::");
}

/**
 * Recursively scan a directory for source files and extract import paths.
 * Skips relative imports, single-segment (stdlib) imports, and common non-source dirs.
 */
export async function detectImports(dirPath: string, maxDepth: number = 20): Promise<string[]> {
  const imports = new Set<string>();

  async function walk(dir: string, depth: number) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          await walk(join(dir, entry.name), depth + 1);
        }
      } else if (entry.isFile()) {
        const ext = extname(entry.name);
        if (!SCAN_EXTS.has(ext)) continue;
        const patterns = IMPORT_PATTERNS[ext];
        if (!patterns) continue;

        let content: string;
        try {
          content = await readFile(join(dir, entry.name), "utf-8");
        } catch {
          continue;
        }

        for (const pattern of patterns) {
          // Reset lastIndex for global regexes
          pattern.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = pattern.exec(content)) !== null) {
            const imp = m[1];
            if (!isRelativeImport(imp) && !isSingleSegment(imp)) {
              imports.add(imp);
            }
          }
        }
      }
    }
  }

  await walk(dirPath, 0);
  return Array.from(imports);
}

/**
 * Normalize an import path to a slash-separated form for matching.
 * Python dots become slashes, Rust :: becomes /.
 */
function normalizeImport(imp: string): string {
  // Python: dots → slashes
  if (imp.includes(".") && !imp.includes("/")) {
    return imp.replace(/\./g, "/");
  }
  // Rust: :: → /
  if (imp.includes("::")) {
    return imp.replace(/::/g, "/");
  }
  return imp;
}

/**
 * Match import paths against known scopes. For each import, find the longest
 * known scope prefix that matches. Returns deduplicated matched scope paths.
 */
export function matchImportsToScopes(imports: string[], knownScopes: string[]): string[] {
  // Sort scopes longest-first for greedy matching
  const sorted = [...knownScopes].sort((a, b) => b.length - a.length);
  const matched = new Set<string>();

  for (const raw of imports) {
    const normalized = normalizeImport(raw);
    for (const scope of sorted) {
      if (normalized === scope || normalized.startsWith(scope + "/")) {
        matched.add(scope);
        break;
      }
    }
  }

  return Array.from(matched);
}

/**
 * Full pipeline: scan a scope directory for imports, match against known scopes,
 * and filter out self-references.
 */
export async function scanScopeDependencies(
  root: string,
  scope: string,
  knownScopes: string[],
): Promise<string[]> {
  const dirPath = join(root, scope);
  const imports = await detectImports(dirPath);
  const matched = matchImportsToScopes(imports, knownScopes);
  return matched.filter((s) => s !== scope);
}

export interface ScopeDependencies {
  consumes: string[];      // scopes this scope imports from
  implementsFor: string[]; // scopes that import from this scope
}

/**
 * Scan all scopes in a project and build a complete dependency map.
 * For each scope, determines what it consumes (imports from) and what
 * it implements for (who imports from it).
 */
export async function scanAllDependencies(
  root: string,
): Promise<Map<string, ScopeDependencies>> {
  // Find all CONTEXT.md files to discover scopes
  const contextFiles: string[] = [];
  async function findContextFiles(dir: string, depth: number) {
    if (depth > 10) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isFile() && entry.name === "CONTEXT.md") {
        contextFiles.push(join(dir, entry.name));
      } else if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) {
        await findContextFiles(join(dir, entry.name), depth + 1);
      }
    }
  }
  await findContextFiles(root, 0);

  const knownScopes = contextFiles
    .map(f => relative(root, dirname(f)))
    .filter(s => s !== "");

  const result = new Map<string, ScopeDependencies>();

  // Initialize all scopes
  for (const scope of knownScopes) {
    result.set(scope, { consumes: [], implementsFor: [] });
  }

  // For each scope, detect what it consumes
  for (const scope of knownScopes) {
    try {
      const consumed = await scanScopeDependencies(root, scope, knownScopes);
      const entry = result.get(scope)!;
      entry.consumes = consumed;

      // Reverse direction: if A consumes B, then B implementsFor A
      for (const dep of consumed) {
        const depEntry = result.get(dep);
        if (depEntry) {
          depEntry.implementsFor.push(scope);
        }
      }
    } catch {
      // Skip scopes that fail to scan
    }
  }

  return result;
}
