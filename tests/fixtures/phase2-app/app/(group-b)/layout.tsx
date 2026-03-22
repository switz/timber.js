import { Link } from '@timber-js/app/client';

export default function GroupBLayout({ children }: { children: React.ReactNode }) {
  return (
    <section data-testid="group-b-layout">
      <nav>
        <Link href="/page-a" data-testid="link-group-back-a">
          Back to A
        </Link>
      </nav>
      <div>{children}</div>
    </section>
  );
}
