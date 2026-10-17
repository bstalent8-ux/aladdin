import Link from "next/link";

/** The status a pending owner sees on every screen of the limited workspace (server-rendered; no state). */
export function PendingApprovalBanner({ title, body, linkLabel }: { title: string; body: string; linkLabel: string }) {
  return (
    <div role="status" data-testid="pending-approval-banner" className="mb-4 rounded-md border border-strong bg-surface p-4 text-body-lg text-fg">
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-fg-secondary">{body}</p>
      <Link href="/business/applications" className="mt-2 inline-block font-medium text-accent underline underline-offset-2">{linkLabel}</Link>
    </div>
  );
}
