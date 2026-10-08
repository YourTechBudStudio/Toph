/**
 * Release APKs ship only `arm64-v8a` native libraries, which is every phone Toph targets (epic #4:
 * sideloaded arm64 release APKs). Without this, ONNX Runtime and React Native each add their
 * `armeabi-v7a`, `x86` and `x86_64` copies to the APK.
 *
 * Debug builds keep every ABI, so a development build still runs on an `x86_64` emulator.
 *
 * A plain `ndk { abiFilters }` in the release build type cannot do this: React Native's Gradle
 * plugin adds every `reactNativeArchitectures` entry to `defaultConfig.ndk.abiFilters` in its own
 * `finalizeDsl` callback, and Gradle merges a build type's filters with the default config's. A
 * packaging exclude cannot either, because React Native marks its own libraries `pickFirst`, which
 * wins over an exclude. So this block, whose `finalizeDsl` runs after React Native's, moves those
 * defaults onto every other build type and gives release `arm64-v8a` alone.
 *
 * Check the result on a release APK with `unzip -l app-release.apk | grep '\.so'`.
 */

import { type ConfigPlugin, withAppBuildGradle } from 'expo/config-plugins.js';

const MARKER = '// arm64-release:';

export const RELEASE_ABI = 'arm64-v8a';

const releaseAbiFilter = `
${MARKER} release APKs ship ${RELEASE_ABI} native libraries only (plugins/arm64-release.ts).
androidComponents {
    finalizeDsl { android ->
        def defaultAbis = android.defaultConfig.ndk.abiFilters.toList()
        android.defaultConfig.ndk.abiFilters.clear()
        android.buildTypes.each { buildType ->
            if (buildType.name == 'release') {
                buildType.ndk.abiFilters.add('${RELEASE_ABI}')
            } else {
                buildType.ndk.abiFilters.addAll(defaultAbis)
            }
        }
    }
}
`;

/** Appends the release-only ABI filter to app/build.gradle. Applying it twice changes nothing. */
export const applyReleaseAbiFilter = (gradle: string): string => {
  if (gradle.includes(MARKER)) {
    return gradle;
  }
  // The block must come after React Native's plugin is applied, so its callback runs second.
  if (!/apply plugin:\s*["']com\.facebook\.react["']/u.test(gradle)) {
    throw new Error('arm64-release: app/build.gradle does not apply com.facebook.react');
  }
  return `${gradle.trimEnd()}\n${releaseAbiFilter}`;
};

const withArm64Release: ConfigPlugin = (config) =>
  withAppBuildGradle(config, (mod) => {
    mod.modResults.contents = applyReleaseAbiFilter(mod.modResults.contents);
    return mod;
  });

export default withArm64Release;
