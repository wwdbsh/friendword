import { z } from 'zod';

import type { Session } from '@supabase/supabase-js';

import type { BrowserSupabaseClient } from './client';
import type { MessageRow } from './database.types';
import { DataLayerError, UnauthenticatedError } from './errors';

const uuidSchema = z.string().uuid();
const messageBodySchema = z.string().trim().min(1).max(2000);
const reportReasonSchema = z.string().trim().min(1).max(1000);

export type IntroRoomSummary = {
  readonly roomId: string;
  readonly campaignId: string;
  readonly campaignSlug: string | null;
  readonly otherUserId: string;
  readonly otherDisplayName: string;
  readonly createdAt: string;
};

/**
 * Intro Room client surface. Reads and message sends rely on 0002's
 * participant RLS (which already enforces blocks); listing and leaving use
 * the 0007 RPCs. Text only by design — no media in MVP chat.
 */
export class IntroRoomRepo {
  constructor(private readonly client: BrowserSupabaseClient) {}

  async listMyRooms(): Promise<readonly IntroRoomSummary[]> {
    await this.getRequiredSession();
    const { data, error } = await this.client.rpc('list_my_intro_rooms', {});
    if (error !== null) {
      throw new DataLayerError('introRoom.listMyRooms', error);
    }

    return data.map((row) => ({
      roomId: row.room_id,
      campaignId: row.campaign_id,
      campaignSlug: row.campaign_slug,
      otherUserId: row.other_user_id,
      otherDisplayName: row.other_display_name,
      createdAt: row.created_at,
    }));
  }

  async listMessages(roomId: string): Promise<readonly MessageRow[]> {
    await this.getRequiredSession();
    const { data, error } = await this.client
      .from('messages')
      .select()
      .eq('intro_room_id', uuidSchema.parse(roomId))
      .order('created_at', { ascending: true });
    if (error !== null) {
      throw new DataLayerError('introRoom.listMessages', error);
    }

    return data;
  }

  async sendMessage(roomId: string, body: string): Promise<MessageRow> {
    const session = await this.getRequiredSession();
    const { data, error } = await this.client
      .from('messages')
      .insert({
        intro_room_id: uuidSchema.parse(roomId),
        sender_user_id: session.user.id,
        body: messageBodySchema.parse(body),
      })
      .select()
      .single();
    if (error !== null) {
      throw new DataLayerError('introRoom.sendMessage', error);
    }

    return data;
  }

  async leaveRoom(roomId: string): Promise<void> {
    await this.getRequiredSession();
    const { error } = await this.client.rpc('leave_intro_room', {
      target_room_id: uuidSchema.parse(roomId),
    });
    if (error !== null) {
      throw new DataLayerError('introRoom.leaveRoom', error);
    }
  }

  /** Blocking is immediate and two-way: RLS drops the room for both sides. */
  async blockUser(blockedUserId: string): Promise<void> {
    const session = await this.getRequiredSession();
    const { error } = await this.client.from('blocks').insert({
      blocker_user_id: session.user.id,
      blocked_user_id: uuidSchema.parse(blockedUserId),
    });
    if (error !== null) {
      throw new DataLayerError('introRoom.blockUser', error);
    }
  }

  async reportUser(input: {
    readonly reportedUserId: string;
    readonly campaignId: string | null;
    readonly reason: string;
  }): Promise<void> {
    const session = await this.getRequiredSession();
    const { error } = await this.client.from('reports').insert({
      reporter_user_id: session.user.id,
      reported_user_id: uuidSchema.parse(input.reportedUserId),
      campaign_id: input.campaignId === null ? null : uuidSchema.parse(input.campaignId),
      reason: reportReasonSchema.parse(input.reason),
    });
    if (error !== null) {
      throw new DataLayerError('introRoom.reportUser', error);
    }
  }

  private async getRequiredSession(): Promise<Session> {
    const { data, error } = await this.client.auth.getSession();
    if (error !== null) {
      throw new DataLayerError('introRoom.getSession', error);
    }
    if (data.session === null) {
      throw new UnauthenticatedError();
    }

    return data.session;
  }
}
