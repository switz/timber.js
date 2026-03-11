// MIGRATION: template.tsx is not a file convention in timber.js.
// See app/_hooks/template.tsx for explanation.
import React from 'react';

export default function Template({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
