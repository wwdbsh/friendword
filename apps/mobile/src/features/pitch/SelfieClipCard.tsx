import { colors, fonts, fontSizes, radii, spacing } from '@friendword/ui-tokens';
import { CameraView, useCameraPermissions, type CameraRecordingOptions } from 'expo-camera';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';

import { HypeButton, StickerCard } from '../../components';
import { localFileByteSize, pickedClipMimeType } from '../../services/mediaFiles';
import type { PitchClip } from '../../services/types';
import { selfieClipFromCapture } from './pitchFlowState';
import {
  canStopSelfieRecording,
  INITIAL_SELFIE_CLIP_STATE,
  nextSelfieClipState,
  SELFIE_CLIP_MAX_MS,
  selfieCaptureOf,
  shouldStopSelfieRecording,
  type SelfieCapture,
  type SelfieClipState,
} from './selfieClip';

/**
 * The card's own copy, exported so a test asserts the exact promise the product
 * makes rather than a paraphrase of it. Both lines are load-bearing:
 *
 * - *optional* — nothing in the pitch flow requires a clip, and no failure of
 *   this card can block the recording step.
 * - *Only your own face* — this is the introducer's opener, not a picture of
 *   the person being introduced, whose face may only be published after they
 *   approve it themselves. `Your friend approves it before it's used` is the
 *   web consent screen's include/exclude choice, which the dater has to make
 *   explicitly — the clip is never carried into a revision on its own.
 */
export const SELFIE_CLIP_TITLE = 'Add a 3-second selfie clip (optional)';
export const SELFIE_CLIP_GUIDELINE =
  'Only your own face. Your friend approves it before it’s used.';
/**
 * The whole of the permission dead end. It says where the setting is and stops:
 * the app cannot re-ask (iOS answers once), and it must not imply the pitch is
 * blocked, because it is not.
 */
/**
 * The other honest dead end: the pitch's one free video is already spent on a
 * clip the introducer picked. Says which clip is holding the slot and both ways
 * out, and does not offer a recording the server would refuse after the upload.
 */
export const SELFIE_CLIP_NO_SLOT_MESSAGE =
  'Your free clip slot is used by the clip you picked. Remove it, or add a Campaign Pass, to add a selfie.';

export const SELFIE_CLIP_DENIED_MESSAGE = 'Camera is off for Friendword — enable it in Settings.';

const RECORDING_OPTIONS: CameraRecordingOptions = {
  // Seconds. The OS stop is the backstop; the ticker below is what normally
  // ends the take, so the two must agree.
  maxDuration: SELFIE_CLIP_MAX_MS / 1_000,
};

const TICK_MS = 100;

type SelfieClipCardProps = {
  /** The clip already on the draft, or null. Null puts the card back on its offer. */
  readonly selfieClip: PitchClip | null;
  /** Saves the clip on the draft, or removes it for null. Rejects on failure. */
  readonly onSelfieClipChange: (clip: PitchClip | null) => Promise<void>;
  /** True while the step is saving something else; the card only greys out. */
  readonly busy: boolean;
  /**
   * Whether the draft still has a video slot the selfie could take
   * (`selfieClipSlotAvailable`). False hides the capture entirely rather than
   * spending an upload on a registration the server would refuse.
   */
  readonly slotAvailable: boolean;
};

/**
 * The optional selfie opener (docs/REEL_V3_DESIGN.md §3).
 *
 * Every branch here ends somewhere the introducer can leave: a denied
 * permission, a camera that would not start, a take too short to use and an
 * upload that failed all render a sentence and a way out, and none of them
 * changes anything about the pitch itself. The rules about what may follow what
 * live in `selfieClip.ts`; this component runs the effects and draws the state.
 */
export function SelfieClipCard({
  selfieClip,
  onSelfieClipChange,
  busy,
  slotAvailable,
}: SelfieClipCardProps) {
  const [state, setState] = useState<SelfieClipState>(INITIAL_SELFIE_CLIP_STATE);
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  // The ticker is also the hard stop: `recordAsync`'s maxDuration is the OS
  // backstop, and a preview left running while the state machine thinks it
  // stopped is the one way a take longer than five seconds could be banked.
  useEffect(() => {
    if (state.status !== 'recording') {
      setElapsedMs(0);
      return;
    }
    const timer = setInterval(() => {
      const now = Date.now();
      setElapsedMs(Math.max(0, now - state.startedAtMs));
      if (shouldStopSelfieRecording(state, now)) {
        camera.current?.stopRecording();
      }
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [state]);

  const add = useCallback(async (): Promise<void> => {
    setState((current) => nextSelfieClipState(current, { type: 'add' }));
    // `granted` is the only answer that opens the camera. `canAskAgain: false`
    // and an outright refusal are the same dead end from here.
    const answer = permission?.granted === true ? permission : await requestPermission();
    setState((current) =>
      nextSelfieClipState(current, {
        type: answer.granted ? 'permission_granted' : 'permission_denied',
      }),
    );
  }, [permission, requestPermission]);

  const record = useCallback(async (): Promise<void> => {
    const startedAtMs = Date.now();
    setState((current) =>
      nextSelfieClipState(current, { type: 'record_start', atMs: startedAtMs }),
    );
    try {
      // Resolves when the take stops — the ticker's `stopRecording`, the tap,
      // or maxDuration. `mute` keeps this a picture-only asset: the render
      // worker takes frames from it and nothing else, and a silent capture is
      // also what keeps the microphone prompt out of this flow.
      const video = await camera.current?.recordAsync(RECORDING_OPTIONS);
      const uri = video?.uri;
      if (uri === undefined) {
        setState((current) =>
          nextSelfieClipState(current, {
            type: 'record_fail',
            message: 'The camera did not save that take. Try again.',
          }),
        );
        return;
      }
      const capture = await measureCapture(uri, Date.now() - startedAtMs);
      setState((current) =>
        capture === null
          ? nextSelfieClipState(current, {
              type: 'record_fail',
              message: 'That clip could not be read from this device. Try again.',
            })
          : nextSelfieClipState(current, { type: 'record_stop', capture }),
      );
    } catch {
      setState((current) =>
        nextSelfieClipState(current, {
          type: 'record_fail',
          message: 'The camera stopped before the clip was saved. Try again.',
        }),
      );
    }
  }, []);

  const keep = useCallback(async (): Promise<void> => {
    const capture = selfieCaptureOf(state);
    if (capture === null) {
      return;
    }
    setState((current) => nextSelfieClipState(current, { type: 'keep' }));
    try {
      await onSelfieClipChange(selfieClipFromCapture(capture));
      setState((current) => nextSelfieClipState(current, { type: 'keep_succeeded' }));
    } catch {
      setState((current) =>
        nextSelfieClipState(current, {
          type: 'keep_failed',
          message: 'That clip was not saved to your pitch. Try again.',
        }),
      );
    }
  }, [onSelfieClipChange, state]);

  const remove = useCallback(async (): Promise<void> => {
    try {
      await onSelfieClipChange(null);
    } catch {
      // Nothing to report: removal failing leaves the clip where it was, and
      // the card keeps showing it. The pitch is unaffected either way.
    }
  }, [onSelfieClipChange]);

  return (
    <StickerCard>
      <Text style={styles.title}>{SELFIE_CLIP_TITLE}</Text>
      <Text style={styles.guideline}>{SELFIE_CLIP_GUIDELINE}</Text>
      {renderBody()}
    </StickerCard>
  );

  function renderBody() {
    if (state.status === 'denied') {
      return (
        <View style={styles.body}>
          <Text accessibilityLiveRegion="polite" style={styles.notice}>
            {SELFIE_CLIP_DENIED_MESSAGE}
          </Text>
          <HypeButton
            label="Open Settings"
            onPress={() => {
              void Linking.openSettings();
            }}
            secondary
          />
        </View>
      );
    }

    if (state.status === 'requesting') {
      return <Text style={styles.notice}>Asking for camera access…</Text>;
    }

    if (state.status === 'ready' || state.status === 'recording') {
      const recording = state.status === 'recording';
      const canStop = canStopSelfieRecording(state, Date.now());
      return (
        <View style={styles.body}>
          <CameraView
            facing="front"
            mode="video"
            mute
            ref={camera}
            style={styles.preview}
            videoQuality="1080p"
          />
          <Text style={styles.notice}>
            {recording
              ? `${formatSeconds(elapsedMs)} of ${formatSeconds(SELFIE_CLIP_MAX_MS)}${
                  canStop ? '' : ' — keep going to 3 seconds'
                }`
              : 'Look into the camera and say hi. 3 to 5 seconds.'}
          </Text>
          {recording ? (
            <HypeButton
              disabled={!canStop}
              label="Stop"
              onPress={() => camera.current?.stopRecording()}
            />
          ) : (
            <HypeButton
              disabled={busy}
              label="Record"
              onPress={() => {
                void record();
              }}
            />
          )}
          <HypeButton
            label="Not now"
            onPress={() => setState((current) => nextSelfieClipState(current, { type: 'discard' }))}
            secondary
          />
        </View>
      );
    }

    if (state.status === 'captured') {
      return (
        <View style={styles.body}>
          <Text style={styles.notice}>
            {`Your clip is ${formatSeconds(state.capture.durationMillis)} long.`}
          </Text>
          <HypeButton
            disabled={busy}
            label="Keep it"
            onPress={() => {
              void keep();
            }}
          />
          <HypeButton
            label="Retake"
            onPress={() => setState((current) => nextSelfieClipState(current, { type: 'retake' }))}
            secondary
          />
          <HypeButton
            label="Delete"
            onPress={() => setState((current) => nextSelfieClipState(current, { type: 'discard' }))}
            secondary
          />
        </View>
      );
    }

    if (state.status === 'uploading') {
      return <Text style={styles.notice}>Saving your clip…</Text>;
    }

    if (state.status === 'failed') {
      return (
        <View style={styles.body}>
          <Text accessibilityLiveRegion="polite" style={styles.notice}>
            {state.message}
          </Text>
          <HypeButton
            label="Try again"
            onPress={() => setState((current) => nextSelfieClipState(current, { type: 'retry' }))}
          />
          <HypeButton
            label="Delete"
            onPress={() => setState((current) => nextSelfieClipState(current, { type: 'discard' }))}
            secondary
          />
        </View>
      );
    }

    // idle — either the offer, or the clip already saved on the draft.
    if (selfieClip !== null) {
      return (
        <View style={styles.body}>
          <Text style={styles.notice}>Selfie clip added.</Text>
          <HypeButton
            disabled={busy}
            label="Delete it"
            onPress={() => {
              void remove();
            }}
            secondary
          />
        </View>
      );
    }
    if (!slotAvailable) {
      return <Text style={styles.notice}>{SELFIE_CLIP_NO_SLOT_MESSAGE}</Text>;
    }
    return (
      <HypeButton
        disabled={busy}
        label="Add a selfie clip"
        onPress={() => {
          void add();
        }}
        secondary
      />
    );
  }
}

/**
 * The capture as the draft records it, or null when this device cannot measure
 * the file it just wrote.
 *
 * `width`/`height` are left at 0 on purpose: `recordAsync` reports neither, and
 * the pixel columns are nullable with a `> 0` CHECK, so an unmeasured clip is
 * registered without them rather than with a guess. The render worker reads the
 * real size off the ingested proxy.
 */
export async function measureCapture(uri: string, ranForMs: number): Promise<SelfieCapture | null> {
  const byteSize = await localFileByteSize(uri);
  if (byteSize === null) {
    return null;
  }
  return {
    uri,
    // iOS writes .mov, Android .mp4. Read it off the file the camera wrote
    // rather than assuming: the container decides the storage object's
    // extension and the Content-Type the signed upload is sent with, and an
    // .mov announced as video/mp4 is refused by the ingest probe.
    mimeType: pickedClipMimeType({ uri }) ?? 'video/mp4',
    // This app's own timing of the take, not a measurement of the file:
    // `recordAsync` resolves with `{ uri }` and nothing else, and no decoder is
    // installed here to probe the container. Capped, because the ticker and the
    // OS stop can disagree by a frame; never floored, because a take that came
    // back short IS short and the state machine has to be able to refuse it.
    // The server re-reads the real length during ingest, and that is the
    // authority — this number is only what the app displays and checks.
    durationMillis: Math.min(SELFIE_CLIP_MAX_MS, Math.round(ranForMs)),
    width: 0,
    height: 0,
    byteSize,
  };
}

function formatSeconds(ms: number): string {
  return `${Math.round(ms / 100) / 10}s`;
}

const styles = StyleSheet.create({
  title: { color: colors.ink, fontFamily: 'BricolageGrotesqueBold', fontSize: fontSizes.lg },
  guideline: {
    color: colors.textSecondary,
    fontFamily: fonts.body,
    fontSize: fontSizes.md,
    lineHeight: 22,
  },
  body: { gap: spacing.sm },
  notice: {
    color: colors.textSecondary,
    fontFamily: fonts.body,
    fontSize: fontSizes.md,
    lineHeight: 22,
  },
  preview: {
    aspectRatio: 9 / 16,
    borderRadius: radii.md,
    overflow: 'hidden',
    width: '100%',
  },
});
