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

SplashScreen.preventAutoHideAsync();

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
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="pitch/new" options={{ headerShown: false }} />
        <Stack.Screen name="campaigns/index" options={{ title: 'My dating campaigns' }} />
        <Stack.Screen name="interests/index" options={{ title: 'My interests' }} />
      </Stack>
    </>
  );
}
