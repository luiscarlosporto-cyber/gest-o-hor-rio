import type { CapacitorConfig } from '@capacitor/cli'

// App Android: a mesma app web, construída com "vite build --mode android" para dist-android/.
const config: CapacitorConfig = {
  appId: 'pt.gestaohorario.app',
  appName: 'Ritmia',
  webDir: 'dist-android',
  android: { allowMixedContent: false },
  plugins: {
    LocalNotifications: { smallIcon: 'ic_stat_icon', iconColor: '#2f6feb' },
  },
}

export default config
