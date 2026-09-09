import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

// The same server-render harness the other card tests use: React Native's
// primitives are stubbed as host elements so the rendered copy can be asserted
// without a device.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const renderModule: unknown = require('react-dom/server');
const renderToStaticMarkup = getRenderToStaticMarkup(renderModule);

function getRenderToStaticMarkup(value: unknown): (node: ReactNode) => string {
  if (typeof value !== 'object' || value === null || !('renderToStaticMarkup' in value)) {
    throw new Error('react-dom/server renderer is unavailable');
  }
  const renderer = value.renderToStaticMarkup;
  if (typeof renderer !== 'function') {
    throw new Error('react-dom/server renderer is invalid');
  }
  return (node) => {
    const markup: unknown = renderer(node);
    if (typeof markup !== 'string') {
      throw new Error('react-dom/server returned non-string markup');
    }
    return markup;
  };
}

const permission = vi.hoisted(() => ({ granted: false as boolean | null }));

vi.mock('@friendword/ui-tokens', () => ({
  colors: { ink: '#000', textSecondary: '#555' },
  fonts: { body: 'body' },
  fontSizes: { lg: 20, md: 16 },
  radii: { md: 8 },
  spacing: { sm: 8 },
}));
vi.mock('expo-camera', async () => {
  const { createElement } = await import('react');
  return {
    CameraView: () => createElement('div', null, 'camera'),
    useCameraPermissions: () => [
      permission.granted === null ? null : { granted: permission.granted },
      async () => ({ granted: permission.granted === true }),
    ],
  };
});
vi.mock('react-native', async () => {
  const { createElement } = await import('react');
  return {
    Linking: { openSettings: async () => undefined },
    StyleSheet: { create: (styles: object) => styles },
    Text: ({ children }: { readonly children?: ReactNode }) =>
      createElement('span', null, children),
    View: ({ children }: { readonly children?: ReactNode }) => createElement('div', null, children),
  };
});
vi.mock('../../components', async () => {
  const { createElement } = await import('react');
  return {
    HypeButton: ({ label }: { readonly label: string }) => createElement('button', null, label),
    StickerCard: ({ children }: { readonly children?: ReactNode }) =>
      createElement('section', null, children),
  };
});
// Only the file-size read is stubbed; the mime-type rules are the real ones,
// because what this asserts is that the container the camera wrote is the one
// the upload announces.
vi.mock('../../services/mediaFiles', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/mediaFiles')>()),
  localFileByteSize: async () => 1_000,
}));

const {
  SELFIE_CLIP_DENIED_MESSAGE,
  SELFIE_CLIP_GUIDELINE,
  SELFIE_CLIP_NO_SLOT_MESSAGE,
  SELFIE_CLIP_TITLE,
  SelfieClipCard,
  measureCapture,
} = await import('./SelfieClipCard');

const noop = async (): Promise<void> => undefined;

describe('SelfieClipCard', () => {
  it('says the clip is optional and own-face only, before anything is tapped', () => {
    const markup = renderToStaticMarkup(
      <SelfieClipCard busy={false} onSelfieClipChange={noop} selfieClip={null} slotAvailable />,
    );

    // The two product guarantees, verbatim: the clip is optional, and it is the
    // introducer's own face — not the person being introduced, whose face is
    // published only after they approve it themselves.
    expect(markup).toContain(SELFIE_CLIP_TITLE);
    expect(SELFIE_CLIP_TITLE).toContain('(optional)');
    expect(markup).toContain('Only your own face.');
    expect(markup).toContain('approves it before it');
    expect(SELFIE_CLIP_GUIDELINE).toContain('Only your own face.');
    expect(markup).toContain('Add a selfie clip');
  });

  it('summarises a clip that is already on the draft, with a way to delete it', () => {
    const markup = renderToStaticMarkup(
      <SelfieClipCard
        busy={false}
        onSelfieClipChange={noop}
        selfieClip={{
          uri: 'file:///selfie.mp4',
          width: 0,
          height: 0,
          durationMillis: 4_000,
          byteSize: 2_400_000,
          mimeType: 'video/mp4',
          role: 'selfie',
        }}
        slotAvailable={false}
      />,
    );

    expect(markup).toContain('Selfie clip added.');
    expect(markup).toContain('Delete it');
  });

  it('offers no recording when the picked clip already holds the free slot', () => {
    // 0050 refuses the second video inside registerAsset, after the bytes are
    // uploaded, and that refusal used to reach the introducer as a failed
    // submission. The card must not start a capture it knows will be thrown
    // away, and must say who is holding the slot.
    const markup = renderToStaticMarkup(
      <SelfieClipCard
        busy={false}
        onSelfieClipChange={noop}
        selfieClip={null}
        slotAvailable={false}
      />,
    );

    expect(markup).toContain(SELFIE_CLIP_NO_SLOT_MESSAGE);
    expect(markup).not.toContain('Add a selfie clip');
    expect(SELFIE_CLIP_NO_SLOT_MESSAGE).toContain('Campaign Pass');
  });

  it('announces the container the camera actually wrote', async () => {
    // iOS writes .mov, Android .mp4. The mime type picks the storage object's
    // extension and the signed upload's Content-Type, so an .mov sent as
    // video/mp4 is a clip the ingest probe refuses.
    await expect(measureCapture('file:///Camera/selfie.mov', 4_000)).resolves.toEqual(
      expect.objectContaining({ mimeType: 'video/quicktime' }),
    );
    await expect(measureCapture('file:///cache/selfie.mp4', 4_000)).resolves.toEqual(
      expect.objectContaining({ mimeType: 'video/mp4' }),
    );
  });

  it('caps the app-timed length at five seconds and never rounds a short take up', async () => {
    // `recordAsync` resolves with `{ uri }` alone, so this number is the app's
    // own timing, not a measurement of the file. It may not invent length: a
    // short take has to stay short so the state machine can refuse it.
    await expect(measureCapture('file:///selfie.mp4', 9_000)).resolves.toEqual(
      expect.objectContaining({ durationMillis: 5_000 }),
    );
    await expect(measureCapture('file:///selfie.mp4', 1_200)).resolves.toEqual(
      expect.objectContaining({ durationMillis: 1_200 }),
    );
  });

  it('names Settings, and nothing else, once the camera is off for Friendword', async () => {
    // Rendered straight from the machine's `denied` state, which is where a
    // refusal lands. The card must not claim the pitch is blocked, because the
    // recording step continues with no clip at all.
    const { nextSelfieClipState } = await import('./selfieClip');
    const denied = nextSelfieClipState({ status: 'requesting' }, { type: 'permission_denied' });

    expect(denied).toEqual({ status: 'denied' });
    expect(SELFIE_CLIP_DENIED_MESSAGE).toBe(
      'Camera is off for Friendword — enable it in Settings.',
    );
    expect(SELFIE_CLIP_DENIED_MESSAGE).not.toMatch(/cannot|blocked|required/i);
  });
});
