import { app } from 'electron';

import { bootstrap } from './bootstrap';

const toggleCaptureFlag = '--toggle-capture';
const ruleSwitcherFlag = '--rule-switcher';
const shouldToggleOnLaunch = process.argv.includes(toggleCaptureFlag);
const shouldOpenRuleSwitcherOnLaunch = process.argv.includes(ruleSwitcherFlag);

if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-features', 'GlobalShortcutsPortal');
}

void bootstrap({
  shouldToggleOnLaunch,
  shouldOpenRuleSwitcherOnLaunch,
  toggleCaptureFlag,
  ruleSwitcherFlag,
}).catch((error) => {
  console.error('Toph failed to bootstrap.', error);
  app.quit();
});
