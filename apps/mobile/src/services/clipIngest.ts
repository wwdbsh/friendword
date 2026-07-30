import { CLIP_INGEST_STATES, type ClipIngestState, type PitchClip } from './types';

/** Ingest state per stored object name, as the server reported it. */
export type ObservedClipIngest = ReadonlyMap<string, ClipIngestState>;

export type ClipIngestRequest = {
  readonly draftId: string;
  readonly objectNames: readonly string[];
};

export type ClipIngestReader = (request: ClipIngestRequest) => Promise<ObservedClipIngest>;

export type ClipIngestTransport = {
  readonly accessToken: string;
  readonly origin: string;
  readonly send: (url: string, init: RequestInit) => Promise<Response>;
};

/**
 * How often the app asks the server where a clip's ingest job stands, and how
 * many times before it stops asking. Ingest is probe + proxy transcode + poster
 * + frame moderation, so it is seconds-to-minutes work; two minutes of polling
 * covers the normal case and the introducer can ask again by hand after that.
 * Never a deadline the server honours — only how long this screen waits.
 */
export const CLIP_INGEST_POLL_INTERVAL_MS = 5_000;
export const CLIP_INGEST_MAX_POLLS = 24;

/**
 * `waiting`: at least one clip has no final state and it is worth asking again.
 * `settled`: every clip came back succeeded or flagged.
 * `unresolved`: the polls ran out with a clip still unreported. Says nothing
 * about the clip — only that this device stopped waiting.
 */
export type ClipIngestPollPhase = 'waiting' | 'settled' | 'unresolved';

export type ClipIngestPoll = {
  /** Completed reads. 0 before the first one. */
  readonly attempt: number;
  readonly phase: ClipIngestPollPhase;
};

function isFinalState(state: ClipIngestState | undefined): boolean {
  // `failed` is final for this screen's purposes: the pipeline may re-queue it
  // internally while attempts remain, and the next state it reports is then
  // `pending` again — which restarts the wait on its own.
  return state === 'succeeded' || state === 'flagged' || state === 'failed';
}

/**
 * The poll state for clips whose states this device already has cached. A draft
 * with no unfinished clip starts settled, so a screen that has nothing to wait
 * for never schedules a request.
 */
export function startClipIngestPoll(
  states: readonly (ClipIngestState | undefined)[],
): ClipIngestPoll {
  return { attempt: 0, phase: states.every(isFinalState) ? 'settled' : 'waiting' };
}

/**
 * The poll state after one completed read.
 *
 * A read that answered nothing (offline, route unavailable, job row not written
 * yet) still counts as an attempt: the alternative is an unbounded loop against
 * a server that is not going to answer. It does not change any cached state —
 * `mergeClipIngestStates` keeps what the device already knew — so the introducer
 * is never told a clip regressed to pending because a request failed.
 */
export function advanceClipIngestPoll(
  current: ClipIngestPoll,
  states: readonly (ClipIngestState | undefined)[],
  maxPolls: number = CLIP_INGEST_MAX_POLLS,
): ClipIngestPoll {
  const attempt = current.attempt + 1;
  if (states.every(isFinalState)) {
    return { attempt, phase: 'settled' };
  }
  return { attempt, phase: attempt >= maxPolls ? 'unresolved' : 'waiting' };
}

/**
 * The clips with each one's cached ingest state replaced by what the server
 * reported. A clip the server said nothing about keeps the state it had: the
 * server is the authority on what the state *is*, but silence is not a state.
 * Returns the same array instance when nothing changed, so a caller can skip a
 * pointless write.
 */
export function mergeClipIngestStates(
  clips: readonly PitchClip[],
  observed: ObservedClipIngest,
): readonly PitchClip[] {
  let changed = false;
  const next = clips.map((clip) => {
    const objectName = clip.upload?.objectName;
    const state = objectName === undefined ? undefined : observed.get(objectName);
    if (state === undefined || state === clip.ingest) {
      return clip;
    }
    changed = true;
    return { ...clip, ingest: state };
  });
  return changed ? next : clips;
}

function asClipIngestState(value: unknown): ClipIngestState | null {
  return CLIP_INGEST_STATES.find((state) => state === value) ?? null;
}

/**
 * Reads the ingest state of already-uploaded clip objects from the web API.
 *
 * Modelled on `requestMediaValidation`: the mobile app holds a Supabase
 * session, not a service role, so the state comes from an authenticated route
 * rather than a direct table read. Anything that is not a recognised state —
 * offline, 404/501 while the route is not deployed, a malformed body — is
 * reported as *no answer* (an absent entry), never as `pending` or `succeeded`,
 * so an unavailable server can neither fake progress nor fake a pass.
 */
export async function requestClipIngestStates(
  request: ClipIngestRequest,
  transport?: ClipIngestTransport,
): Promise<ObservedClipIngest> {
  const empty: ObservedClipIngest = new Map();
  if (request.objectNames.length === 0) {
    return empty;
  }
  try {
    let activeTransport = transport;
    if (activeTransport === undefined) {
      const [{ getSupabaseClient }, { getWebOrigin }] = await Promise.all([
        import('./supabaseClient'),
        import('./webOrigin'),
      ]);
      const client = getSupabaseClient();
      if (client === null) {
        return empty;
      }
      const { data } = await client.auth.getSession();
      const accessToken = data.session?.access_token;
      if (accessToken === undefined) {
        return empty;
      }
      activeTransport = {
        accessToken,
        origin: getWebOrigin(),
        send: (url, init) => fetch(url, init),
      };
    }

    const response = await activeTransport.send(
      `${activeTransport.origin}/api/media/clip-ingest-state`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${activeTransport.accessToken}`,
        },
        body: JSON.stringify({
          bucket: 'pitch-media',
          draftId: request.draftId,
          objectNames: [...request.objectNames],
        }),
      },
    );
    if (!response.ok) {
      return empty;
    }
    const body: unknown = await response.json().catch(() => null);
    if (typeof body !== 'object' || body === null || !('states' in body)) {
      return empty;
    }
    const states: unknown = body.states;
    if (typeof states !== 'object' || states === null) {
      return empty;
    }
    const observed = new Map<string, ClipIngestState>();
    for (const objectName of request.objectNames) {
      const reported = asClipIngestState((states as Record<string, unknown>)[objectName]);
      if (reported !== null) {
        observed.set(objectName, reported);
      }
    }
    return observed;
  } catch {
    return empty;
  }
}

/**
 * What the introducer is told about one clip.
 *
 * Deliberately narrow: the pipeline runs a container/codec probe, a silent
 * proxy transcode, and automated frame moderation. It does not check that the
 * person in the video is the dater, and it does not inspect audio (the proxy has
 * no audio track at all), so no message here may imply either.
 */
export function clipIngestMessage(
  state: ClipIngestState | undefined,
  phase: ClipIngestPollPhase = 'waiting',
): string {
  if (state === 'succeeded') {
    return 'This video passed Friendword’s automated safety checks.';
  }
  if (state === 'flagged') {
    // The server refuses a consent submission while a flagged clip is attached
    // (0050 `reject_flagged_video_on_consent`), so saying "send it without the
    // video" would be false — there is no way to take it off yet.
    return (
      'This video did not pass Friendword’s automated safety checks. It will not be published, ' +
      'and this pitch cannot be sent while it is attached. Someone reviews every flag; if they ' +
      'clear it, the checks run once more.'
    );
  }
  if (state === 'failed') {
    return (
      'Friendword could not process this video, so it will not be published. ' +
      'It may be retried automatically; if it keeps failing, a shorter export usually works.'
    );
  }
  if (phase === 'unresolved') {
    return (
      'Friendword has not been able to confirm this video’s safety review yet. ' +
      'It stays unpublished until it does. Check again in a few minutes.'
    );
  }
  return (
    'This video is going through Friendword’s automated safety review. ' +
    'It cannot be published until that finishes.'
  );
}

/** Short status label for a clip tile. */
export function clipIngestLabel(state: ClipIngestState | undefined): string {
  switch (state) {
    case 'succeeded':
      return 'Safety checks passed';
    case 'flagged':
      return 'Safety checks refused it';
    case 'failed':
      return 'Could not be processed';
    case 'pending':
    case 'processing':
      return 'Safety review in progress';
    default:
      return 'Saved on this device';
  }
}
