import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { app } from 'electron';

const productionAppName = 'Toph';
const packagedDevAppName = 'Toph(DEV)';
const packagedDevResourcesMarker = `${packagedDevAppName}.app`;

export const packagedDevDataDirectoryName = '.toph_Dev';

export function isPackagedDevApp() {
  const resourcesPath = process.resourcesPath ?? '';
  return app.isPackaged && resourcesPath.includes(packagedDevResourcesMarker);
}

export function configureAppIdentity() {
  const devApp = isPackagedDevApp();
  const appName = devApp ? packagedDevAppName : productionAppName;

  app.setName(appName);

  if (devApp) {
    const userDataPath = join(app.getPath('appData'), appName);
    mkdirSync(userDataPath, { recursive: true });
    app.setPath('userData', userDataPath);
    app.setPath('sessionData', userDataPath);
  }

  return {
    appName,
    isPackagedDevApp: devApp,
  };
}
