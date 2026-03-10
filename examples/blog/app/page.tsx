import { Link } from '@timber/app/client';

export const metadata = { title: 'Home' };

export default function Home() {
  return (
    <div data-testid="home-content">
      <h1>timber.js Blog Example</h1>
      <p>A blog built with content collections and MDX.</p>
      <Link href="/blog">Read the blog</Link>
    </div>
  );
}
