/** @type {import('next').NextConfig} */
const nextConfig = {
  devIndicators: false,
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  htmlLimitedBots: /.*/,
  images: {
    remotePatterns: [{ protocol: 'https', hostname: '**.supabase.co' }],
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
