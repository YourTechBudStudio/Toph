import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

import { clipboard, systemPreferences } from 'electron';

import type { PasteAttempt, PasteSupport } from '@toph/desktop-contracts';

import { createWindowsClipboardManager } from './clipboard.windows';

const execFileAsync = promisify(execFile);

type PasteHelper = {
  name: string;
  args: string[];
  supported: boolean;
};

export interface ClipboardManager {
  describePasteSupport: () => Promise<PasteSupport>;
  copyAndPasteText: (text: string) => Promise<PasteAttempt>;
}

const sessionType = (process.env.XDG_SESSION_TYPE ?? '').toLowerCase();
const currentDesktop = (
  process.env.XDG_CURRENT_DESKTOP ??
  process.env.DESKTOP_SESSION ??
  ''
).toLowerCase();

let helperPromise: Promise<PasteHelper | null> | null = null;

function describeError(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
}

function copyText(text: string): PasteAttempt | null {
  try {
    clipboard.writeText(text);
    return null;
  } catch (error) {
    return {
      helper: null,
      status: 'failed',
      detail: `Transcript could not be copied to the clipboard. ${describeError(error)}.`,
      copiedToClipboard: false,
    };
  }
}

async function commandExists(command: string): Promise<boolean> {
  try {
    await execFileAsync('which', [command]);
    return true;
  } catch {
    return false;
  }
}

async function resolveHelper(
  options: { forceRefresh?: boolean } = {},
): Promise<PasteHelper | null> {
  if (helperPromise && !options.forceRefresh) {
    return helperPromise;
  }

  helperPromise = (async () => {
    const isWayland = sessionType === 'wayland';
    const isGnome = currentDesktop.includes('gnome');

    if (isWayland && isGnome) {
      if (await commandExists('ydotool')) {
        return {
          name: 'ydotool',
          args: ['key', '29:1', '42:1', '47:1', '47:0', '42:0', '29:0'],
          supported: true,
        };
      }

      return null;
    }

    if (isWayland && (await commandExists('wtype'))) {
      return {
        name: 'wtype',
        args: ['-M', 'ctrl', '-M', 'shift', 'v', '-m', 'shift', '-m', 'ctrl'],
        supported: true,
      };
    }

    if (await commandExists('ydotool')) {
      return {
        name: 'ydotool',
        args: ['key', '29:1', '42:1', '47:1', '47:0', '42:0', '29:0'],
        supported: true,
      };
    }

    if (!isWayland && (await commandExists('xdotool'))) {
      return {
        name: 'xdotool',
        args: ['key', '--clearmodifiers', 'ctrl+shift+v'],
        supported: true,
      };
    }

    return null;
  })();

  return helperPromise;
}

function runHelper(helper: PasteHelper): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(helper.name, helper.args, { stdio: 'ignore' });
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      resolve(false);
    }, 1500);

    child.once('error', () => {
      clearTimeout(timeout);
      resolve(false);
    });

    child.once('exit', (code) => {
      clearTimeout(timeout);
      resolve(code === 0);
    });
  });
}

function createLinuxClipboardManager(): ClipboardManager {
  return {
    async describePasteSupport(): Promise<PasteSupport> {
      let helper: PasteHelper | null;

      try {
        helper = await resolveHelper({ forceRefresh: true });
      } catch (error) {
        return {
          helper: null,
          detail: `Clipboard-first mode is active, but helper inspection failed. ${describeError(error)}.`,
        };
      }

      if (helper?.supported) {
        return {
          helper: helper.name,
          detail: `Clipboard-first mode is active. Auto-paste will be attempted with ${helper.name}.`,
        };
      }

      if (sessionType === 'wayland' && currentDesktop.includes('gnome')) {
        return {
          helper: null,
          detail:
            'Clipboard-first mode is active. GNOME on Wayland blocks synthetic paste unless a helper like ydotool is available.',
        };
      }

      if (sessionType === 'wayland') {
        return {
          helper: null,
          detail:
            'Clipboard-first mode is active. Auto-paste needs a compositor-compatible helper on Wayland.',
        };
      }

      return {
        helper: null,
        detail:
          'Clipboard-first mode is active. Auto-paste needs an installed helper such as xdotool.',
      };
    },

    async copyAndPasteText(text): Promise<PasteAttempt> {
      const copyFailure = copyText(text);
      if (copyFailure) {
        return copyFailure;
      }

      let helper: PasteHelper | null;

      try {
        helper = await resolveHelper();
      } catch (error) {
        return {
          helper: null,
          status: 'failed',
          detail: `Transcript copied to the clipboard, but helper inspection failed. ${describeError(error)}.`,
          copiedToClipboard: true,
        };
      }

      if (!helper?.supported) {
        return {
          helper: null,
          status: 'clipboard-only',
          detail:
            'Transcript copied to the clipboard. Automatic paste is unavailable in this Linux session right now.',
          copiedToClipboard: true,
        };
      }

      const pasted = await runHelper(helper);

      if (pasted) {
        return {
          helper: helper.name,
          status: 'success',
          detail: `Transcript copied to the clipboard and paste was attempted with ${helper.name}.`,
          copiedToClipboard: true,
        };
      }

      return {
        helper: helper.name,
        status: 'failed',
        detail: `Transcript copied to the clipboard. ${helper.name} was found, but the paste attempt failed.`,
        copiedToClipboard: true,
      };
    },
  };
}

function createMacClipboardManager(): ClipboardManager {
  return {
    async describePasteSupport() {
      if (!systemPreferences.isTrustedAccessibilityClient(false)) {
        return {
          helper: null,
          detail: 'Clipboard write is ready. Auto-paste needs macOS Accessibility access.',
        };
      }

      return {
        helper: 'macos-accessibility',
        detail:
          'Clipboard-first mode is active. Auto-paste will be attempted with macOS Accessibility.',
      };
    },

    async copyAndPasteText(text) {
      const copyFailure = copyText(text);
      if (copyFailure) {
        return copyFailure;
      }

      if (!systemPreferences.isTrustedAccessibilityClient(false)) {
        return {
          helper: 'macos-accessibility',
          status: 'clipboard-only',
          detail:
            'Transcript copied to the clipboard. Auto-paste needs macOS Accessibility access.',
          copiedToClipboard: true,
        };
      }

      try {
        await execFileAsync('osascript', [
          '-e',
          'tell application "System Events" to keystroke "v" using command down',
        ]);

        return {
          helper: 'macos-accessibility',
          status: 'success',
          detail:
            'Transcript copied to the clipboard and paste was attempted with macOS Accessibility.',
          copiedToClipboard: true,
        };
      } catch (error) {
        return {
          helper: 'macos-accessibility',
          status: 'failed',
          detail: `Transcript copied to the clipboard, but macOS automatic paste failed. ${describeError(error)}.`,
          copiedToClipboard: true,
        };
      }
    },
  };
}

function createDefaultClipboardManager(): ClipboardManager {
  return {
    async describePasteSupport() {
      return {
        helper: null,
        detail: 'Clipboard write is ready. Auto-paste is not implemented for this platform yet.',
      };
    },

    async copyAndPasteText(text) {
      const copyFailure = copyText(text);
      if (copyFailure) {
        return copyFailure;
      }

      return {
        helper: null,
        status: 'clipboard-only',
        detail:
          'Transcript copied to clipboard. Auto-paste is not implemented for this platform yet.',
        copiedToClipboard: true,
      };
    },
  };
}

// Each platform implements its own manager end to end, including the
// copy-then-paste sequencing and result wording. The overlap between them is
// coincidence, not a contract: platform paste mechanisms differ enough
// (Linux helper resolution, macOS accessibility, Windows SendInput) that a
// shared shell would be a parameter bag. Do not unify without a real driver,
// such as a PasteAttempt contract change that must land uniformly.
export function createClipboardManager(): ClipboardManager {
  if (process.platform === 'darwin') {
    return createMacClipboardManager();
  }

  if (process.platform === 'win32') {
    return createWindowsClipboardManager({ copyText });
  }

  if (process.platform === 'linux') {
    return createLinuxClipboardManager();
  }

  return createDefaultClipboardManager();
}
