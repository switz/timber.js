import { describe, it, expect, vi } from 'vitest';
import type { TimberUserConfig } from '../packages/timber-app/src/index';
import { warnConfigConflicts } from '../packages/timber-app/src/index';

// Re-implement mergeFileConfig for testing — mirrors the logic in index.ts
function mergeFileConfig(inline: TimberUserConfig, fileConfig: TimberUserConfig): TimberUserConfig {
  return {
    ...fileConfig,
    ...inline,
    // Deep merge for nested objects where both exist
    ...(fileConfig.limits && inline.limits
      ? { limits: { ...fileConfig.limits, ...inline.limits } }
      : {}),
    ...(fileConfig.dev && inline.dev ? { dev: { ...fileConfig.dev, ...inline.dev } } : {}),
    ...(fileConfig.mdx && inline.mdx ? { mdx: { ...fileConfig.mdx, ...inline.mdx } } : {}),
  };
}

describe('timber config merging', () => {
  it('file config fills in missing fields', () => {
    const inline: TimberUserConfig = { output: 'server' };
    const fileConfig: TimberUserConfig = {
      pageExtensions: ['tsx', 'ts', 'jsx', 'js', 'mdx'],
      mdx: { remarkPlugins: [] },
    };

    const merged = mergeFileConfig(inline, fileConfig);

    expect(merged.output).toBe('server'); // inline wins
    expect(merged.pageExtensions).toEqual(['tsx', 'ts', 'jsx', 'js', 'mdx']); // file fills in
    expect(merged.mdx).toEqual({ remarkPlugins: [] }); // file fills in
  });

  it('inline config takes precedence over file config', () => {
    const inline: TimberUserConfig = {
      output: 'static',
      pageExtensions: ['tsx', 'ts'],
    };
    const fileConfig: TimberUserConfig = {
      output: 'server',
      pageExtensions: ['tsx', 'ts', 'jsx', 'js', 'mdx'],
      csrf: true,
    };

    const merged = mergeFileConfig(inline, fileConfig);

    expect(merged.output).toBe('static'); // inline wins
    expect(merged.pageExtensions).toEqual(['tsx', 'ts']); // inline wins
    expect(merged.csrf).toBe(true); // file fills in
  });

  it('deep merges nested objects when both exist', () => {
    const inline: TimberUserConfig = {
      mdx: { remarkPlugins: ['custom-remark'] },
    };
    const fileConfig: TimberUserConfig = {
      mdx: { rehypePlugins: ['custom-rehype'], remarkPlugins: ['file-remark'] },
    };

    const merged = mergeFileConfig(inline, fileConfig);

    // Inline remarkPlugins wins, file rehypePlugins fills in
    expect(merged.mdx).toEqual({
      rehypePlugins: ['custom-rehype'],
      remarkPlugins: ['custom-remark'],
    });
  });

  it('deep merges limits when both exist', () => {
    const inline: TimberUserConfig = {
      limits: { actionBodySize: '1mb' },
    };
    const fileConfig: TimberUserConfig = {
      limits: { uploadBodySize: '10mb', actionBodySize: '500kb' },
    };

    const merged = mergeFileConfig(inline, fileConfig);

    expect(merged.limits).toEqual({
      uploadBodySize: '10mb', // file fills in
      actionBodySize: '1mb', // inline wins
    });
  });

  it('file-only config is used when no inline config', () => {
    const inline: TimberUserConfig = {};
    const fileConfig: TimberUserConfig = {
      output: 'static',
      pageExtensions: ['tsx', 'ts', 'mdx'],
      csrf: false,
      mdx: { remarkPlugins: ['remark-gfm'] },
    };

    const merged = mergeFileConfig(inline, fileConfig);

    expect(merged.output).toBe('static');
    expect(merged.pageExtensions).toEqual(['tsx', 'ts', 'mdx']);
    expect(merged.csrf).toBe(false);
    expect(merged.mdx).toEqual({ remarkPlugins: ['remark-gfm'] });
  });

  it('empty file config does not overwrite inline config', () => {
    const inline: TimberUserConfig = {
      output: 'server',
      pageExtensions: ['tsx'],
    };
    const fileConfig: TimberUserConfig = {};

    const merged = mergeFileConfig(inline, fileConfig);

    expect(merged.output).toBe('server');
    expect(merged.pageExtensions).toEqual(['tsx']);
  });

  it('MDX activates from timber.config.ts — pageExtensions with mdx', () => {
    // Simulates: inline config has no pageExtensions or mdx,
    // but timber.config.ts has pageExtensions including 'mdx'
    const inline: TimberUserConfig = { output: 'server' };
    const fileConfig: TimberUserConfig = {
      pageExtensions: ['tsx', 'ts', 'jsx', 'js', 'mdx'],
    };

    const merged = mergeFileConfig(inline, fileConfig);

    // MDX plugin checks ctx.config.pageExtensions — this should now contain 'mdx'
    const hasMdx = merged.pageExtensions?.some((ext) => ['mdx', 'md'].includes(ext));
    expect(hasMdx).toBe(true);
  });
});

describe('warnConfigConflicts', () => {
  it('returns conflicting keys when both inline and file set the same key', () => {
    const inline: TimberUserConfig = { clientJavascript: false };
    const fileConfig: TimberUserConfig = {
      clientJavascript: { disabled: true, enableHMRInDev: true },
    };

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const conflicts = warnConfigConflicts(inline, fileConfig);
    warnSpy.mockRestore();

    expect(conflicts).toEqual(['clientJavascript']);
  });

  it('emits a warning message listing conflicting keys', () => {
    const inline: TimberUserConfig = { clientJavascript: false, csrf: true };
    const fileConfig: TimberUserConfig = {
      clientJavascript: { disabled: true },
      csrf: false,
    };

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    warnConfigConflicts(inline, fileConfig);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('"clientJavascript"')
    );
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('"csrf"'));
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Move all config to timber.config.ts')
    );
    warnSpy.mockRestore();
  });

  it('returns empty array when no conflicts exist', () => {
    const inline: TimberUserConfig = { output: 'server' };
    const fileConfig: TimberUserConfig = {
      pageExtensions: ['tsx', 'ts', 'mdx'],
      csrf: true,
    };

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const conflicts = warnConfigConflicts(inline, fileConfig);
    warnSpy.mockRestore();

    expect(conflicts).toEqual([]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('excludes output from conflict detection (it always has a default)', () => {
    const inline: TimberUserConfig = { output: 'server' };
    const fileConfig: TimberUserConfig = { output: 'static' };

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const conflicts = warnConfigConflicts(inline, fileConfig);
    warnSpy.mockRestore();

    expect(conflicts).toEqual([]);
  });

  it('does not warn when file key is not in inline config', () => {
    const inline: TimberUserConfig = {};
    const fileConfig: TimberUserConfig = {
      clientJavascript: { disabled: true },
    };

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const conflicts = warnConfigConflicts(inline, fileConfig);
    warnSpy.mockRestore();

    expect(conflicts).toEqual([]);
  });
});
