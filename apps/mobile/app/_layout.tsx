import {
  BricolageGrotesque_400Regular,
  BricolageGrotesque_600SemiBold,
  BricolageGrotesque_700Bold,
} from '@expo-google-fonts/bricolage-grotesque';
import { Unbounded_700Bold } from '@expo-google-fonts/unbounded';
import { colors, fonts } from '@friendword/ui-tokens';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { shouldPurgeConsentTokensOnAuthChange } from '../src/services/authDraftPurge';
import { pitchDraftService } from '../src/services/draftServiceInstance';
import {
  syncPurchasesIdentity,
  type PurchasesIdentitySyncResult,
} from '../src/services/purchasesIdentity';
import { getSupabaseClient } from '../src/services/supabaseClient';

SplashScreen.preventAutoHideAsync();

function reportIdentitySyncResult(result: PurchasesIdentitySyncResult): void {
  if (result.state === 'error') {
    console.warn('RevenueCat identity sync failed:', result.error.message);
  }
}

function syncIdentityWithoutCrashing(userId: string | null): void {
  void syncPurchasesIdentity(userId === null ? null : { userId })
    .then(reportIdentitySyncResult)
    .catch((error: unknown) => {
      console.warn(
        'RevenueCat identity sync failed:',
        error instanceof Error ? error.message : 'Unknown identity sync error.',
      );
    });
}

export default function RootLayout() {
  const [loaded, error] = useFonts({
    [fonts.display]: Unbounded_700Bold,
    [fonts.body]: BricolageGrotesque_400Regular,
    BricolageGrotesqueSemiBold: BricolageGrotesque_600SemiBold,
    BricolageGrotesqueBold: BricolageGrotesque_700Bold,
  });

  useEffect(() => {
    if (loaded || error) {
      SplashScreen.hideAsync();
    }
  }, [error, loaded]);

  useEffect(() => {
    const client = getSupabaseClient();
    if (client === null) {
      syncIdentityWithoutCrashing(null);
      return;
    }

    let disposed = false;
    let relevantAuthEventSeen = false;
    let lastObservedUserId: string | null | undefined;
    const syncIfUserChanged = (userId: string | null) => {
      if (disposed || lastObservedUserId === userId) {
        return;
      }
      lastObservedUserId = userId;
      syncIdentityWithoutCrashing(userId);
    };
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event, session) => {
      if (event !== 'SIGNED_IN' && event !== 'SIGNED_OUT' && event !== 'TOKEN_REFRESHED') {
        return;
      }
      relevantAuthEventSeen = true;
      const nextUserId = session?.user.id ?? null;
      // Read the previous user before syncIfUserChanged advances it: a sign-out
      // or account switch must wipe every draft's raw consent bearer token.
      if (shouldPurgeConsentTokensOnAuthChange(event, lastObservedUserId, nextUserId)) {
        void pitchDraftService.purgeAllConsentTokens().catch((purgeError: unknown) => {
          console.warn(
            'Consent token purge on auth change failed:',
            purgeError instanceof Error ? purgeError.message : 'Unknown purge error.',
          );
        });
      }
      syncIfUserChanged(nextUserId);
    });

    void client.auth
      .getSession()
      .then(({ data, error: sessionError }) => {
        if (sessionError !== null) {
          console.warn('RevenueCat identity cold-start sync failed:', sessionError.message);
          return;
        }
        if (!relevantAuthEventSeen) {
          syncIfUserChanged(data.session?.user.id ?? null);
        }
      })
      .catch((sessionError: unknown) => {
        console.warn(
          'RevenueCat identity cold-start sync failed:',
          sessionError instanceof Error ? sessionError.message : 'Unknown auth session error.',
        );
      });

    return () => {
      disposed = true;
      subscription.unsubscribe();
    };
  }, []);

  if (!loaded && !error) {
    return null;
  }

  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: colors.background },
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.ink,
          headerShadowVisible: false,
          headerTitleStyle: { fontFamily: 'BricolageGrotesqueBold' },
          // Real-device QA (CP-7): without this, an untitled previous screen
          // (the headerless home) leaks its route name ("index") as the iOS back
          // label. "minimal" shows the chevron only, no text label.
          headerBackButtonDisplayMode: 'minimal',
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="pitch/new" options={{ headerShown: false }} />
        <Stack.Screen name="campaigns/index" options={{ title: 'My dating campaigns' }} />
        <Stack.Screen name="interests/index" options={{ title: 'My interests' }} />
        {/* review and share set their own dynamic titles inline; these register
            them in the stack with a safe fallback so an unregistered route never
            shows its raw path as the header title. */}
        <Stack.Screen name="pitch/review" options={{ title: 'Review your draft' }} />
        <Stack.Screen name="pitch/share" options={{ title: 'Share' }} />
        <Stack.Screen name="paywall" options={{ title: 'Purchase' }} />
      </Stack>
    </>
  );
}
