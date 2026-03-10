import type { ReactNode } from 'react';
import './globals.css';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head />
      <body className="bg-white text-gray-900 antialiased" data-testid="tailwind-body">
        {children}
      </body>
    </html>
  );
}

export const metadata = {
  title: 'Timber + Tailwind',
  description: 'Example app demonstrating Tailwind CSS with timber.js',
};
