import type { NextConfig } from "next";

// When STATIC_EXPORT=1 (set by the GitHub Pages workflow), build a fully
// static, server-less bundle suitable for `gh-pages`. The AI features are
// disabled in this mode — clients detect NEXT_PUBLIC_STATIC_EXPORT and show
// a banner pointing users at local-dev for AI generation.
const isStaticExport = process.env.STATIC_EXPORT === "1";

// GitHub Pages serves the legacy instance under /NotationApp; the
// authenticated instance (CloudFront) is served at the root. BASE_PATH=""
// (or any explicit value) overrides the Pages default at build time.
const basePath = process.env.BASE_PATH ?? "/NotationApp";

const nextConfig: NextConfig = {
  devIndicators: false,
  ...(isStaticExport
    ? {
        output: "export" as const,
        ...(basePath ? { basePath } : {}),
        images: { unoptimized: true },
        trailingSlash: true,
      }
    : {}),
  env: {
    NEXT_PUBLIC_STATIC_EXPORT: isStaticExport ? "1" : "",
    NEXT_PUBLIC_BASE_PATH: isStaticExport ? basePath : "",
  },
};

export default nextConfig;
