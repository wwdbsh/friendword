import { z } from 'zod';

import type { Session } from '@supabase/supabase-js';

import type { BrowserSupabaseClient } from './client';
import { DataLayerError, UnauthenticatedError } from './errors';

const emailSchema = z.string().email();
const otpTokenSchema = z.string().trim().min(1);
const displayNameSchema = z.string().trim().min(1);

export type EnsureUserRowResult = {
  readonly userId: string;
  readonly profileDisplayName: string;
};

export async function signInWithOtp(client: BrowserSupabaseClient, email: string): Promise<void> {
  const parsedEmail = emailSchema.parse(email);
  const { error } = await client.auth.signInWithOtp({ email: parsedEmail });
  if (error !== null) {
    throw new DataLayerError('signInWithOtp', error);
  }
}

export async function verifyOtp(
  client: BrowserSupabaseClient,
  email: string,
  token: string,
): Promise<Session | null> {
  const { data, error } = await client.auth.verifyOtp({
    email: emailSchema.parse(email),
    token: otpTokenSchema.parse(token),
    type: 'email',
  });
  if (error !== null) {
    throw new DataLayerError('verifyOtp', error);
  }

  return data.session;
}

export async function getSession(client: BrowserSupabaseClient): Promise<Session | null> {
  const { data, error } = await client.auth.getSession();
  if (error !== null) {
    throw new DataLayerError('getSession', error);
  }

  return data.session;
}

export async function ensureUserRow(client: BrowserSupabaseClient): Promise<EnsureUserRowResult> {
  const session = await getSession(client);
  if (session === null) {
    throw new UnauthenticatedError();
  }

  const metadataDisplayName = displayNameSchema.safeParse(
    session.user.user_metadata['display_name'],
  );
  const emailDisplayName = session.user.email?.split('@')[0];
  const profileDisplayName = metadataDisplayName.success
    ? metadataDisplayName.data
    : displayNameSchema.catch('Friendword user').parse(emailDisplayName);

  const { error: userError } = await client
    .from('users')
    .upsert({ id: session.user.id }, { ignoreDuplicates: true, onConflict: 'id' });
  if (userError !== null) {
    throw new DataLayerError('ensureUserRow.users', userError);
  }

  const { error: profileError } = await client
    .from('profiles')
    .upsert(
      { user_id: session.user.id, display_name: profileDisplayName },
      { ignoreDuplicates: true, onConflict: 'user_id' },
    );
  if (profileError !== null) {
    throw new DataLayerError('ensureUserRow.profiles', profileError);
  }

  return { userId: session.user.id, profileDisplayName };
}
