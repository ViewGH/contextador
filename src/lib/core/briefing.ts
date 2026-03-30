import { findContextFiles, readContextFile } from "./hierarchy";
import { relative, dirname, sep } from "path";

function extractPurpose(content: string): string {
  const match = content.match(/## Purpose\n(.+)/);
  return match ? match[1].trim() : "No description";
}

function extractDeps(content: string, direction: string): string[] {
  const regex = new RegExp(`\\*\\*${direction}:\\*\\*\\s*(.+)`, "i");
  const match = content.match(regex);
  if (!match) return [];
  return match[1].split(",").map(s => s.trim()).filter(Boolean);
}

function extractName(content: string): string {
  const match = content.match(/^#\s+(.+)/m);
  return match ? match[1].trim() : "Unknown";
}

interface Entry {
  name: string;
  scope: string;
  category: string;
  purpose: string;
  downstream: string[];
}

export async function generateBriefing(root: string): Promise<string> {
  const files = await findContextFiles(root);
  const entries: Entry[] = [];

  for (const file of files) {
    const rel = relative(root, dirname(file));
    const parts = rel.split(sep);
    if (parts.length !== 2) continue; // Only 2nd-level entries

    const content = await readContextFile(file);
    entries.push({
      name: extractName(content),
      scope: rel,
      category: parts[0],
      purpose: extractPurpose(content),
      downstream: extractDeps(content, "Downstream"),
    });
  }

  const grouped = new Map<string, Entry[]>();
  for (const e of entries) {
    if (!grouped.has(e.category)) grouped.set(e.category, []);
    grouped.get(e.category)!.push(e);
  }

  let commit = "unknown";
  try {
    const proc = Bun.spawn(["git", "log", "-1", "--format=%h"], { cwd: root, stdout: "pipe" });
    commit = (await new Response(proc.stdout).text()).trim();
  } catch {}

  const date = new Date().toISOString().split("T")[0];
  const lines: string[] = [];
  lines.push(`# Briefing`);
  lines.push(`Generated: ${date} | Commit: ${commit}\n`);

  for (const [cat, items] of grouped) {
    lines.push(`## ${cat.charAt(0).toUpperCase() + cat.slice(1)} (${items.length})`);
    for (const item of items) lines.push(`${item.name}: ${item.purpose}`);
    lines.push("");
  }

  lines.push("## How Things Connect");
  for (const e of entries) {
    if (e.downstream.length > 0) lines.push(`${e.name} → ${e.downstream.join(", ")}`);
  }
  lines.push("");

  return lines.join("\n");
}
