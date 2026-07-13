import { z } from 'zod';

import type { BrowserSupabaseClient } from './client';
import { DataLayerError, UnauthenticatedError } from './errors';

export type ReportTargetType = 'campaign' | 'interest' | 'intro_room' | 'message';

const reportIdSchema = z.string().uuid();

/**
 * Safety actions shared by the web surfaces (audit P0-5): reporting any
 * product object and self-service account deletion. Both are SECURITY
 * DEFINER RPCs — the client never writes the ops tables directly.
 */
export class SafetyRepo {
  constructor(private readonly client: BrowserSupabaseClient) {}

  async reportContent(input: {
    readonly targetType: ReportTargetType;
    readonly targetId: string;
    readonly reason: string;
    readonly detail?: string;
  }): Promise<string> {
    const { data, error } = await this.client.rpc('report_content', {
      target_type: input.targetType,
      target_id: input.targetId,
      reason: input.reason,
      ...(input.detail === undefined ? {} : { detail: input.detail }),
    });
    if (error !== null) {
      if (error.message.includes('authentication required')) {
        throw new UnauthenticatedError();
      }
      throw new DataLayerError('safety.report', error);
    }

    return reportIdSchema.parse(data);
  }

  async requestAccountDeletion(): Promise<void> {
    const { error } = await this.client.rpc('request_account_deletion');
    if (error !== null) {
      if (error.message.includes('authentication required')) {
        throw new UnauthenticatedError();
      }
      throw new DataLayerError('safety.requestAccountDeletion', error);
    }
  }
}
