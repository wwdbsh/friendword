import { describe, expect, it } from 'vitest';

import {
  advanceClipIngestPoll,
  CLIP_INGEST_MAX_POLLS,
  clipIngestLabel,
  clipIngestMessage,
  mergeClipIngestStates,
  requestClipIngestStates,
  startClipIngestPoll,
  type ObservedClipIngest,
} from './clipIngest';
import { CLIP_INGEST_STATES, type ClipIngestState, type PitchClip } from './types';

const DRAFT_ID = '10000000-0000-4000-8000-000000000001';

function clip(objectName: string | null, ingest?: ClipIngestState): PitchClip {
  return {
    uri: `file:///${objectName ?? 'unsent'}.mp4`,
    width: 1080,
    height: 1920,
    durationMillis: 6_000,
    byteSize: 1_000_000,
    mimeType: 'video/mp4',
    ...(objectName === null ? {} : { upload: { objectName, registered: true, validated: false } }),
    ...(ingest === undefined ? {} : { ingest }),
  };
}

describe('clip ingest polling', () => {
  it('starts settled when there is nothing left to wait for', () => {
    expect(startClipIngestPoll([])).toEqual({ attempt: 0, phase: 'settled' });
    expect(startClipIngestPoll(['succeeded', 'flagged'])).toEqual({
      attempt: 0,
      phase: 'settled',
    });
  });

  it('starts waiting for a clip that is pending or unreported', () => {
    expect(startClipIngestPoll(['pending'])).toEqual({ attempt: 0, phase: 'waiting' });
    expect(startClipIngestPoll([undefined])).toEqual({ attempt: 0, phase: 'waiting' });
    expect(startClipIngestPoll(['succeeded', 'pending'])).toEqual({
      attempt: 0,
      phase: 'waiting',
    });
  });

  it('settles as soon as every clip has a final state', () => {
    const first = advanceClipIngestPoll(startClipIngestPoll(['pending']), ['pending']);
    const second = advanceClipIngestPoll(first, ['succeeded']);

    expect(first).toEqual({ attempt: 1, phase: 'waiting' });
    expect(second).toEqual({ attempt: 2, phase: 'settled' });
  });

  it('settles on a flagged verdict too — it is an answer, not a failure to wait out', () => {
    expect(advanceClipIngestPoll({ attempt: 3, phase: 'waiting' }, ['flagged'])).toEqual({
      attempt: 4,
      phase: 'settled',
    });
  });

  it('stops polling once the attempts run out, without claiming a verdict', () => {
    let poll = startClipIngestPoll(['pending']);
    for (let index = 0; index < CLIP_INGEST_MAX_POLLS; index += 1) {
      poll = advanceClipIngestPoll(poll, ['pending']);
    }

    expect(poll).toEqual({ attempt: CLIP_INGEST_MAX_POLLS, phase: 'unresolved' });
    expect(clipIngestMessage('pending', poll.phase)).toContain('has not been able to confirm');
  });

  it('counts a read that answered nothing as an attempt, so it cannot loop forever', () => {
    const poll = advanceClipIngestPoll({ attempt: 0, phase: 'waiting' }, [undefined], 2);

    expect(poll).toEqual({ attempt: 1, phase: 'waiting' });
    expect(advanceClipIngestPoll(poll, [undefined], 2)).toEqual({
      attempt: 2,
      phase: 'unresolved',
    });
  });
});

describe('clip ingest state merge', () => {
  it('takes the server state for a clip it reported', () => {
    const merged = mergeClipIngestStates(
      [clip('clip-a.mp4', 'pending')],
      new Map<string, ClipIngestState>([['clip-a.mp4', 'flagged']]),
    );

    expect(merged[0]?.ingest).toBe('flagged');
  });

  it('keeps the state it had for a clip the server said nothing about', () => {
    const clips = [clip('clip-a.mp4', 'flagged'), clip('clip-b.mp4', 'pending')];

    const merged = mergeClipIngestStates(clips, new Map());

    // Silence is not a state: an unreachable server must not reset a verdict.
    expect(merged).toBe(clips);
    expect(merged[0]?.ingest).toBe('flagged');
  });

  it('leaves a clip that was never uploaded alone', () => {
    const clips = [clip(null)];

    expect(mergeClipIngestStates(clips, new Map([['clip-a.mp4', 'succeeded']]))).toBe(clips);
  });
});

describe('clip ingest state read', () => {
  const transport = (
    status: number,
    body: unknown,
  ): {
    accessToken: string;
    origin: string;
    send: (url: string, init: RequestInit) => Promise<Response>;
    calls: Array<{ url: string; body: unknown }>;
  } => {
    const calls: Array<{ url: string; body: unknown }> = [];
    return {
      accessToken: 'token',
      origin: 'https://friendword.test',
      calls,
      send: async (url, init) => {
        calls.push({ url, body: JSON.parse(String(init.body)) });
        return new Response(JSON.stringify(body), { status });
      },
    };
  };

  it('reads the states the server reported for the objects it asked about', async () => {
    const active = transport(200, {
      states: { 'clip-a.mp4': 'succeeded', 'clip-b.mov': 'flagged' },
    });

    const observed = await requestClipIngestStates(
      { draftId: DRAFT_ID, objectNames: ['clip-a.mp4', 'clip-b.mov'] },
      active,
    );

    expect(active.calls[0]?.url).toBe('https://friendword.test/api/media/clip-ingest-state');
    expect(active.calls[0]?.body).toEqual({
      bucket: 'pitch-media',
      draftId: DRAFT_ID,
      objectNames: ['clip-a.mp4', 'clip-b.mov'],
    });
    expect(Object.fromEntries(observed)).toEqual({
      'clip-a.mp4': 'succeeded',
      'clip-b.mov': 'flagged',
    });
  });

  it('reports no answer — never a pass — when the route is unavailable', async () => {
    for (const status of [404, 500, 501]) {
      const observed = await requestClipIngestStates(
        { draftId: DRAFT_ID, objectNames: ['clip-a.mp4'] },
        transport(status, { states: { 'clip-a.mp4': 'succeeded' } }),
      );
      expect(observed.size).toBe(0);
    }
  });

  it('ignores a value that is not a state, and objects it did not ask about', async () => {
    const observed: ObservedClipIngest = await requestClipIngestStates(
      { draftId: DRAFT_ID, objectNames: ['clip-a.mp4'] },
      transport(200, { states: { 'clip-a.mp4': 'in_progress', 'clip-z.mp4': 'succeeded' } }),
    );

    expect(observed.size).toBe(0);
  });

  it('reports no answer when the request itself throws', async () => {
    const observed = await requestClipIngestStates(
      { draftId: DRAFT_ID, objectNames: ['clip-a.mp4'] },
      {
        accessToken: 'token',
        origin: 'https://friendword.test',
        send: async () => {
          throw new Error('offline');
        },
      },
    );

    expect(observed.size).toBe(0);
  });

  it('does not call the server when there is nothing to ask about', async () => {
    const active = transport(200, { states: {} });

    const observed = await requestClipIngestStates({ draftId: DRAFT_ID, objectNames: [] }, active);

    expect(observed.size).toBe(0);
    expect(active.calls).toEqual([]);
  });
});

describe('clip ingest copy', () => {
  it('says what the pipeline checked and never implies identity or audio review', () => {
    const messages = [
      ...CLIP_INGEST_STATES.map((state) => clipIngestMessage(state)),
      clipIngestMessage(undefined),
      clipIngestMessage('pending', 'unresolved'),
      ...CLIP_INGEST_STATES.map((state) => clipIngestLabel(state)),
      clipIngestLabel(undefined),
    ];

    for (const message of messages) {
      expect(message).not.toBe('');
      expect(message.toLowerCase()).not.toMatch(/face|identity|voice|audio|verified|match/);
    }
  });

  it('tells a flagged clip the truth: not published, and the pitch is blocked', () => {
    const message = clipIngestMessage('flagged');

    expect(message).toContain('did not pass');
    expect(message).toContain('will not be published');
    // The server refuses the consent submit while a flagged clip is attached, so
    // the copy must not promise a send-without-it that does not exist.
    expect(message).toContain('cannot be sent while it is attached');
  });

  it('separates a processing failure from a moderation refusal', () => {
    expect(clipIngestMessage('failed')).toContain('could not process');
    expect(clipIngestMessage('failed')).not.toContain('did not pass');
    expect(clipIngestLabel('processing')).toBe(clipIngestLabel('pending'));
  });

  it('never presents a pending clip as publishable', () => {
    expect(clipIngestMessage('pending')).toContain('cannot be published');
    expect(clipIngestMessage(undefined, 'unresolved')).toContain('stays unpublished');
  });
});
