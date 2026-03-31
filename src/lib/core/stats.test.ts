import { test, expect } from "bun:test";
import { loadStats, saveStats, recordQuery, recordFeedback, estimateTokensSaved } from "./stats";
import { mkdir, rm } from "fs/promises";
import { join } from "path";

const TEST_ROOT = "/tmp/contextador-stats-test";

test("loadStats returns empty stats for new project", async () => {
  await mkdir(join(TEST_ROOT, ".contextador"), { recursive: true });
  const stats = await loadStats(TEST_ROOT);
  expect(stats.queriesServed).toBe(0);
  expect(stats.cacheHits).toBe(0);
  await rm(TEST_ROOT, { recursive: true });
});

test("recordQuery increments counters", async () => {
  await mkdir(join(TEST_ROOT, ".contextador"), { recursive: true });
  await recordQuery(TEST_ROOT, 500, false);
  await recordQuery(TEST_ROOT, 300, true);
  const stats = await loadStats(TEST_ROOT);
  expect(stats.queriesServed).toBe(2);
  expect(stats.cacheHits).toBe(1);
  expect(stats.tokensUsedQueries).toBe(800);
  await rm(TEST_ROOT, { recursive: true });
});

test("recordFeedback increments counter", async () => {
  await mkdir(join(TEST_ROOT, ".contextador"), { recursive: true });
  await recordFeedback(TEST_ROOT);
  await recordFeedback(TEST_ROOT);
  const stats = await loadStats(TEST_ROOT);
  expect(stats.feedbackReports).toBe(2);
  await rm(TEST_ROOT, { recursive: true });
});

test("estimateTokensSaved calculates correctly", () => {
  const stats = {
    queriesServed: 10,
    cacheHits: 3,
    feedbackReports: 1,
    tokensUsedInit: 5000,
    tokensUsedQueries: 3000,
    sweepsRun: 2,
    firstUsed: "2026-03-30",
    lastUsed: "2026-03-31",
  };
  const est = estimateTokensSaved(stats);
  // 7 local queries * 25000 + 3 cache hits * 25000 = 175000 + 75000 = 250000
  expect(est.saved).toBe(250000);
  expect(est.used).toBe(8000);
  expect(est.net).toBe(242000);
});
