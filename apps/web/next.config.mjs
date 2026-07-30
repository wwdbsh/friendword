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
  // Video ingest worker (Phase 3a): the exec'd ffmpeg/ffprobe binaries and the
  // vendored BlazeFace weights are opened with fs, so the bundler cannot see
  // them — they must be traced in by hand. Everything ffprobe-static ships for
  // OTHER platforms is traced OUT, because the all-platform bin directory alone
  // (~350MB) would blow the 250MB uncompressed function ceiling the
  // 2026-07-30 feasibility measurement was fixed against.
  outputFileTracingIncludes: {
    '/api/media/ingest-run': [
      './node_modules/ffmpeg-static/ffmpeg',
      './node_modules/ffprobe-static/bin/linux/x64/**',
      './src/lib/clipIngest/blazeface-model/**',
    ],
  },
  outputFileTracingExcludes: {
    '*': [
      './node_modules/ffprobe-static/bin/darwin/**',
      './node_modules/ffprobe-static/bin/win32/**',
      './node_modules/ffprobe-static/bin/linux/ia32/**',
    ],
  },
};

export default nextConfig;
