export default {
  async fetch(): Promise<Response> {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>timber.js</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            timber: '#6B4226',
          }
        }
      }
    }
  </script>
</head>
<body class="min-h-screen bg-timber flex items-center justify-center">
  <h1 class="text-white text-4xl md:text-6xl font-light tracking-wide">
    timber.js <span class="text-white/60">&mdash; coming soon</span>
  </h1>
</body>
</html>`;

    return new Response(html, {
      headers: { "Content-Type": "text/html;charset=UTF-8" },
    });
  },
};
