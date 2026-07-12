import { colors } from '@friendword/ui-tokens';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: colors.background },
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.textPrimary,
          headerShadowVisible: false,
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="pitch/new" options={{ title: 'Pitch a friend' }} />
        <Stack.Screen name="campaigns/index" options={{ title: 'My dating campaigns' }} />
        <Stack.Screen name="interests/index" options={{ title: 'My interests' }} />
      </Stack>
    </>
  );
}
