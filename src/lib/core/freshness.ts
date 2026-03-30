import { readFile, writeFile } from "fs/promises";
import { dirname, relative, join } from "path";

const STALE_COMMIT_THRESHOLD = 3;
const STALE_DAYS_THRESHOLD = 3;

export interface FreshnessInfo {
  lastValidated: string | null;  // commit SHA
  validatedAt: string | null;    // ISO date
}

export interface FreshnessCheck {
  fresh: boolean;
  stale: boolean;
  staleSeverity: "none" | "minor" | "major";
  staleSince: string;  // human-readable description
  lastValidated: string | null;
  latestCommit: string | null;
  commitsBehind: number;
  daysBehind: number;
}

/** Extract frontmatter from a CONTEXT.md file */
export function parseFrontmatter(content: string): { frontmatter: FreshnessInfo; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return {
      frontmatter: { lastValidated: null, validatedAt: null },
      body: content,
    };
  }

  const fmBlock = match[1];
  const body = match[2];
  let lastValidated: string | null = null;
  let validatedAt: string | null = null;

  for (const line of fmBlock.split("\n")) {
    const [key, ...rest] = line.split(":");
    const value = rest.join(":").trim();
    if (key.trim() === "last_validated") lastValidated = value;
    if (key.trim() === "validated_at") validatedAt = value;
  }

  return { frontmatter: { lastValidated, validatedAt }, body };
}

/** Build frontmatter string */
export function buildFrontmatter(sha: string, date: string): string {
  return `---\nlast_validated: ${sha}\nvalidated_at: ${date}\n---\n`;
}

/** Get the latest commit SHA touching a directory */
export async function getLatestCommit(root: string, scopePath: string): Promise<string | null> {
  const dir = scopePath ? join(root, scopePath) : root;
  try {
    const proc = Bun.spawn(["git", "log", "-1", "--format=%H", "--", dir], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await new Response(proc.stdout).text();
    await proc.exited;
    const sha = output.trim();
    return sha || null;
  } catch {
    return null;
  }
}

/** Get the number of commits between two SHAs touching a scope */
export async function getCommitsBetween(root: string, scopePath: string, fromSha: string): Promise<number> {
  const dir = scopePath ? join(root, scopePath) : root;
  try {
    const proc = Bun.spawn(["git", "rev-list", "--count", `${fromSha}..HEAD`, "--", dir], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await new Response(proc.stdout).text();
    await proc.exited;
    return parseInt(output.trim(), 10) || 0;
  } catch {
    return 0;
  }
}

/** Calculate days between a date string and now */
export function daysSince(dateStr: string): number {
  const then = new Date(dateStr);
  const now = new Date();
  return Math.floor((now.getTime() - then.getTime()) / (1000 * 60 * 60 * 24));
}

/** Check freshness of a CONTEXT.md file */
export async function checkFreshness(
  root: string,
  contextPath: string,
): Promise<FreshnessCheck> {
  const content = await readFile(contextPath, "utf-8").catch(() => "");
  const { frontmatter } = parseFrontmatter(content);
  const scopePath = relative(root, dirname(contextPath));
  const latestCommit = await getLatestCommit(root, scopePath);

  // No frontmatter — never validated
  if (!frontmatter.lastValidated) {
    return {
      fresh: false,
      stale: true,
      staleSeverity: "major",
      staleSince: "never validated",
      lastValidated: null,
      latestCommit,
      commitsBehind: -1,
      daysBehind: -1,
    };
  }

  // Same commit — fresh
  if (frontmatter.lastValidated === latestCommit?.slice(0, frontmatter.lastValidated.length)) {
    return {
      fresh: true,
      stale: false,
      staleSeverity: "none",
      staleSince: "up to date",
      lastValidated: frontmatter.lastValidated,
      latestCommit,
      commitsBehind: 0,
      daysBehind: 0,
    };
  }

  // Different commit — check how stale
  const commitsBehind = await getCommitsBetween(root, scopePath, frontmatter.lastValidated);
  const daysBehind = frontmatter.validatedAt ? daysSince(frontmatter.validatedAt) : -1;

  const isMajor = commitsBehind >= STALE_COMMIT_THRESHOLD || daysBehind >= STALE_DAYS_THRESHOLD;

  const parts: string[] = [];
  if (commitsBehind > 0) parts.push(`${commitsBehind} commit${commitsBehind > 1 ? "s" : ""} behind`);
  if (daysBehind > 0) parts.push(`${daysBehind} day${daysBehind > 1 ? "s" : ""} old`);

  return {
    fresh: false,
    stale: true,
    staleSeverity: isMajor ? "major" : "minor",
    staleSince: parts.join(", ") || "unknown drift",
    lastValidated: frontmatter.lastValidated,
    latestCommit,
    commitsBehind,
    daysBehind,
  };
}

/** Stamp a CONTEXT.md file with the current commit SHA */
export async function stampContextFile(
  root: string,
  contextPath: string,
): Promise<void> {
  const content = await readFile(contextPath, "utf-8").catch(() => "");
  const { body } = parseFrontmatter(content);
  const scopePath = relative(root, dirname(contextPath));
  const latestCommit = await getLatestCommit(root, scopePath);

  if (!latestCommit) return;

  const date = new Date().toISOString().split("T")[0];
  const shortSha = latestCommit.slice(0, 7);
  const newContent = buildFrontmatter(shortSha, date) + body;
  await writeFile(contextPath, newContent, "utf-8");
}
