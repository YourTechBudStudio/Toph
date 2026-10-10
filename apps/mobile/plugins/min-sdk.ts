/**
 * Toph supports Android 13 (API 33) and newer. From 33 on, notifications are a runtime permission
 * and `InputMethodService.switchToPreviousInputMethod` exists, so the app and the voice keyboard
 * carry no code for older versions.
 *
 * Expo's root project plugin reads `android.minSdkVersion` from `gradle.properties` into
 * `rootProject.ext.minSdkVersion`, which the app and every module build use.
 *
 * Check the result in the merged manifest (`<uses-sdk android:minSdkVersion="33">`).
 */

import { type ConfigPlugin, withGradleProperties } from 'expo/config-plugins.js';

const KEY = 'android.minSdkVersion';
const MIN_SDK = '33';

const withMinSdk: ConfigPlugin = (config) =>
  withGradleProperties(config, (mod) => {
    const properties = mod.modResults.filter(
      (item) => item.type !== 'property' || item.key !== KEY,
    );
    properties.push({ type: 'property', key: KEY, value: MIN_SDK });
    mod.modResults = properties;
    return mod;
  });

export default withMinSdk;
