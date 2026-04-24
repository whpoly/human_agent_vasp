import { ConnectionForm } from "@/components/connection-form";
import { getConnections } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function ConnectionsPage() {
  const connections = await getConnections().catch(() => []);

  return (
    <div className="content-stack">
      <section className="hero compact-hero">
        <div>
          <p className="eyebrow">DFT 后端桥接</p>
          <h1>保存计算主机元数据、测试连接，并准备真实执行路径。</h1>
          <p className="lede">
            这里是工作室的连接层：集中管理 SSH 目标、调度器默认值和工作目录，让审查后的
            DFT 作业可以清晰地路由到后端。
          </p>
        </div>
      </section>

      <ConnectionForm initialConnections={connections} />
    </div>
  );
}

