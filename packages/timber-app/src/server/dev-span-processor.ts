/**
 * DevSpanProcessor — Custom OTEL SpanProcessor that drives dev log output.
 *
 * Collects completed spans per-request (correlated by trace ID). When the
 * root span (http.server.request) ends, all child spans are already collected
 * (child spans end before parent in OTEL). The processor formats the span
 * tree and writes it to stderr.
 *
 * This replaces the old DevLogEmitter/DevLogEvents system. OTEL spans are
 * now the single source of truth for dev logging — no more parallel event
 * systems that can drift.
 *
 * Design doc: 17-logging.md §"Dev Logging", 21-dev-server.md §"Dev Logging"
 */

import type { SpanProcessor, ReadableSpan } from '@opentelemetry/sdk-trace-base';
import type { Span, Context } from '@opentelemetry/api';
import {
  formatSpanTree,
  formatSpanSummary,
  formatJson,
  type DevLogMode,
  type DevLoggerConfig,
} from './dev-logger.js';

export class DevSpanProcessor implements SpanProcessor {
  private spansByTrace = new Map<string, ReadableSpan[]>();
  private mode: DevLogMode;
  private config: DevLoggerConfig;

  constructor(config: DevLoggerConfig) {
    this.config = config;
    this.mode = config.mode ?? 'tree';
  }

  onStart(_span: Span, _context: Context): void {
    // No action needed on span start — we collect on end.
  }

  onEnd(span: ReadableSpan): void {
    const traceId = span.spanContext().traceId;

    let spans = this.spansByTrace.get(traceId);
    if (!spans) {
      spans = [];
      this.spansByTrace.set(traceId, spans);
    }
    spans.push(span);

    // Root span signals request completion — all child spans are already
    // collected because OTEL ends child spans before parent spans.
    if (span.name === 'http.server.request') {
      const output = this.format(spans);
      if (output) {
        process.stderr.write(output);
      }
      this.spansByTrace.delete(traceId);
    }
  }

  private format(spans: ReadableSpan[]): string {
    if (this.mode === 'quiet') return '';
    if (this.mode === 'json') return formatJson(spans);
    if (this.mode === 'summary') return formatSpanSummary(spans, this.config);
    // Both 'tree' and 'verbose' use the tree formatter.
    // verbose will show additional detail (every component render) once
    // component-level spans are wired.
    return formatSpanTree(spans, this.config);
  }

  async shutdown(): Promise<void> {
    this.spansByTrace.clear();
  }

  async forceFlush(): Promise<void> {
    // Nothing to flush — output happens synchronously in onEnd.
  }
}
