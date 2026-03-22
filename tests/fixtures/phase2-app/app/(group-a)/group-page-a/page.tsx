import { Link } from '@timber-js/app/client';

export default function GroupPageA() {
  return (
    <div data-testid="group-page-a">
      <h1>Group A - Page A</h1>
      <Link href="/group-page-b" data-testid="link-group-page-b">
        Go to Page B
      </Link>
    </div>
  );
}
