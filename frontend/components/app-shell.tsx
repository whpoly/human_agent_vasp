import Link from "next/link";
import type { ReactNode } from "react";

import { GlobalAiConfigMenu } from "@/components/ai-config-panel";

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
        <GlobalAiConfigMenu />
      </header>
      <main className="page-frame">{children}</main>
    </div>
  );
}

