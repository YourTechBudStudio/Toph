/**
 * A development build installs beside the release build instead of replacing it.
 *
 * The split is carried by the build type in the generated native project, so these checks run the
 * plugin's transforms over the shapes Expo's template produces: only the Android debug build type
 * moves to the development identity, and only the release build answers the real link scheme.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  DEV_ID_SUFFIX,
  applyAndroidBuildTypes,
  moveLinkSchemeToDev,
  releaseManifest,
} from '../plugins/dev-variant.ts';

const readJson = (relative) => JSON.parse(readFileSync(new URL(relative, import.meta.url), 'utf8'));

const GRADLE = `android {
    defaultConfig {
        applicationId 'studio.yourtechbud.toph'
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            signingConfig signingConfigs.debug
        }
    }
}
`;

describe('Android build types', () => {
  it('labels the default build and gives the debug build type the development identity', () => {
    const gradle = applyAndroidBuildTypes(GRADLE, 'Toph');
    assert.match(
      gradle,
      /defaultConfig \{\n {8}manifestPlaceholders\['appLabel'\] = 'Toph'\n {8}applicationId/u,
    );
    assert.match(
      gradle,
      /debug \{\n {12}applicationIdSuffix '\.dev'\n {12}manifestPlaceholders\['appLabel'\] = 'Toph Dev'\n {12}signingConfig/u,
    );
    assert.equal(gradle.match(/applicationIdSuffix/gu)?.length, 1);
  });

  it('quotes the label as a Groovy string', () => {
    assert.match(applyAndroidBuildTypes(GRADLE, "Toph's"), /= 'Toph\\'s Dev'/u);
  });

  it('is unchanged when applied again', () => {
    const once = applyAndroidBuildTypes(GRADLE, 'Toph');
    assert.equal(applyAndroidBuildTypes(once, 'Toph'), once);
  });

  it('fails loudly when the template no longer has the blocks it edits', () => {
    assert.throws(() => applyAndroidBuildTypes('android {}\n', 'Toph'), /buildTypes\.debug/u);
  });

  it('launches the development identity from `pnpm android`', () => {
    // Expo launches the gradle `applicationId`, which has no suffix, so the script names the
    // development package itself and has to follow the package in app.json.
    const { expo } = readJson('../app.json');
    const { scripts } = readJson('../package.json');
    assert.match(
      scripts.android,
      new RegExp(`--app-id ${expo.android.package}${DEV_ID_SUFFIX}$`, 'u'),
    );
  });
});

describe('link schemes', () => {
  const linkFilters = () => [
    {
      action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }],
      category: [{ $: { 'android:name': 'android.intent.category.LAUNCHER' } }],
    },
    {
      action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
      category: [
        { $: { 'android:name': 'android.intent.category.DEFAULT' } },
        { $: { 'android:name': 'android.intent.category.BROWSABLE' } },
      ],
      data: [{ $: { 'android:scheme': 'toph' } }, { $: { 'android:scheme': 'exp+toph' } }],
    },
  ];
  const schemes = (filter) => filter.data.map((data) => data.$['android:scheme']);

  it('moves the shared link filter to the development scheme and keeps the dev-client scheme', () => {
    const filters = linkFilters();
    const filter = moveLinkSchemeToDev(filters, 'toph');
    assert.equal(filter, filters[1]);
    assert.deepEqual(schemes(filter), ['toph-dev', 'exp+toph']);
    assert.equal(filters[0].data, undefined);
  });

  it('is unchanged when applied again', () => {
    const filters = linkFilters();
    moveLinkSchemeToDev(filters, 'toph');
    const again = moveLinkSchemeToDev(filters, 'toph');
    assert.deepEqual(schemes(again), ['toph-dev', 'exp+toph']);
  });

  it('fails loudly when no filter answers the scheme', () => {
    assert.throws(() => moveLinkSchemeToDev([linkFilters()[0]], 'toph'), /"toph" scheme/u);
  });

  it('gives the release build the real scheme in place of the development link filter', () => {
    const filter = moveLinkSchemeToDev(linkFilters(), 'toph');
    const xml = releaseManifest('.MainActivity', filter, 'toph');
    const [removed, added] = xml.split('<intent-filter').slice(1);
    assert.match(removed, /^ tools:node="remove">/u);
    assert.match(removed, /android:scheme="toph-dev"\/>\n {8}<data android:scheme="exp\+toph"\/>/u);
    assert.match(removed, /android\.intent\.category\.BROWSABLE/u);
    assert.match(added, /^>/u);
    assert.deepEqual(added.match(/android:scheme="[^"]+"/gu), ['android:scheme="toph"']);
    assert.match(added, /android\.intent\.action\.VIEW/u);
  });

  it('launches the release identity from `pnpm release:android`', () => {
    const { expo } = readJson('../app.json');
    const { scripts } = readJson('../package.json');
    assert.match(
      scripts['release:android'],
      new RegExp(`--app-id ${expo.android.package.replaceAll('.', '\\.')}$`, 'u'),
    );
  });
});
