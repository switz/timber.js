/**
 * Startup timer — records named phases with their durations.
 *
 * Used by the plugin system to instrument cold start and report a
 * timing breakdown in dev mode. Zero overhead in production (disabled).
 *
 * See design/18-build-system.md, TIM-155.
 */

import { performance } from 'node:perf_hooks';

export interface PhaseRecord {
  name: string;
  startMs: number;
  durationMs: number;
}

export interface StartupTimer {
  /** Mark the beginning of a named phase. */
  start(phase: string): void;
  /** Mark the end of a named phase. Returns duration in ms. */
  end(phase: string): number;
  /** Get all completed phase records, ordered by start time. */
  getPhases(): PhaseRecord[];
  /** Total elapsed time from first start() to last end(). */
  totalMs(): number;
  /** Format a human-readable summary string. */
  formatSummary(): string;
}

/**
 * Create a startup timer that records phase durations.
 */
export function createStartupTimer(): StartupTimer {
  const pending = new Map<string, number>();
  const phases: PhaseRecord[] = [];

  return {
    start(phase: string): void {
      pending.set(phase, performance.now());
    },

    end(phase: string): number {
      const startMs = pending.get(phase);
      if (startMs === undefined) {
        return 0;
      }
      pending.delete(phase);
      const durationMs = performance.now() - startMs;
      phases.push({ name: phase, startMs, durationMs });
      return durationMs;
    },

    getPhases(): PhaseRecord[] {
      return [...phases].sort((a, b) => a.startMs - b.startMs);
    },

    totalMs(): number {
      if (phases.length === 0) return 0;
      const sorted = this.getPhases();
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      return last.startMs + last.durationMs - first.startMs;
    },

    formatSummary(): string {
      const sorted = this.getPhases();
      if (sorted.length === 0) return 'No phases recorded.';

      const lines = sorted.map((p) => {
        const ms = p.durationMs.toFixed(1);
        return `  ${p.name.padEnd(30)} ${ms.padStart(8)}ms`;
      });

      const total = this.totalMs().toFixed(1);
      lines.push(`  ${'total'.padEnd(30)} ${total.padStart(8)}ms`);

      return ['[timber] startup timing:', ...lines].join('\n');
    },
  };
}

/**
 * No-op timer for production builds — all methods are empty.
 */
export function createNoopTimer(): StartupTimer {
  return {
    start() {},
    end() {
      return 0;
    },
    getPhases() {
      return [];
    },
    totalMs() {
      return 0;
    },
    formatSummary() {
      return '';
    },
  };
}
