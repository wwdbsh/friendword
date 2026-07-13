import { z } from 'zod';

import { pitchStructureSchema, type DraftInputs, type PitchStructure } from '@friendword/contracts';
import type { Session } from '@supabase/supabase-js';

import type { BrowserSupabaseClient } from './client';
import type { ConsentRequestRow, PitchAssetRow, PitchDraftRow } from './database.types';
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
   * Records an uploaded object in pitch_assets so other surfaces (consent
   * review, public page) can discover it without guessing storage paths.
   */
  async registerAsset(
    draftId: string,
    assetType: 'voice' | 'photo',
    fileName: string,
    sortOrder = 0,
  ): Promise<PitchAssetRow> {
    const session = await this.getRequiredSession();
    const storagePath = buildPitchMediaPath(draftId, fileName);
    const { data, error } = await this.client
      .from('pitch_assets')
      .insert({
        pitch_draft_id: uuidSchema.parse(draftId),
        uploaded_by_user_id: session.user.id,
        asset_type: assetType,
        storage_path: storagePath,
        sort_order: sortOrder,
      })
      .select()
      .single();
    if (error !== null) {
      throw new DataLayerError('pitchDraft.registerAsset', error);
    }

    return data;
  }

  /**
   * Server-validated transition draft → consent_pending (0004 RPC).
   * Returns the raw consent token exactly once — only its hash is stored,
   * so the caller must hand it to the introducer's share flow immediately.
   */
  async submitForConsent(
    draftId: string,
    invitation?: ConsentInvitationInput,
  ): Promise<ConsentSubmission> {
    await this.getRequiredSession();
    const parsedDraftId = uuidSchema.parse(draftId);
    const args =
      invitation === undefined
        ? { draft_id: parsedDraftId }
        : buildConsentInvitationArgs(parsedDraftId, invitation);
    const { data, error } = await this.client.rpc('submit_pitch_for_consent', {
      ...args,
    });
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
