import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.dirname(fileURLToPath(import.meta.url));

// pnpm installs this app's node_modules entries as SYMLINKS into the store at
// <repo>/node_modules/.pnpm. An outputFileTracingIncludes glob written as
// './node_modules/<pkg>/...' therefore names a path that runs THROUGH a
// symlink — and that is only safe while nothing else puts the symlink itself
// into the same function.
//
// Adding serverExternalPackages (below) changed exactly that. Once a package
// is external, the route requires it at runtime, so the tracer records the
// pnpm symlink './node_modules/<pkg>' as its own entry AND records the real
// store files behind it. The function then contains both
//   apps/web/node_modules/<pkg>            (a symlink)
//   apps/web/node_modules/<pkg>/<binary>   (a file, from the include glob)
// and Vercel's "Deploying outputs" step, which materialises the symlink before
// it writes the file underneath it, cannot create the second path. Every
// deployment of both projects since bc1c492 died there: first as
// "ENOTDIR: not a directory, mkdir '.../apps/web/node_modules/@sparticuz/chromium'",
// then — after only chromium was moved off the symlinked form — as a silent
// ENOENT with no log line at all (deployment errorCode ENOENT, errorStep
// direct:build; verified on dpl_Fb3BJiGC21hkgnCYMBrd46n6qME1 and siblings,
// 2026-08-05). The remaining collisions were ffmpeg-static and ffprobe-static,
// whose globs looked "known-good" because 5cef761 shipped them green — but at
// 5cef761 those packages were bundled, not external, so no symlink entry
// existed to collide with.
//
// Naming the store's REAL directory keeps every traced include on a path with
// no symlink component, so nothing is ever written through one. realpathSync
// resolves it at build time, so version bumps need no edit here. Runtime
// behaviour is unchanged: Node resolves symlinks when it loads a module, so
// each package's __dirname is the store directory either way — which is where
// these globs now put the binaries.
//
// Local `next build` accepts either form; only Vercel's packaging step
// distinguishes them. That is why every local gate stayed green while both
// projects failed to deploy, and why any future include for a real dependency
// must go through this helper.
const storeGlob = (packageName, pattern) =>
  path
    .join(
      path.relative(appDir, realpathSync(path.join(appDir, 'node_modules', packageName))),
      pattern,
    )
    .split(path.sep)
    .join('/');

const chromiumBinGlob = storeGlob('@sparticuz/chromium', 'bin/**');
const ffmpegBinGlob = storeGlob('ffmpeg-static', 'ffmpeg');
const ffprobeLinuxBinGlob = storeGlob('ffprobe-static', 'bin/linux/x64/**');
const ffprobeOtherPlatformGlobs = ['bin/darwin/**', 'bin/win32/**', 'bin/linux/ia32/**'].map(
  (pattern) => storeGlob('ffprobe-static', pattern),
);

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
      ffmpegBinGlob,
      ffprobeLinuxBinGlob,
      './src/lib/clipIngest/blazeface-model/**',
    ],
    // MP4 render worker (Phase 4): headless Chromium (brotli-packed, expands
    // to /tmp at cold start) plus the exec'd ffmpeg encoder. ffprobe-static and
    // the BlazeFace weights are deliberately NOT traced here — this route never
    // uses them, and the 250MB uncompressed ceiling is why (2026-08-03
    // feasibility: chromium 66MB + ffmpeg 78.7MB + puppeteer-core 7.8MB).
    '/api/media/render-run': [chromiumBinGlob, ffmpegBinGlob],
    // The render bench (same engine, no DB/storage) execs the same two
    // binaries; without its own entry the deployed bench function would ship
    // without Chromium/ffmpeg and die at spawn — tracing includes are
    // per-route.
    '/api/media/render-bench': [chromiumBinGlob, ffmpegBinGlob],
  },
  // ffprobe-static ships every platform it supports; the all-platform bin
  // directory alone (~350MB) would blow the 250MB uncompressed function
  // ceiling the 2026-07-30 feasibility measurement was fixed against. These
  // must name the store path too, because that is the form the tracer reports
  // now that ffprobe-static is external.
  outputFileTracingExcludes: {
    '*': ffprobeOtherPlatformGlobs,
  },
};

export default nextConfig;
