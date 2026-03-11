export default function HomePage() {
  return (
    <div>
      <h1>timber.js</h1>
      <p>Running in Docker with Nitro node-server preset.</p>
      <p>
        Runtime: <code>{process.env.TIMBER_RUNTIME ?? 'unknown'}</code>
      </p>
      <p>
        Port: <code>{process.env.PORT ?? '3000'}</code>
      </p>
    </div>
  );
}
