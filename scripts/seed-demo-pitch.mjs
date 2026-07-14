#!/usr/bin/env node
/**
 * Representative-demo seed pipeline (third audit GP-P0-3).
 *
 * Turns a hand-authored manifest (audio + transcript + segments + structure +
 * photos) into the values the PRODUCTION renderer consumes — the same
 * PitchView → PitchPlayer path a real published pitch uses. There is no
 * demo-only renderer.
 *
 * Design constraints (do not relax):
 *   - No OPENAI key required. The transcript and segments are hand-written and
 *     supplied in the manifest, so the pipeline runs offline.
 *   - TTS / AI-synthesised voice is FORBIDDEN as a stand-in for the friend's
 *     real recording (2026-07-13 decision). `audio` must be a rights-cleared
 *     human recording, and `rightsCleared` must be true, before any emit.
 *   - Until the recording arrives the public surface stays the honest written
 *     preview (apps/web/src/fixtures/pitch.ts). This script never fabricates a
 *     recording into the committed demo.
 *
 * Modes:
 *   node scripts/seed-demo-pitch.mjs [--manifest <path>]        # validate only
 *   node scripts/seed-demo-pitch.mjs --dry-run                  # validate + local audio-path proof
 *   node scripts/seed-demo-pitch.mjs --emit-fixture <out.json>  # emit fixture data (requires cleared audio)
 *
 * `--dry-run` synthesises a short local sine WAV (never committed, never the
 * public demo) purely to exercise the duration → scene-window plan and prove
 * the audio path decodes; it writes nothing to the repo's public demo.
 */

import { Buffer } from 'node:buffer';
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const PUBLIC_DIR = join(REPO, 'apps', 'web', 'public');
const DEFAULT_MANIFEST = join(HERE, 'demo-pitch', 'manifest.example.json');

function parseArgs(argv) {
  const args = { manifest: DEFAULT_MANIFEST, dryRun: false, emitFixture: null };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--manifest') args.manifest = resolve(argv[(i += 1)]);
    else if (flag === '--dry-run') args.dryRun = true;
    else if (flag === '--emit-fixture') args.emitFixture = resolve(argv[(i += 1)]);
    else throw new Error(`Unknown argument: ${flag}`);
  }
  return args;
}

function fail(message) {
  console.error(`seed-demo-pitch: ${message}`);
  process.exit(1);
}

// Mirrors pitchStructureSchema (packages/contracts/src/pitchStructure.ts). Keep
// in sync — the audit3 suite locks the TS contract.
function validateStructure(structure, errors) {
  if (structure === null || typeof structure !== 'object') {
    errors.push('structure: must be an object');
    return;
  }
  const strFields = ['hook', 'relationship_context', 'evidence_or_anecdote', 'good_match_for'];
  for (const field of strFields) {
    if (typeof structure[field] !== 'string' || structure[field].trim() === '') {
      errors.push(`structure.${field}: must be a non-empty string`);
    }
  }
  const qualities = structure.three_specific_qualities;
  if (!Array.isArray(qualities) || qualities.length !== 3 || !qualities.every((q) => typeof q === 'string' && q.trim() !== '')) {
    errors.push('structure.three_specific_qualities: must be exactly 3 non-empty strings');
  }
  const hard = structure.hard_claims_requiring_confirmation;
  if (!Array.isArray(hard) || !hard.every((c) => typeof c === 'string')) {
    errors.push('structure.hard_claims_requiring_confirmation: must be an array of strings');
  }
}

function validateManifest(manifest) {
  const errors = [];
  for (const field of ['campaignSlug', 'daterName', 'introducerPseudonym', 'relationship', 'transcript']) {
    if (typeof manifest[field] !== 'string' || manifest[field].trim() === '') {
      errors.push(`${field}: must be a non-empty string`);
    }
  }

  const segments = manifest.segments;
  if (!Array.isArray(segments) || segments.length === 0) {
    errors.push('segments: must be a non-empty array');
  } else {
    let previousStart = -Infinity;
    segments.forEach((segment, index) => {
      if (typeof segment.start !== 'number' || typeof segment.end !== 'number' || typeof segment.text !== 'string') {
        errors.push(`segments[${index}]: needs numeric start, end and string text`);
        return;
      }
      if (segment.start < 0 || segment.end <= segment.start) {
        errors.push(`segments[${index}]: require 0 <= start < end`);
      }
      if (segment.start < previousStart) {
        errors.push(`segments[${index}]: start must be non-decreasing`);
      }
      previousStart = segment.start;
    });
  }

  validateStructure(manifest.structure, errors);

  const photos = manifest.photos;
  if (!Array.isArray(photos) || photos.length === 0) {
    errors.push('photos: must be a non-empty array');
  } else {
    photos.forEach((photo, index) => {
      if (typeof photo.src !== 'string' || typeof photo.alt !== 'string' || photo.alt.trim() === '') {
        errors.push(`photos[${index}]: needs a string src and a non-empty alt`);
        return;
      }
      // Public fixture images resolve under apps/web/public.
      if (photo.src.startsWith('/')) {
        const onDisk = join(PUBLIC_DIR, photo.src.slice(1));
        if (!existsSync(onDisk)) errors.push(`photos[${index}].src: file not found at ${onDisk}`);
      }
    });
  }

  if (manifest.audio !== null && manifest.audio !== undefined) {
    if (typeof manifest.audio !== 'string') errors.push('audio: must be a path string or null');
    else if (!existsSync(resolve(REPO, manifest.audio))) errors.push(`audio: file not found at ${manifest.audio}`);
  }

  return errors;
}

// Mirrors distributePhotoScenes (apps/web/src/pitch/scenes.ts). Kept identical
// so the dry-run plan matches what the renderer produces.
function distributePhotoScenes(photoCount, durationMs, segments) {
  const count = Math.max(1, Math.floor(photoCount));
  const totalMs = durationMs > 0 ? durationMs : 1;
  if (count === 1) return [{ startMs: 0, endMs: totalMs }];
  if (segments.length >= count) {
    const base = Math.floor(segments.length / count);
    const remainder = segments.length % count;
    const windows = [];
    let segmentIndex = 0;
    for (let photo = 0; photo < count; photo += 1) {
      const take = base + (photo < remainder ? 1 : 0);
      const startSegment = segmentIndex;
      segmentIndex += take;
      windows.push({
        startMs: photo === 0 ? 0 : (segments[startSegment]?.startMs ?? Math.round((photo * totalMs) / count)),
        endMs: photo === count - 1 ? totalMs : (segments[segmentIndex]?.startMs ?? Math.round(((photo + 1) * totalMs) / count)),
      });
    }
    return windows;
  }
  const windows = [];
  for (let index = 0; index < count; index += 1) {
    windows.push({
      startMs: index === 0 ? 0 : Math.round((index * totalMs) / count),
      endMs: index === count - 1 ? totalMs : Math.round(((index + 1) * totalMs) / count),
    });
  }
  return windows;
}

/** Write a minimal 16-bit PCM WAV sine tone so the local audio path can be exercised. */
function synthesiseSineWav(path, seconds) {
  const sampleRate = 8000;
  const sampleCount = Math.max(1, Math.floor(sampleRate * seconds));
  const dataBytes = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < sampleCount; i += 1) {
    const sample = Math.round(Math.sin((2 * Math.PI * 220 * i) / sampleRate) * 12000);
    buffer.writeInt16LE(sample, 44 + i * 2);
  }
  writeFileSync(path, buffer);
  // Validate the RIFF header round-trips (proves it is a decodable WAV shell).
  const check = readFileSync(path);
  if (check.toString('ascii', 0, 4) !== 'RIFF' || check.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('synthesised WAV failed its own RIFF/WAVE header check');
  }
  return dataBytes + 44;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(args.manifest)) fail(`manifest not found: ${args.manifest}`);

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(args.manifest, 'utf8'));
  } catch (error) {
    fail(`manifest is not valid JSON: ${error.message}`);
  }

  const errors = validateManifest(manifest);
  if (errors.length > 0) {
    console.error('seed-demo-pitch: manifest failed validation:');
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  console.log(`✓ manifest valid: ${args.manifest}`);

  const segmentsMs = manifest.segments.map((s) => ({
    startMs: Math.round(s.start * 1000),
    endMs: Math.round(s.end * 1000),
  }));
  const durationMs = segmentsMs.at(-1).endMs;
  const scenes = distributePhotoScenes(manifest.photos.length, durationMs, segmentsMs);
  console.log(`  duration (from segments): ${(durationMs / 1000).toFixed(1)}s`);
  console.log(`  photo scenes (real segment timing, no 60s grid):`);
  scenes.forEach((scene, index) => {
    console.log(`    photo ${index + 1}: ${(scene.startMs / 1000).toFixed(1)}s → ${(scene.endMs / 1000).toFixed(1)}s`);
  });
  console.log(`  captions: ${manifest.segments.length} segment-level (real timestamps)`);
  console.log(`  structure scenes: hook / relationship / 3 qualities / anecdote / good-match`);

  const hasRealAudio = typeof manifest.audio === 'string' && manifest.rightsCleared === true;

  if (args.dryRun) {
    const scratch = mkdtempSync(join(tmpdir(), 'fw-demo-'));
    const wavPath = join(scratch, 'probe.wav');
    const bytes = synthesiseSineWav(wavPath, Math.min(3, Math.max(1, durationMs / 1000)));
    console.log(`✓ dry-run: synthesised local probe WAV (${bytes} bytes) at ${wavPath}`);
    console.log('  (probe audio is local-only — never committed and never the public demo)');
  }

  if (args.emitFixture) {
    if (!hasRealAudio) {
      fail(
        'refusing to emit fixture: a rights-cleared human recording is required.\n' +
          '  Set `audio` to the recording path AND `rightsCleared` to true first.\n' +
          '  TTS / AI-synthesised voice is not an acceptable substitute (2026-07-13 decision).',
      );
    }
    const fixture = {
      campaignSlug: manifest.campaignSlug,
      daterName: manifest.daterName,
      introducerPseudonym: manifest.introducerPseudonym,
      relationship: manifest.relationship,
      approximateLocation: manifest.approximateLocation ?? null,
      durationMs,
      audio: manifest.audio,
      captions: manifest.segments.map((s) => ({
        startMs: Math.round(s.start * 1000),
        endMs: Math.round(s.end * 1000),
        text: s.text,
      })),
      structure: manifest.structure,
      photos: manifest.photos,
      transcript: manifest.transcript,
    };
    writeFileSync(args.emitFixture, `${JSON.stringify(fixture, null, 2)}\n`);
    console.log(`✓ emitted fixture data to ${args.emitFixture}`);
  } else if (!hasRealAudio) {
    console.log('ℹ no rights-cleared recording yet → public surface stays the honest written preview.');
  }
}

main();
