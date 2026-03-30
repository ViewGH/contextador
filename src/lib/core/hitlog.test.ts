import { test, expect } from "bun:test";
import { hashKeywords, pruneHitLog } from "./hitlog";

test("hashKeywords produces consistent hash", () => {
  const h1 = hashKeywords(["eob", "processing", "failed"]);
  const h2 = hashKeywords(["eob", "processing", "failed"]);
  expect(h1).toBe(h2);
});

test("hashKeywords is order-independent", () => {
  const h1 = hashKeywords(["eob", "processing"]);
  const h2 = hashKeywords(["processing", "eob"]);
  expect(h1).toBe(h2);
});

test("hashKeywords different for different keywords", () => {
  const h1 = hashKeywords(["eob", "processing"]);
  const h2 = hashKeywords(["sentinel", "gateway"]);
  expect(h1).not.toBe(h2);
});

test("pruneHitLog removes entries beyond max", () => {
  const entries = Array.from({ length: 60 }, (_, i) => ({
    query_hash: `hash${i}`,
    timestamp: "2026-03-25",
  }));
  expect(pruneHitLog(entries, 50).length).toBe(50);
});

test("pruneHitLog removes old entries", () => {
  const entries = [
    { query_hash: "old", timestamp: "2025-01-01" },
    { query_hash: "new", timestamp: "2026-03-25" },
  ];
  expect(pruneHitLog(entries, 50, 30).length).toBe(1);
});
