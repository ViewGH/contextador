import { readFile, rm, writeFile, access } from "fs/promises";
import { join, relative } from "path";
import { findContextFiles } from "./hierarchy";
import { parseFrontmatter } from "./freshness";

async function fileExists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

/** Check if a CONTEXT.md was created by Contextador (has our frontmatter) */
export function isContextadorGenerated(content: string): boolean {
  const { frontmatter } = parseFrontmatter(content);
  return frontmatter.lastValidated !== null || frontmatter.validatedAt !== null;
}

export interface DemolishResult {
  contextadorDirRemoved: boolean;
  contextFilesRemoved: string[];
  contextFilesKept: string[];
  mcpJsonUpdated: boolean;
}

export async function demolish(root: string): Promise<DemolishResult> {
  const result: DemolishResult = {
    contextadorDirRemoved: false,
    contextFilesRemoved: [],
    contextFilesKept: [],
    mcpJsonUpdated: false,
  };

  // 1. Remove .contextador/ directory
  const ctxDir = join(root, ".contextador");
  if (await fileExists(ctxDir)) {
    await rm(ctxDir, { recursive: true });
    result.contextadorDirRemoved = true;
  }

  // 2. Remove Contextador-generated CONTEXT.md files
  const contextFiles = await findContextFiles(root);
  for (const file of contextFiles) {
    try {
      const content = await readFile(file, "utf-8");
      if (isContextadorGenerated(content)) {
        await rm(file);
        result.contextFilesRemoved.push(relative(root, file));
      } else {
        result.contextFilesKept.push(relative(root, file));
      }
    } catch {}
  }

  // 3. Clean up .mcp.json
  const mcpPath = join(root, ".mcp.json");
  if (await fileExists(mcpPath)) {
    try {
      const raw = await readFile(mcpPath, "utf-8");
      const mcp = JSON.parse(raw);
      if (mcp.mcpServers?.contextador) {
        delete mcp.mcpServers.contextador;
        if (Object.keys(mcp.mcpServers).length === 0) {
          await rm(mcpPath);
        } else {
          await writeFile(mcpPath, JSON.stringify(mcp, null, 2) + "\n", "utf-8");
        }
        result.mcpJsonUpdated = true;
      }
    } catch {}
  }

  return result;
}
