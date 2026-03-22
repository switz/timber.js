import { Link } from '@timber-js/app/client';

export default function GroupPageB() {
  return (
    <div data-testid="group-page-b">
      <h1>Group A - Page B</h1>
      <Link href="/group-page-a" data-testid="link-group-page-a">
        Go to Page A
      </Link>
    </div>
  );
}
