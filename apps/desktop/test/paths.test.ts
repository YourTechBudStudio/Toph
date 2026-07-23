import assert from 'node:assert/strict';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { resolveTophDataPaths } from '../src/main/paths.ts';

test('default data paths use the resolved user home when HOME is unavailable', async () => {
  const testRoot = await mkdtemp(join(tmpdir(), 'toph-paths-'));
  const homeDirectory = join(testRoot, 'windows-user');

  try {
    const paths = await resolveTophDataPaths({ env: {}, homeDirectory });

    assert.equal(paths.dataDirectory, resolve(homeDirectory, '.toph'));
    await access(paths.dataDirectory);
    await access(paths.pricingDirectory);
    await access(paths.recordingsDirectory);
  } finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});
