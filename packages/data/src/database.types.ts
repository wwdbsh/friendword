import type { RelationshipDuration, RelationshipType } from '@friendword/contracts';
import type { PitchDraftStatus } from '@friendword/domain';

export type Json =
  string | number | boolean | null | { readonly [key: string]: Json } | readonly Json[];

export type UserRow = {
  readonly id: string;
  readonly phone_verified_at: string | null;
  readonly account_status: 'active' | 'suspended' | 'deleted';
  readonly preferences: Json;
  readonly created_at: string;
  readonly updated_at: string;
};

export type ProfileRow = {
  readonly user_id: string;
  readonly display_name: string;
  readonly birth_date: string | null;
  readonly locale: string;
  readonly verification_status: string;
  readonly created_at: string;
  readonly updated_at: string;
};

export type PitchDraftRow = {
  readonly id: string;
  readonly created_by_user_id: string;
  readonly subject_user_id: string | null;
  readonly status: PitchDraftStatus;
  readonly headline: string | null;
  readonly body: string | null;
  readonly relationship_type: RelationshipType | null;
  readonly relationship_duration: RelationshipDuration | null;
  readonly created_at: string;
  readonly updated_at: string;
};

export type CampaignRow = {
  readonly id: string;
  readonly pitch_draft_id: string;
  readonly owner_user_id: string;
  readonly status: 'draft' | 'published' | 'paused' | 'expired' | 'archived';
  readonly published_at: string | null;
  readonly slug: string | null;
  readonly created_at: string;
  readonly updated_at: string;
};

export type Database = {
  public: {
    Tables: {
      users: {
        Row: UserRow;
        Insert: {
          readonly id: string;
          readonly preferences?: Json;
        };
        Update: {
          readonly preferences?: Json;
        };
        Relationships: [];
      };
      profiles: {
        Row: ProfileRow;
        Insert: {
          readonly user_id: string;
          readonly display_name: string;
          readonly birth_date?: string | null;
          readonly locale?: string;
        };
        Update: {
          readonly display_name?: string;
          readonly birth_date?: string | null;
          readonly locale?: string;
        };
        Relationships: [];
      };
      pitch_drafts: {
        Row: PitchDraftRow;
        Insert: {
          readonly created_by_user_id: string;
          readonly headline?: string | null;
          readonly body?: string | null;
          readonly relationship_type?: RelationshipType | null;
          readonly relationship_duration?: RelationshipDuration | null;
        };
        Update: {
          readonly headline?: string | null;
          readonly body?: string | null;
          readonly relationship_type?: RelationshipType | null;
          readonly relationship_duration?: RelationshipDuration | null;
        };
        Relationships: [];
      };
      campaigns: {
        Row: CampaignRow;
        // Clients only hold UPDATE (status, published_at); inserts are RPC/service-only.
        Insert: {
          readonly pitch_draft_id: string;
          readonly owner_user_id: string;
          readonly status?: CampaignRow['status'];
          readonly published_at?: string | null;
          readonly slug?: string | null;
        };
        Update: {
          readonly status?: CampaignRow['status'];
          readonly published_at?: string | null;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      submit_pitch_for_consent: {
        Args: { readonly draft_id: string };
        Returns: readonly {
          readonly consent_request_id: string;
          readonly consent_token: string;
        }[];
      };
      get_consent_preview: {
        Args: { readonly raw_token: string };
        Returns: readonly {
          readonly introducer_display_name: string;
          readonly relationship_type: RelationshipType | null;
          readonly relationship_duration: RelationshipDuration | null;
          readonly request_status: string;
        }[];
      };
      claim_consent_request: {
        Args: { readonly raw_token: string };
        Returns: readonly {
          readonly pitch_draft_id: string;
        }[];
      };
      approve_and_publish_pitch: {
        Args: { readonly draft_id: string };
        Returns: readonly {
          readonly campaign_id: string;
          readonly campaign_slug: string;
        }[];
      };
    };
    Enums: {
      account_status: 'active' | 'suspended' | 'deleted';
      pitch_draft_status: PitchDraftStatus;
    };
    CompositeTypes: Record<string, never>;
  };
};
