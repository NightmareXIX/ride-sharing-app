import path from 'node:path';
import type { NextConfig } from 'next';

// Where the Express API lives. Rewrites are resolved at build time, so this must be set
// when building (a Docker build arg, or a Vercel build env var).
const apiUrl = process.env.API_URL ?? 'http://localhost:4000';

const repoRoot = path.join(import.meta.dirname, '../..');

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image.
  output: 'standalone',
  // npm workspaces hoist dependencies to the repo root, so tracing starts there.
  outputFileTracingRoot: repoRoot,
  turbopack: { root: repoRoot },
  // The browser only ever talks to this site; API calls are proxied so the auth cookie
  // stays first-party across the two hosts (NFR §1).
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${apiUrl}/api/v1/:path*` }];
  },
};

export default nextConfig;
