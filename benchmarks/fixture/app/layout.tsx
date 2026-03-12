export const metadata = {
  title: { default: 'Bench App', template: '%s | Bench' },
  description: 'Benchmark fixture app',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
      </head>
      <body>{children}</body>
    </html>
  );
}
