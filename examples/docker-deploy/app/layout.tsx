import { type ReactNode } from 'react';

export const metadata = {
  title: 'timber.js Docker Deploy',
  description: 'Minimal timber.js app for Docker deployment testing',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head />
      <body>
        <main>{children}</main>
      </body>
    </html>
  );
}
