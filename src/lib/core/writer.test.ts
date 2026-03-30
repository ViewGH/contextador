import { test, expect } from "bun:test";
import { planWrite } from "./writer";

test("planWrite identifies correct coordinator from touched paths", () => {
  const result = planWrite([
    "services/backend/pipelines/processing/handler.py",
    "services/backend/integrations/connector.py",
  ]);

  expect(result.coordinator).toBe("services/backend");
  expect(result.coordinatorRole).toBe("chair");
  expect(result.delegations.length).toBe(2);
});

test("planWrite uses headmaster for cross-category writes", () => {
  const result = planWrite([
    "services/backend/pipelines/processing/handler.py",
    "frontends/web-app/src/pages/Dashboard.tsx",
  ]);

  expect(result.coordinator).toBe("");
  expect(result.coordinatorRole).toBe("headmaster");
});
