export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <title>Build Test App</title>
      </head>
      <body>{children}</body>
    </html>
  );
}
