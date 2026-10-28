import type { NextConfig } from "next";
import { resolve } from "path";
import { loadEnvConfig } from "@next/env";

const projectDir = process.cwd();
loadEnvConfig(resolve(projectDir, ".."));

// Who may embed the public share page (/share/<id>) in an iframe. CSP
// `frame-ancestors` syntax, e.g. "'self' https://example.com"; default: anyone.
const SHARE_FRAME_ANCESTORS = process.env.SHARE_FRAME_ANCESTORS || '*';

const nextConfig: NextConfig = {
  /* config options here */
  env: {
    // Absolute path to <workspace>/backend — evaluated once at startup from
    // next.config.ts where process.cwd() is always the frontend/ directory.
    BACKEND_DIR: resolve(projectDir, '..', 'backend'),
  },
  async headers() {
    return [
      {
        source: '/share/:path*',
        headers: [{ key: 'Content-Security-Policy', value: `frame-ancestors ${SHARE_FRAME_ANCESTORS}` }],
      },
    ];
  },
  transpilePackages: ['@speckle/viewer', '@speckle/shared'],
  turbopack: {
    resolveExtensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
    resolveAlias: {
      '#lodash': 'lodash-es',
    },
  },
};

export default nextConfig;
