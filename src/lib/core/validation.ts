import { readFile, access } from "fs/promises";
import { join, dirname } from "path";
import { parseFrontmatter } from "./freshness";

export type ValidationStatus = "pass" | "minor" | "major" | "missing";

export interface ValidationResult {
  status: ValidationStatus;
  issues: string[];
}

function extractKeyFiles(content: string): string[] {
  const match = content.match(/## Key Files\n([\s\S]*?)(?=\n## |\n---|$)/);
  if (!match) return [];
  const files: string[] = [];
  for (const line of match[1].split("\n")) {
    const m = line.match(/^-\s+(\S+)/);
    if (m) files.push(m[1]);
  }
  return files;
}

async function fileExists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

export async function validateContext(root: string, contextPath: string): Promise<ValidationResult> {
  if (!(await fileExists(contextPath))) {
    return { status: "missing", issues: ["CONTEXT.md does not exist"] };
  }

  const content = await readFile(contextPath, "utf-8");
  const scopeDir = dirname(contextPath);
  const issues: string[] = [];

  const keyFiles = extractKeyFiles(content);
  if (keyFiles.length > 0) {
    const toCheck = keyFiles.slice(0, 3);
    let missing = 0;
    for (const f of toCheck) {
      if (!(await fileExists(join(scopeDir, f)))) {
        missing++;
        issues.push(`Key file missing: ${f}`);
      }
    }
    if (missing > 0 && missing >= toCheck.length * 0.5) {
      return { status: "major", issues };
    }
    if (missing > 0) {
      return { status: "minor", issues };
    }
  }

  const { frontmatter } = parseFrontmatter(content);
  if (!frontmatter.lastValidated) {
    issues.push("No freshness stamp");
    return { status: "minor", issues };
  }

  return { status: "pass", issues: [] };
}
