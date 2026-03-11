import '#/styles/globals.css';

import db from '#/lib/db';
import Byline from '#/ui/byline';
import { GlobalNav } from '#/ui/global-nav';
// MIGRATION: Replaced 'next' Metadata type with timber's Metadata type
import type { Metadata } from '@timber/app/server';
// MIGRATION: next/font/google shim currently only exports a default function,
// not named exports (timber-rlm). Stub out the font objects directly until fixed.
const geistSans = { variable: '' };
const geistMono = { variable: '' };

export const metadata: Metadata = {
  title: { default: 'timber.js Playground', template: '%s | timber.js Playground' },
  description:
    'A playground to explore timber.js features such as nested layouts, instant loading states, streaming, and component level data fetching.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const demos = db.demo.findMany();
  return (
    <html lang="en" className="[color-scheme:dark]">
      <body
        className={`overflow-y-scroll bg-gray-950 font-sans ${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <div className="fixed top-0 z-10 flex w-full flex-col border-b border-gray-800 bg-black lg:bottom-0 lg:z-auto lg:w-72 lg:border-r lg:border-b-0 lg:border-gray-800">
          <GlobalNav items={demos} />
        </div>

        <div className="lg:pl-72">
          <div className="mx-auto mt-12 mb-24 max-w-4xl -space-y-[1px] lg:px-8 lg:py-8">
            {children}

            <Byline />
          </div>
        </div>
      </body>
    </html>
  );
}
