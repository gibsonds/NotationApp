import type { NextConfig } from "next";

// When STATIC_EXPORT=1 (set by the GitHub Pages workflow), build a fully
// static, server-less bundle suitable for `gh-pages`. The AI features are
// disabled in this mode — clients detect NEXT_PUBLIC_STATIC_EXPORT and show
// a banner pointing users at local-dev for AI generation.
const isStaticExport = process.env.STATIC_EXPORT === "1";

const nextConfig: NextConfig = {
  devIndicators: false,
  ...(isStaticExport
    ? {
        output: "export" as const,
        basePath: "/NotationApp",
        images: { unoptimized: true },
        trailingSlash: true,
      }
    : {}),
  env: {
    NEXT_PUBLIC_STATIC_EXPORT: isStaticExport ? "1" : "",
  },
};

export default nextConfig;
