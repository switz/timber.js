import { Suspense } from 'react';
import Counter from '../Counter';

export const metadata = { title: 'Dashboard' };

async function SlowData() {
  return <p>Dashboard data loaded</p>;
}

export default function DashboardPage() {
  return (
    <div>
      <h1>Dashboard</h1>
      <Counter />
      <Suspense fallback={<p>Loading data...</p>}>
        <SlowData />
      </Suspense>
    </div>
  );
}
