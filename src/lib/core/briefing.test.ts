import { test, expect } from "bun:test";
import { generateBriefing } from "./briefing";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";

const TEST_ROOT = "/tmp/contextador-briefing-test";

test("generateBriefing creates flat summary", async () => {
  await mkdir(join(TEST_ROOT, "services/backend"), { recursive: true });
  await mkdir(join(TEST_ROOT, "frontends/web-app"), { recursive: true });
  await writeFile(join(TEST_ROOT, "services/backend/CONTEXT.md"), "---\nlast_validated: abc\nvalidated_at: 2026-03-25\n---\n# Backend\n\n## Purpose\nProcesses incoming documents.\n\n## Dependencies\n- **Downstream:** Database, Cache");
  await writeFile(join(TEST_ROOT, "frontends/web-app/CONTEXT.md"), "---\nlast_validated: def\nvalidated_at: 2026-03-25\n---\n# Web App\n\n## Purpose\nMain user interface.\n\n## Dependencies\n- **Downstream:** Backend API");

  const briefing = await generateBriefing(TEST_ROOT);
  expect(briefing).toContain("Backend");
  expect(briefing).toContain("Web App");
  expect(briefing).toContain("How Things Connect");
  expect(briefing.split("\n").length).toBeLessThan(200);

  await rm(TEST_ROOT, { recursive: true });
});
