import { readFile, writeFile } from "fs/promises";
import { parseFrontmatter } from "./freshness";

export interface HitEntry {
  query_hash: string;
  timestamp: string;
}

export function hashKeywords(keywords: string[]): string {
  const sorted = [...keywords].sort().join("|");
  let hash = 0;
  for (let i = 0; i < sorted.length; i++) {
    const char = sorted.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(16).slice(0, 6);
}

export function parseHitLog(content: string): HitEntry[] {
  const { frontmatter } = parseFrontmatter(content);
  if (!(frontmatter as any).hitLog) return [];
  return (frontmatter as any).hitLog;
}

export async function recordHit(contextPath: string, queryHash: string): Promise<void> {
  const content = await readFile(contextPath, "utf-8").catch(() => "");
  const { body } = parseFrontmatter(content);

  // Parse ALL existing frontmatter fields (not just the ones parseFrontmatter knows about)
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?/);
  const existingFields = new Map<string, string>();
  let existingHitLog: HitEntry[] = [];

  if (fmMatch) {
    let currentKey = "";
    let inHitLog = false;
    let currentEntry: Partial<HitEntry> = {};

    for (const line of fmMatch[1].split("\n")) {
      if (line.startsWith("hit_log:")) {
        inHitLog = true;
        continue;
      }
      if (inHitLog) {
        const hashMatch = line.match(/^\s+-\s*query_hash:\s*(.+)/);
        const tsMatch = line.match(/^\s+timestamp:\s*(.+)/);
        if (hashMatch) {
          if (currentEntry.query_hash) {
            existingHitLog.push(currentEntry as HitEntry);
          }
          currentEntry = { query_hash: hashMatch[1].trim() };
        } else if (tsMatch) {
          currentEntry.timestamp = tsMatch[1].trim();
        } else if (!line.startsWith("  ")) {
          // End of hit_log block
          if (currentEntry.query_hash) {
            existingHitLog.push(currentEntry as HitEntry);
          }
          inHitLog = false;
          currentEntry = {};
          // Parse this line as a regular field
          const fieldMatch = line.match(/^(\S+):\s*(.*)/);
          if (fieldMatch) existingFields.set(fieldMatch[1], fieldMatch[2].trim());
        }
      } else {
        const fieldMatch = line.match(/^(\S+):\s*(.*)/);
        if (fieldMatch) existingFields.set(fieldMatch[1], fieldMatch[2].trim());
      }
    }
    if (currentEntry.query_hash) {
      existingHitLog.push(currentEntry as HitEntry);
    }
  }

  // Add the new hit
  existingHitLog.push({ query_hash: queryHash, timestamp: new Date().toISOString().split("T")[0] });

  // Rebuild frontmatter preserving ALL fields
  const lines = ["---"];
  // Write known fields first
  lines.push(`last_validated: ${existingFields.get("last_validated") ?? "unknown"}`);
  existingFields.delete("last_validated");
  lines.push(`validated_at: ${existingFields.get("validated_at") ?? new Date().toISOString().split("T")[0]}`);
  existingFields.delete("validated_at");

  // Write remaining fields (feedback_failures, feedback_successes, etc.)
  for (const [key, value] of existingFields) {
    lines.push(`${key}: ${value}`);
  }

  // Write hit log
  lines.push("hit_log:");
  for (const e of existingHitLog) {
    lines.push(`  - query_hash: ${e.query_hash}`);
    lines.push(`    timestamp: ${e.timestamp}`);
  }

  lines.push("---\n");
  await writeFile(contextPath, lines.join("\n") + body, "utf-8");
}

export function pruneHitLog(entries: HitEntry[], maxEntries: number = 50, maxDays: number = 30): HitEntry[] {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - maxDays);
  const cutoffStr = cutoff.toISOString().split("T")[0];
  const fresh = entries.filter(e => e.timestamp >= cutoffStr);
  if (fresh.length <= maxEntries) return fresh;
  return fresh.slice(fresh.length - maxEntries);
}

export function hasHit(hitLog: HitEntry[], queryHash: string): boolean {
  return hitLog.some(e => e.query_hash === queryHash);
}
