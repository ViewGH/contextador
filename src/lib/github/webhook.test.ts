import { describe, expect, test } from "bun:test";
import { getWebhookDefaults } from "./webhook";

describe("webhook config", () => {
  test("returns sensible defaults", () => {
    const defaults = getWebhookDefaults();
    expect(defaults.enabled).toBe(false);
    expect(defaults.port).toBe(9471);
    expect(defaults.secret).toBe("");
    expect(defaults.branches).toEqual(["main", "master"]);
  });
});
