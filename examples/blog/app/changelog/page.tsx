import { allChangelogs } from 'content-collections';

export const metadata = { title: 'Changelog' };

export default function ChangelogPage() {
  const releases = allChangelogs
    .sort((a, b) => b.date.getTime() - a.date.getTime());

  return (
    <div data-testid="changelog">
      <h1>Changelog</h1>
      {releases.map((release) => (
        <section key={release.version} data-testid="changelog-release">
          <h2>v{release.version}</h2>
          <time dateTime={release.date.toISOString()}>
            {release.date.toLocaleDateString()}
          </time>
          <ul>
            {release.changes.map((change, i) => (
              <li key={i} data-testid="changelog-change">
                <strong>{change.type}:</strong> {change.description}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
