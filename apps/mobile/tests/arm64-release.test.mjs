/**
 * Release APKs carry only arm64 native libraries, while debug builds keep every ABI for the emulator.
 *
 * The filter lives in the generated native project, so these checks run the plugin's transform
 * over the shape Expo's template produces.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { applyReleaseAbiFilter } from '../plugins/arm64-release.ts';

const GRADLE = `apply plugin: "com.android.application"
apply plugin: "com.facebook.react"

android {
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            signingConfig signingConfigs.debug
        }
    }
}

dependencies {
    implementation("com.facebook.react:react-android")
}
`;

describe('release ABI filter', () => {
  it('gives release arm64-v8a alone and every other build type the default ABIs', () => {
    const gradle = applyReleaseAbiFilter(GRADLE);
    assert.ok(gradle.startsWith(GRADLE.trimEnd()), 'the template is changed only by appending');
    const block = gradle.slice(GRADLE.trimEnd().length);
    assert.match(block, /androidComponents \{\n {4}finalizeDsl \{ android ->/u);
    assert.match(block, /android\.defaultConfig\.ndk\.abiFilters\.clear\(\)/u);
    assert.match(
      block,
      /if \(buildType\.name == 'release'\) \{\n {16}buildType\.ndk\.abiFilters\.add\('arm64-v8a'\)\n {12}\} else \{\n {16}buildType\.ndk\.abiFilters\.addAll\(defaultAbis\)/u,
    );
  });

  it('is unchanged when applied again', () => {
    const once = applyReleaseAbiFilter(GRADLE);
    assert.equal(applyReleaseAbiFilter(once), once);
  });

  it('fails loudly when React Native is not applied before it', () => {
    assert.throws(
      () => applyReleaseAbiFilter('apply plugin: "com.android.application"\nandroid {}\n'),
      /com\.facebook\.react/u,
    );
  });

  it('is applied by app.json', () => {
    const { expo } = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8'));
    assert.ok(expo.plugins.includes('./plugins/arm64-release.ts'));
  });
});
