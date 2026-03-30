import { test, expect } from "bun:test";
import { buildSummary, serializeSummary, isSummary, buildSummaryMessage } from "./summarizer";
import { buildBroadcast } from "./rooms";

function makeBroadcasts(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    content: buildBroadcast({
      query: `query ${i % 10}`,
      queryHash: `hash${i % 10}`,
      scopes: [`services/scope-${i % 5}`],
      pointers: {},
      tokensUsed: 100,
      agentId: "ctx-test",
      contextValidated: "abc",
    }),
  }));
}

test("buildSummary returns null below threshold", () => {
  const events = makeBroadcasts(10);
  expect(buildSummary(events)).toBeNull();
});

test("buildSummary creates summary at threshold", () => {
  const events = makeBroadcasts(60);
  const summary = buildSummary(events);
  expect(summary).not.toBeNull();
  expect(summary!.broadcastCount).toBe(60);
  expect(summary!.scopes.length).toBe(5);
});

test("buildSummary groups by scope with correct counts", () => {
  const events = makeBroadcasts(50);
  const summary = buildSummary(events)!;
  // 50 events across 5 scopes = 10 each
  for (const scope of summary.scopes) {
    expect(scope.queryCount).toBe(10);
    expect(scope.totalTokens).toBe(1000);
  }
});

test("serializeSummary produces readable output", () => {
  const summary = buildSummary(makeBroadcasts(50))!;
  const text = serializeSummary(summary);
  expect(text).toContain("50 broadcasts");
  expect(text).toContain("services/scope-0");
});

test("isSummary detects summary messages", () => {
  const summary = buildSummary(makeBroadcasts(50))!;
  const msg = buildSummaryMessage(summary);
  expect(isSummary({ content: msg })).toBe(true);
});
