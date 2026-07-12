import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'Friendword',
  slug: 'friendword',
  version: '1.0.0',
  orientation: 'portrait',
  scheme: 'friendword',
  userInterfaceStyle: 'dark',
  ios: {
    bundleIdentifier: 'com.friendword.app',
    supportsTablet: true,
  },
  android: {
    package: 'com.friendword.app',
  },
  plugins: ['expo-router'],
  experiments: {
    typedRoutes: true,
  },
};

export default config;
