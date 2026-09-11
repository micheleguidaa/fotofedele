import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // The live API route never reads the static data: keep the (large) image folder out of its function bundle.
  outputFileTracingExcludes: { "/api/enhance": ["./public/**/*"] },
  async headers() {
    // Prototype: keep it out of search engines (the <meta name="robots"> tag is set in app/layout.tsx too).
    return [{ source: "/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] }];
  },
};

export default nextConfig;
