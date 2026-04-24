import type { NextConfig } from "next";
import { resolve } from "path";
import { loadEnvConfig } from "@next/env";

const projectDir = process.cwd();
loadEnvConfig(resolve(projectDir, ".."));

const nextConfig: NextConfig = {
  /* config options here */
  transpilePackages: ['@speckle/viewer', '@speckle/shared'],
  turbopack: {
    resolveExtensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
    resolveAlias: {
      '#lodash': 'lodash-es',
    },
  },
};

export default nextConfig;
