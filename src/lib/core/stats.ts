import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";

export interface Stats {
  queriesServed: number;
  cacheHits: number;
  feedbackReports: number;
  tokensUsedInit: number;
  tokensUsedQueries: number;
  sweepsRun: number;
  firstUsed: string;
  lastUsed: string;
}

const EMPTY_STATS: Stats = {
  queriesServed: 0,
  cacheHits: 0,
  feedbackReports: 0,
  tokensUsedInit: 0,
  tokensUsedQueries: 0,
  sweepsRun: 0,
  firstUsed: "",
  lastUsed: "",
};

const AVG_MANUAL_EXPLORATION_TOKENS = 25000;
const AVG_CACHE_SAVINGS_TOKENS = 25000;

export async function loadStats(root: string): Promise<Stats> {
  try {
    const raw = await readFile(join(root, ".contextador", "stats.json"), "utf-8");
    return { ...EMPTY_STATS, ...JSON.parse(raw) };
  } catch {
    return { ...EMPTY_STATS };
  }
}

export async function saveStats(root: string, stats: Stats): Promise<void> {
  await mkdir(join(root, ".contextador"), { recursive: true });
  await writeFile(join(root, ".contextador", "stats.json"), JSON.stringify(stats, null, 2) + "\n", "utf-8");
}

export async function recordQuery(root: string, tokensUsed: number, cacheHit: boolean): Promise<void> {
  const stats = await loadStats(root);
  stats.queriesServed++;
  if (cacheHit) stats.cacheHits++;
  stats.tokensUsedQueries += tokensUsed;
  stats.lastUsed = new Date().toISOString();
  if (!stats.firstUsed) stats.firstUsed = stats.lastUsed;
  await saveStats(root, stats);
}

export async function recordFeedback(root: string): Promise<void> {
  const stats = await loadStats(root);
  stats.feedbackReports++;
  stats.lastUsed = new Date().toISOString();
  await saveStats(root, stats);
}

export async function recordInit(root: string, tokensUsed: number): Promise<void> {
  const stats = await loadStats(root);
  stats.tokensUsedInit += tokensUsed;
  stats.lastUsed = new Date().toISOString();
  if (!stats.firstUsed) stats.firstUsed = stats.lastUsed;
  await saveStats(root, stats);
}

export async function recordSweep(root: string): Promise<void> {
  const stats = await loadStats(root);
  stats.sweepsRun++;
  stats.lastUsed = new Date().toISOString();
  await saveStats(root, stats);
}

export function estimateTokensSaved(stats: Stats): { saved: number; used: number; net: number } {
  const localQueries = stats.queriesServed - stats.cacheHits;
  const savedFromLocal = localQueries * AVG_MANUAL_EXPLORATION_TOKENS;
  const savedFromCache = stats.cacheHits * AVG_CACHE_SAVINGS_TOKENS;
  const totalSaved = savedFromLocal + savedFromCache;
  const totalUsed = stats.tokensUsedInit + stats.tokensUsedQueries;
  return {
    saved: totalSaved,
    used: totalUsed,
    net: totalSaved - totalUsed,
  };
}

export function formatStats(stats: Stats, contextFileCount: number): string {
  const est = estimateTokensSaved(stats);
  const cacheRate = stats.queriesServed > 0 ? Math.round((stats.cacheHits / stats.queriesServed) * 100) : 0;

  const lines: string[] = [];
  lines.push(`  Queries served          ${stats.queriesServed}`);
  lines.push(`  Cache hits (Mainframe)  ${stats.cacheHits}${stats.queriesServed > 0 ? `  (${cacheRate}%)` : ""}`);
  lines.push(`  Feedback reports        ${stats.feedbackReports}`);
  lines.push(`  Sweeps run              ${stats.sweepsRun}`);
  lines.push("");
  lines.push(`  Tokens saved (est.)     ~${est.saved.toLocaleString()}`);
  lines.push(`  Tokens used (init)      ~${stats.tokensUsedInit.toLocaleString()}`);
  lines.push(`  Tokens used (queries)   ~${stats.tokensUsedQueries.toLocaleString()}`);
  lines.push(`  Net savings             ~${est.net.toLocaleString()}`);
  lines.push("");
  lines.push(`  CONTEXT.md files        ${contextFileCount}`);
  if (stats.firstUsed) lines.push(`  First used              ${stats.firstUsed.slice(0, 10)}`);
  if (stats.lastUsed) lines.push(`  Last used               ${stats.lastUsed.slice(0, 10)}`);

  return lines.join("\n");
}
