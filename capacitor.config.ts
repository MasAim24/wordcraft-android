import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.storytold.wordcraft',
  appName: 'WordCraft',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  }
};

export default config;
