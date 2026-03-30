import { test, expect } from "bun:test";
import { BudgetTracker } from "./budget";

test("tracks local spend", () => {
  const bt = new BudgetTracker({ dailyLimit: 10000 });
  expect(bt.canSpend(5000)).toBe(true);
  bt.record(5000);
  expect(bt.canSpend(6000)).toBe(false);
  expect(bt.canSpend(5000)).toBe(true);
});

test("respects room budget", () => {
  const bt = new BudgetTracker({ dailyLimit: 100000 });
  bt.updateRoomBudget({ hourly_limit: 1000, used_this_hour: 900, paused: false });
  expect(bt.canSpend(200)).toBe(false);
  expect(bt.canSpend(50)).toBe(true);
});

test("respects pause", () => {
  const bt = new BudgetTracker({ dailyLimit: 100000 });
  bt.updateRoomBudget({ hourly_limit: 100000, used_this_hour: 0, paused: true });
  expect(bt.canSpend(1)).toBe(false);
  expect(bt.canRead()).toBe(true);
});

test("kill blocks everything including reads", () => {
  const bt = new BudgetTracker({ dailyLimit: 100000 });
  bt.kill();
  expect(bt.canSpend(1)).toBe(false);
  expect(bt.canRead()).toBe(false);
  bt.resume();
  expect(bt.canRead()).toBe(true);
});

test("alerts at 80%", () => {
  const bt = new BudgetTracker({ dailyLimit: 10000 });
  bt.record(7000);
  expect(bt.shouldAlert()).toBe(false);
  bt.record(1100);
  expect(bt.shouldAlert()).toBe(true);
  expect(bt.shouldAlert()).toBe(false); // only once
});
