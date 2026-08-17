/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    // Post media/avatars are served from Cloudflare R2 public buckets
    // (see R2_PUBLIC_URL in .env) — either the default r2.dev domain or a
    // custom domain. Wildcard-match r2.dev so next/image can resize and
    // serve them as webp/avif instead of shipping the original file size.
    remotePatterns: [
      { protocol: "https", hostname: "*.r2.dev" },
    ],
  },
};

export default nextConfig;
