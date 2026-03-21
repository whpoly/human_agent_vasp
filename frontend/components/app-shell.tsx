import Link from "next/link";
import type { ReactNode } from "react";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Human-in-the-loop VASP assistant</p>
          <Link className="brand" href="/">
            VASP Workflow Copilot
          </Link>
        </div>
        <nav className="nav-links">
          <Link href="/">Workflows</Link>
          <Link href="/connections">SSH Connections</Link>
        </nav>
      </header>
      <main className="page-frame">{children}</main>
    </div>
  );
}

