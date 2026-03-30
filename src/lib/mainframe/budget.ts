/**
 * Budget tracker for the mainframe multi-agent sharing layer.
 * Tracks daily and hourly token spend to prevent runaway costs.
 */

export interface BudgetTrackerOptions {
  dailyLimit: number;
}

interface RoomBudget {
  hourly_limit: number;
  used_this_hour: number;
  paused: boolean;
}

export class BudgetTracker {
  private dailyLimit: number;
  private usedToday = 0;
  private currentDate: string;
  private roomBudget: RoomBudget | null = null;
  private killed = false;
  private alertFired = false;

  constructor(opts: BudgetTrackerOptions) {
    this.dailyLimit = opts.dailyLimit;
    this.currentDate = this.today();
  }

  canSpend(tokens: number): boolean {
    this.maybeReset();
    if (this.killed) return false;
    if (this.roomBudget?.paused) return false;
    if (this.usedToday + tokens > this.dailyLimit) return false;
    if (
      this.roomBudget &&
      this.roomBudget.used_this_hour + tokens > this.roomBudget.hourly_limit
    ) {
      return false;
    }
    return true;
  }

  canRead(): boolean {
    this.maybeReset();
    return !this.killed;
  }

  record(tokens: number): void {
    this.maybeReset();
    this.usedToday += tokens;
  }

  updateRoomBudget(room: RoomBudget): void {
    this.roomBudget = { ...room };
  }

  kill(): void {
    this.killed = true;
  }

  resume(): void {
    this.killed = false;
  }

  shouldAlert(): boolean {
    this.maybeReset();
    if (this.alertFired) return false;
    if (this.usedToday >= this.dailyLimit * 0.8) {
      this.alertFired = true;
      return true;
    }
    return false;
  }

  getStatus(): {
    usedToday: number;
    dailyLimit: number;
    paused: boolean;
    killed: boolean;
  } {
    this.maybeReset();
    return {
      usedToday: this.usedToday,
      dailyLimit: this.dailyLimit,
      paused: this.roomBudget?.paused ?? false,
      killed: this.killed,
    };
  }

  private maybeReset(): void {
    const now = this.today();
    if (now !== this.currentDate) {
      this.usedToday = 0;
      this.alertFired = false;
      this.currentDate = now;
    }
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }
}
