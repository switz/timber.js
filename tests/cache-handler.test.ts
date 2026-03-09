import { describe, it, expect } from 'vitest';
import { MemoryCacheHandler } from '@timber/app/cache';

describe('MemoryCacheHandler', () => {
  it('returns null for missing keys', async () => {
    const handler = new MemoryCacheHandler();
    const result = await handler.get('nonexistent');
    expect(result).toBeNull();
  });

  it('stores and retrieves values', async () => {
    const handler = new MemoryCacheHandler();
    await handler.set('key', { data: 'hello' }, { ttl: 60, tags: [] });
    const result = await handler.get('key');
    expect(result).not.toBeNull();
    expect(result!.value).toEqual({ data: 'hello' });
    expect(result!.stale).toBe(false);
  });

  it('invalidates by key', async () => {
    const handler = new MemoryCacheHandler();
    await handler.set('key', 'value', { ttl: 60, tags: [] });
    await handler.invalidate({ key: 'key' });
    const result = await handler.get('key');
    expect(result).toBeNull();
  });

  it('invalidates by tag', async () => {
    const handler = new MemoryCacheHandler();
    await handler.set('a', 'val-a', { ttl: 60, tags: ['t1'] });
    await handler.set('b', 'val-b', { ttl: 60, tags: ['t1', 't2'] });
    await handler.set('c', 'val-c', { ttl: 60, tags: ['t2'] });

    await handler.invalidate({ tag: 't1' });

    expect(await handler.get('a')).toBeNull();
    expect(await handler.get('b')).toBeNull();
    expect(await handler.get('c')).not.toBeNull();
  });
});
