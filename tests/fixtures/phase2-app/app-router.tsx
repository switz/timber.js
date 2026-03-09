/**
 * Minimal client-side router for the Phase 2 E2E fixture app.
 *
 * Temporary replacement for timber's segment router. Provides pathname-based
 * routing so E2E smoke tests can validate the fixture infrastructure.
 *
 * Once timber's client navigation runtime is wired up, this file will be
 * removed — the framework's segment router handles all routing.
 */
import { useState, useEffect, useCallback } from 'react';

// Route components
import { RootShell } from './app/root-shell';
import HomePage from './app/page';
import { DashboardShell } from './app/dashboard/dashboard-shell';
import DashboardPage from './app/dashboard/page';
import SettingsPage from './app/dashboard/settings/page';
import TodosPage from './app/todos/page';
import SlowPage from './app/slow-page/page';

function usePathname(): [string, (path: string) => void] {
  const [pathname, setPathname] = useState(window.location.pathname);

  useEffect(() => {
    function onPopState() {
      setPathname(window.location.pathname);
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback((path: string) => {
    window.history.pushState(null, '', path);
    setPathname(path);
  }, []);

  return [pathname, navigate];
}

function resolveRoute(pathname: string) {
  // Strip trailing slash for matching (keep "/" as-is)
  const path = pathname === '/' ? '/' : pathname.replace(/\/$/, '');

  if (path === '/') return { page: 'home', layout: 'root' } as const;
  if (path === '/dashboard') return { page: 'dashboard', layout: 'dashboard' } as const;
  if (path === '/dashboard/settings') return { page: 'settings', layout: 'dashboard' } as const;
  if (path === '/todos') return { page: 'todos', layout: 'root' } as const;
  if (path === '/slow-page') return { page: 'slow', layout: 'root' } as const;
  return { page: 'notfound', layout: 'root' } as const;
}

export function App() {
  const [pathname, _navigate] = usePathname();
  const route = resolveRoute(pathname);

  let content: React.ReactNode;

  switch (route.page) {
    case 'home':
      content = <HomePage />;
      break;
    case 'dashboard':
      content = (
        <DashboardShell>
          <DashboardPage />
        </DashboardShell>
      );
      break;
    case 'settings':
      content = (
        <DashboardShell>
          <SettingsPage />
        </DashboardShell>
      );
      break;
    case 'todos':
      content = <TodosPage />;
      break;
    case 'slow':
      content = <SlowPage />;
      break;
    case 'notfound':
      content = <div>404 — Not Found</div>;
      break;
  }

  return <RootShell>{content}</RootShell>;
}
