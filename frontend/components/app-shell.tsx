import Link from "next/link";
import type { ReactNode } from "react";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">人机协同 DFT 流程</p>
          <Link className="brand" href="/">
            DFT 智能工作室
          </Link>
        </div>
        <nav className="nav-links">
          <Link href="/">流程首页</Link>
          <Link href="/sessions">工作条目</Link>
          <Link href="/connections">计算配置</Link>
        </nav>
      </header>
      <main className="page-frame">{children}</main>
    </div>
  );
}

