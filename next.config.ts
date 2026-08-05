import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // The logo-upload Server Action (uploadLogo) accepts files up to 5 MB
    // (MAX_LOGO_BYTES), but Next's default Server Action body limit is 1 MB —
    // so >1 MB logos were rejected with a 413 before the action ran. Raise the
    // framework limit to match the action's own validation.
    serverActions: {
      bodySizeLimit: "5mb",
    },
  },
  images: {
    // Allow next/image to serve Vercel Blob URLs. The store path is
    // public.blob.vercel-storage.com regardless of which store we created.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.public.blob.vercel-storage.com",
      },
    ],
  },
};

export default nextConfig;
