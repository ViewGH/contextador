import { test, expect } from "bun:test";
import { findMatchingBroadcast } from "./dedup";
import { buildBroadcast } from "./rooms";

test("finds matching hash", () => {
  const events = [
    { content: buildBroadcast({ query: "auth flow", queryHash: "abc123", scopes: ["s/sentinel"], pointers: { p: 1 }, tokensUsed: 100, agentId: "ctx-1", contextValidated: "sha1" }) },
    { content: buildBroadcast({ query: "eob pipeline", queryHash: "def456", scopes: ["s/backend"], pointers: { p: 2 }, tokensUsed: 200, agentId: "ctx-2", contextValidated: "sha2" }) },
  ];
  const match = findMatchingBroadcast(events, "abc123", 24);
  expect(match).not.toBeNull();
  expect(match?.query).toBe("auth flow");
});

test("returns null for no match", () => {
  const events = [
    { content: buildBroadcast({ query: "test", queryHash: "xyz", scopes: [], pointers: {}, tokensUsed: 0, agentId: "x", contextValidated: "" }) },
  ];
  expect(findMatchingBroadcast(events, "nomatch", 24)).toBeNull();
});

test("skips old broadcasts", () => {
  const old = buildBroadcast({ query: "old", queryHash: "abc", scopes: [], pointers: {}, tokensUsed: 0, agentId: "x", contextValidated: "" });
  old["m.ctx"].data.timestamp = "2020-01-01T00:00:00Z";
  expect(findMatchingBroadcast([{ content: old }], "abc", 24)).toBeNull();
});
