import { type ReactNode } from 'react';
import type { Metadata } from '@timber/app/server';
import { Link } from '@timber/app/client';
import Counter from './Counter';
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
      { href: '/errors/crash', testid: 'link-errors-crash', text: 'Crash' },
      { href: '/errors/render-error', testid: 'link-errors-render', text: 'RenderError' },
      { href: '/errors/deny-403', testid: 'link-errors-deny-403', text: 'Deny 403' },
      { href: '/errors/deny-401', testid: 'link-errors-deny-401', text: 'Deny 401' },
      { href: '/errors/deny-404', testid: 'link-errors-deny-404', text: 'Deny 404' },
    ],
  },
  {
    label: 'Middleware',
    links: [
      { href: '/middleware-test/headers', testid: 'link-mw-headers', text: 'Headers' },
      { href: '/middleware-test/inject', testid: 'link-mw-inject', text: 'Inject' },
      { href: '/middleware-test/short-circuit', testid: 'link-mw-short-circuit', text: 'Short-Circuit' },
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
      { href: '/routes-test/42', testid: 'link-routes-dynamic', text: 'Dynamic' },
      { href: '/routes-test/catch/a/b', testid: 'link-routes-catch', text: 'Catch-All' },
      { href: '/routes-test/optional', testid: 'link-routes-optional', text: 'Optional' },
      { href: '/routes-test/grouped-a', testid: 'link-routes-group-a', text: 'Group A' },
      { href: '/routes-test/grouped-b', testid: 'link-routes-group-b', text: 'Group B' },
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
    ],
  },
];

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head />
      <body className="bg-gray-50 text-gray-900 antialiased">
        <header
          data-testid="site-header"
          className="bg-white border-b border-gray-200 px-4 py-3"
        >
          <nav className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <Link href="/" data-testid="link-home" className="font-semibold text-gray-900">
              Home
            </Link>
            {navSections.map((section) => (
              <div key={section.label} className="flex items-center gap-x-2">
                <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">
                  {section.label}
                </span>
                {section.links.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    data-testid={link.testid}
                    className="text-sm text-blue-600 hover:text-blue-800 hover:underline"
                  >
                    {link.text}
                  </Link>
                ))}
              </div>
            ))}
            <Counter />
          </nav>
        </header>
        <main data-testid="main-content" className="max-w-4xl mx-auto px-4 py-8">
          {children}
        </main>
      </body>
    </html>
  );
}
