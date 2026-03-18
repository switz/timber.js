// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { NuqsTestingAdapter } from 'nuqs/adapters/testing';
import { createElement, type ReactNode } from 'react';
import { createSearchParams } from '@timber-js/app/search-params';
import {
  useQueryStates,
  bindUseQueryStates,
} from '../packages/timber-app/src/client/use-query-states.js';

// ─── Codecs ─────────────────────────────────────────────────────

const pageCodec = {
  parse: (v: string | string[] | undefined) => (typeof v === 'string' ? Number(v) : 1),
  serialize: (v: number) => String(v),
};

const qCodec = {
  parse: (v: string | string[] | undefined): string | null => (typeof v === 'string' ? v : null),
  serialize: (v: string | null): string | null => v,
};

// ─── Helper ─────────────────────────────────────────────────────

function createWrapper(searchParams?: string) {
  return ({ children }: { children: ReactNode }) =>
    createElement(
      NuqsTestingAdapter,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { searchParams: searchParams ?? '', hasMemory: true } as any,
      children
    );
}

// ─── Tests: parses current URL ──────────────────────────────────

describe('useQueryStates', () => {
  it('parses current URL', () => {
    const { result } = renderHook(() => useQueryStates({ page: pageCodec, q: qCodec }), {
      wrapper: createWrapper('?page=3&q=boots'),
    });

    const [params] = result.current;
    expect(params.page).toBe(3);
    expect(params.q).toBe('boots');
  });

  it('returns defaults when no search params', () => {
    const { result } = renderHook(() => useQueryStates({ page: pageCodec, q: qCodec }), {
      wrapper: createWrapper(''),
    });

    const [params] = result.current;
    expect(params.page).toBe(1);
    expect(params.q).toBeNull();
  });

  it('updates URL on setParams', async () => {
    const { result } = renderHook(() => useQueryStates({ page: pageCodec, q: qCodec }), {
      wrapper: createWrapper('?page=1'),
    });

    expect(result.current[0].page).toBe(1);

    await act(async () => {
      result.current[1]({ page: 2 });
    });

    expect(result.current[0].page).toBe(2);
  });

  it('shallow skips navigation', async () => {
    const { result } = renderHook(() => useQueryStates({ page: pageCodec }), {
      wrapper: createWrapper(''),
    });

    await act(async () => {
      result.current[1]({ page: 5 }, { shallow: true });
    });

    // Shallow update still updates the parsed value
    expect(result.current[0].page).toBe(5);
  });

  it('respects urlKeys', () => {
    const { result } = renderHook(
      () => useQueryStates({ search: qCodec, page: pageCodec }, undefined, { search: 'q' }),
      { wrapper: createWrapper('?q=shoes&page=3') }
    );

    const [params] = result.current;
    expect(params.search).toBe('shoes');
    expect(params.page).toBe(3);
  });

  it('bridges codecs — nuqs receives correct parse/serialize', () => {
    // Verify that the codec bridge correctly translates between protocols.
    // pageCodec.parse(undefined) → 1 (default), so nuqs should use 1 as defaultValue.
    const { result } = renderHook(() => useQueryStates({ page: pageCodec }), {
      wrapper: createWrapper(''),
    });

    // Default value should come through
    expect(result.current[0].page).toBe(1);
  });
});

// ─── Tests: bindUseQueryStates ──────────────────────────────────

describe('bindUseQueryStates', () => {
  it('works via SearchParamsDefinition', () => {
    const def = createSearchParams({ page: pageCodec, q: qCodec });
    const bound = bindUseQueryStates(def);

    const { result } = renderHook(() => bound(), { wrapper: createWrapper('?page=5&q=hats') });

    const [params] = result.current;
    expect(params.page).toBe(5);
    expect(params.q).toBe('hats');
  });

  it('passes urlKeys from definition', () => {
    const def = createSearchParams(
      { search: qCodec, page: pageCodec },
      { urlKeys: { search: 'q' } }
    );
    const bound = bindUseQueryStates(def);

    const { result } = renderHook(() => bound(), { wrapper: createWrapper('?q=boots&page=2') });

    const [params] = result.current;
    expect(params.search).toBe('boots');
    expect(params.page).toBe(2);
  });
});

// ─── Tests: codec parsing and serialization ─────────────────────

describe('codec integration', () => {
  it('SearchParamsDefinition.useQueryStates throws on server', () => {
    const def = createSearchParams({ page: pageCodec, q: qCodec });
    expect(() => def.useQueryStates()).toThrow('client component');
  });

  it('parse + serialize round-trips correctly', () => {
    const def = createSearchParams({ page: pageCodec, q: qCodec });

    const parsed = def.parse(new URLSearchParams('page=3&q=boots'));
    expect(parsed.page).toBe(3);
    expect(parsed.q).toBe('boots');

    const qs = def.serialize({ page: 3, q: 'boots' });
    expect(qs).toContain('page=3');
    expect(qs).toContain('q=boots');
  });

  it('default values omitted from serialization', () => {
    const def = createSearchParams({ page: pageCodec, q: qCodec });
    const qs = def.serialize({ page: 1, q: null });
    expect(qs).toBe('');
  });

  it('pick() preserves codecs for subset', () => {
    const def = createSearchParams({
      page: pageCodec,
      q: qCodec,
      sort: {
        parse: (v: string | string[] | undefined): string =>
          typeof v === 'string' ? v : 'popular',
        serialize: (v: string): string | null => v,
      },
    });

    const picked = def.pick('page', 'q');
    const parsed = picked.parse(new URLSearchParams('page=5&q=boots&sort=newest'));
    expect(parsed.page).toBe(5);
    expect(parsed.q).toBe('boots');
    expect('sort' in parsed).toBe(false);
  });

  it('URL key aliasing works with serialization', () => {
    const def = createSearchParams(
      { search: qCodec, page: pageCodec },
      { urlKeys: { search: 'q' } }
    );

    const qs = def.serialize({ search: 'boots', page: 2 });
    expect(qs).toContain('q=boots');
    expect(qs).toContain('page=2');
    expect(qs).not.toContain('search=');

    const parsed = def.parse(new URLSearchParams('q=shoes&page=3'));
    expect(parsed.search).toBe('shoes');
    expect(parsed.page).toBe(3);
  });
});
