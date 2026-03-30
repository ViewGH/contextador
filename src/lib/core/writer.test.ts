import { test, expect } from "bun:test";
import { planWrite } from "./writer";

test("planWrite identifies correct coordinator from touched paths", () => {
  const result = planWrite([
    "services/backend/pipelines/eob/handler.py",
    "services/backend/integrations/opendental.py",
  ]);

  expect(result.coordinator).toBe("services/backend");
  expect(result.coordinatorRole).toBe("chair");
  expect(result.delegations.length).toBe(2);
});

test("planWrite uses headmaster for cross-category writes", () => {
  const result = planWrite([
    "services/backend/pipelines/eob/handler.py",
    "frontends/web-app/src/pages/Claims.tsx",
  ]);

  expect(result.coordinator).toBe("");
  expect(result.coordinatorRole).toBe("headmaster");
});
