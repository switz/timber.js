/**
 * @vitest-environment happy-dom
 *
 * HeadOn - apply directly to the <head />!
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { applyHeadElements, type HeadElement } from '../packages/timber-app/src/client/head';

describe('applyHeadElements', () => {
  beforeEach(() => {
    // Reset document head to a clean state
    document.head.innerHTML = '';
    document.title = '';
  });

  it('sets document.title from a title element', () => {
    const elements: HeadElement[] = [{ tag: 'title', content: 'New Title' }];
    applyHeadElements(elements);
    expect(document.title).toBe('New Title');
  });

  it('creates meta tags with data-timber-head marker', () => {
    const elements: HeadElement[] = [
      { tag: 'meta', attrs: { name: 'description', content: 'A description' } },
    ];
    applyHeadElements(elements);

    const meta = document.head.querySelector('meta[name="description"]');
    expect(meta).not.toBeNull();
    expect(meta!.getAttribute('content')).toBe('A description');
    expect(meta!.hasAttribute('data-timber-head')).toBe(true);
  });

  it('creates link tags with data-timber-head marker', () => {
    const elements: HeadElement[] = [
      { tag: 'link', attrs: { rel: 'canonical', href: 'https://example.com/' } },
    ];
    applyHeadElements(elements);

    const link = document.head.querySelector('link[rel="canonical"]');
    expect(link).not.toBeNull();
    expect(link!.getAttribute('href')).toBe('https://example.com/');
    expect(link!.hasAttribute('data-timber-head')).toBe(true);
  });

  it('removes previous timber-managed tags on second call', () => {
    const first: HeadElement[] = [
      { tag: 'meta', attrs: { name: 'description', content: 'First' } },
      { tag: 'meta', attrs: { name: 'keywords', content: 'a, b' } },
    ];
    applyHeadElements(first);
    expect(document.head.querySelectorAll('[data-timber-head]')).toHaveLength(2);

    const second: HeadElement[] = [
      { tag: 'meta', attrs: { name: 'description', content: 'Second' } },
    ];
    applyHeadElements(second);

    // Only one timber-managed tag now (keywords was removed)
    expect(document.head.querySelectorAll('[data-timber-head]')).toHaveLength(1);
    const meta = document.head.querySelector('meta[name="description"]');
    expect(meta!.getAttribute('content')).toBe('Second');
  });

  it('replaces existing SSR meta tags with same name', () => {
    // Simulate an SSR-rendered meta tag (no data-timber-head marker)
    const ssrMeta = document.createElement('meta');
    ssrMeta.setAttribute('name', 'description');
    ssrMeta.setAttribute('content', 'SSR description');
    document.head.appendChild(ssrMeta);

    const elements: HeadElement[] = [
      { tag: 'meta', attrs: { name: 'description', content: 'SPA description' } },
    ];
    applyHeadElements(elements);

    // SSR tag should be gone, replaced by timber-managed tag
    const metas = document.head.querySelectorAll('meta[name="description"]');
    expect(metas).toHaveLength(1);
    expect(metas[0].getAttribute('content')).toBe('SPA description');
    expect(metas[0].hasAttribute('data-timber-head')).toBe(true);
  });

  it('replaces existing meta tags matched by property attribute (OG tags)', () => {
    const ssrMeta = document.createElement('meta');
    ssrMeta.setAttribute('property', 'og:title');
    ssrMeta.setAttribute('content', 'SSR OG Title');
    document.head.appendChild(ssrMeta);

    const elements: HeadElement[] = [
      { tag: 'meta', attrs: { property: 'og:title', content: 'New OG Title' } },
    ];
    applyHeadElements(elements);

    const metas = document.head.querySelectorAll('meta[property="og:title"]');
    expect(metas).toHaveLength(1);
    expect(metas[0].getAttribute('content')).toBe('New OG Title');
  });

  it('handles mixed title, meta, and link elements', () => {
    const elements: HeadElement[] = [
      { tag: 'title', content: 'My Page' },
      { tag: 'meta', attrs: { name: 'description', content: 'Desc' } },
      { tag: 'link', attrs: { rel: 'canonical', href: '/my-page' } },
    ];
    applyHeadElements(elements);

    expect(document.title).toBe('My Page');
    expect(document.head.querySelector('meta[name="description"]')).not.toBeNull();
    expect(document.head.querySelector('link[rel="canonical"]')).not.toBeNull();
  });

  it('skips elements with no attrs and no content', () => {
    const elements: HeadElement[] = [
      { tag: 'meta' }, // no attrs — should be skipped
    ];
    applyHeadElements(elements);
    expect(document.head.querySelectorAll('meta')).toHaveLength(0);
  });
});
