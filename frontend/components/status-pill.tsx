export function StatusPill({ status }: { status: string }) {
  const tone = status.toLowerCase();
  const label =
    {
      pending: "待处理",
      recommended: "已推荐",
      approved: "已批准",
      validated: "已验证",
      completed: "已完成",
      failed: "失败",
      "execution-failed": "执行失败",
      running: "运行中",
      submitted: "已提交",
      queued: "排队中",
      cancelled: "已取消",
    }[tone.replace(/\s+/g, "-").replace(/_/g, "-")] ?? status.replace(/_/g, " ");

  return (
    <span className={`status-pill status-${tone.replace(/\s+/g, "-")}`}>
      {label}
    </span>
  );
}

