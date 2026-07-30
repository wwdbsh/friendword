// PHASE 3A — the ingest probe's refusal set and the silent-proxy invariant.
//
// These tests run the REAL bundled ffmpeg/ffprobe binaries against fixtures
// generated on the spot, because the two claims they pin are claims about
// bytes, not about argument strings:
//
//   1. The probe refuses everything outside the allowlist: a webm container, a
//      16-second clip, a file over the byte cap, and bytes that are not video.
//   2. The proxy the pipeline uploads carries ZERO audio streams (ffprobe is
//      the witness) and none of the source's metadata. Deleting `-an` or
//      `-map_metadata -1` from the transcode arguments turns these red.
//   3. A source whose mvhd/tkhd/mdhd were patched to claim 4.8s while carrying
//      30s of frames passes the probe — so the proxy is hard-cut at 15s (`-t`)
//      and the proxy's own re-probed duration is the recorded authority.
//      Deleting `-t` from the transcode arguments turns these red.
/* global beforeAll, describe, expect, it */

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { resolveFfmpegPath, resolveFfprobePath } from '../src/lib/clipIngest/binaries';
import {
  CLIP_MAX_SOURCE_DURATION_MS,
  probeClipFile,
  videoMaxBytes,
} from '../src/lib/clipIngest/probe';
import {
  assertSilentProxy,
  buildSilentProxyArgs,
  extractModerationFrames,
  extractPoster,
  probeProxyStreams,
  PROXY_MAX_DURATION_SECONDS,
  PROXY_MAX_MEASURED_DURATION_MS,
  transcodeToSilentProxy,
} from '../src/lib/clipIngest/transcode';

const execFileAsync = promisify(execFile);

let workDir: string;
let okMp4: string;
let okMov: string;
let webm: string;
let sixteenSeconds: string;
let notVideo: string;
let lyingThirty: string;

async function generate(args: readonly string[]): Promise<void> {
  await execFileAsync(resolveFfmpegPath(), ['-y', ...args], { maxBuffer: 4 * 1024 * 1024 });
}

/**
 * The verifier's attack, reproduced as a fixture: patch the duration fields of
 * every mvhd/tkhd/mdhd box so the container CLAIMS `claimedSeconds` while the
 * sample tables still carry all the real frames. ffprobe reads the patched
 * headers, so the file probes at the claimed duration.
 */
async function forgeClaimedDuration(
  realPath: string,
  forgedPath: string,
  claimedSeconds: number,
): Promise<void> {
  const bytes = Buffer.from(await readFile(realPath));
  const moovAt = bytes.indexOf(Buffer.from('moov', 'ascii'));
  expect(moovAt).toBeGreaterThan(-1);

  // mvhd/mdhd (version 0): [tag(4)][version(1)+flags(3)][creation(4)]
  // [modification(4)][timescale(4)][duration(4)] — duration sits at tag+20 in
  // the box's own timescale (tag+16).
  const patchTimescaledBox = (tag: 'mvhd' | 'mdhd'): number => {
    let timescale = 0;
    let at = bytes.indexOf(Buffer.from(tag, 'ascii'), moovAt);
    expect(at).toBeGreaterThan(-1);
    while (at !== -1) {
      expect(bytes[at + 4]).toBe(0);
      timescale = bytes.readUInt32BE(at + 16);
      bytes.writeUInt32BE(Math.round(claimedSeconds * timescale), at + 20);
      at = bytes.indexOf(Buffer.from(tag, 'ascii'), at + 4);
    }
    return timescale;
  };

  const movieTimescale = patchTimescaledBox('mvhd');
  patchTimescaledBox('mdhd');

  // tkhd (version 0): duration sits at tag+24, in the MOVIE timescale.
  let tkhdAt = bytes.indexOf(Buffer.from('tkhd', 'ascii'), moovAt);
  expect(tkhdAt).toBeGreaterThan(-1);
  while (tkhdAt !== -1) {
    expect(bytes[tkhdAt + 4]).toBe(0);
    bytes.writeUInt32BE(Math.round(claimedSeconds * movieTimescale), tkhdAt + 24);
    tkhdAt = bytes.indexOf(Buffer.from('tkhd', 'ascii'), tkhdAt + 4);
  }

  await writeFile(forgedPath, bytes);
}

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'clip-probe-test-'));
  okMp4 = join(workDir, 'ok.mp4');
  okMov = join(workDir, 'ok.mov');
  webm = join(workDir, 'refuse.webm');
  sixteenSeconds = join(workDir, 'sixteen.mp4');
  notVideo = join(workDir, 'not-video.mp4');
  lyingThirty = join(workDir, 'lying-thirty.mp4');

  // A representative source: video + AN AUDIO TRACK + location metadata, so the
  // proxy assertions below prove something was actually stripped.
  await generate([
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=160x284:rate=15',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:sample_rate=22050',
    '-t',
    '2',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-c:a',
    'aac',
    '-metadata',
    'location=+37.5665+126.9780/',
    okMp4,
  ]);
  await generate([
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=160x284:rate=15',
    '-t',
    '1',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    okMov,
  ]);
  await generate([
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=160x284:rate=15',
    '-t',
    '1',
    '-c:v',
    'libvpx',
    webm,
  ]);
  await generate([
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=160x284:rate=15',
    '-t',
    '16',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    sixteenSeconds,
  ]);
  await writeFile(notVideo, 'this is not a video at all');

  // A REAL 30-second clip whose headers will be forged to claim 4.8s.
  const thirtyReal = join(workDir, 'thirty-real.mp4');
  await generate([
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=160x284:rate=15',
    '-t',
    '30',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    thirtyReal,
  ]);
  await forgeClaimedDuration(thirtyReal, lyingThirty, 4.8);
}, 120_000);

describe('clip ingest probe — the refusal set', () => {
  it('accepts an mp4/H.264 clip inside every cap and measures it', async () => {
    const result = await probeClipFile(okMp4);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.videoCodec).toBe('h264');
      expect(result.durationMs).toBeGreaterThan(1500);
      expect(result.durationMs).toBeLessThanOrEqual(CLIP_MAX_SOURCE_DURATION_MS);
      expect(result.width).toBe(160);
      expect(result.height).toBe(284);
    }
  });

  it('accepts a mov container', async () => {
    const result = await probeClipFile(okMov);
    expect(result.ok).toBe(true);
  });

  it('refuses a webm container', async () => {
    const result = await probeClipFile(webm);
    expect(result).toMatchObject({ ok: false, reason: 'only mp4 and mov clips are accepted' });
  });

  it('refuses a 16-second clip', async () => {
    const result = await probeClipFile(sixteenSeconds);
    expect(result).toMatchObject({
      ok: false,
      reason: 'clips longer than 15 seconds are not accepted',
    });
  });

  it('refuses a file over the byte cap', async () => {
    const size = (await stat(okMp4)).size;
    const result = await probeClipFile(okMp4, { maxBytes: size - 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('ceiling');
    }
  });

  it('refuses bytes that are not a video', async () => {
    const result = await probeClipFile(notVideo);
    expect(result.ok).toBe(false);
  });

  it('reads the byte cap from FRIENDWORD_VIDEO_MAX_BYTES with a 50MB default', () => {
    expect(videoMaxBytes({})).toBe(52_428_800);
    expect(videoMaxBytes({ FRIENDWORD_VIDEO_MAX_BYTES: '1000000' })).toBe(1_000_000);
    expect(videoMaxBytes({ FRIENDWORD_VIDEO_MAX_BYTES: 'not-a-number' })).toBe(52_428_800);
  });
});

describe('clip ingest proxy — structurally silent, metadata-free', () => {
  it('produces a proxy whose ffprobe stream list has ZERO audio streams', async () => {
    const proxyPath = join(workDir, 'proxy.mp4');
    await transcodeToSilentProxy(okMp4, proxyPath);

    // The witness is ffprobe reading the produced bytes, not the argument
    // list: remove `-an` from buildSilentProxyArgs and the source's aac track
    // survives into the proxy, audioStreams becomes 1, and this fails.
    const facts = await probeProxyStreams(proxyPath);
    expect(facts.audioStreams).toBe(0);
    expect(facts.width).toBe(1080);
    expect(facts.height).toBe(1920);
    // The asserted facts carry the artifact's MEASURED duration (a ~2s source
    // proxies at ~2s) — the value the pipeline records.
    const asserted = await assertSilentProxy(proxyPath);
    expect(asserted.durationMs).toBeGreaterThan(1_500);
    expect(asserted.durationMs).toBeLessThan(3_000);

    // -map_metadata -1: the source carried a GPS location tag; the proxy's
    // format tags must not.
    const { stdout } = await execFileAsync(
      resolveFfprobePath(),
      ['-v', 'error', '-show_entries', 'format_tags', '-of', 'json', proxyPath],
      { maxBuffer: 1024 * 1024 },
    );
    const tags = JSON.stringify(
      (JSON.parse(stdout) as { format?: { tags?: Record<string, string> } }).format?.tags ?? {},
    ).toLowerCase();
    expect(tags).not.toContain('location');
    expect(tags).not.toContain('37.5665');
  }, 60_000);

  it('pins the argument pairs the privacy claims ride on', () => {
    const args = buildSilentProxyArgs('in.mp4', 'out.mp4');
    expect(args).toContain('-an');
    const metadataIndex = args.indexOf('-map_metadata');
    expect(metadataIndex).toBeGreaterThan(-1);
    expect(args[metadataIndex + 1]).toBe('-1');
  });

  it('extracts a poster and at most 15 moderation frames from the proxy', async () => {
    const proxyPath = join(workDir, 'proxy.mp4');
    const posterPath = join(workDir, 'poster.jpg');
    const framesDir = await mkdtemp(join(workDir, 'frames-'));
    await extractPoster(proxyPath, posterPath);
    const frames = await extractModerationFrames(proxyPath, framesDir);
    expect((await stat(posterPath)).size).toBeGreaterThan(0);
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.length).toBeLessThanOrEqual(15);
  }, 60_000);
});

describe('clip ingest proxy — a source whose container lies about duration', () => {
  it('the forged clip PASSES the probe at its claimed ~4.8s — the source claim is not an authority', async () => {
    const result = await probeClipFile(lyingThirty);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.durationMs).toBeGreaterThan(4_000);
      expect(result.durationMs).toBeLessThan(6_000);
    }
  });

  it('the proxy is hard-cut at 15s and its re-probed duration is the measured authority', async () => {
    const proxyPath = join(workDir, 'lying-proxy.mp4');
    await transcodeToSilentProxy(lyingThirty, proxyPath);

    // Mutation red: delete `-t` from buildSilentProxyArgs and the proxy
    // carries ~30s of footage — the measured duration blows the ceiling below
    // and assertSilentProxy throws instead of returning facts.
    const facts = await assertSilentProxy(proxyPath);
    expect(facts.durationMs).toBeGreaterThanOrEqual(14_000);
    expect(facts.durationMs).toBeLessThanOrEqual(PROXY_MAX_MEASURED_DURATION_MS);
  }, 120_000);

  it('pins `-t 15` as an OUTPUT option in the transcode arguments', () => {
    const args = buildSilentProxyArgs('in.mp4', 'out.mp4');
    const cutIndex = args.lastIndexOf('-t');
    expect(cutIndex).toBeGreaterThan(args.indexOf('in.mp4'));
    expect(args[cutIndex + 1]).toBe(String(PROXY_MAX_DURATION_SECONDS));
    expect(PROXY_MAX_DURATION_SECONDS).toBe(15);
  });

  it('assertSilentProxy refuses a proxy that measures past the 15.5s ceiling', async () => {
    // A proxy-shaped 16s file produced OUTSIDE buildSilentProxyArgs: the
    // re-probe alone must refuse it, whatever produced it.
    const overlong = join(workDir, 'overlong-proxy.mp4');
    await generate([
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=1080x1920:rate=30',
      '-t',
      '16',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      '-an',
      overlong,
    ]);
    await expect(assertSilentProxy(overlong)).rejects.toThrow('ceiling');
  }, 120_000);
});
