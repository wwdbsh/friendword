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
      reports: {
        Row: {
          readonly id: string;
          readonly reporter_user_id: string;
          readonly reported_user_id: string | null;
          readonly campaign_id: string | null;
          readonly reason: string;
          readonly status: string;
          readonly created_at: string;
          readonly updated_at: string;
        };
        Insert: {
          readonly reporter_user_id: string;
          readonly reported_user_id?: string | null;
          readonly campaign_id?: string | null;
          readonly reason: string;
        };
        Update: Record<string, never>;
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
