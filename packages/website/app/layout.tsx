import type { ReactNode } from 'react';
import './globals.css';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head />
      <body className="bg-white text-stone-800 antialiased dark:bg-stone-900 dark:text-stone-200">
        {children}
      </body>
    </html>
  );
}

export const metadata = {
  title: {
    template: '%s | timber.js',
    default: 'timber.js',
  },
  // description:
  //   'A web framework built on Vite and React Server Components. Correct HTTP semantics, real status codes, pages that work without JavaScript.',
  robots: 'noindex, nofollow',
};
