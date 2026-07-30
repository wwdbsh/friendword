import { z } from 'zod';

import {
  pitchStructureSchema,
  type DraftInputs,
  type PitchSceneAnyVersion,
  type PitchStructure,
} from '@friendword/contracts';
import type { Session } from '@supabase/supabase-js';

import type { BrowserSupabaseClient } from './client';
import type {
  ConsentRequestRow,
  Database,
  Json,
  PitchAssetRow,
  PitchDraftRow,
} from './database.types';
import {
  DataLayerError,
  InvalidDraftUpdateError,
  InvalidStoragePathError,
  UnauthenticatedError,
} from './errors';

const uuidSchema = z.string().uuid();
const fileNameSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const PITCH_MEDIA_BUCKET = 'pitch-media';

export type UpdatePitchDraftInput = {
  readonly headline?: string | null;
  readonly body?: string | null;
  readonly structure?: PitchStructure | null;
};

/**
 * Pixel dimensions of an uploaded photo, as the picker reported them. Optional
 * end to end: the columns are nullable and every asset registered before they
 * existed has none, so a reader must never assume a photo has dimensions.
 */
export type AssetDimensions = {
  readonly width: number;
  readonly height: number;
};

/**
 * `width`/`height` are the nullable pitch_assets columns migration 0048 adds.
 * Narrowed to a positive number here — this repo either measures a photo or
 * leaves the columns out, and the DB CHECK forbids anything else.
 */
type PitchAssetInsert = Omit<
  Database['public']['Tables']['pitch_assets']['Insert'],
  'width' | 'height'
> & {
  readonly width?: number;
  readonly height?: number;
};

/**
 * `new_scene` is the 5th parameter migration 0048 adds to
 * `submit_pitch_for_consent`. The public entry point takes the typed scene so a
 * caller cannot hand the RPC a shape the DB would reject; the wire form is Json,
 * because the generated `Json` type cannot express an optional key that is
 * present-but-undefined (a v2 scene's `chrome.progressBar`) and `sceneAsJson`
 * removes those keys for real rather than casting the difference away.
 */
type SubmitPitchForConsentArgs = Omit<
  Database['public']['Functions']['submit_pitch_for_consent']['Args'],
  'new_scene'
> & {
  readonly new_scene?: Json;
};

/**
 * A parsed scene holds only JSON values, so this is a narrowing rather than a
 * conversion — the round trip exists to drop keys whose value is `undefined`,
 * exactly as the request serializer would, so the typed args match what is sent.
 */
function sceneAsJson(scene: PitchSceneAnyVersion | null): Json {
  return scene === null ? null : (JSON.parse(JSON.stringify(scene)) as Json);
}

export type SignedAssetUpload = {
  readonly storagePath: string;
  readonly signedUrl: string;
  readonly token: string;
};

export type ConsentSubmission = {
  readonly consentRequestId: string;
  readonly consentToken: string | null;
};

const consentInvitationSchema = z.object({
  channel: z.literal('email'),
  contact: z.string().trim().email(),
  friendName: z.string().trim().min(1),
});

export type ConsentInvitationInput = z.input<typeof consentInvitationSchema>;

const consentSubmissionRowSchema = z.array(
  z.object({
    consent_request_id: z.string().uuid(),
    consent_token: z.string().min(24).nullable(),
  }),
);

/** Postgres unique_violation, as PostgREST reports it. */
function isUniqueViolation(error: unknown): boolean {
  return (
    error !== null && typeof error === 'object' && (error as { code?: unknown }).code === '23505'
  );
}

export function buildPitchMediaPath(draftId: string, fileName: string): string {
  const parsedDraftId = uuidSchema.safeParse(draftId);
  const parsedFileName = fileNameSchema.safeParse(fileName);
  if (!parsedDraftId.success) {
    throw new InvalidStoragePathError(draftId);
  }
  if (!parsedFileName.success) {
    throw new InvalidStoragePathError(fileName);
  }

  return `${PITCH_MEDIA_BUCKET}/${parsedDraftId.data}/${parsedFileName.data}`;
}

export class PitchDraftRepo {
  constructor(private readonly client: BrowserSupabaseClient) {}

  async createDraft(context: DraftInputs): Promise<PitchDraftRow> {
    const session = await this.getRequiredSession();
    const { data, error } = await this.client
      .from('pitch_drafts')
      .insert({
        created_by_user_id: session.user.id,
        relationship_type: context.relationshipType,
        relationship_duration: context.relationshipDuration,
      })
      .select()
      .single();
    if (error !== null) {
      throw new DataLayerError('pitchDraft.create', error);
    }

    return data;
  }

  async updateDraft(draftId: string, input: UpdatePitchDraftInput): Promise<PitchDraftRow> {
    await this.getRequiredSession();
    const updates = {
      ...(input.headline === undefined ? {} : { headline: input.headline }),
      ...(input.body === undefined ? {} : { body: input.body }),
      ...(input.structure === undefined
        ? {}
        : {
            structure:
              input.structure === null ? null : pitchStructureSchema.parse(input.structure),
          }),
    };
    if (Object.keys(updates).length === 0) {
      throw new InvalidDraftUpdateError();
    }
    const { data, error } = await this.client
      .from('pitch_drafts')
      .update(updates)
      .eq('id', uuidSchema.parse(draftId))
      .select()
      .single();
    if (error !== null) {
      throw new DataLayerError('pitchDraft.update', error);
    }

    return data;
  }

  async listMyDrafts(): Promise<readonly PitchDraftRow[]> {
    await this.getRequiredSession();
    const { data, error } = await this.client
      .from('pitch_drafts')
      .select()
      .order('created_at', { ascending: false });
    if (error !== null) {
      throw new DataLayerError('pitchDraft.listMine', error);
    }

    return data;
  }

  async getDraft(draftId: string): Promise<PitchDraftRow> {
    await this.getRequiredSession();
    const { data, error } = await this.client
      .from('pitch_drafts')
      .select()
      .eq('id', uuidSchema.parse(draftId))
      .single();
    if (error !== null) {
      throw new DataLayerError('pitchDraft.get', error);
    }
    return data;
  }

  async listMyConsentRequests(): Promise<readonly ConsentRequestRow[]> {
    await this.getRequiredSession();
    const { data, error } = await this.client
      .from('consent_requests')
      .select()
      .order('created_at', { ascending: false });
    if (error !== null) {
      throw new DataLayerError('pitchDraft.listConsentRequests', error);
    }
    return data;
  }

  async requestAssetUpload(draftId: string, fileName: string): Promise<SignedAssetUpload> {
    const storagePath = buildPitchMediaPath(draftId, fileName);
    const objectPath = storagePath.slice(`${PITCH_MEDIA_BUCKET}/`.length);
    const { data, error } = await this.client.storage
      .from(PITCH_MEDIA_BUCKET)
      .createSignedUploadUrl(objectPath, { upsert: false });
    if (error !== null) {
      throw new DataLayerError('pitchDraft.requestAssetUpload', error);
    }

    return { storagePath, signedUrl: data.signedUrl, token: data.token };
  }

  /**
   * The pitch_assets rows a draft currently carries. `submit_pitch_for_consent`
   * snapshots all of them into the consent revision, so this is how a caller
   * can see what a submit would actually send before sending it.
   */
  async listAssets(draftId: string): Promise<readonly PitchAssetRow[]> {
    await this.getRequiredSession();
    const { data, error } = await this.client
      .from('pitch_assets')
      .select()
      .eq('pitch_draft_id', uuidSchema.parse(draftId))
      .order('sort_order', { ascending: true });
    if (error !== null) {
      throw new DataLayerError('pitchDraft.listAssets', error);
    }

    return data;
  }

  /**
   * Detaches a photo the caller uploaded from their own still-editable draft
   * (0046). Deletes the pitch_assets row only — the storage object is left to
   * the 48h orphan sweep, which reclaims bytes through the Storage API.
   *
   * The RPC refuses a voice asset, a draft past `changes_requested`, and an
   * asset someone else uploaded, so a caller cannot use it to publish a pitch
   * without the introducer's voice or to edit media the subject has consented
   * to.
   */
  async removeAsset(assetId: string): Promise<void> {
    await this.getRequiredSession();
    const { error } = await this.client.rpc('remove_pitch_draft_asset', {
      p_asset_id: uuidSchema.parse(assetId),
    });
    if (error !== null) {
      throw new DataLayerError('pitchDraft.removeAsset', error);
    }
  }

  /**
   * Records an uploaded object in pitch_assets so other surfaces (consent
   * review, public page) can discover it without guessing storage paths.
   *
   * Idempotent by (pitch_draft_id, storage_path), which the table declares
   * UNIQUE (0001:93). A caller that never learned its insert committed — a lost
   * response, an app kill between the insert and its own bookkeeping — retries
   * with the same path, and surfacing that as a failure would leave the draft
   * permanently unsubmittable from that device.
   */
  async registerAsset(
    draftId: string,
    assetType: 'voice' | 'photo',
    fileName: string,
    sortOrder = 0,
    dimensions?: AssetDimensions,
  ): Promise<PitchAssetRow> {
    const session = await this.getRequiredSession();
    const storagePath = buildPitchMediaPath(draftId, fileName);
    const parsedDraftId = uuidSchema.parse(draftId);
    const payload: PitchAssetInsert = {
      pitch_draft_id: parsedDraftId,
      uploaded_by_user_id: session.user.id,
      asset_type: assetType,
      storage_path: storagePath,
      sort_order: sortOrder,
      // Omitted rather than sent as null when unknown: the CHECK is `> 0`, so a
      // caller with no measurement has to leave the columns absent.
      ...(dimensions === undefined ? {} : { width: dimensions.width, height: dimensions.height }),
    };
    const { data, error } = await this.client
      .from('pitch_assets')
      .insert(payload)
      .select()
      .single();
    if (error !== null) {
      if (isUniqueViolation(error)) {
        return this.findRegisteredAsset(parsedDraftId, storagePath);
      }
      throw new DataLayerError('pitchDraft.registerAsset', error);
    }

    return data;
  }

  /** The row a duplicate registration collided with; its absence is a real failure. */
  private async findRegisteredAsset(draftId: string, storagePath: string): Promise<PitchAssetRow> {
    const { data, error } = await this.client
      .from('pitch_assets')
      .select()
      .eq('pitch_draft_id', draftId)
      .eq('storage_path', storagePath)
      .maybeSingle();
    if (error !== null) {
      throw new DataLayerError('pitchDraft.registerAsset', error);
    }
    if (data === null) {
      throw new DataLayerError(
        'pitchDraft.registerAsset',
        new Error('pitch asset already exists but is not readable'),
      );
    }

    return data;
  }

  /**
   * Server-validated transition draft → consent_pending (0004 RPC).
   * Returns the raw consent token exactly once — only its hash is stored,
   * so the caller must hand it to the introducer's share flow immediately.
   *
   * `scene` is the PitchScene the dater will be asked to approve — v2 from a
   * current bundle, v1 from an older one, since both stay valid writes. It is sent
   * at submit because a dater who approves without editing never triggers a
   * revision save, and their published page would then carry no motion. `null`
   * is a real answer (no transcript segments, no photos) and leaves the revision
   * with no scene, which the surfaces read as the legacy fallback. Passing
   * `undefined` omits the argument entirely, for callers that predate scenes.
   */
  async submitForConsent(
    draftId: string,
    invitation?: ConsentInvitationInput,
    scene?: PitchSceneAnyVersion | null,
  ): Promise<ConsentSubmission> {
    await this.getRequiredSession();
    const parsedDraftId = uuidSchema.parse(draftId);
    const args: SubmitPitchForConsentArgs = {
      ...(invitation === undefined
        ? { draft_id: parsedDraftId }
        : buildConsentInvitationArgs(parsedDraftId, invitation)),
      ...(scene === undefined ? {} : { new_scene: sceneAsJson(scene) }),
    };
    const { data, error } = await this.client.rpc('submit_pitch_for_consent', args);
    if (error !== null) {
      throw new DataLayerError('pitchDraft.submitForConsent', error);
    }

    const row = consentSubmissionRowSchema.parse(data).at(0);
    if (row === undefined) {
      throw new DataLayerError(
        'pitchDraft.submitForConsent',
        new Error('RPC returned no consent request'),
      );
    }

    return { consentRequestId: row.consent_request_id, consentToken: row.consent_token };
  }

  private async getRequiredSession(): Promise<Session> {
    const { data, error } = await this.client.auth.getSession();
    if (error !== null) {
      throw new DataLayerError('pitchDraft.getSession', error);
    }
    if (data.session === null) {
      throw new UnauthenticatedError();
    }

    return data.session;
  }
}

function buildConsentInvitationArgs(draftId: string, invitation: ConsentInvitationInput) {
  const parsed = consentInvitationSchema.parse(invitation);
  return {
    draft_id: draftId,
    invite_channel: parsed.channel,
    invite_contact: parsed.contact,
    invite_friend_name: parsed.friendName,
  };
}
