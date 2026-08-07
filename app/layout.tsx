import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import Link from 'next/link';
import { Toaster } from 'sonner';
import { CommandPalette } from '@/components/CommandPalette';
import { ConnectionBadge } from '@/components/ConnectionBadge';
import { OfflineBanner } from '@/components/OfflineBanner';
import { HeaderBalance } from '@/components/HeaderBalance';
import { MarketFeedProvider } from '@/components/MarketFeedProvider';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Riverflow — Live Crypto Paper Trading',
  description:
    'Realtime crypto markets with a $100,000 paper-trading balance. Demo application — not financial advice.',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body
        suppressHydrationWarning
        className={`${geistSans.variable} ${geistMono.variable} flex min-h-screen flex-col bg-bg text-text antialiased`}
      >
        <MarketFeedProvider />
        <CommandPalette />
        <header className="sticky top-0 z-40 border-b border-border bg-bg/90 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:gap-6">
            <Link
              href="/"
              className="flex shrink-0 items-center gap-2 text-sm font-bold tracking-widest"
            >
              <span className="text-accent">◆</span> RIVERFLOW
            </Link>
            {/* min-w-0 + overflow-x-auto: the nav is the widest flexible item, so it is what must
                give way on a narrow phone. Without this the whole document scrolls sideways. */}
            <nav className="flex min-w-0 items-center gap-3 overflow-x-auto text-sm text-muted sm:gap-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <Link href="/" className="shrink-0 transition-colors hover:text-text">
                Markets
              </Link>
              <Link
                href="/stocks"
                className="flex shrink-0 items-center gap-1 transition-colors hover:text-text"
              >
                Stocks
                {/* Provenance-neutral on purpose: in the default fixture mode the stocks data is
                    synthetic, so a global "EOD" badge here would claim more than the page can back. */}
                <span className="rounded border border-border px-1 text-[10px] leading-4">
                  US
                </span>
              </Link>
              <Link href="/watchlist" className="shrink-0 transition-colors hover:text-text">
                Watchlist
              </Link>
              <Link href="/portfolio" className="shrink-0 transition-colors hover:text-text">
                Portfolio
              </Link>
            </nav>
            <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
              <span className="hidden items-center gap-1 rounded border border-border px-2 py-1 text-xs text-muted sm:flex">
                Search
                <kbd className="rounded bg-panel2 px-1 font-mono">⌘K</kbd>
              </span>
              <ConnectionBadge />
              <HeaderBalance />
            </div>
          </div>
        </header>
        <main className="flex-1">
          <div className="mx-auto max-w-7xl px-4 pt-4 empty:hidden">
            <OfflineBanner />
          </div>
          {children}
        </main>
        <footer className="border-t border-border py-6 text-center text-xs text-muted">
          <div className="mx-auto max-w-7xl space-y-2 px-4">
            <p>
              Charts by{' '}
              <a
                href="https://www.lightweight-charts.com"
                target="_blank"
                rel="noopener noreferrer"
                className="underline transition-colors hover:text-text"
              >
                lightweight-charts
              </a>{' '}
              lightweight-charts
            </p>
            <p>
              Demo application. Simulated trading with fictional funds — not
              financial advice.
            </p>
          </div>
        </footer>
        <Toaster
          theme="dark"
          position="bottom-right"
          toastOptions={{
            style: {
              background: '#1e2329',
              border: '1px solid #2b3139',
              color: '#eaecef',
            },
          }}
        />
      </body>
    </html>
  );
}
