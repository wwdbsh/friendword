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
  // ffmpeg-static resolves its exec'd binary with __dirname at require time.
  // Bundled into a route chunk, that __dirname becomes .next*/server/app/... and
  // the spawn ENOENTs (found by the Phase 4 render-run e2e under `next start`).
  // Externalized, the module loads from its real node_modules directory — where
  // the binary actually lives and where the tracing includes below already put
  // it in the deployed bundle.
  // Both packages resolve their binary as path.join(__dirname, ...) at module
  // scope. Bundled, __dirname becomes the route chunk's directory and the
  // resolved path points at a file that is not there, so the spawn fails with
  // ENOENT — reproduced locally under `next start`. Externalized, the module
  // loads from its real node_modules directory, where the binary actually
  // lives and where the tracing includes below already put it.
  //
  // ffprobe-static belongs here for the same reason ffmpeg-static does: the
  // ingest route execs BOTH, and its ffprobe path was still being rewritten
  // after ffmpeg alone was externalized (the package source was inlined into
  // .next-build/server/app/api/media/ingest-run/route.js). That route has
  // never run in production — it answers 501 until FRIENDWORD_MEDIA_INGEST_SECRET
  // is set — which is why a broken binary path went unnoticed.
  serverExternalPackages: ['ffmpeg-static', 'ffprobe-static'],
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
    // MP4 render worker (Phase 4): headless Chromium (brotli-packed, expands
    // to /tmp at cold start) plus the exec'd ffmpeg encoder. ffprobe-static and
    // the BlazeFace weights are deliberately NOT traced here — this route never
    // uses them, and the 250MB uncompressed ceiling is why (2026-08-03
    // feasibility: chromium 66MB + ffmpeg 78.7MB + puppeteer-core 7.8MB).
    '/api/media/render-run': [
      './node_modules/ffmpeg-static/ffmpeg',
      './node_modules/@sparticuz/chromium/bin/**',
    ],
    // The render bench (same engine, no DB/storage) execs the same two
    // binaries; without its own entry the deployed bench function would ship
    // without Chromium/ffmpeg and die at spawn — tracing includes are
    // per-route.
    '/api/media/render-bench': [
      './node_modules/ffmpeg-static/ffmpeg',
      './node_modules/@sparticuz/chromium/bin/**',
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
