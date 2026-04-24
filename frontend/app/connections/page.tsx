import { ConnectionForm } from "@/components/connection-form";
import { getConnections } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function ConnectionsPage() {
  const connections = await getConnections().catch(() => []);

  return (
    <div className="content-stack">
      <section className="hero compact-hero">
        <div>
          <p className="eyebrow">DFT backend bridge</p>
          <h1>Store compute-host metadata, test connectivity, and prepare real execution routes.</h1>
          <p className="lede">
            This page is the connector layer for the studio: keep SSH targets, scheduler defaults,
            and working directories in one place so reviewed DFT jobs can be routed cleanly later.
          </p>
        </div>
      </section>

      <ConnectionForm initialConnections={connections} />
    </div>
  );
}

