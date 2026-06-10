import { SourceHealth } from '../types';

class HealthTracker {
  private stats: Map<string, { success: number; fail: number; totalMs: number; lastChecked: Date }> = new Map();

  record(sourceName: string, success: boolean, responseMs: number): void {
    const e = this.stats.get(sourceName) || { success: 0, fail: 0, totalMs: 0, lastChecked: new Date() };
    if (success) e.success++; else e.fail++;
    e.totalMs += responseMs;
    e.lastChecked = new Date();
    this.stats.set(sourceName, e);
  }

  getHealth(sourceName: string): SourceHealth {
    const s = this.stats.get(sourceName);
    if (!s) return { name: sourceName, successRate: 1, avgResponseMs: 0, lastChecked: new Date(), isAlive: true };
    const total = s.success + s.fail;
    const successRate = total === 0 ? 1 : s.success / total;
    return { name: sourceName, successRate, avgResponseMs: total === 0 ? 0 : s.totalMs / total, lastChecked: s.lastChecked, isAlive: successRate > 0.1 };
  }

  getAllHealth(): SourceHealth[] {
    return [...this.stats.keys()].map((name: string) => this.getHealth(name));
  }

  isDead(sourceName: string): boolean {
    const s = this.stats.get(sourceName);
    if (!s) return false;
    const total = s.success + s.fail;
    return total >= 5 && !this.getHealth(sourceName).isAlive;
  }
}

export const healthTracker = new HealthTracker();
