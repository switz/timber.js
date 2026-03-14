import type { ReactNode } from 'react';
import './globals.css';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head />
      <body className="bg-white text-stone-800 antialiased dark:bg-stone-800 dark:text-stone-200">
        {children}
      </body>
    </html>
  );
}

export const metadata = {
  title: 'timber.js',
  description: 'A Vite-native React framework for Cloudflare Workers',
  robots: 'noindex, nofollow',
};
