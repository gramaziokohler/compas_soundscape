import type { NextConfig } from "next";
import { resolve } from "path";
import { loadEnvConfig } from "@next/env";

const projectDir = process.cwd();
loadEnvConfig(resolve(projectDir, ".."));

const nextConfig: NextConfig = {
  /* config options here */
  env: {
    // Absolute path to <workspace>/backend — evaluated once at startup from
    // next.config.ts where process.cwd() is always the frontend/ directory.
    BACKEND_DIR: resolve(projectDir, '..', 'backend'),
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
