import { InterestRepo, UnauthenticatedError, type MyInterest } from '@friendword/data';
import { colors, fonts, fontSizes, spacing } from '@friendword/ui-tokens';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  LoadFailureCard,
  PendingCard,
  QuietNavAction,
  ScreenHeading,
  SignInPromptCard,
  StatusBadge,
  TrustCard,
} from '../../src/components';
import { SignInSheet } from '../../src/features/auth/SignInSheet';
import { getSupabaseClient } from '../../src/services/supabaseClient';
import { buildRoomsUrl } from '../../src/services/webOrigin';

export type InterestsLoadState = 'loading' | 'ready' | 'signed_out' | 'error';

type InterestsContentProps = {
  readonly state: InterestsLoadState;
  readonly interests: readonly MyInterest[];
  readonly onSignIn?: () => void;
  /** Re-runs the read that failed. Required by the error state (MUI-13). */
  readonly onRetry?: () => void;
  /** Injected in tests; defaults to opening the web intro rooms. */
  readonly onOpenRooms?: () => void;
};

export function getInterestTitle(interest: MyInterest): string {
  return (
    interest.daterDisplayName?.trim() || interest.campaignHeadline?.trim() || 'Untitled campaign'
  );
}

export function getInterestStatusLabel(interest: MyInterest): string {
  if (interest.campaignStatus === 'expired') {
    return 'Campaign expired';
  }
  if (interest.campaignStatus === 'archived') {
    return 'Campaign archived';
  }
  if (interest.campaignStatus === 'paused') {
    return 'Campaign paused';
  }
  switch (interest.interestStatus) {
    case 'started':
      return 'Started';
    case 'verification_pending':
      return 'Verifying';
    case 'submitted':
      return 'Submitted';
    case 'accepted':
      return 'Accepted';
    case 'declined':
      return 'Declined';
    case 'withdrawn':
      return 'Withdrawn';
    default:
      return assertNever(interest.interestStatus);
  }
}

/**
 * FUN-6: an accepted interest used to say "open intro rooms on the web" and
 * stop there — no URL, no handler, nothing to press. The web origin comes from
 * the same Expo config the consent and share links use; never hard-coded.
 *
 * Resolves to the message to show, or null when the browser opened: a swallowed
 * failure would leave a pressed button looking like it worked.
 */
export async function openIntroRoomsOnWeb(): Promise<string | null> {
  try {
    await Linking.openURL(buildRoomsUrl());
    return null;
  } catch {
    return 'Your intro rooms could not open. Please try again.';
  }
}

export function InterestsContent({
  state,
  interests,
  onSignIn,
  onRetry,
  onOpenRooms,
}: InterestsContentProps) {
  // Keyed by interest so one failed open does not caption every accepted card.
  const [roomsErrorInterestId, setRoomsErrorInterestId] = useState<string | null>(null);

  const openRooms = (interestId: string): void => {
    setRoomsErrorInterestId(null);
    if (onOpenRooms !== undefined) {
      onOpenRooms();
      return;
    }
    void openIntroRoomsOnWeb().then((message) => {
      setRoomsErrorInterestId(message === null ? null : interestId);
    });
  };

  if (state === 'loading') {
    return <PendingCard label="Loading your interests…" />;
  }
  if (state === 'signed_out') {
    return (
      <SignInPromptCard
        title="Sign in to see your interests"
        message="Interests are private and only appear for the account that sent them."
        onSignIn={onSignIn ?? (() => {})}
      />
    );
  }
  if (state === 'error') {
    // MUI-13: this card used to end at "reopen this screen" — an instruction to
    // do by hand what the screen can do in one line, and one that means nothing
    // on a screen you arrived at from the home list.
    return (
      <LoadFailureCard
        title="Interests could not be loaded"
        message="None of your interests were changed. Check your connection and read them again."
        onRetry={onRetry ?? (() => {})}
      />
    );
  }
  if (interests.length === 0) {
    return (
      <TrustCard>
        <Text style={styles.cardTitle}>No interests sent yet</Text>
        <Text style={styles.message}>
          When you submit interest in a friend’s campaign, its status will appear here.
        </Text>
      </TrustCard>
    );
  }

  return interests.map((interest) => (
    <TrustCard key={interest.interestId}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>{getInterestTitle(interest)}</Text>
        <StatusBadge label={getInterestStatusLabel(interest)} tone="trust" />
      </View>
      {interest.daterDisplayName !== null && interest.campaignHeadline !== null ? (
        <Text style={styles.headline}>{interest.campaignHeadline}</Text>
      ) : null}
      <Text style={styles.meta}>{formatSubmittedAt(interest.submittedAt)}</Text>
      <Text style={styles.message}>{getInterestDecisionCopy(interest.interestStatus)}</Text>
      {interest.interestStatus === 'accepted' ? (
        <>
          <Text style={styles.roomNote}>
            Your intro room is on the Friendword web app — messages are answered there.
          </Text>
          <QuietNavAction
            label="Open my intro rooms on the web"
            onPress={() => openRooms(interest.interestId)}
          />
          {roomsErrorInterestId === interest.interestId ? (
            <Text style={styles.roomsError}>
              Your intro rooms could not open. Please try again.
            </Text>
          ) : null}
        </>
      ) : null}
      {interest.campaignStatus === 'expired' || interest.campaignStatus === 'archived' ? (
        <Text style={styles.message}>
          This campaign is no longer public, but your decision history stays visible here.
        </Text>
      ) : null}
    </TrustCard>
  ));
}

export default function InterestsScreen() {
  const [state, setState] = useState<InterestsLoadState>('loading');
  const [interests, setInterests] = useState<readonly MyInterest[]>([]);
  const [signInVisible, setSignInVisible] = useState(false);

  const load = useCallback(() => {
    let active = true;
    const client = getSupabaseClient();
    setInterests([]);
    if (client === null) {
      setState('signed_out');
      return () => {
        active = false;
      };
    }

    setState('loading');
    const repo = new InterestRepo(client);
    void repo
      .listMyInterests()
      .then((rows) => {
        if (active) {
          setInterests(rows);
          setState('ready');
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setInterests([]);
          setState(error instanceof UnauthenticatedError ? 'signed_out' : 'error');
        }
      });

    return () => {
      active = false;
    };
  }, []);

  useFocusEffect(load);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenHeading
          eyebrow="MY CONTEXT"
          title="My interests"
          subtitle="Follow the campaigns you reached out to and see each decision clearly."
        />
        <InterestsContent
          state={state}
          interests={interests}
          onRetry={load}
          onSignIn={() => setSignInVisible(true)}
        />
      </ScrollView>
      <SignInSheet
        visible={signInVisible}
        purpose="generic"
        onClose={() => setSignInVisible(false)}
        onSignedIn={() => {
          setSignInVisible(false);
          load();
        }}
      />
    </SafeAreaView>
  );
}

function formatSubmittedAt(submittedAt: string | null): string {
  if (submittedAt === null) {
    return 'Not submitted yet';
  }
  const date = new Date(submittedAt);
  if (Number.isNaN(date.getTime())) {
    return 'Submission date unavailable';
  }
  return `Submitted ${date.toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })}`;
}

function getInterestDecisionCopy(status: MyInterest['interestStatus']): string {
  switch (status) {
    case 'started':
      return 'Your interest has not been submitted yet.';
    case 'verification_pending':
      return 'Finish verification to submit this interest.';
    case 'submitted':
      return 'Waiting for the dater to decide.';
    case 'accepted':
      return 'Your interest was accepted.';
    case 'declined':
      return 'The dater decided not to continue this introduction.';
    case 'withdrawn':
      return 'You withdrew this interest.';
    default:
      return assertNever(status);
  }
}

function assertNever(value: never): never {
  return value;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  content: { gap: spacing.lg, padding: spacing.lg, paddingBottom: spacing.xxl },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  cardTitle: {
    flex: 1,
    color: colors.ink,
    fontFamily: 'BricolageGrotesqueBold',
    fontSize: fontSizes.lg,
  },
  headline: {
    color: colors.ink,
    fontFamily: fonts.body,
    fontSize: fontSizes.md,
    lineHeight: 24,
  },
  // MUI-6: `fresh` is 2.35:1 on cream; `verified` carries the same signal at
  // 4.93:1, which a date line has to reach to be read.
  meta: {
    color: colors.verified,
    fontFamily: 'BricolageGrotesqueSemiBold',
    fontSize: fontSizes.sm,
  },
  message: {
    color: colors.textSecondary,
    fontFamily: fonts.body,
    fontSize: fontSizes.md,
    lineHeight: 24,
  },
  roomNote: {
    color: colors.ink,
    fontFamily: 'BricolageGrotesqueSemiBold',
    fontSize: fontSizes.md,
    lineHeight: 24,
  },
  roomsError: {
    color: colors.danger,
    fontFamily: 'BricolageGrotesqueBold',
    fontSize: fontSizes.md,
  },
});
