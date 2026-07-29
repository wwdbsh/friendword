import { z } from 'zod';

import {
  daterPitchStructureEditSchema,
  deriveDaterPitchBody,
  deriveDaterPitchHeadline,
  pitchStructureSchema,
  type DaterPitchStructureEdit,
} from '@friendword/contracts';

import type { RelationshipDuration, RelationshipType } from '@friendword/contracts';
import type { Session } from '@supabase/supabase-js';

import type { BrowserSupabaseClient } from './client';
import type { PitchAssetRow } from './database.types';
import { DataLayerError, UnauthenticatedError } from './errors';

const rawTokenSchema = z
  .string()
  .trim()
  .min(24)
  .regex(/^[A-Za-z0-9_-]+$/);
const uuidSchema = z.string().uuid();
const fileNameSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const daterPhotoContentTypeSchema = z.enum(['image/jpeg', 'image/png', 'image/webp']);
const PITCH_MEDIA_BUCKET = 'pitch-media';
const SIGNED_URL_TTL_SECONDS = 60 * 60;

const daterRevisionRowSchema = z.array(
  z.object({
    revision_id: z.string().uuid(),
    revision_number: z.number().int().positive(),
  }),
);

const daterRevisionInputSchema = z.object({
  draftId: z.string().uuid(),
  headline: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(2000),
  includedAssetIds: z.array(z.string().uuid()),
  // Fifth audit P0: when present, the five structure fields ARE the approved
  // content and the server derives headline/body from them.
  structure: daterPitchStructureEditSchema.optional(),
  // Per-claim disposition (fifth audit P0, decision D2). Absent → the RPC keeps
  // every flagged claim (pre-0047 behaviour). Present → the published structure
  // carries exactly these claims; an empty array means "I removed all of them".
  // The server rejects any entry that was not already flagged, so this can only
  // ever shrink the list.
  retainedHardClaims: z.array(z.string().trim().min(1)).optional(),
});

const daterProfileSchema = z
  .object({
    birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    region: z.string().trim().min(1).max(80),
    city: z
      .string()
      .trim()
      .max(80)
      .optional()
      .transform((value) => (value === undefined || value.length === 0 ? undefined : value)),
    intent: z.enum(['long-term', 'open-to-either', 'short-term']),
  })
  .strict();

const publishPreferencesSchema = z
  .object({
    draftId: z.string().uuid(),
    audience: z
      .object({
        minAge: z.number().int().min(18),
        maxAge: z.number().int().min(18).optional(),
        intents: z.array(z.enum(['long-term', 'open-to-either', 'short-term'])).optional(),
      })
      .refine((audience) => audience.maxAge === undefined || audience.maxAge >= audience.minAge, {
        message: 'maximum age cannot be below minimum age',
      }),
    locationPrecision: z.enum(['city', 'region', 'hidden']),
    publishDays: z.union([z.literal(7), z.literal(14)]),
  })
  .strict();

export type ConsentPreview = {
  readonly introducerDisplayName: string;
  readonly relationshipType: RelationshipType | null;
  readonly relationshipDuration: RelationshipDuration | null;
  readonly requestStatus: string;
};

export type ConsentClaim = {
  readonly pitchDraftId: string;
};

export type PublishedCampaign = {
  readonly campaignId: string;
  readonly campaignSlug: string;
};

export type ConsentRevision = {
  readonly id: string;
  readonly pitch_draft_id: string;
  readonly revision_number: number;
  readonly headline: string;
  readonly body: string;
  readonly structure: unknown;
  readonly asset_ids: readonly string[];
  readonly voice_asset_path: string | null;
  readonly content_hash: string;
  readonly created_at: string;
};

export type ConsentReview = {
  readonly revision: ConsentRevision;
  readonly assets: readonly PitchAssetRow[];
  readonly hardClaims: readonly string[];
  /**
   * The five structure fields the public page renders, so the Dater can edit
   * the exact text that publishes (fifth audit P0). Null when the snapshot
   * predates the structured pitch or doesn't match the shape — the UI then
   * falls back to headline/body editing and says so instead of publishing
   * sentences the Dater never saw.
   */
  readonly editableStructure: EditablePitchStructure | null;
  /**
   * The machine transcript frozen into this revision — the exact text
   * approve_and_publish_pitch copies onto the published draft, which the public
   * page prints in full AND runs as the captions over the photos. It is not
   * editable (it is what the Introducer actually said), so the consent UI shows
   * it read-only: "approve" cannot mean anything unless the Dater has seen it.
   * Null when the recording has no transcript.
   */
  readonly transcriptText: string | null;
  /**
   * True when the current revision was cut by the Dater editing the copy
   * (third audit P0-NEW-3). The approve gate then requires an explicit
   * hard-claims confirmation, so the UI always surfaces the confirmation.
   */
  readonly daterEdited: boolean;
  /**
   * True when this revision was created through the structure path, i.e. the
   * five published fields came from the Dater's own editor. False for AI-drafted
   * and pre-0047 revisions, whose structure the Dater never saw — the caller
   * must not claim otherwise, and must re-send the structure on the next save
   * so the moderation ledger keys stay in step (see createDaterRevision).
   */
  readonly structureReviewed: boolean;
};

export type ConsentApproval = {
  readonly draftId: string;
  readonly campaignDays: 7 | 14;
  readonly revisionId: string;
  readonly includedAssetIds: readonly string[];
  readonly hardClaimsConfirmed: boolean;
};

export type DaterRevisionInput = {
  readonly draftId: string;
  readonly headline: string;
  readonly body: string;
  readonly includedAssetIds: readonly string[];
  /**
   * The Dater's edited structure. When set, headline/body are re-derived here
   * and again by the RPC, which ignores the client's copies; the passed
   * headline/body only stay in the payload for pre-0047 compatibility.
   */
  readonly structure?: DaterPitchStructureEdit;
  /**
   * The flagged claims the Dater says are still true and still on the page.
   * Omit to keep every flagged claim. An empty array publishes none of them.
   */
  readonly retainedHardClaims?: readonly string[];
};

export type DaterRevisionResult = {
  readonly revisionId: string;
  readonly revisionNumber: number;
};

export type DaterProfileInput = {
  /** ISO calendar date 'YYYY-MM-DD'; the server validates 18+ and never publishes it. */
  readonly birthDate: string;
  readonly region: string;
  readonly city?: string;
  readonly intent: 'long-term' | 'open-to-either' | 'short-term';
};

export type PublishPreferencesInput = {
  readonly draftId: string;
  readonly audience: {
    readonly minAge: number;
    readonly maxAge?: number;
    readonly intents?: readonly ('long-term' | 'open-to-either' | 'short-term')[];
  };
  readonly locationPrecision: 'city' | 'region' | 'hidden';
  readonly publishDays: 7 | 14;
};

export type ConsentResponseAction = 'request_changes' | 'decline';

export function isTranscriptionEditableStatus(status: string): boolean {
  return status === 'draft' || status === 'changes_requested';
}

const previewRowSchema = z.array(
  z.object({
    introducer_display_name: z.string(),
    relationship_type: z.string().nullable(),
    relationship_duration: z.string().nullable(),
    request_status: z.string(),
  }),
);

const claimRowSchema = z.array(z.object({ pitch_draft_id: z.string().uuid() }));

const publishRowSchema = z.array(
  z.object({
    campaign_id: z.string().uuid(),
    campaign_slug: z.string().min(1),
  }),
);

const revisionStructureSchema = z
  .object({
    hard_claims_requiring_confirmation: z.array(z.string().trim().min(1)).default([]),
  })
  .nullable();

/**
 * Read-side shape of the Dater-editable fields. Deliberately looser than
 * `daterPitchStructureEditSchema`: an AI draft may exceed the edit limits or
 * leave a field blank, and the Dater must still be able to open it and fix it.
 * The strict contract schema gates the save.
 */
const editablePitchStructureSchema = pitchStructureSchema.omit({
  hard_claims_requiring_confirmation: true,
});

export type EditablePitchStructure = z.infer<typeof editablePitchStructureSchema>;

/**
 * The revision's frozen transcript snapshot (migration 0032). Only `text` is
 * needed at consent — the segments drive the public page's captions, which are
 * cut from this same text, so showing the text covers both surfaces.
 */
const revisionTranscriptSchema = z
  .object({ text: z.string() })
  .passthrough()
  .nullable()
  .catch(null);

const responseNoteSchema = z.string().trim().min(1);

/**
 * Flow B client surface: the dater previews an invite anonymously, signs in,
 * claims it, reviews the introducer's material, and approves. Every state
 * transition still happens inside the 0004/0005 SECURITY DEFINER RPCs — this
 * repo only calls them and reads what RLS exposes to the claimed subject.
 */
export class ConsentRepo {
  constructor(private readonly client: BrowserSupabaseClient) {}

  /** Anonymous-safe invite preview; null when the token matches nothing. */
  async getPreview(rawToken: string): Promise<ConsentPreview | null> {
    const parsed = rawTokenSchema.safeParse(rawToken);
    if (!parsed.success) {
      return null;
    }

    const { data, error } = await this.client.rpc('get_consent_preview', {
      raw_token: parsed.data,
    });
    if (error !== null) {
      throw new DataLayerError('consent.getPreview', error);
    }

    const row = previewRowSchema.parse(data).at(0);
    if (row === undefined) {
      return null;
    }

    return {
      introducerDisplayName: row.introducer_display_name,
      relationshipType: (row.relationship_type as RelationshipType | null) ?? null,
      relationshipDuration: (row.relationship_duration as RelationshipDuration | null) ?? null,
      requestStatus: row.request_status,
    };
  }

  /** Links the signed-in dater to the draft (server-validated, 0005 RPC). */
  async claim(rawToken: string): Promise<ConsentClaim> {
    await this.getRequiredSession();
    const { data, error } = await this.client.rpc('claim_consent_request', {
      raw_token: rawTokenSchema.parse(rawToken),
    });
    if (error !== null) {
      throw new DataLayerError('consent.claim', error);
    }

    const row = claimRowSchema.parse(data).at(0);
    if (row === undefined) {
      throw new DataLayerError('consent.claim', new Error('RPC returned no draft'));
    }

    return { pitchDraftId: row.pitch_draft_id };
  }

  async getConsentReview(draftId: string): Promise<ConsentReview> {
    await this.getRequiredSession();
    const parsedDraftId = uuidSchema.parse(draftId);
    const { data: request, error: requestError } = await this.client
      .from('consent_requests')
      .select('revision_id')
      .eq('pitch_draft_id', parsedDraftId)
      .single();
    if (requestError !== null) {
      throw new DataLayerError('consent.getConsentReview.request', requestError);
    }
    if (request.revision_id === null) {
      throw new DataLayerError(
        'consent.getConsentReview.request',
        new Error('consent request has no revision'),
      );
    }

    const { data: revision, error: revisionError } = await this.client
      .from('consent_revisions')
      .select()
      .eq('id', request.revision_id)
      .eq('pitch_draft_id', parsedDraftId)
      .single();
    if (revisionError !== null) {
      throw new DataLayerError('consent.getConsentReview.revision', revisionError);
    }

    let assets: readonly PitchAssetRow[] = [];
    if (revision.asset_ids.length > 0) {
      const { data, error } = await this.client
        .from('pitch_assets')
        .select()
        .eq('pitch_draft_id', parsedDraftId)
        .in('id', revision.asset_ids)
        .order('sort_order', { ascending: true });
      if (error !== null) {
        throw new DataLayerError('consent.getConsentReview.assets', error);
      }
      const returnedAssetIds = new Set(data.map((asset) => asset.id));
      if (revision.asset_ids.some((assetId) => !returnedAssetIds.has(assetId))) {
        throw new DataLayerError(
          'consent.getConsentReview.assets',
          new Error('revision asset is unavailable'),
        );
      }
      assets = data;
    }

    const parsedStructure = revisionStructureSchema.safeParse(revision.structure);
    if (!parsedStructure.success) {
      throw new DataLayerError('consent.getConsentReview.structure', parsedStructure.error);
    }

    // `dater_edited` lands with migration 0036 and `structure_reviewed` with
    // 0047; the generated Row type is regenerated at integration time, so read
    // them structurally. Both fail closed to false on a pre-migration row.
    const revisionFlags = revision as {
      readonly dater_edited?: boolean | null;
      readonly structure_reviewed?: boolean | null;
    };
    const daterEdited = revisionFlags.dater_edited === true;
    const structureReviewed = revisionFlags.structure_reviewed === true;

    // The transcript is a snapshot the approve RPC copies to the published
    // draft, so what the Dater reads here is what publishes. An unparseable
    // snapshot reads as "no transcript" rather than a half-rendered blob.
    const transcript = revisionTranscriptSchema.parse(
      (revision as { readonly transcript?: unknown }).transcript ?? null,
    );
    const transcriptText =
      transcript === null || transcript.text.trim() === '' ? null : transcript.text;

    // Fail closed on the editable half too: a structure that doesn't match the
    // shape is reported as absent (legacy fallback), never coerced into blanks.
    const parsedEditable = editablePitchStructureSchema.safeParse(revision.structure);

    return {
      revision,
      assets,
      hardClaims: parsedStructure.data?.hard_claims_requiring_confirmation ?? [],
      editableStructure: parsedEditable.success ? parsedEditable.data : null,
      transcriptText,
      daterEdited,
      structureReviewed,
    };
  }

  /**
   * Current AI-processing disclosure revision (third audit C1 RPC). The Dater
   * must see and affirm this before any new photo or edited text is sent to the
   * external moderation provider. Returns null when the RPC is unavailable so
   * the caller can keep the AI actions closed.
   */
  async getAiDisclosureRevision(): Promise<string | null> {
    await this.getRequiredSession();
    const { data, error } = await this.client.rpc('get_ai_disclosure_revision');
    if (error !== null) {
      throw new DataLayerError('consent.getAiDisclosureRevision', error);
    }
    return typeof data === 'string' && data !== '' ? data : null;
  }

  /**
   * Records the Dater's affirmative, draft-scoped AI-processing consent for the
   * given disclosure revision (third audit C2). Idempotent server-side; throws
   * on failure so the caller keeps the gate closed and never starts processing.
   */
  async recordDaterAiConsent(draftId: string, revision: string): Promise<void> {
    await this.getRequiredSession();
    const { error } = await this.client.rpc('record_ai_processing_consent', {
      target_draft_id: uuidSchema.parse(draftId),
      target_consent_revision: revision,
    });
    if (error !== null) {
      throw new DataLayerError('consent.recordDaterAiConsent', error);
    }
  }

  /** Signed view URL for a registered asset ('pitch-media/<draft>/<file>'). */
  async createAssetViewUrl(storagePath: string): Promise<string> {
    await this.getRequiredSession();
    const prefix = `${PITCH_MEDIA_BUCKET}/`;
    const objectPath = storagePath.startsWith(prefix)
      ? storagePath.slice(prefix.length)
      : storagePath;
    const [draftId, ...pathSegments] = objectPath.split('/');
    const validPath =
      uuidSchema.safeParse(draftId).success &&
      pathSegments.length > 0 &&
      pathSegments.every((segment) => fileNameSchema.safeParse(segment).success);
    if (!validPath) {
      throw new DataLayerError('consent.createAssetViewUrl', new Error('unexpected storage path'));
    }
    const { data, error } = await this.client.storage
      .from(PITCH_MEDIA_BUCKET)
      .createSignedUrl(objectPath, SIGNED_URL_TTL_SECONDS);
    if (error !== null) {
      throw new DataLayerError('consent.createAssetViewUrl', error);
    }

    return data.signedUrl;
  }

  /** Uploads and registers a dater-owned photo; validation remains the caller's next step. */
  async uploadDaterPhoto(
    draftId: string,
    fileName: string,
    fileBody: ArrayBuffer,
    contentType: 'image/jpeg' | 'image/png' | 'image/webp',
  ): Promise<PitchAssetRow> {
    const session = await this.getRequiredSession();
    const parsedDraftId = uuidSchema.parse(draftId);
    const parsedFileName = fileNameSchema.parse(fileName);
    const parsedContentType = daterPhotoContentTypeSchema.parse(contentType);
    const objectPath = `${parsedDraftId}/${parsedFileName}`;
    const storagePath = `${PITCH_MEDIA_BUCKET}/${objectPath}`;

    const { data: latestAssets, error: latestAssetsError } = await this.client
      .from('pitch_assets')
      .select('sort_order')
      .eq('pitch_draft_id', parsedDraftId)
      .order('sort_order', { ascending: false })
      .limit(1);
    if (latestAssetsError !== null) {
      throw new DataLayerError('consent.uploadDaterPhoto.sortOrder', latestAssetsError);
    }
    const sortOrder = (latestAssets.at(0)?.sort_order ?? -1) + 1;

    const bucket = this.client.storage.from(PITCH_MEDIA_BUCKET);
    const { data: upload, error: signedUploadError } = await bucket.createSignedUploadUrl(
      objectPath,
      { upsert: false },
    );
    if (signedUploadError !== null) {
      throw new DataLayerError('consent.uploadDaterPhoto.signedUpload', signedUploadError);
    }
    const { error: uploadError } = await bucket.uploadToSignedUrl(
      objectPath,
      upload.token,
      fileBody,
      { contentType: parsedContentType },
    );
    if (uploadError !== null) {
      throw new DataLayerError('consent.uploadDaterPhoto.upload', uploadError);
    }

    const { data: asset, error: assetError } = await this.client
      .from('pitch_assets')
      .insert({
        pitch_draft_id: parsedDraftId,
        uploaded_by_user_id: session.user.id,
        asset_type: 'photo',
        storage_path: storagePath,
        sort_order: sortOrder,
      })
      .select()
      .single();
    if (assetError !== null) {
      throw new DataLayerError('consent.uploadDaterPhoto.register', assetError);
    }

    return asset;
  }

  /** Creates the dater's immutable text/photo selection revision. */
  async createDaterRevision(input: DaterRevisionInput): Promise<DaterRevisionResult> {
    await this.getRequiredSession();
    const parsed = daterRevisionInputSchema.parse(input);
    const structure = parsed.structure;
    const { data, error } = await callUntypedRpc(this.client, 'create_dater_revision', {
      draft_id: parsed.draftId,
      new_headline: structure === undefined ? parsed.headline : deriveDaterPitchHeadline(structure),
      new_body: structure === undefined ? parsed.body : deriveDaterPitchBody(structure),
      included_asset_ids: parsed.includedAssetIds,
      // Omitted (not null) without a structure so pre-0047 deployments, whose
      // function has no such parameter, keep resolving the legacy signature.
      ...(structure === undefined ? {} : { new_structure: structure }),
      // Same reasoning for the claim disposition: omitted means "keep them all",
      // which is also what a pre-0047 function does with no such parameter.
      ...(parsed.retainedHardClaims === undefined
        ? {}
        : { retained_hard_claims: parsed.retainedHardClaims }),
    });
    if (error !== null) {
      throw new DataLayerError('consent.createDaterRevision', error);
    }
    const row = daterRevisionRowSchema.parse(data).at(0);
    if (row === undefined) {
      throw new DataLayerError(
        'consent.createDaterRevision',
        new Error('RPC returned no revision'),
      );
    }

    return { revisionId: row.revision_id, revisionNumber: row.revision_number };
  }

  /**
   * Confirms the dater's own age (18+), structured approximate location, and
   * dating intent (CP-1). Server-validated SECURITY DEFINER RPC (migration
   * 0041); the birth date is stored on the profile and never published.
   */
  async setDaterProfile(input: DaterProfileInput): Promise<void> {
    await this.getRequiredSession();
    const parsed = daterProfileSchema.parse(input);
    const { error } = await callUntypedRpc(this.client, 'set_dater_profile', {
      target_birth_date: parsed.birthDate,
      target_region: parsed.region,
      target_city: parsed.city ?? null,
      target_intent: parsed.intent,
    });
    if (error !== null) {
      throw new DataLayerError('consent.setDaterProfile', error);
    }
  }

  /** Persists audience, location, and duration immediately before approval. */
  async setPublishPreferences(input: PublishPreferencesInput): Promise<void> {
    await this.getRequiredSession();
    const parsed = publishPreferencesSchema.parse(input);
    const audience = {
      min_age: parsed.audience.minAge,
      ...(parsed.audience.maxAge === undefined ? {} : { max_age: parsed.audience.maxAge }),
      ...(parsed.audience.intents === undefined || parsed.audience.intents.length === 0
        ? {}
        : { intents: parsed.audience.intents }),
    };
    const { error } = await callUntypedRpc(this.client, 'set_publish_preferences', {
      draft_id: parsed.draftId,
      audience,
      target_location_precision: parsed.locationPrecision,
      target_publish_days: parsed.publishDays,
    });
    if (error !== null) {
      throw new DataLayerError('consent.setPublishPreferences', error);
    }
  }

  /** Approve and publish in one server transaction; returns the public slug. */
  async approveAndPublish(approval: ConsentApproval): Promise<PublishedCampaign> {
    await this.getRequiredSession();
    const { data, error } = await this.client.rpc('approve_and_publish_pitch', {
      draft_id: uuidSchema.parse(approval.draftId),
      campaign_days: approval.campaignDays,
      revision_id: uuidSchema.parse(approval.revisionId),
      included_asset_ids: approval.includedAssetIds.map((assetId) => uuidSchema.parse(assetId)),
      hard_claims_confirmed: approval.hardClaimsConfirmed,
    });
    if (error !== null) {
      throw new DataLayerError('consent.approveAndPublish', error);
    }

    const row = publishRowSchema.parse(data).at(0);
    if (row === undefined) {
      throw new DataLayerError('consent.approveAndPublish', new Error('RPC returned no campaign'));
    }

    return { campaignId: row.campaign_id, campaignSlug: row.campaign_slug };
  }

  async respondToConsent(
    draftId: string,
    action: ConsentResponseAction,
    note: string,
  ): Promise<void> {
    await this.getRequiredSession();
    const { error } = await this.client.rpc('respond_consent_request', {
      draft_id: uuidSchema.parse(draftId),
      action,
      note: responseNoteSchema.parse(note),
    });
    if (error !== null) {
      throw new DataLayerError('consent.respondToConsent', error);
    }
  }

  private async getRequiredSession(): Promise<Session> {
    const { data, error } = await this.client.auth.getSession();
    if (error !== null) {
      throw new DataLayerError('consent.getSession', error);
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
  functionName: 'create_dater_revision' | 'set_publish_preferences' | 'set_dater_profile',
  args: Readonly<Record<string, unknown>>,
): Promise<RpcEnvelope> {
  const rpc: unknown = Reflect.get(client, 'rpc');
  if (typeof rpc !== 'function') {
    throw new DataLayerError('consent.rpc', new Error('Supabase RPC client is unavailable'));
  }
  const result: unknown = await Reflect.apply(rpc, client, [functionName, args]);
  if (
    typeof result !== 'object' ||
    result === null ||
    !('data' in result) ||
    !('error' in result)
  ) {
    throw new DataLayerError('consent.rpc', new Error('Supabase RPC returned an invalid result'));
  }
  const data: unknown = Reflect.get(result, 'data');
  const error: unknown = Reflect.get(result, 'error');
  return { data, error };
}
