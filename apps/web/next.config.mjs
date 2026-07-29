/** @type {import('next').NextConfig} */
const nextConfig = {
  devIndicators: false,
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  htmlLimitedBots: /.*/,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.supabase.co' },
      // Local Supabase stack (supabase start) for on-device QA. Dev only:
      // production builds must never fetch images from a loopback host.
      ...(process.env.NODE_ENV === 'production'
        ? []
        : [{ protocol: 'http', hostname: '127.0.0.1' }]),
    ],
  },
  transpilePackages: [
    '@friendword/adapters',
    '@friendword/contracts',
    '@friendword/data',
    '@friendword/domain',
    '@friendword/ui-tokens',
  ],
};

export default nextConfig;
