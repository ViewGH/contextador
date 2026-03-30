import { describe, expect, it } from "bun:test";
import { extractPointers, serializePointers } from "./pointers";

const FULL_CONTEXT = `---
last_validated: abc1234
validated_at: 2026-03-25
---
# Browser Relay

## Purpose
Chrome extension for browser automation. Attaches to active tab via CDP.

## Dependencies
- **Upstream:** User clicks extension icon
- **Downstream:** Local bridge server, BU model server
- **Shared:** None

## Key Files
- \`manifest.json\` — MV3 manifest with debugger permissions
- \`background.js\` — Service worker for CDP commands
- \`offscreen.js\` — Persistent WebSocket relay

## API Surface
- \`chrome.debugger.attach\` — attaches to target tab
- \`ws://localhost:9090\` — bridge WebSocket endpoint

## Tests
- \`test/relay.test.ts\` — unit tests for relay logic
- \`test/e2e.test.ts\` — end-to-end browser tests
`;

const MINIMAL_CONTEXT = `# Tiny Module

Just a small utility.
`;

describe("extractPointers", () => {
  it("extracts all sections from a complete CONTEXT.md", () => {
    const p = extractPointers(FULL_CONTEXT, "tools/browser-relay");

    expect(p.scope).toBe("tools/browser-relay");
    expect(p.purpose).toBe(
      "Chrome extension for browser automation. Attaches to active tab via CDP."
    );

    expect(p.keyFiles).toEqual([
      { name: "manifest.json", description: "MV3 manifest with debugger permissions" },
      { name: "background.js", description: "Service worker for CDP commands" },
      { name: "offscreen.js", description: "Persistent WebSocket relay" },
    ]);

    expect(p.dependencies.upstream).toEqual(["User clicks extension icon"]);
    expect(p.dependencies.downstream).toEqual([
      "Local bridge server",
      "BU model server",
    ]);
    expect(p.dependencies.shared).toEqual([]);

    expect(p.apiSurface).toEqual([
      "`chrome.debugger.attach` — attaches to target tab",
      "`ws://localhost:9090` — bridge WebSocket endpoint",
    ]);

    expect(p.tests).toEqual([
      "`test/relay.test.ts` — unit tests for relay logic",
      "`test/e2e.test.ts` — end-to-end browser tests",
    ]);
  });

  it("handles missing sections gracefully", () => {
    const p = extractPointers(MINIMAL_CONTEXT, "tools/tiny");

    expect(p.scope).toBe("tools/tiny");
    expect(p.purpose).toBe("Just a small utility.");
    expect(p.keyFiles).toEqual([]);
    expect(p.dependencies).toEqual({
      upstream: [],
      downstream: [],
      shared: [],
    });
    expect(p.apiSurface).toEqual([]);
    expect(p.tests).toEqual([]);
  });

  it("handles content with no frontmatter", () => {
    const raw = `# No Frontmatter

## Purpose
Does stuff.

## Key Files
- \`index.ts\` — entry point
`;
    const p = extractPointers(raw, "lib/nofm");
    expect(p.purpose).toBe("Does stuff.");
    expect(p.keyFiles).toEqual([{ name: "index.ts", description: "entry point" }]);
  });
});

describe("serializePointers", () => {
  it("produces compact text block", () => {
    const p = extractPointers(FULL_CONTEXT, "tools/browser-relay");
    const text = serializePointers(p);

    expect(text).toContain("[tools/browser-relay]");
    expect(text).toContain("Purpose: Chrome extension");
    expect(text).toContain("Key Files:");
    expect(text).toContain("  manifest.json — MV3 manifest with debugger permissions");
    expect(text).toContain("Dependencies:");
    expect(text).toContain("  up: User clicks extension icon");
    expect(text).toContain("  down: Local bridge server, BU model server");
    expect(text).toContain("API Surface:");
    expect(text).toContain("Tests:");
  });

  it("omits empty sections", () => {
    const p = extractPointers(MINIMAL_CONTEXT, "tools/tiny");
    const text = serializePointers(p);

    expect(text).toContain("[tools/tiny]");
    expect(text).toContain("Purpose: Just a small utility.");
    expect(text).not.toContain("Key Files:");
    expect(text).not.toContain("Dependencies:");
    expect(text).not.toContain("API Surface:");
    expect(text).not.toContain("Tests:");
  });
});
