#!/usr/bin/env node

import { resolve } from 'node:path';
import { readdir } from 'node:fs/promises';
import prompts from 'prompts';
import {
  copyDir,
  replaceInDir,
  writeTimberConfig,
  addMdxDeps,
  renameGitignore,
  type AdapterChoice,
} from './scaffold';

async function main() {
  const args = process.argv.slice(2);
  const targetArg = args.find((a) => !a.startsWith('-'));

  let cancelled = false;
  const response = await prompts(
    [
      {
        type: targetArg ? null : 'text',
        name: 'projectName',
        message: 'Project name:',
        initial: 'my-timber-app',
      },
      {
        type: 'select',
        name: 'adapter',
        message: 'Deploy target:',
        choices: [
          { title: 'Cloudflare Workers', value: 'cloudflare' },
          { title: 'Node.js (Nitro)', value: 'node' },
          { title: 'Static export', value: 'static' },
        ],
        initial: 0,
      },
      {
        type: 'confirm',
        name: 'mdx',
        message: 'Add MDX support?',
        initial: false,
      },
    ],
    {
      onCancel: () => {
        cancelled = true;
      },
    },
  );

  if (cancelled) {
    console.log('Cancelled.');
    process.exit(0);
  }

  const projectName: string = targetArg ?? response.projectName;
  const adapter: AdapterChoice = response.adapter;
  const mdx: boolean = response.mdx;

  const targetDir = resolve(process.cwd(), projectName);
  const templateDir = resolve(import.meta.dirname, '..', 'template');

  // Check if target already exists and is non-empty
  try {
    const existing = await readdir(targetDir);
    if (existing.length > 0) {
      console.error(`Error: ${targetDir} is not empty.`);
      process.exit(1);
    }
  } catch {
    // Directory doesn't exist — that's fine
  }

  await copyDir(templateDir, targetDir);
  await renameGitignore(targetDir);
  await replaceInDir(targetDir, '{{PROJECT_NAME}}', projectName);
  await writeTimberConfig(targetDir, adapter, { mdx });

  if (mdx) {
    await addMdxDeps(targetDir);
  }

  console.log();
  console.log(`  Created ${projectName}`);
  console.log();
  console.log('  Get started:');
  console.log(`    cd ${projectName}`);
  console.log('    npm install');
  console.log('    npm run dev');
  console.log();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
