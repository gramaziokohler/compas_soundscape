import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  transpilePackages: ['@speckle/viewer', '@speckle/shared'],
  experimental: {
    turbo: {
      resolveExtensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
      resolveAlias: {
        '#lodash': 'lodash-es',
      },
    },
  },
};

export default nextConfig;
