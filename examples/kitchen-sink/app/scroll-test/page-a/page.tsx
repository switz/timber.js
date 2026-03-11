import { Link } from '@timber/app/client';
import TallContent from '../TallContent';

export default function PageA() {
  return (
    <div data-testid="scroll-page-a">
      <h1>Scroll Test — Page A</h1>
      <Link href="/scroll-test/page-b" data-testid="link-to-page-b">
        Go to Page B
      </Link>
      <Link href="/scroll-test/page-b" scroll={false} data-testid="link-to-page-b-no-scroll">
        Go to Page B (no scroll)
      </Link>
      <TallContent id="page-a" />
    </div>
  );
}
