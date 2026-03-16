import type { ReactNode } from 'react';

export const metadata = {
  title: '{{PROJECT_NAME}}',
  description: 'Built with timber.js',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
