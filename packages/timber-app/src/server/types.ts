// Server-side type definitions

export interface MiddlewareContext {
  req: Request;
  requestHeaders: Headers;
  headers: Headers;
  params: Record<string, string | string[]>;
  searchParams: unknown;
}

export interface RouteContext {
  req: Request;
  params: Record<string, string | string[]>;
  searchParams: URLSearchParams;
  headers: Headers;
}

export interface AccessContext {
  params: Record<string, string | string[]>;
  searchParams: unknown;
}

export interface Metadata {
  title?: string | { default?: string; template?: string; absolute?: string };
  description?: string;
  generator?: string;
  applicationName?: string;
  authors?: Array<{ name?: string; url?: string }> | { name?: string; url?: string };
  creator?: string;
  publisher?: string;
  robots?:
    | string
    | {
        index?: boolean;
        follow?: boolean;
        googleBot?: string | { index?: boolean; follow?: boolean; [key: string]: unknown };
        [key: string]: unknown;
      };
  referrer?: string;
  keywords?: string | string[];
  category?: string;
  openGraph?: {
    title?: string;
    description?: string;
    url?: string;
    siteName?: string;
    images?: string | Array<{ url: string; width?: number; height?: number; alt?: string }>;
    videos?: Array<{ url: string; width?: number; height?: number }>;
    audio?: Array<{ url: string }>;
    locale?: string;
    type?: string;
    publishedTime?: string;
    modifiedTime?: string;
    authors?: string[];
  };
  twitter?: {
    card?: string;
    site?: string;
    siteId?: string;
    title?: string;
    description?: string;
    images?:
      | string
      | string[]
      | Array<{ url: string; alt?: string; width?: number; height?: number }>;
    creator?: string;
    creatorId?: string;
  };
  icons?: {
    icon?: string | Array<{ url: string; sizes?: string; type?: string; media?: string }>;
    shortcut?: string | string[];
    apple?: string | Array<{ url: string; sizes?: string; type?: string }>;
    other?: Array<{ rel: string; url: string; sizes?: string; type?: string }>;
  };
  manifest?: string;
  alternates?: {
    canonical?: string;
    languages?: Record<string, string>;
    media?: Record<string, string>;
    types?: Record<string, string>;
  };
  verification?: {
    google?: string;
    yahoo?: string;
    yandex?: string;
    other?: Record<string, string | string[]>;
  };
  metadataBase?: URL | null;
  appleWebApp?: {
    capable?: boolean;
    title?: string;
    statusBarStyle?: string;
    startupImage?: string | Array<{ url: string; media?: string }>;
  };
  formatDetection?: { email?: boolean; address?: boolean; telephone?: boolean };
  other?: Record<string, string | string[]>;
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace MetadataRoute {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  export interface Sitemap extends Array<SitemapEntry> {}
  export interface SitemapEntry {
    url: string;
    lastModified?: Date | string;
    changeFrequency?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
    priority?: number;
  }
  export interface Robots {
    rules: Array<{
      userAgent?: string | string[];
      allow?: string | string[];
      disallow?: string | string[];
    }>;
    sitemap?: string | string[];
    host?: string;
  }
}
