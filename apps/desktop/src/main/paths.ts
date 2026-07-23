import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const dataDirectoryEnvVar = 'TOPH_DATA_DIRECTORY';

function resolveDefaultDataDirectory(homeDirectory: string) {
  if (!homeDirectory) {
    throw new Error('Unable to resolve the Toph data directory because the user home is unavailable.');
  }

  return join(homeDirectory, '.toph');
}

interface ResolveTophDataPathsOptions {
  env?: NodeJS.ProcessEnv;
  homeDirectory?: string;
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

export async function resolveTophDataPaths(options: ResolveTophDataPathsOptions = {}) {
  const env = options.env ?? process.env;
  const configuredDirectory = env[dataDirectoryEnvVar];
  const dataDirectory = configuredDirectory
    ? resolve(configuredDirectory)
    : resolveDefaultDataDirectory(options.homeDirectory ?? homedir());

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
