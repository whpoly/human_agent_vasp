export function StatusPill({ status }: { status: string }) {
  const tone = status.toLowerCase();
  return (
    <span className={`status-pill status-${tone.replace(/\s+/g, "-")}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

