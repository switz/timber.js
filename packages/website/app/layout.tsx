import type { ReactNode } from 'react';
import './globals.css';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head />
      <body>{children}</body>
    </html>
  );
}

export const metadata = {
  title: 'timber.js',
  description: 'A Vite-native React framework for Cloudflare Workers',
  noindex: true,
};
