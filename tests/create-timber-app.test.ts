import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';

describe('create-timber-app', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'create-timber-app-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('copies template files to target directory', async () => {
    const projectName = 'test-project';
    const projectDir = join(tempDir, projectName);

    // Run CLI non-interactively by piping choices
    // We test the template copy logic directly instead
    const { copyDir, replaceInDir } = await import('../packages/create-timber-app/src/scaffold');
    const templateDir = join(
      import.meta.dirname,
      '..',
      'packages',
      'create-timber-app',
      'template'
    );

    await copyDir(templateDir, projectDir);
    await replaceInDir(projectDir, '{{PROJECT_NAME}}', projectName);

    // Verify core files exist
    const files = await readdir(projectDir);
    expect(files).toContain('package.json');
    expect(files).toContain('vite.config.ts');
    expect(files).toContain('tsconfig.json');
    expect(files).toContain('timber.config.ts');

    // Verify app directory
    const appFiles = await readdir(join(projectDir, 'app'));
    expect(appFiles).toContain('layout.tsx');
    expect(appFiles).toContain('page.tsx');

    // Verify project name substitution
    const pkg = JSON.parse(await readFile(join(projectDir, 'package.json'), 'utf-8'));
    expect(pkg.name).toBe(projectName);

    // Verify layout has project name in metadata
    const layout = await readFile(join(projectDir, 'app', 'layout.tsx'), 'utf-8');
    expect(layout).toContain(projectName);
    expect(layout).not.toContain('{{PROJECT_NAME}}');
  });

  it('generates correct timber.config.ts for cloudflare adapter', async () => {
    const { writeTimberConfig } = await import('../packages/create-timber-app/src/scaffold');
    const projectDir = join(tempDir, 'cf-project');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(projectDir, { recursive: true });

    await writeTimberConfig(projectDir, 'cloudflare', { mdx: false });

    const config = await readFile(join(projectDir, 'timber.config.ts'), 'utf-8');
    expect(config).toContain('@timber-js/app/adapters/cloudflare');
    expect(config).toContain('cloudflare()');
    expect(config).not.toContain('pageExtensions');
  });

  it('generates correct timber.config.ts for node adapter', async () => {
    const { writeTimberConfig } = await import('../packages/create-timber-app/src/scaffold');
    const projectDir = join(tempDir, 'node-project');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(projectDir, { recursive: true });

    await writeTimberConfig(projectDir, 'node', { mdx: false });

    const config = await readFile(join(projectDir, 'timber.config.ts'), 'utf-8');
    expect(config).toContain('@timber-js/app/adapters/nitro');
    expect(config).toContain('nitro()');
  });

  it('generates correct timber.config.ts for static output', async () => {
    const { writeTimberConfig } = await import('../packages/create-timber-app/src/scaffold');
    const projectDir = join(tempDir, 'static-project');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(projectDir, { recursive: true });

    await writeTimberConfig(projectDir, 'static', { mdx: false });

    const config = await readFile(join(projectDir, 'timber.config.ts'), 'utf-8');
    expect(config).toContain("'static'");
    expect(config).not.toContain('import');
  });

  it('adds MDX config when mdx option is true', async () => {
    const { writeTimberConfig } = await import('../packages/create-timber-app/src/scaffold');
    const projectDir = join(tempDir, 'mdx-project');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(projectDir, { recursive: true });

    await writeTimberConfig(projectDir, 'cloudflare', { mdx: true });

    const config = await readFile(join(projectDir, 'timber.config.ts'), 'utf-8');
    expect(config).toContain('pageExtensions');
    expect(config).toContain('mdx');
  });

  it('adds MDX dependencies to package.json', async () => {
    const { addMdxDeps } = await import('../packages/create-timber-app/src/scaffold');
    const projectDir = join(tempDir, 'mdx-deps');
    const { mkdir, writeFile: wf } = await import('node:fs/promises');
    await mkdir(projectDir, { recursive: true });
    await wf(join(projectDir, 'package.json'), JSON.stringify({ name: 'test', dependencies: {} }));

    await addMdxDeps(projectDir);

    const pkg = JSON.parse(await readFile(join(projectDir, 'package.json'), 'utf-8'));
    expect(pkg.dependencies['@mdx-js/rollup']).toBeDefined();
  });

  it('template package.json has correct dependencies', async () => {
    const templatePkg = JSON.parse(
      await readFile(
        join(
          import.meta.dirname,
          '..',
          'packages',
          'create-timber-app',
          'template',
          'package.json'
        ),
        'utf-8'
      )
    );

    expect(templatePkg.dependencies['@timber-js/app']).toBeDefined();
    expect(templatePkg.dependencies['react']).toBeDefined();
    expect(templatePkg.dependencies['react-dom']).toBeDefined();
    // expect(templatePkg.devDependencies['vite-plus']).toBeDefined();
    expect(templatePkg.devDependencies['typescript']).toBeDefined();
    expect(templatePkg.type).toBe('module');
  });

  it('template vite.config.ts imports from @timber-js/app', async () => {
    const viteConfig = await readFile(
      join(
        import.meta.dirname,
        '..',
        'packages',
        'create-timber-app',
        'template',
        'vite.config.ts'
      ),
      'utf-8'
    );

    expect(viteConfig).toContain("from '@timber-js/app'");
    expect(viteConfig).toContain('timber()');
    expect(viteConfig).toContain('defineConfig');
  });
});
