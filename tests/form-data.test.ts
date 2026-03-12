import { describe, it, expect } from 'vitest';
import { parseFormData, coerce } from '../packages/timber-app/src/server/form-data';

// ─── parseFormData ───────────────────────────────────────────────────────

describe('parseFormData', () => {
  it('converts simple key-value pairs', () => {
    const fd = new FormData();
    fd.append('name', 'Alice');
    fd.append('email', 'alice@example.com');

    const result = parseFormData(fd);
    expect(result).toEqual({ name: 'Alice', email: 'alice@example.com' });
  });

  it('converts duplicate keys into arrays', () => {
    const fd = new FormData();
    fd.append('tags', 'js');
    fd.append('tags', 'ts');
    fd.append('tags', 'react');

    const result = parseFormData(fd);
    expect(result).toEqual({ tags: ['js', 'ts', 'react'] });
  });

  it('converts empty strings to undefined', () => {
    const fd = new FormData();
    fd.append('name', 'Alice');
    fd.append('bio', '');

    const result = parseFormData(fd);
    expect(result).toEqual({ name: 'Alice', bio: undefined });
  });

  it('strips $ACTION_* fields', () => {
    const fd = new FormData();
    fd.append('title', 'Hello');
    fd.append('$ACTION_REF_1', 'abc123');
    fd.append('$ACTION_KEY', 'def456');

    const result = parseFormData(fd);
    expect(result).toEqual({ title: 'Hello' });
    expect(result).not.toHaveProperty('$ACTION_REF_1');
    expect(result).not.toHaveProperty('$ACTION_KEY');
  });

  it('expands dot-notation paths into nested objects', () => {
    const fd = new FormData();
    fd.append('user.name', 'Alice');
    fd.append('user.age', '30');
    fd.append('user.address.city', 'NYC');
    fd.append('simple', 'value');

    const result = parseFormData(fd);
    expect(result).toEqual({
      user: {
        name: 'Alice',
        age: '30',
        address: { city: 'NYC' },
      },
      simple: 'value',
    });
  });

  it('handles empty File objects as undefined', () => {
    const fd = new FormData();
    fd.append('name', 'Alice');
    // Simulate an empty file input (browsers send empty File with name="" size=0)
    fd.append('avatar', new File([], ''));

    const result = parseFormData(fd);
    expect(result).toEqual({ name: 'Alice', avatar: undefined });
  });

  it('preserves non-empty File objects', () => {
    const fd = new FormData();
    const file = new File(['content'], 'photo.jpg', { type: 'image/jpeg' });
    fd.append('avatar', file);

    const result = parseFormData(fd);
    expect(result.avatar).toBeInstanceOf(File);
    expect((result.avatar as File).name).toBe('photo.jpg');
  });

  it('returns empty object for empty FormData', () => {
    const fd = new FormData();
    expect(parseFormData(fd)).toEqual({});
  });

  it('handles mixed simple and dot-path keys', () => {
    const fd = new FormData();
    fd.append('title', 'My Post');
    fd.append('author.name', 'Bob');

    const result = parseFormData(fd);
    expect(result).toEqual({
      title: 'My Post',
      author: { name: 'Bob' },
    });
  });

  it('filters undefined from multi-value arrays', () => {
    const fd = new FormData();
    fd.append('items', 'one');
    fd.append('items', '');
    fd.append('items', 'three');

    const result = parseFormData(fd);
    expect(result).toEqual({ items: ['one', 'three'] });
  });

  // ─── No-JS form submission shape ────────────────────────────────────

  it('strips all $ACTION_* variants from no-JS form submissions', () => {
    const fd = new FormData();
    fd.append('$ACTION_REF_1', '');
    fd.append('$ACTION_1:0', '{"id":"/app/actions.ts#create","bound":"$@1"}');
    fd.append('$ACTION_1:1', '[null]');
    fd.append('$ACTION_KEY', 'kfbcc4f7c74b32a19e6a8a4ec01f87c56');
    fd.append('$ACTION_ID_abc', 'def');
    fd.append('title', 'Hello');
    fd.append('description', '');

    const result = parseFormData(fd);
    expect(result).toEqual({ title: 'Hello', description: undefined });
    expect(Object.keys(result).some((k) => k.startsWith('$ACTION_'))).toBe(false);
  });

  it('handles realistic no-JS event form submission', () => {
    const fd = new FormData();
    // React hidden fields
    fd.append('$ACTION_REF_1', '');
    fd.append('$ACTION_1:0', '{"id":"/app/forms-test/actions.ts#createEvent","bound":"$@1"}');
    fd.append('$ACTION_1:1', '[null]');
    fd.append('$ACTION_KEY', 'kfbcc4f7c74b32a19e6a8a4ec01f87c56');
    // User fields
    fd.append('title', 'React Summit 2026');
    fd.append('description', '');
    fd.append('date', '');
    fd.append('category', '');
    fd.append('maxAttendees', '');
    fd.append('metadata', '{"source":"kitchen-sink","version":1}');

    const result = parseFormData(fd);
    expect(result).toEqual({
      title: 'React Summit 2026',
      description: undefined,
      date: undefined,
      category: undefined,
      maxAttendees: undefined,
      metadata: '{"source":"kitchen-sink","version":1}',
    });
  });

  it('handles no-JS form with checkboxes and multi-select', () => {
    const fd = new FormData();
    fd.append('$ACTION_REF_1', '');
    fd.append('$ACTION_KEY', 'abc123');
    fd.append('title', 'Test');
    fd.append('isPublic', 'on');
    fd.append('tags', 'react');
    fd.append('tags', 'typescript');

    const result = parseFormData(fd);
    expect(result).toEqual({
      title: 'Test',
      isPublic: 'on',
      tags: ['react', 'typescript'],
    });
  });

  it('handles no-JS form with unchecked checkbox (absent key)', () => {
    const fd = new FormData();
    fd.append('$ACTION_REF_1', '');
    fd.append('$ACTION_KEY', 'abc123');
    fd.append('title', 'Test');
    // isPublic is absent — checkbox not checked

    const result = parseFormData(fd);
    expect(result).toEqual({ title: 'Test' });
    expect(result).not.toHaveProperty('isPublic');
  });
});

// ─── coerce.number ───────────────────────────────────────────────────────

describe('coerce.number', () => {
  it('coerces numeric strings to numbers', () => {
    expect(coerce.number('42')).toBe(42);
    expect(coerce.number('3.14')).toBe(3.14);
    expect(coerce.number('-7')).toBe(-7);
    expect(coerce.number('0')).toBe(0);
  });

  it('returns undefined for empty/null/undefined', () => {
    expect(coerce.number('')).toBeUndefined();
    expect(coerce.number(undefined)).toBeUndefined();
    expect(coerce.number(null)).toBeUndefined();
  });

  it('returns undefined for non-numeric strings (rejects NaN)', () => {
    expect(coerce.number('abc')).toBeUndefined();
    expect(coerce.number('12px')).toBeUndefined();
  });

  it('passes through actual numbers', () => {
    expect(coerce.number(42)).toBe(42);
    expect(coerce.number(0)).toBe(0);
  });

  it('returns undefined for non-string non-number types', () => {
    expect(coerce.number(true)).toBeUndefined();
    expect(coerce.number({})).toBeUndefined();
  });
});

// ─── coerce.checkbox ─────────────────────────────────────────────────────

describe('coerce.checkbox', () => {
  it('returns true for "on" (standard checkbox value)', () => {
    expect(coerce.checkbox('on')).toBe(true);
  });

  it('returns true for any non-empty string', () => {
    expect(coerce.checkbox('yes')).toBe(true);
    expect(coerce.checkbox('true')).toBe(true);
    expect(coerce.checkbox('1')).toBe(true);
  });

  it('returns false for absence (undefined/null/empty)', () => {
    expect(coerce.checkbox(undefined)).toBe(false);
    expect(coerce.checkbox(null)).toBe(false);
    expect(coerce.checkbox('')).toBe(false);
  });

  it('passes through booleans', () => {
    expect(coerce.checkbox(true)).toBe(true);
    expect(coerce.checkbox(false)).toBe(false);
  });
});

// ─── coerce.json ─────────────────────────────────────────────────────────

describe('coerce.json', () => {
  it('parses valid JSON strings', () => {
    expect(coerce.json('{"a":1}')).toEqual({ a: 1 });
    expect(coerce.json('[1,2,3]')).toEqual([1, 2, 3]);
    expect(coerce.json('"hello"')).toBe('hello');
  });

  it('returns undefined for empty/null/undefined', () => {
    expect(coerce.json('')).toBeUndefined();
    expect(coerce.json(undefined)).toBeUndefined();
    expect(coerce.json(null)).toBeUndefined();
  });

  it('returns undefined for invalid JSON', () => {
    expect(coerce.json('{invalid}')).toBeUndefined();
    expect(coerce.json('not json')).toBeUndefined();
  });

  it('passes through non-string values', () => {
    const obj = { a: 1 };
    expect(coerce.json(obj)).toBe(obj);
    expect(coerce.json(42)).toBe(42);
  });
});
