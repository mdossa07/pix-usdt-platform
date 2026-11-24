import type { ReactNode } from 'react';
import Link from 'next/link';

export default function WorkspaceShell({ children, area }: { children: ReactNode; area: string }) {
  return (
    <div className="workspace-page-shell">
      <header className="workspace-topbar">
        <Link href="/" className="workspace-brand" aria-label="PixSplit — início">
          <span className="brand-mark">p</span>
          <span><span className="workspace-brand-name">pixsplit</span><span className="workspace-brand-caption">PAYMENTS PLATFORM</span></span>
        </Link>
        <span className="workspace-area-label">{area}</span>
      </header>
      <main className="workspace-content">{children}</main>
    </div>
  );
}
