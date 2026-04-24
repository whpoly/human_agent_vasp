import Link from "next/link";
import type { ReactNode } from "react";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Human-in-the-loop DFT platform</p>
          <Link className="brand" href="/">
            DFT Agent Studio
          </Link>
        </div>
        <nav className="nav-links">
          <Link href="/">Workbench</Link>
          <Link href="/connections">Compute Links</Link>
        </nav>
      </header>
      <main className="page-frame">{children}</main>
    </div>
  );
}

