import { ConnectionForm } from "@/components/connection-form";
import { getConnections } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function ConnectionsPage() {
  const connections = await getConnections().catch(() => []);

  return (
    <div className="content-stack">
      <section className="hero compact-hero">
        <div>
          <p className="eyebrow">Remote execution setup</p>
          <h1>Store connection metadata, test SSH access, and keep execution practical.</h1>
          <p className="lede">
            The MVP is intentionally lightweight here: it records connection settings, working
            directories, and scheduler preferences without trying to become a full cluster platform.
          </p>
        </div>
      </section>

      <ConnectionForm initialConnections={connections} />
    </div>
  );
}

