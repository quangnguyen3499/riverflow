// next.config.ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Bundled CC0 coin icons. Content-stable filenames, so safe to freeze. Without this,
        // Vercel serves public/ with must-revalidate and all ~16 icons re-validate on every
        // reload. If an icon ever needs replacing, rename it — never rely on revalidation.
        source: '/coins/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ];
  },
};

export default nextConfig;
