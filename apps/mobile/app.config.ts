import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'Friendword',
  slug: 'friendword',
  version: '1.0.0',
  orientation: 'portrait',
  scheme: 'friendword',
  userInterfaceStyle: 'light',
  ios: {
    bundleIdentifier: 'com.friendword.app',
    supportsTablet: true,
    infoPlist: {
      NSMicrophoneUsageDescription:
        'Friendword uses your microphone to record a 30–60 second pitch for your friend.',
      NSPhotoLibraryUsageDescription:
        'Friendword lets you suggest photos that your friend can approve or replace.',
    },
  },
  android: {
    package: 'com.friendword.app',
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
      'expo-image-picker',
      {
        photosPermission: 'Allow Friendword to suggest photos your friend can approve or replace.',
      },
    ],
    'expo-font',
    'expo-splash-screen',
  ],
  experiments: {
    typedRoutes: true,
  },
};

export default config;
