import { Link } from '@timber-js/app/client';
import TallContent from '../TallContent';

export default function ParallelScrollPage() {
  return (
    <div data-testid="parallel-scroll-page">
      <h1>Parallel Scroll Test — Main</h1>
      <Link href="/scroll-test/page-a" data-testid="parallel-link-to-page-a">
        Go to Page A
      </Link>
      <TallContent id="parallel-main" />
    </div>
  );
}
