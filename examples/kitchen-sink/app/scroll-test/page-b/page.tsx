import { Link } from '@timber/app/client';
import TallContent from '../TallContent';

export default function PageB() {
  return (
    <div data-testid="scroll-page-b">
      <h1>Scroll Test — Page B</h1>
      <Link href="/scroll-test/page-a" data-testid="link-to-page-a">
        Go to Page A
      </Link>
      <TallContent id="page-b" />
    </div>
  );
}
