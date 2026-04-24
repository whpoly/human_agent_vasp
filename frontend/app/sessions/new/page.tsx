import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { SessionCreateForm } from "@/components/session-create-form";

export default function NewSessionPage() {
  return (
    <div className="content-stack">
      <section className="hero compact-hero">
        <div className="hero-copy">
          <p className="eyebrow">创建工作条目</p>
          <h1>先定义任务，再进入流程工具。</h1>
          <p className="lede">
            创建完成后会进入独立流程工作区，按步骤打开工具、完成或报错返回，最后提交计算。
          </p>
          <div className="hero-actions">
            <Link className="secondary-link icon-button-label" href="/sessions">
              <ArrowLeft size={16} />
              返回工作条目
            </Link>
          </div>
        </div>
      </section>

      <SessionCreateForm />
    </div>
  );
}
