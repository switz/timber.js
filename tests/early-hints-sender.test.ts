/**
 * Tests for the 103 Early Hints sender — ALS bridge for platform adapters.
 *
 * Verifies that:
 * - sendEarlyHints103() calls the sender when ALS is populated
 * - sendEarlyHints103() is a no-op when no sender is installed
 * - sendEarlyHints103() is a no-op for empty link arrays
 * - sendEarlyHints103() catches and ignores sender errors
 * - runWithEarlyHintsSender() correctly scopes the sender per-request
 *
 * Task: TIM-311
 */

import { describe, it, expect, vi } from 'vitest';
import {
  runWithEarlyHintsSender,
  sendEarlyHints103,
} from '../packages/timber-app/src/server/early-hints-sender';

describe('early hints sender', () => {
  it('calls sender when installed via ALS', () => {
    const sender = vi.fn();
    const links = ['</style.css>; rel=preload; as=style'];

    runWithEarlyHintsSender(sender, () => {
      sendEarlyHints103(links);
    });

    expect(sender).toHaveBeenCalledOnce();
    expect(sender).toHaveBeenCalledWith(links);
  });

  it('is a no-op when no sender is installed', () => {
    // Should not throw
    sendEarlyHints103(['</style.css>; rel=preload; as=style']);
  });

  it('is a no-op for empty link arrays', () => {
    const sender = vi.fn();

    runWithEarlyHintsSender(sender, () => {
      sendEarlyHints103([]);
    });

    expect(sender).not.toHaveBeenCalled();
  });

  it('catches and ignores sender errors', () => {
    const sender = vi.fn(() => {
      throw new Error('writeEarlyHints failed');
    });

    // Should not throw
    runWithEarlyHintsSender(sender, () => {
      sendEarlyHints103(['</style.css>; rel=preload; as=style']);
    });

    expect(sender).toHaveBeenCalledOnce();
  });

  it('scopes sender per-request with nested ALS', async () => {
    const sender1 = vi.fn();
    const sender2 = vi.fn();
    const links1 = ['</a.css>; rel=preload; as=style'];
    const links2 = ['</b.css>; rel=preload; as=style'];

    await Promise.all([
      new Promise<void>((resolve) => {
        runWithEarlyHintsSender(sender1, () => {
          sendEarlyHints103(links1);
          resolve();
        });
      }),
      new Promise<void>((resolve) => {
        runWithEarlyHintsSender(sender2, () => {
          sendEarlyHints103(links2);
          resolve();
        });
      }),
    ]);

    expect(sender1).toHaveBeenCalledWith(links1);
    expect(sender2).toHaveBeenCalledWith(links2);
    expect(sender1).not.toHaveBeenCalledWith(links2);
    expect(sender2).not.toHaveBeenCalledWith(links1);
  });

  it('sender is not available after ALS scope exits', () => {
    const sender = vi.fn();

    runWithEarlyHintsSender(sender, () => {
      // sender is available here
    });

    // Outside ALS scope — should be no-op
    sendEarlyHints103(['</style.css>; rel=preload; as=style']);
    expect(sender).not.toHaveBeenCalled();
  });
});
