import Link from 'next/link';

export function EmptyState({
  title,
  body,
  href,
  linkText,
}: {
  title: string;
  body: string;
  href: string;
  linkText: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-border bg-panel px-6 py-16 text-center">
      <p className="text-lg font-semibold text-text">{title}</p>
      <p className="max-w-md text-sm text-muted">{body}</p>
      <Link
        href={href}
        className="mt-2 rounded bg-accent px-4 py-2 text-sm font-semibold text-bg hover:opacity-90"
      >
        {linkText}
      </Link>
    </div>
  );
}
