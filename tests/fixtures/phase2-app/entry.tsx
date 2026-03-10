/**
 * Client entry for the Phase 2 E2E fixture app.
 *
 * This is a temporary bootstrap that renders the fixture app as a client-side
 * SPA. Once timber's routing and entry plugins are functional, this file will
 * be replaced by the framework's virtual browser entry module.
 *
 * The fixture uses a minimal pathname-based router to serve routes that the
 * E2E tests expect. All route components are imported eagerly — no code
 * splitting needed for a test fixture.
 */
import { createRoot } from 'react-dom/client';
import { StrictMode } from 'react';
import { App } from './app-router';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
