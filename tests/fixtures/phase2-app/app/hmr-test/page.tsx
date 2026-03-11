/// <reference types="vite/client" />
/**
 * HMR test page — server component.
 *
 * Used by tests/e2e/hmr.test.ts to verify:
 * - Server component edits trigger RSC re-render without full page reload
 * - Layout edits propagate to child pages
 */
import { HmrCounter } from './hmr-counter';
import { SHARED_VALUE } from './shared-module';
import './hmr-test.css';

export default function HmrTestPage() {
  return (
    <div data-testid="hmr-test-page">
      <h1 data-testid="hmr-server-text">Hello HMR</h1>
      <p data-testid="hmr-shared-value">shared:{SHARED_VALUE}</p>
      <HmrCounter />
      <div data-testid="hmr-styled-box" className="hmr-box">
        Styled box
      </div>
    </div>
  );
}
