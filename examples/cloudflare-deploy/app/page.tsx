export default function HomePage() {
  return (
    <main>
      <h1>timber.js on Cloudflare Workers</h1>
      <p>
        This example demonstrates deploying a timber.js app to Cloudflare Workers using the
        Cloudflare adapter.
      </p>
      <h2>Features</h2>
      <ul>
        <li>Cloudflare Workers runtime with nodejs_compat</li>
        <li>Static assets served via Cloudflare CDN</li>
        <li>waitUntil() bound to ExecutionContext</li>
        <li>KV/D1/R2 bindings accessible via getCloudflareBindings()</li>
      </ul>
    </main>
  );
}
