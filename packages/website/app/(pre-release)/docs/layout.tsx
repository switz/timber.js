import type { ReactNode } from 'react';
import type { Metadata } from '@timber/app/server';

export default function DocsLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export const metadata: Metadata = {
  title: {
    template: '%s | timber.js docs',
    default: 'Documentation | timber.js',
  },
};
