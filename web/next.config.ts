import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // The live API route never reads the static data: keep the (large) image folder out of its function bundle.
  outputFileTracingExcludes: { "/api/enhance": ["./public/**/*"] },
  async redirects() {
    // Studio and the per-photo lab page were merged into the Foto view; the lab overview is now "Numeri".
    return [
      { source: "/studio", has: [{ type: "query", key: "foto", value: "(?<foto>[A-Z]\\d{2})" }], destination: "/foto/:foto", permanent: false },
      { source: "/studio", destination: "/", permanent: false },
      { source: "/lab", destination: "/numeri", permanent: false },
      { source: "/lab/:id", destination: "/foto/:id", permanent: false },
    ];
  },
  async headers() {
    // Prototype: keep it out of search engines (the <meta name="robots"> tag is set in app/layout.tsx too).
    return [{ source: "/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] }];
  },
};

export default nextConfig;
