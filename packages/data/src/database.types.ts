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
  readonly display_name_confirmed: boolean;
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
  readonly structure: Json | null;
  readonly relationship_type: RelationshipType | null;
  readonly relationship_duration: RelationshipDuration | null;
  readonly created_at: string;
  readonly updated_at: string;
};

export type PitchAssetRow = {
  readonly id: string;
  readonly pitch_draft_id: string;
  readonly uploaded_by_user_id: string;
  readonly asset_type: string;
  readonly storage_path: string;
  readonly sort_order: number;
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
  readonly ends_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
};

export type DatingProfileRow = {
  readonly user_id: string;
  readonly bio: string | null;
  readonly photos: readonly string[];
  readonly dating_intent: string | null;
  readonly approximate_location: string | null;
  readonly profile_updated_at: string;
  readonly created_at: string;
  readonly updated_at: string;
};

export type InterestRow = {
  readonly id: string;
  readonly campaign_id: string;
  readonly sender_user_id: string;
  readonly status:
    | 'started'
    | 'verification_pending'
    | 'submitted'
    | 'accepted'
    | 'declined'
    | 'withdrawn'
    | 'blocked';
  readonly note: string | null;
  readonly submitted_at: string | null;
  readonly decided_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
};

export type MessageRow = {
  readonly id: string;
  readonly intro_room_id: string;
  readonly sender_user_id: string;
  readonly body: string;
  readonly created_at: string;
  readonly updated_at: string;
};

export type ConsentRequestRow = {
  readonly id: string;
  readonly pitch_draft_id: string;
  readonly subject_user_id: string | null;
  readonly token_hash: string;
  readonly status: string;
  readonly responded_at: string | null;
  readonly invite_contact_channel: 'email' | 'phone' | null;
  readonly invite_contact_hash: string | null;
  readonly invite_friend_name: string | null;
  readonly revision_id: string | null;
  readonly response_note: string | null;
  readonly created_at: string;
  readonly updated_at: string;
};

export type ConsentRevisionRow = {
  readonly id: string;
  readonly pitch_draft_id: string;
  readonly revision_number: number;
  readonly headline: string;
  readonly body: string;
  readonly structure: Json | null;
  readonly asset_ids: readonly string[];
  readonly voice_asset_path: string | null;
  readonly content_hash: string;
  readonly created_at: string;
};

export type PurchaseIntentRow = {
  readonly id: string;
  readonly user_id: string;
  readonly product_id: string;
  readonly scope_type: 'PITCH_DRAFT' | 'CAMPAIGN';
  readonly scope_id: string;
  readonly original_transaction_id: string | null;
  readonly status: 'issued' | 'consumed' | 'expired';
  readonly created_at: string;
  readonly expires_at: string;
};

export type AppConfigRow = {
  readonly key: string;
  readonly value: string;
  readonly updated_at: string;
};

export type MediaValidationRow = {
  readonly id: string;
  readonly bucket_id: string;
  readonly object_name: string;
  readonly validated_at: string;
  readonly mime_ok: boolean;
  readonly magic_ok: boolean;
  readonly size_ok: boolean;
  readonly decode_ok: boolean;
  readonly moderation_status: 'passed' | 'flagged' | 'skipped';
  readonly moderation_ref: string | null;
  readonly created_at: string;
};

export type DeletionRequestRow = {
  readonly id: string;
  readonly user_id: string;
  readonly scope: 'account';
  readonly status: 'queued' | 'processing' | 'done' | 'failed';
  readonly requested_at: string;
  readonly processed_at: string | null;
  readonly note: string | null;
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
          readonly display_name_confirmed?: boolean;
          readonly birth_date?: string | null;
          readonly locale?: string;
        };
        Update: {
          readonly display_name?: string;
          readonly display_name_confirmed?: boolean;
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
          readonly structure?: Json | null;
          readonly relationship_type?: RelationshipType | null;
          readonly relationship_duration?: RelationshipDuration | null;
        };
        Update: {
          readonly headline?: string | null;
          readonly body?: string | null;
          readonly structure?: Json | null;
          readonly relationship_type?: RelationshipType | null;
          readonly relationship_duration?: RelationshipDuration | null;
        };
        Relationships: [];
      };
      dating_profiles: {
        Row: DatingProfileRow;
        Insert: {
          readonly user_id: string;
          readonly bio?: string | null;
          readonly photos?: readonly string[];
          readonly dating_intent?: string | null;
          readonly approximate_location?: string | null;
        };
        Update: {
          readonly bio?: string | null;
          readonly photos?: readonly string[];
          readonly dating_intent?: string | null;
          readonly approximate_location?: string | null;
        };
        Relationships: [];
      };
      interests: {
        Row: InterestRow;
        // Writes flow through submit_interest / decide_interest RPCs.
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      messages: {
        Row: MessageRow;
        Insert: {
          readonly intro_room_id: string;
          readonly sender_user_id: string;
          readonly body: string;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
      consent_requests: {
        Row: ConsentRequestRow;
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      consent_revisions: {
        Row: ConsentRevisionRow;
        Insert: {
          readonly pitch_draft_id: string;
          readonly revision_number: number;
          readonly headline: string;
          readonly body: string;
          readonly structure?: Json | null;
          readonly asset_ids?: readonly string[];
          readonly voice_asset_path?: string | null;
          readonly content_hash: string;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
      app_config: {
        Row: AppConfigRow;
        Insert: {
          readonly key: string;
          readonly value: string;
        };
        Update: {
          readonly value?: string;
        };
        Relationships: [];
      };
      media_validations: {
        Row: MediaValidationRow;
        Insert: {
          readonly bucket_id: string;
          readonly object_name: string;
          readonly validated_at: string;
          readonly mime_ok: boolean;
          readonly magic_ok: boolean;
          readonly size_ok: boolean;
          readonly decode_ok: boolean;
          readonly moderation_status: 'passed' | 'flagged' | 'skipped';
          readonly moderation_ref?: string | null;
        };
        Update: {
          readonly validated_at?: string;
          readonly mime_ok?: boolean;
          readonly magic_ok?: boolean;
          readonly size_ok?: boolean;
          readonly decode_ok?: boolean;
          readonly moderation_status?: 'passed' | 'flagged' | 'skipped';
          readonly moderation_ref?: string | null;
        };
        Relationships: [];
      };
      reports: {
        Row: {
          readonly id: string;
          readonly reporter_user_id: string | null;
          readonly reported_user_id: string | null;
          readonly campaign_id: string | null;
          readonly reason: string;
          readonly target_type: 'campaign' | 'interest' | 'intro_room' | 'message' | null;
          readonly target_id: string | null;
          readonly severity: 'low' | 'high';
          readonly detail: string | null;
          readonly anon_report: boolean;
          readonly reporter_ip_hash: string | null;
          readonly status: string;
          readonly created_at: string;
          readonly updated_at: string;
        };
        Insert: {
          readonly reporter_user_id?: string | null;
          readonly reported_user_id?: string | null;
          readonly campaign_id?: string | null;
          readonly reason: string;
          readonly target_type?: 'campaign' | 'interest' | 'intro_room' | 'message' | null;
          readonly target_id?: string | null;
          readonly severity?: 'low' | 'high';
          readonly detail?: string | null;
          readonly anon_report?: boolean;
          readonly reporter_ip_hash?: string | null;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
      ops_alerts: {
        Row: {
          readonly id: string;
          readonly alert_type: string;
          readonly campaign_id: string | null;
          readonly report_id: string | null;
          readonly detail: Json;
          readonly resolved_at: string | null;
          readonly created_at: string;
        };
        Insert: {
          readonly alert_type: string;
          readonly campaign_id?: string | null;
          readonly report_id?: string | null;
          readonly detail?: Json;
          readonly resolved_at?: string | null;
        };
        Update: {
          readonly resolved_at?: string | null;
        };
        Relationships: [];
      };
      deletion_requests: {
        Row: DeletionRequestRow;
        Insert: {
          readonly user_id: string;
          readonly scope?: 'account';
          readonly status?: 'queued' | 'processing' | 'done' | 'failed';
          readonly processed_at?: string | null;
          readonly note?: string | null;
        };
        Update: {
          readonly status?: 'queued' | 'processing' | 'done' | 'failed';
          readonly processed_at?: string | null;
          readonly note?: string | null;
        };
        Relationships: [];
      };
      blocks: {
        Row: {
          readonly id: string;
          readonly blocker_user_id: string;
          readonly blocked_user_id: string;
          readonly created_at: string;
        };
        Insert: {
          readonly blocker_user_id: string;
          readonly blocked_user_id: string;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
      purchase_events: {
        Row: {
          readonly id: string;
          readonly purchaser_user_id: string;
          readonly product_id: string;
          readonly scope_type: 'PITCH_DRAFT' | 'CAMPAIGN';
          readonly scope_id: string;
          readonly provider_event_id: string;
          readonly purchased_at: string;
          readonly transaction_id: string | null;
          readonly original_transaction_id: string | null;
          readonly environment: string | null;
          readonly event_type: string | null;
          readonly raw_app_user_id: string | null;
          readonly created_at: string;
          readonly updated_at: string;
        };
        // Service-only (RevenueCat webhook); clients hold no write grants.
        Insert: {
          readonly purchaser_user_id: string;
          readonly product_id: string;
          readonly scope_type: 'PITCH_DRAFT' | 'CAMPAIGN';
          readonly scope_id: string;
          readonly provider_event_id: string;
          readonly purchased_at?: string;
          readonly transaction_id?: string | null;
          readonly original_transaction_id?: string | null;
          readonly environment?: string | null;
          readonly event_type?: string | null;
          readonly raw_app_user_id?: string | null;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
      purchase_credit_ledger: {
        Row: {
          readonly id: string;
          readonly user_id: string;
          readonly credit_state: 'available' | 'reserved' | 'consumed' | 'refunded' | 'revoked';
          readonly product_id: string;
          readonly pitch_draft_id: string | null;
          readonly campaign_id: string | null;
          readonly idempotency_key: string;
          readonly created_at: string;
          readonly updated_at: string;
        };
        Insert: {
          readonly user_id: string;
          readonly credit_state?: 'available' | 'reserved' | 'consumed' | 'refunded' | 'revoked';
          readonly product_id: string;
          readonly pitch_draft_id?: string | null;
          readonly campaign_id?: string | null;
          readonly idempotency_key: string;
        };
        Update: {
          readonly credit_state?: 'available' | 'reserved' | 'consumed' | 'refunded' | 'revoked';
        };
        Relationships: [];
      };
      purchase_intents: {
        Row: PurchaseIntentRow;
        Insert: {
          readonly user_id: string;
          readonly product_id: string;
          readonly scope_type: 'PITCH_DRAFT' | 'CAMPAIGN';
          readonly scope_id: string;
          readonly original_transaction_id?: string | null;
          readonly status?: 'issued' | 'consumed' | 'expired';
          readonly expires_at?: string;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
      campaign_entitlements: {
        Row: {
          readonly id: string;
          readonly campaign_id: string;
          readonly product_id: string;
          readonly active: boolean;
          readonly expires_at: string | null;
          readonly original_transaction_id: string | null;
          readonly created_at: string;
          readonly updated_at: string;
        };
        Insert: {
          readonly campaign_id: string;
          readonly product_id: string;
          readonly active?: boolean;
          readonly expires_at?: string | null;
          readonly original_transaction_id?: string | null;
        };
        Update: {
          readonly active?: boolean;
          readonly expires_at?: string | null;
          readonly original_transaction_id?: string | null;
        };
        Relationships: [];
      };
      analytics_events: {
        Row: {
          readonly id: string;
          readonly user_id: string | null;
          readonly event_name: string;
          readonly properties: Json;
          readonly created_at: string;
        };
        // Clients write via track_event; direct inserts are service-only.
        Insert: {
          readonly user_id?: string | null;
          readonly event_name: string;
          readonly properties?: Json;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
      pitch_assets: {
        Row: PitchAssetRow;
        Insert: {
          readonly pitch_draft_id: string;
          readonly uploaded_by_user_id: string;
          readonly asset_type: string;
          readonly storage_path: string;
          readonly sort_order?: number;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
      campaigns: {
        Row: CampaignRow;
        // All writes are RPC/service-only since 0008 revoked client grants.
        Insert: {
          readonly pitch_draft_id: string;
          readonly owner_user_id: string;
          readonly status?: CampaignRow['status'];
          readonly published_at?: string | null;
          readonly slug?: string | null;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      report_content: {
        Args: {
          readonly target_type: 'campaign' | 'interest' | 'intro_room' | 'message';
          readonly target_id: string;
          readonly reason: string;
          readonly detail?: string | null;
        };
        Returns: string;
      };
      request_account_deletion: {
        Args: Record<string, never>;
        Returns: readonly {
          readonly deletion_request_id: string;
          readonly deletion_status: 'queued' | 'processing' | 'done' | 'failed';
        }[];
      };
      reassign_pitch_storage_owner: {
        Args: {
          readonly target_draft_id: string;
          readonly new_owner_id: string;
        };
        Returns: undefined;
      };
      submit_pitch_for_consent: {
        Args: {
          readonly draft_id: string;
          readonly invite_channel?: 'email' | 'phone' | null;
          readonly invite_contact?: string | null;
          readonly invite_friend_name?: string | null;
        };
        Returns: readonly {
          readonly consent_request_id: string;
          readonly consent_token: string | null;
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
        Args: {
          readonly draft_id: string;
          readonly campaign_days: number;
          readonly revision_id: string;
          readonly included_asset_ids: readonly string[];
          readonly hard_claims_confirmed: boolean;
        };
        Returns: readonly {
          readonly campaign_id: string;
          readonly campaign_slug: string;
        }[];
      };
      respond_consent_request: {
        Args: {
          readonly draft_id: string;
          readonly action: 'request_changes' | 'decline';
          readonly note: string;
        };
        Returns: undefined;
      };
      issue_purchase_intent: {
        Args: {
          readonly product_id: string;
          readonly scope_id: string;
        };
        Returns: readonly {
          readonly purchase_intent_id: string;
          readonly expires_at: string;
        }[];
      };
      record_revenuecat_event: {
        Args: { readonly payload: Json };
        Returns: Json;
      };
      reserve_creator_credit: {
        Args: { readonly draft_id: string };
        Returns: string;
      };
      release_creator_credit: {
        Args: { readonly ledger_id: string };
        Returns: undefined;
      };
      consume_creator_credit: {
        Args: { readonly ledger_id: string };
        Returns: undefined;
      };
      submit_interest: {
        Args: { readonly target_campaign_id: string; readonly interest_note?: string | null };
        Returns: readonly {
          readonly interest_id: string;
          readonly interest_status: string;
        }[];
      };
      list_campaign_interests: {
        Args: { readonly target_campaign_id: string };
        Returns: readonly {
          readonly interest_id: string;
          readonly interest_status: string;
          readonly note: string | null;
          readonly submitted_at: string | null;
          readonly sender_display_name: string;
          readonly sender_age: number | null;
          readonly sender_bio: string | null;
          readonly sender_photos: readonly string[] | null;
          readonly sender_dating_intent: string | null;
          readonly sender_location: string | null;
        }[];
      };
      decide_interest: {
        Args: { readonly target_interest_id: string; readonly decision: string };
        Returns: readonly {
          readonly intro_room_id: string | null;
        }[];
      };
      list_my_intro_rooms: {
        Args: Record<string, never>;
        Returns: readonly {
          readonly room_id: string;
          readonly campaign_id: string;
          readonly campaign_slug: string | null;
          readonly other_user_id: string;
          readonly other_display_name: string;
          readonly created_at: string;
        }[];
      };
      leave_intro_room: {
        Args: { readonly target_room_id: string };
        Returns: undefined;
      };
      track_event: {
        Args: { readonly event_name: string; readonly properties?: Json };
        Returns: undefined;
      };
      set_campaign_status: {
        Args: { readonly target_campaign_id: string; readonly next_status: string };
        Returns: readonly {
          readonly campaign_status: string;
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
