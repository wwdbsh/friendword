import type { ExpoConfig } from 'expo/config';

/**
 * apps/mobile/.env is a symlink to the repo-root .env, so Expo's standard
 * dotenv loading provides EXPO_PUBLIC_* here and to the bundle. We mirror
 * the two client-safe values into `extra` (read via expo-constants); when
 * they are absent the app falls back to the local mock draft service.
 */
const config: ExpoConfig = {
  name: 'Friendword',
  slug: 'friendword',
  owner: 'wwdbsh',
  version: '1.0.0',
  orientation: 'portrait',
  scheme: 'friendword',
  userInterfaceStyle: 'light',
  icon: './assets/icon.png',
  ios: {
    bundleIdentifier: 'com.friendword.app',
    supportsTablet: true,
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      NSMicrophoneUsageDescription:
        'Friendword uses your microphone to record a 30–60 second pitch for your friend.',
      NSCameraUsageDescription:
        'Record a short clip of yourself while you introduce your friend. Optional.',
      NSPhotoLibraryUsageDescription:
        'Friendword lets you suggest photos and short videos that your friend can approve or replace.',
    },
  },
  android: {
    package: 'com.friendword.app',
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#FF5B2E',
    },
  },
  plugins: [
    'expo-router',
    [
      'expo-audio',
      {
        microphonePermission: 'Allow Friendword to record your 30–60 second voice pitch.',
      },
    ],
    [
      // The optional 3-second selfie opener (docs/REEL_V3_DESIGN.md §3). The
      // clip is recorded muted — the render worker only extracts frames from it
      // — so this plugin must not claim the microphone: `false` tells
      // `createPermissionsPlugin` to leave NSMicrophoneUsageDescription alone,
      // which keeps the voice-recording string above as the only one iOS shows.
      'expo-camera',
      {
        cameraPermission:
          'Record a short clip of yourself while you introduce your friend. Optional.',
        microphonePermission: false,
        recordAudioAndroid: false,
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission:
          'Allow Friendword to suggest photos and short videos your friend can approve or replace.',
      },
    ],
    'expo-font',
    [
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        imageWidth: 240,
        backgroundColor: '#FFF6EA',
      },
    ],
  ],
  extra: {
    // EAS project link (@wwdbsh/friendword). The project ID is not a secret.
    eas: {
      projectId: process.env['EAS_PROJECT_ID'] ?? '11a30ea3-adae-4578-9867-a023047bf432',
    },
    supabaseUrl: process.env['EXPO_PUBLIC_SUPABASE_URL'] ?? '',
    supabaseAnonKey: process.env['EXPO_PUBLIC_SUPABASE_ANON_KEY'] ?? '',
    webOrigin: process.env['EXPO_PUBLIC_WEB_ORIGIN'] ?? '',
    // Mirror of the server's clip byte ceiling, so both sides read one env name
    // (`FRIENDWORD_VIDEO_MAX_BYTES`, 50MB on Supabase Free). Not a secret and not
    // an authority: the client uses it to refuse a doomed upload early, the
    // server decides what is stored. Absent leaves the app on its own default.
    videoMaxBytes: process.env['FRIENDWORD_VIDEO_MAX_BYTES'] ?? '',
    revenueCatIosApiKey: process.env['EXPO_PUBLIC_REVENUECAT_IOS_API_KEY'] ?? '',
  },
  experiments: {
    typedRoutes: true,
  },
};

export default config;
