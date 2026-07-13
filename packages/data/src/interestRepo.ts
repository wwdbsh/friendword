import { z } from 'zod';

import type { Session } from '@supabase/supabase-js';

import type { BrowserSupabaseClient } from './client';
import type { DatingProfileRow } from './database.types';
import { DataLayerError, InvalidStoragePathError, UnauthenticatedError } from './errors';

const uuidSchema = z.string().uuid();
const fileNameSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const birthDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const PROFILE_MEDIA_BUCKET = 'profile-media';
const SIGNED_URL_TTL_SECONDS = 60 * 60;

export type DatingProfileInput = {
  readonly bio: string;
  readonly datingIntent: string;
  readonly approximateLocation: string | null;
  readonly photos: readonly string[];
  /** ISO date (YYYY-MM-DD); stored on profiles for the 18+ gate. */
  readonly birthDate: string;
};

export type SubmittedInterest = {
  readonly interestId: string;
  readonly interestStatus: string;
};

export type CampaignInterest = {
  readonly interestId: string;
  readonly interestStatus: string;
  readonly note: string | null;
  readonly submittedAt: string | null;
  readonly senderDisplayName: string;
  readonly senderAge: number | null;
  readonly senderBio: string | null;
  readonly senderPhotos: readonly string[];
  readonly senderDatingIntent: string | null;
  readonly senderLocation: string | null;
};

export type InterestDecision = {
  readonly introRoomId: string | null;
};

export type MyInterest = {
  readonly interestId: string;
  readonly interestStatus:
    'started' | 'verification_pending' | 'submitted' | 'accepted' | 'declined' | 'withdrawn';
  readonly submittedAt: string | null;
  readonly decidedAt: string | null;
  readonly campaignId: string;
  readonly campaignSlug: string | null;
  readonly campaignStatus: 'published' | 'paused' | 'expired' | 'archived';
  readonly daterDisplayName: string | null;
  readonly campaignHeadline: string | null;
};

const submitRowSchema = z.array(
  z.object({ interest_id: z.string().uuid(), interest_status: z.string() }),
);

const decideRowSchema = z.array(z.object({ intro_room_id: z.string().uuid().nullable() }));

const myInterestRowsSchema = z.array(
  z.object({
    interest_id: z.string().uuid(),
    interest_status: z.enum([
      'started',
      'verification_pending',
      'submitted',
      'accepted',
      'declined',
      'withdrawn',
    ]),
    submitted_at: z.string().datetime({ offset: true }).nullable(),
    decided_at: z.string().datetime({ offset: true }).nullable(),
    campaign_id: z.string().uuid(),
    campaign_slug: z.string().min(1).nullable(),
    campaign_status: z.enum(['published', 'paused', 'expired', 'archived']),
    dater_display_name: z.string().trim().min(1).nullable(),
    campaign_headline: z.string().trim().min(1).nullable(),
  }),
);

/**
 * Flow C client surface. Profile writes use the client-writable columns and
 * RLS; every interest state transition goes through the 0006 SECURITY
 * DEFINER RPCs. Contact details never travel through this repo.
 */
export class InterestRepo {
  constructor(private readonly client: BrowserSupabaseClient) {}

  async getMyDatingProfile(): Promise<DatingProfileRow | null> {
    const session = await this.getRequiredSession();
    const { data, error } = await this.client
      .from('dating_profiles')
      .select()
      .eq('user_id', session.user.id)
      .maybeSingle();
    if (error !== null) {
      throw new DataLayerError('interest.getMyDatingProfile', error);
    }

    return data;
  }

  /** Uploads a profile photo into the caller's own folder; returns its path. */
  async uploadProfilePhoto(fileName: string, body: Blob | ArrayBuffer): Promise<string> {
    const session = await this.getRequiredSession();
    const parsedName = fileNameSchema.safeParse(fileName);
    if (!parsedName.success) {
      throw new InvalidStoragePathError(fileName);
    }

    const objectPath = `${session.user.id}/${parsedName.data}`;
    const { error } = await this.client.storage
      .from(PROFILE_MEDIA_BUCKET)
      .upload(objectPath, body, { upsert: true });
    if (error !== null) {
      throw new DataLayerError('interest.uploadProfilePhoto', error);
    }

    return `${PROFILE_MEDIA_BUCKET}/${objectPath}`;
  }

  /** Signed view URL for a profile photo path ('profile-media/<user>/<file>'). */
  async createPhotoViewUrl(storagePath: string): Promise<string> {
    await this.getRequiredSession();
    const prefix = `${PROFILE_MEDIA_BUCKET}/`;
    if (!storagePath.startsWith(prefix)) {
      throw new DataLayerError(
        'interest.createPhotoViewUrl',
        new Error(`unexpected storage path: ${storagePath}`),
      );
    }
    const { data, error } = await this.client.storage
      .from(PROFILE_MEDIA_BUCKET)
      .createSignedUrl(storagePath.slice(prefix.length), SIGNED_URL_TTL_SECONDS);
    if (error !== null) {
      throw new DataLayerError('interest.createPhotoViewUrl', error);
    }

    return data.signedUrl;
  }

  /** Saves the verified-interest profile (dating profile + birth date). */
  async saveDatingProfile(input: DatingProfileInput): Promise<void> {
    const session = await this.getRequiredSession();
    const { error: profileError } = await this.client
      .from('profiles')
      .update({ birth_date: birthDateSchema.parse(input.birthDate) })
      .eq('user_id', session.user.id);
    if (profileError !== null) {
      throw new DataLayerError('interest.saveBirthDate', profileError);
    }

    const { error } = await this.client.from('dating_profiles').upsert(
      {
        user_id: session.user.id,
        bio: input.bio,
        dating_intent: input.datingIntent,
        approximate_location: input.approximateLocation,
        photos: input.photos,
      },
      { onConflict: 'user_id' },
    );
    if (error !== null) {
      throw new DataLayerError('interest.saveDatingProfile', error);
    }
  }

  async submitInterest(campaignId: string, note: string | null): Promise<SubmittedInterest> {
    await this.getRequiredSession();
    const { data, error } = await this.client.rpc('submit_interest', {
      target_campaign_id: uuidSchema.parse(campaignId),
      interest_note: note,
    });
    if (error !== null) {
      throw new DataLayerError('interest.submit', error);
    }

    const row = submitRowSchema.parse(data).at(0);
    if (row === undefined) {
      throw new DataLayerError('interest.submit', new Error('RPC returned no interest'));
    }

    return { interestId: row.interest_id, interestStatus: row.interest_status };
  }

  /** Interests sent by the caller, newest submission first (0033 RPC). */
  async listMyInterests(): Promise<readonly MyInterest[]> {
    await this.getRequiredSession();
    const { data, error } = await callUntypedRpc(this.client, 'list_my_interests');
    if (error !== null) {
      throw new DataLayerError('interest.listMyInterests', error);
    }
    const parsed = myInterestRowsSchema.safeParse(data);
    if (!parsed.success) {
      throw new DataLayerError('interest.listMyInterests', parsed.error);
    }

    return parsed.data.map((row) => ({
      interestId: row.interest_id,
      interestStatus: row.interest_status,
      submittedAt: row.submitted_at,
      decidedAt: row.decided_at,
      campaignId: row.campaign_id,
      campaignSlug: row.campaign_slug,
      campaignStatus: row.campaign_status,
      daterDisplayName: row.dater_display_name,
      campaignHeadline: row.campaign_headline,
    }));
  }

  /** The dater's inbox for one campaign (owner-only RPC). */
  async listCampaignInterests(campaignId: string): Promise<readonly CampaignInterest[]> {
    await this.getRequiredSession();
    const { data, error } = await this.client.rpc('list_campaign_interests', {
      target_campaign_id: uuidSchema.parse(campaignId),
    });
    if (error !== null) {
      throw new DataLayerError('interest.listCampaignInterests', error);
    }

    return data.map((row) => ({
      interestId: row.interest_id,
      interestStatus: row.interest_status,
      note: row.note,
      submittedAt: row.submitted_at,
      senderDisplayName: row.sender_display_name,
      senderAge: row.sender_age,
      senderBio: row.sender_bio,
      senderPhotos: row.sender_photos ?? [],
      senderDatingIntent: row.sender_dating_intent,
      senderLocation: row.sender_location,
    }));
  }

  async decideInterest(
    interestId: string,
    decision: 'accepted' | 'declined',
  ): Promise<InterestDecision> {
    await this.getRequiredSession();
    const { data, error } = await this.client.rpc('decide_interest', {
      target_interest_id: uuidSchema.parse(interestId),
      decision,
    });
    if (error !== null) {
      throw new DataLayerError('interest.decide', error);
    }

    const row = decideRowSchema.parse(data).at(0);
    return { introRoomId: row?.intro_room_id ?? null };
  }

  /** Dater lifecycle control: published ⇄ paused → archived (0008 RPC). */
  async setCampaignStatus(
    campaignId: string,
    nextStatus: 'published' | 'paused' | 'archived',
  ): Promise<string> {
    await this.getRequiredSession();
    const { data, error } = await this.client.rpc('set_campaign_status', {
      target_campaign_id: uuidSchema.parse(campaignId),
      next_status: nextStatus,
    });
    if (error !== null) {
      throw new DataLayerError('interest.setCampaignStatus', error);
    }

    return data.at(0)?.campaign_status ?? nextStatus;
  }

  /** Campaigns the signed-in user owns (their inbox scope). */
  async listMyOwnedCampaigns(): Promise<
    readonly {
      readonly id: string;
      readonly slug: string | null;
      readonly status: string;
      readonly endsAt: string | null;
    }[]
  > {
    const session = await this.getRequiredSession();
    const { data, error } = await this.client
      .from('campaigns')
      .select()
      .eq('owner_user_id', session.user.id);
    if (error !== null) {
      throw new DataLayerError('interest.listMyOwnedCampaigns', error);
    }

    return data.map((row) => ({
      id: row.id,
      slug: row.slug,
      status: row.status,
      endsAt: row.ends_at,
    }));
  }

  private async getRequiredSession(): Promise<Session> {
    const { data, error } = await this.client.auth.getSession();
    if (error !== null) {
      throw new DataLayerError('interest.getSession', error);
    }
    if (data.session === null) {
      throw new UnauthenticatedError();
    }

    return data.session;
  }
}

type RpcEnvelope = {
  readonly data: unknown;
  readonly error: unknown | null;
};

async function callUntypedRpc(
  client: BrowserSupabaseClient,
  functionName: 'list_my_interests',
): Promise<RpcEnvelope> {
  const rpc: unknown = Reflect.get(client, 'rpc');
  if (typeof rpc !== 'function') {
    throw new DataLayerError('interest.rpc', new Error('Supabase RPC client is unavailable'));
  }
  const result: unknown = await Reflect.apply(rpc, client, [functionName, {}]);
  if (
    typeof result !== 'object' ||
    result === null ||
    !('data' in result) ||
    !('error' in result)
  ) {
    throw new DataLayerError('interest.rpc', new Error('Supabase RPC returned an invalid result'));
  }
  const data: unknown = Reflect.get(result, 'data');
  const error: unknown = Reflect.get(result, 'error');
  return { data, error };
}
