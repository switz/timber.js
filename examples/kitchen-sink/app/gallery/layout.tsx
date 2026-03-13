import type { ReactNode } from 'react';

export default function GalleryLayout({
  children,
  modal,
}: {
  children: ReactNode;
  modal: ReactNode;
}) {
  return (
    <div data-testid="gallery-layout">
      {children}
      {modal}
    </div>
  );
}
