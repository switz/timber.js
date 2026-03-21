import { type ReactNode } from 'react';
import type { Metadata } from '@timber-js/app/server';
import { Link } from '@timber-js/app/client';
import Counter from './Counter';
import { LinkWithStatus, GlobalPendingIndicator } from './nav-shell';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Kitchen Sink',
    template: '%s | Kitchen Sink',
  },
  description: 'Comprehensive timber.js feature showcase',
};

const navSections = [
  {
    label: 'Streaming',
    links: [
      { href: '/streaming/suspense', testid: 'link-streaming-suspense', text: 'Suspense' },
      { href: '/streaming/deferred', testid: 'link-streaming-deferred', text: 'Deferred' },
      { href: '/streaming/deny-inside', testid: 'link-streaming-deny', text: 'Deny Inside' },
    ],
  },
  {
    label: 'Errors',
    links: [
      { href: '/errors/crash', testid: 'link-errors-crash', text: 'Crash (500)' },
      { href: '/errors/render-error', testid: 'link-errors-render', text: 'RenderError' },
      { href: '/errors/client-error', testid: 'link-errors-client', text: 'Client Error' },
      { href: '/errors/deny-403', testid: 'link-errors-deny-403', text: '403 Forbidden' },
      { href: '/errors/deny-401', testid: 'link-errors-deny-401', text: '401 Fallback' },
      { href: '/errors/deny-404', testid: 'link-errors-deny-404', text: '404 Segment' },
    ],
  },
  {
    label: 'Middleware',
    links: [
      { href: '/middleware-test/headers', testid: 'link-mw-headers', text: 'Headers' },
      { href: '/middleware-test/inject', testid: 'link-mw-inject', text: 'Inject' },
      {
        href: '/middleware-test/short-circuit',
        testid: 'link-mw-short-circuit',
        text: 'Short-Circuit',
      },
      { href: '/middleware-test/nav-target', testid: 'link-mw-nav-target', text: 'Nav Target' },
    ],
  },
  {
    label: 'Auth',
    links: [
      { href: '/auth-test/denied', testid: 'link-auth-denied', text: 'Denied' },
      { href: '/auth-test/redirect', testid: 'link-auth-redirect', text: 'Redirect' },
      { href: '/auth-test/parallel', testid: 'link-auth-parallel', text: 'Parallel Slot' },
    ],
  },
  {
    label: 'Routes',
    links: [
      { href: '/routes-test/42', testid: 'link-routes-dynamic', text: '[id] Dynamic' },
      { href: '/routes-test/catch/a/b', testid: 'link-routes-catch', text: '[...slug]' },
      {
        href: '/routes-test/optional/foo/bar/baz',
        testid: 'link-routes-optional',
        text: '[[...slug]]',
      },
      { href: '/routes-test/grouped-a', testid: 'link-routes-group-a', text: '(group-a)' },
      { href: '/routes-test/grouped-b', testid: 'link-routes-group-b', text: '(group-b)' },
      { href: '/gallery', testid: 'link-gallery', text: 'Intercepting (Modal)' },
      { href: '/parallel-test', testid: 'link-parallel-test', text: 'Parallel Slots' },
      { href: '/nested-layouts', testid: 'link-nested-layouts', text: 'Nested Layouts' },
    ],
  },
  {
    label: 'Forms',
    links: [{ href: '/forms-test', testid: 'link-forms', text: 'Validated Form' }],
  },
  {
    label: 'Pending',
    links: [
      { href: '/pending-test', testid: 'link-pending-test', text: 'Slow Page (2s)' },
    ],
  },
  {
    label: 'Other',
    links: [
      { href: '/search-params-test', testid: 'link-search-params', text: 'Search Params' },
      { href: '/meta-test', testid: 'link-meta-test', text: 'Meta: Title' },
      { href: '/meta-test/absolute', testid: 'link-meta-absolute', text: 'Meta: Absolute' },
      { href: '/meta-test/abc', testid: 'link-meta-dynamic', text: 'Meta: Dynamic' },
      { href: '/scroll-test/page-a', testid: 'link-scroll-page-a', text: 'Scroll A' },
      { href: '/scroll-test/page-b', testid: 'link-scroll-page-b', text: 'Scroll B' },
      { href: '/scroll-test/parallel', testid: 'link-scroll-parallel', text: 'Scroll Parallel' },
      { href: '/mdx-test', testid: 'link-mdx-page', text: 'MDX Page' },
    ],
  },
];

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head />
      <body className="bg-stone-50 text-stone-800 antialiased">
        <div className="flex h-dvh">
          <GlobalPendingIndicator />
          <aside
            data-testid="site-header"
            className="w-56 shrink-0 bg-stone-900 text-stone-300 overflow-y-auto"
          >
            <nav className="p-4 flex flex-col gap-6">
              <Link
                href="/"
                data-testid="link-home"
                className="text-lg font-bold text-white tracking-tight"
              >
                timber.js
              </Link>
              <div className="text-xs text-stone-600">
                <Counter />
              </div>
              {navSections.map((section) => (
                <div key={section.label}>
                  <h3 className="text-[11px] font-semibold uppercase tracking-wider text-stone-500 mb-2">
                    {section.label}
                  </h3>
                  <ul className="space-y-0.5">
                    {section.links.map((link) =>
                      section.label === 'Pending' ? (
                        <li key={link.href}>
                          <LinkWithStatus
                            href={link.href}
                            testid={link.testid}
                            text={link.text}
                          />
                        </li>
                      ) : (
                        <li key={link.href}>
                          <Link
                            href={link.href}
                            data-testid={link.testid}
                            className="block text-sm py-1 px-2 rounded text-stone-400 hover:text-white hover:bg-stone-800 transition-colors"
                          >
                            {link.text}
                          </Link>
                        </li>
                      )
                    )}
                  </ul>
                </div>
              ))}
            </nav>
          </aside>
          <main data-testid="main-content" className="flex-1 p-8 overflow-y-auto">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
