import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const dataDirectoryEnvVar = 'TOPH_DATA_DIRECTORY';
const productionDataDirectoryName = '.toph';

function resolveDefaultDataDirectory(directoryName = productionDataDirectoryName) {
  const homeDirectory = process.env.HOME;
  if (!homeDirectory) {
    throw new Error('Unable to resolve Toph data directory because $HOME is not available.');
  }

  return join(homeDirectory, directoryName);
}

export interface TophDataPaths {
  dataDirectory: string;
  authPath: string;
  settingsPath: string;
  databasePath: string;
  pricingDirectory: string;
  modelsDevCachePath: string;
  recordingsDirectory: string;
}

export async function resolveTophDataPaths(options: { defaultDataDirectoryName?: string } = {}) {
  const configuredDirectory = process.env[dataDirectoryEnvVar];
  const dataDirectory = configuredDirectory
    ? resolve(configuredDirectory)
    : resolveDefaultDataDirectory(options.defaultDataDirectoryName);

  const paths: TophDataPaths = {
    dataDirectory,
    authPath: join(dataDirectory, 'auth.json'),
    settingsPath: join(dataDirectory, 'settings.json'),
    databasePath: join(dataDirectory, 'data.db'),
    pricingDirectory: join(dataDirectory, 'pricing'),
    modelsDevCachePath: join(dataDirectory, 'pricing', 'models-dev.json'),
    recordingsDirectory: join(dataDirectory, 'recordings'),
  };

  await mkdir(paths.dataDirectory, { recursive: true });
  await mkdir(paths.pricingDirectory, { recursive: true });
  await mkdir(paths.recordingsDirectory, { recursive: true });

  return paths;
}
