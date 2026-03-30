import { test, expect } from "bun:test";
import { MatrixClient } from "./client";

test("MatrixClient constructs with server URL", () => {
  const client = new MatrixClient("http://localhost:6167");
  expect(client.serverUrl).toBe("http://localhost:6167");
  expect(client.isConnected()).toBe(false);
});

test("MatrixClient generates unique agent ID", () => {
  const client = new MatrixClient("http://localhost:6167");
  expect(client.agentId).toMatch(/^ctx-[a-z0-9]{4}$/);
});

test("MatrixClient accepts custom agent ID", () => {
  const client = new MatrixClient("http://localhost:6167", "ctx-test");
  expect(client.agentId).toBe("ctx-test");
});
