import { describe, it, expect } from 'vitest';
import { createStartupTimer, createNoopTimer } from '../packages/timber-app/src/utils/startup-timer';

describe('StartupTimer', () => {
  it('records a single phase', () => {
    const timer = createStartupTimer();
    timer.start('route-scan');
    // Simulate some work
    for (let i = 0; i < 1000; i++) Math.random();
    const duration = timer.end('route-scan');

    expect(duration).toBeGreaterThan(0);
    const phases = timer.getPhases();
    expect(phases).toHaveLength(1);
    expect(phases[0].name).toBe('route-scan');
    expect(phases[0].durationMs).toBe(duration);
  });

  it('records multiple phases in order', () => {
    const timer = createStartupTimer();
    timer.start('phase-a');
    timer.end('phase-a');
    timer.start('phase-b');
    timer.end('phase-b');

    const phases = timer.getPhases();
    expect(phases).toHaveLength(2);
    expect(phases[0].name).toBe('phase-a');
    expect(phases[1].name).toBe('phase-b');
    expect(phases[0].startMs).toBeLessThanOrEqual(phases[1].startMs);
  });

  it('returns 0 for end() without start()', () => {
    const timer = createStartupTimer();
    const duration = timer.end('unknown');
    expect(duration).toBe(0);
    expect(timer.getPhases()).toHaveLength(0);
  });

  it('computes totalMs spanning first to last phase', () => {
    const timer = createStartupTimer();
    timer.start('first');
    timer.end('first');
    timer.start('second');
    timer.end('second');

    const total = timer.totalMs();
    const phases = timer.getPhases();
    expect(total).toBeGreaterThanOrEqual(
      phases[0].durationMs + phases[1].durationMs
    );
  });

  it('totalMs returns 0 with no phases', () => {
    const timer = createStartupTimer();
    expect(timer.totalMs()).toBe(0);
  });

  it('formatSummary includes all phase names', () => {
    const timer = createStartupTimer();
    timer.start('config-load');
    timer.end('config-load');
    timer.start('route-scan');
    timer.end('route-scan');

    const summary = timer.formatSummary();
    expect(summary).toContain('[timber] startup timing:');
    expect(summary).toContain('config-load');
    expect(summary).toContain('route-scan');
    expect(summary).toContain('total');
    expect(summary).toContain('ms');
  });

  it('formatSummary returns message for empty timer', () => {
    const timer = createStartupTimer();
    expect(timer.formatSummary()).toBe('No phases recorded.');
  });
});

describe('NoopTimer', () => {
  it('all methods are no-ops', () => {
    const timer = createNoopTimer();
    timer.start('anything');
    expect(timer.end('anything')).toBe(0);
    expect(timer.getPhases()).toEqual([]);
    expect(timer.totalMs()).toBe(0);
    expect(timer.formatSummary()).toBe('');
  });
});
