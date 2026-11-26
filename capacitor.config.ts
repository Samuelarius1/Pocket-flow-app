import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.pocketflow.app',
  appName: 'PocketFlow',
  webDir: 'web/dist',
  server: {
    androidScheme: 'http',
    hostname: 'localhost',
  },
};

export default config;