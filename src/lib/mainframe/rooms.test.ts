import { test, expect } from "bun:test";
import { buildBroadcast, buildRequest, parseBroadcast, isBroadcast, isRequest } from "./rooms";

test("buildBroadcast creates correct structure", () => {
  const msg = buildBroadcast({ query: "auth flow", queryHash: "a3f2c1", scopes: ["services/sentinel"], pointers: { purpose: "JWT auth" }, tokensUsed: 480, agentId: "ctx-a7f3", contextValidated: "abc1234" });
  expect(msg.msgtype).toBe("m.text");
  expect(msg["m.ctx"].type).toBe("broadcast");
  expect(msg["m.ctx"].data.query_hash).toBe("a3f2c1");
});

test("isBroadcast detects broadcasts", () => {
  const msg = buildBroadcast({ query: "test", queryHash: "abc", scopes: [], pointers: {}, tokensUsed: 0, agentId: "x", contextValidated: "" });
  expect(isBroadcast({ content: msg })).toBe(true);
  expect(isRequest({ content: msg })).toBe(false);
});

test("parseBroadcast extracts data", () => {
  const msg = buildBroadcast({ query: "test query", queryHash: "abc", scopes: ["a/b"], pointers: { x: 1 }, tokensUsed: 100, agentId: "ctx-1", contextValidated: "sha" });
  const parsed = parseBroadcast({ content: msg });
  expect(parsed?.query).toBe("test query");
  expect(parsed?.queryHash).toBe("abc");
});

test("buildRequest creates correct structure", () => {
  const msg = buildRequest({ to: "ctx-b8e2", task: "generate CONTEXT.md", priority: "normal" });
  expect(msg["m.ctx"].type).toBe("request");
  expect(msg["m.ctx"].data.to).toBe("ctx-b8e2");
});
