import type { MDXComponents } from 'mdx/types';
import Link from 'next/link';
import React from 'react';

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    ...components,
    a: (props: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href?: string }) => {
      if (!props.href) throw new Error('href is required');
      return <Link {...props} />;
    },
  };
}
