export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>timber.js on Cloudflare Workers</title>
      </head>
      <body>
        <nav>
          <a href="/">Home</a> | <a href="/about">About</a>
        </nav>
        {children}
      </body>
    </html>
  );
}
