// Scaffold utilities for create-timber-app
// Extracted so they can be tested independently of the CLI entry point.

import { join } from 'node:path';
import { mkdir, readdir, readFile, writeFile, unlink } from 'node:fs/promises';

const ADAPTERS = {
  cloudflare: {
    configImport: `import { cloudflare } from '@timber-js/app/adapters/cloudflare';`,
    configAdapter: `  adapter: cloudflare(),`,
  },
  node: {
    configImport: `import { nitro } from '@timber-js/app/adapters/nitro';`,
    configAdapter: `  adapter: nitro(),`,
  },
  static: {
    configImport: '',
    configAdapter: `  output: 'static' as const,`,
  },
} as const;

export type AdapterChoice = keyof typeof ADAPTERS;

export interface FeatureOptions {
  mdx: boolean;
}

export async function copyDir(src: string, dst: string) {
  await mkdir(dst, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const dstPath = join(dst, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, dstPath);
    } else {
      const content = await readFile(srcPath);
      await writeFile(dstPath, content);
    }
  }
}

export async function replaceInDir(dir: string, search: string, replacement: string) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      await replaceInDir(fullPath, search, replacement);
    } else {
      const content = await readFile(fullPath, 'utf-8');
      if (content.includes(search)) {
        await writeFile(fullPath, content.replaceAll(search, replacement));
      }
    }
  }
}

export async function writeTimberConfig(
  targetDir: string,
  adapter: AdapterChoice,
  features: FeatureOptions
) {
  const adapterConfig = ADAPTERS[adapter];
  const lines: string[] = [];

  if (adapterConfig.configImport) {
    lines.push(adapterConfig.configImport);
    lines.push('');
  }

  lines.push('export default {');
  if (adapterConfig.configAdapter) {
    lines.push(adapterConfig.configAdapter);
  }
  if (features.mdx) {
    lines.push(`  pageExtensions: ['tsx', 'ts', 'jsx', 'js', 'mdx'],`);
  }
  lines.push('};');
  lines.push('');

  await writeFile(join(targetDir, 'timber.config.ts'), lines.join('\n'));
}

export async function addMdxDeps(targetDir: string) {
  const pkgPath = join(targetDir, 'package.json');
  const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'));
  pkg.dependencies = pkg.dependencies ?? {};
  pkg.dependencies['@mdx-js/rollup'] = '^3.1.1';
  await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
}

export async function renameGitignore(targetDir: string) {
  const src = join(targetDir, '_gitignore');
  const dst = join(targetDir, '.gitignore');
  try {
    const content = await readFile(src, 'utf-8');
    await writeFile(dst, content);
    await unlink(src);
  } catch {
    // _gitignore may not exist
  }
}
