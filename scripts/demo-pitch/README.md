# Representative demo seed pipeline (GP-P0-3)

Turns a hand-authored manifest into the values the **production** pitch renderer
consumes (`PitchView → PitchPlayer`). There is no demo-only renderer.

## Why this exists

The Grand Prize demo must let a judge experience the real differentiator: a
friend's actual voice → a structured vertical pitch → no-signup viewing →
interest → dater approval → Intro Room. The friend's **rights-cleared human
recording** is a user gate (Sangheon records it). Until it arrives, the public
`demo-blair` surface stays the honest written preview
(`apps/web/src/fixtures/pitch.ts`) — no fabricated audio, no age, no vouches.

**TTS / AI-synthesised voice is forbidden** as a substitute (2026-07-13
decision). The transcript and segments are written by hand, so the pipeline
needs **no OPENAI key**.

## Files

- `manifest.example.json` — the input contract (structure, transcript,
  segments, photos, meta). `audio` is `null` and `rightsCleared` is `false`
  until the recording lands.
- `../seed-demo-pitch.mjs` — validator + dry-run + fixture emitter.

## Usage

```bash
# 1. Validate the manifest shape and print the scene plan (offline, no writes)
node scripts/seed-demo-pitch.mjs

# 2. Dry-run: also synthesise a throwaway local sine WAV to exercise the
#    duration → scene-window path (never committed, never the public demo)
node scripts/seed-demo-pitch.mjs --dry-run

# 3. When the recording arrives: set `audio` to its path and `rightsCleared`
#    to true in the manifest, then emit the fixture data
node scripts/seed-demo-pitch.mjs --emit-fixture scripts/demo-pitch/demo-blair.fixture.json
```

`--emit-fixture` **refuses** unless `audio` is set and `rightsCleared` is
`true`. Photo scene boundaries snap to real segment timing (no 60s grid), and
captions are segment-level (real timestamps, not fabricated word timing).

## When the real recording arrives (Advisor runs this)

1. Drop the rights-cleared `.m4a`/`.wav` somewhere under the repo, set
   `manifest.audio` to its path and `manifest.rightsCleared: true`.
2. `node scripts/seed-demo-pitch.mjs --dry-run` to confirm the plan.
3. `--emit-fixture` to produce the fixture data, wire it into the demo fixture +
   upload the audio, and QA the public `demo-blair` page playing the real voice.

The renderer, timing, waveform decode and structure scenes are already live —
only the recording bytes are gated.
