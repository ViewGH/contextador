import { readdir, readFile, stat } from "fs/promises";
import { join, relative, extname, basename } from "path";
import { generateText } from "ai";
import { getModel } from "../providers/config";
import { getLatestCommit, buildFrontmatter } from "./freshness";

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "target", "__pycache__", "build"]);
const CODE_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".rs", ".go", ".java", ".c", ".cpp", ".h",
  ".json", ".yaml", ".yml", ".toml", ".md", ".sql",
  ".sh", ".bash", ".zsh", ".css", ".scss", ".html", ".svelte", ".vue",
]);
const PRIORITY_FILES = ["README.md", "package.json", "Cargo.toml", "pyproject.toml", "go.mod", "main.ts", "index.ts", "mod.rs", "main.go", "main.py", "app.ts", "app.py"];

const MAX_DEPTH = 4;
const MAX_PREVIEW_FILES = 15;
const PREVIEW_CHARS = 500;

/** Recursively list code files under dirPath, max depth 4, skipping common non-source dirs. */
export async function summarizeDirectory(dirPath: string, depth = 0): Promise<string[]> {
  if (depth > MAX_DEPTH) return [];

  let entries;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
      const subFiles = await summarizeDirectory(join(dirPath, entry.name), depth + 1);
      files.push(...subFiles);
    } else if (entry.isFile()) {
      const ext = extname(entry.name);
      if (CODE_EXTS.has(ext)) {
        files.push(join(dirPath, entry.name));
      }
    }
  }

  return files;
}

/** Pick priority files first, then fill with the rest up to maxFiles. */
function pickPreviewFiles(files: string[], maxFiles: number): string[] {
  const priority: string[] = [];
  const rest: string[] = [];

  for (const f of files) {
    const name = basename(f);
    if (PRIORITY_FILES.includes(name)) {
      priority.push(f);
    } else {
      rest.push(f);
    }
  }

  return [...priority, ...rest].slice(0, maxFiles);
}

/** Read up to `chars` characters from a file. */
async function readPreview(filePath: string, chars: number): Promise<string> {
  try {
    const content = await readFile(filePath, "utf-8");
    return content.slice(0, chars);
  } catch {
    return "";
  }
}

/** Build a directory-listing fallback for CONTEXT.md body. */
function buildFallbackBody(scope: string, files: string[], root: string): string {
  const lines: string[] = [];
  lines.push(`# ${scope || basename(root)}`);
  lines.push("");
  lines.push("## Purpose");
  lines.push("");
  lines.push(`This directory contains ${files.length} source file${files.length !== 1 ? "s" : ""}.`);
  lines.push("");
  lines.push("## Key Files");
  lines.push("");

  const previews = pickPreviewFiles(files, MAX_PREVIEW_FILES);
  for (const f of previews) {
    lines.push(`- \`${relative(root, f)}\``);
  }

  if (files.length > previews.length) {
    lines.push(`- ... and ${files.length - previews.length} more`);
  }

  lines.push("");
  return lines.join("\n");
}

/** Generate CONTEXT.md content using AI, with fallback to directory listing. */
export async function generateContextContent(root: string, scope: string): Promise<string> {
  const dirPath = scope ? join(root, scope) : root;
  const files = await summarizeDirectory(dirPath);
  const sha = await getLatestCommit(root, scope);
  const date = new Date().toISOString().split("T")[0];
  const frontmatter = sha ? buildFrontmatter(sha.slice(0, 7), date) : buildFrontmatter("unknown", date);

  // Build file previews for the AI prompt
  const previews = pickPreviewFiles(files, MAX_PREVIEW_FILES);
  const previewContents: string[] = [];
  for (const f of previews) {
    const relPath = relative(root, f);
    const content = await readPreview(f, PREVIEW_CHARS);
    if (content) {
      previewContents.push(`### ${relPath}\n\`\`\`\n${content}\n\`\`\``);
    }
  }

  // Try AI generation
  try {
    const model = getModel("local-fast");
    const prompt = `You are generating a CONTEXT.md file for a code directory.

Scope: ${scope || "(root)"}
Total files: ${files.length}

File previews:
${previewContents.join("\n\n")}

Generate a concise CONTEXT.md body with these sections:
# ${scope || basename(root)}

## Purpose
(1-2 sentences describing what this code does)

## Key Files
(bullet list of the most important files with brief descriptions)

## Architecture
(brief description of how the code is organized)

Do NOT include frontmatter (---). Just the markdown body.`;

    const result = await generateText({
      model,
      prompt,
      maxTokens: 1024,
    });

    return frontmatter + "\n" + result.text.trim() + "\n";
  } catch {
    // Fallback to directory listing
    const body = buildFallbackBody(scope, files, root);
    return frontmatter + "\n" + body;
  }
}
