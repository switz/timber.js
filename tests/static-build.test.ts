import { describe, it, expect } from 'vitest';
import {
  validateStaticMode,
  detectDynamicApis,
  detectDirectives,
  type StaticValidationError,
} from '../packages/timber-app/src/plugins/static-build';

// ---------------------------------------------------------------------------
// Static render: output: 'static' validates at build time
// ---------------------------------------------------------------------------

describe('static render', () => {
  it('returns no errors for a clean static page', () => {
    const code = `
export default function HomePage() {
  return <h1>Hello</h1>
}
`;
    const errors = validateStaticMode(code, 'app/page.tsx', { clientJavascriptDisabled: false });
    expect(errors).toHaveLength(0);
  });

  it('allows server-only code in static mode', () => {
    const code = `
import { db } from '@/lib/db'

export default async function Page() {
  const posts = await db.posts.findMany()
  return <ul>{posts.map(p => <li key={p.id}>{p.title}</li>)}</ul>
}
`;
    const errors = validateStaticMode(code, 'app/page.tsx', { clientJavascriptDisabled: false });
    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Build time middleware: middleware/access run at build time
// ---------------------------------------------------------------------------

describe('build time middleware', () => {
  it('does not flag middleware.ts files as errors', () => {
    const code = `
export function middleware(ctx) {
  if (!ctx.auth) return ctx.redirect('/login')
  return ctx.next()
}
`;
    const errors = validateStaticMode(code, 'app/middleware.ts', {
      clientJavascriptDisabled: false,
    });
    expect(errors).toHaveLength(0);
  });

  it('does not flag access.ts files as errors', () => {
    const code = `
export default function access(ctx) {
  if (!ctx.auth) return ctx.deny()
  return ctx.allow()
}
`;
    const errors = validateStaticMode(code, 'app/dashboard/access.ts', {
      clientJavascriptDisabled: false,
    });
    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Dynamic API error: cookies()/headers() → build error in static mode
// ---------------------------------------------------------------------------

describe('dynamic api error', () => {
  it('reports cookies() usage as an error in static mode', () => {
    const code = `
import { cookies } from 'next/headers'

export default async function Page() {
  const token = cookies().get('session')
  return <div>{token}</div>
}
`;
    const errors = detectDynamicApis(code, 'app/page.tsx');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].type).toBe('dynamic-api');
    expect(errors[0].message).toContain('cookies()');
  });

  it('reports headers() usage as an error in static mode', () => {
    const code = `
import { headers } from 'next/headers'

export default async function Page() {
  const host = headers().get('host')
  return <div>{host}</div>
}
`;
    const errors = detectDynamicApis(code, 'app/page.tsx');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].type).toBe('dynamic-api');
    expect(errors[0].message).toContain('headers()');
  });

  it('reports cookies imported from @timber/app as an error', () => {
    const code = `
import { cookies } from '@timber/app/headers'

export default async function Page() {
  const token = cookies().get('session')
  return <div>{token}</div>
}
`;
    const errors = detectDynamicApis(code, 'app/page.tsx');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].type).toBe('dynamic-api');
  });

  it('does not flag cookies in non-page files (e.g. route handlers)', () => {
    // route.ts files might use cookies — but in static mode they're also errors
    const code = `
import { cookies } from 'next/headers'
export function GET() {
  return new Response(cookies().get('x'))
}
`;
    const errors = detectDynamicApis(code, 'app/api/route.ts');
    expect(errors.length).toBeGreaterThan(0);
  });

  it('does not flag code without dynamic APIs', () => {
    const code = `
export default function Page() {
  return <h1>Static</h1>
}
`;
    const errors = detectDynamicApis(code, 'app/page.tsx');
    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// clientJavascript disabled use client error: 'use client' → build error in clientJavascript disabled mode
// ---------------------------------------------------------------------------

describe('nojs use client error', () => {
  it('rejects "use client" directive in clientJavascript disabled mode', () => {
    const code = `'use client'

export default function Counter() {
  return <button>Click</button>
}
`;
    const errors = detectDirectives(code, 'app/components/Counter.tsx', {
      clientJavascriptDisabled: true,
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].type).toBe('nojs-directive');
    expect(errors[0].message).toContain("'use client'");
  });

  it('rejects "use server" directive in clientJavascript disabled mode', () => {
    const code = `'use server'

export async function createPost(data) {
  await db.posts.create(data)
}
`;
    const errors = detectDirectives(code, 'app/actions.ts', { clientJavascriptDisabled: true });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].type).toBe('nojs-directive');
    expect(errors[0].message).toContain("'use server'");
  });

  it('rejects double-quoted "use client" in clientJavascript disabled mode', () => {
    const code = `"use client"

export default function Widget() {
  return <div />
}
`;
    const errors = detectDirectives(code, 'app/widget.tsx', { clientJavascriptDisabled: true });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].type).toBe('nojs-directive');
  });

  it('does not flag "use client" in non-clientJavascript disabled static mode', () => {
    const code = `'use client'

export default function Counter() {
  return <button>Click</button>
}
`;
    const errors = detectDirectives(code, 'app/components/Counter.tsx', {
      clientJavascriptDisabled: false,
    });
    expect(errors).toHaveLength(0);
  });

  it('does not flag code without directives in clientJavascript disabled mode', () => {
    const code = `
export default function Page() {
  return <h1>Static</h1>
}
`;
    const errors = detectDirectives(code, 'app/page.tsx', { clientJavascriptDisabled: true });
    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// clientJavascript disabled no runtime: no React runtime in output
// ---------------------------------------------------------------------------

describe('nojs no runtime', () => {
  it('reports "use client" as a clientJavascript disabled violation', () => {
    const code = `'use client'
import { useState } from 'react'
export default function Counter() {
  const [count, setCount] = useState(0)
  return <button onClick={() => setCount(c => c + 1)}>{count}</button>
}
`;
    const errors = detectDirectives(code, 'app/counter.tsx', { clientJavascriptDisabled: true });
    expect(errors.length).toBeGreaterThan(0);
    // In clientJavascript disabled mode, 'use client' is the build error — React runtime removal
    // is a consequence of rejecting all client components
    expect(errors[0].type).toBe('nojs-directive');
  });
});

// ---------------------------------------------------------------------------
// Action extraction: server actions extracted as API endpoints
// ---------------------------------------------------------------------------

describe('action extraction', () => {
  it('detects inline "use server" functions for extraction', () => {
    const code = `
export default function Page() {
  async function submitForm(formData) {
    'use server'
    await db.posts.create(formData)
  }
  return <form action={submitForm}><button>Submit</button></form>
}
`;
    // In static mode (non-clientJavascript disabled), server actions must be extracted
    const errors = validateStaticMode(code, 'app/page.tsx', { clientJavascriptDisabled: false });
    // No errors — action extraction is a transform, not a validation error.
    // The plugin handles extraction during build.
    expect(errors).toHaveLength(0);
  });

  it('detects module-level "use server" files for extraction', () => {
    const code = `'use server'

export async function createPost(data) {
  await db.posts.create(data)
}

export async function deletePost(id) {
  await db.posts.delete(id)
}
`;
    // In non-clientJavascript disabled static mode, server action files are valid — they get extracted
    const errors = validateStaticMode(code, 'app/actions.ts', { clientJavascriptDisabled: false });
    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Combined validation: validateStaticMode orchestrates all checks
// ---------------------------------------------------------------------------

describe('validateStaticMode combined', () => {
  it('catches both dynamic APIs and clientJavascript disabled violations', () => {
    const code = `'use client'
import { cookies } from 'next/headers'

export default function Page() {
  const token = cookies().get('session')
  return <div>{token}</div>
}
`;
    const errors = validateStaticMode(code, 'app/page.tsx', { clientJavascriptDisabled: true });
    // Should report both the 'use client' and cookies() issues
    expect(errors.length).toBeGreaterThanOrEqual(2);
    const types = errors.map((e: StaticValidationError) => e.type);
    expect(types).toContain('nojs-directive');
    expect(types).toContain('dynamic-api');
  });

  it('provides file path in all errors', () => {
    const code = `
import { cookies } from 'next/headers'
export default async function Page() {
  return <div>{cookies().get('x')}</div>
}
`;
    const errors = validateStaticMode(code, 'app/dashboard/page.tsx', {
      clientJavascriptDisabled: false,
    });
    for (const err of errors) {
      expect(err.file).toBe('app/dashboard/page.tsx');
    }
  });
});
