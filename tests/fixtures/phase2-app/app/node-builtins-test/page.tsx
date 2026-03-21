/**
 * Test page: verifies Node.js builtins work in server components.
 * Regression test for LOCAL-327.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

const als = new AsyncLocalStorage<string>();

export default function NodeBuiltinsPage() {
  const uuid = randomUUID();
  const alsValue = als.run('test-value', () => als.getStore());

  return (
    <div data-testid="node-builtins">
      <p data-testid="uuid">{uuid}</p>
      <p data-testid="als-value">{alsValue}</p>
    </div>
  );
}
