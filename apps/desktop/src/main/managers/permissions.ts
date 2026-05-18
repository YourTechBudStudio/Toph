import { shell, systemPreferences } from 'electron';

import type {
  PermissionRequirement,
  PermissionRequirementId,
  PermissionState,
} from '@toph/desktop-contracts';

export interface PermissionManager {
  inspectRequiredPermissions: () => Promise<PermissionState>;
  performPermissionAction: (permissionId: PermissionRequirementId) => Promise<PermissionState>;
}

const notRequiredPermissions: PermissionState = {
  ready: true,
  requirements: [],
};

function createPermissionState(requirements: PermissionRequirement[]): PermissionState {
  return {
    ready: requirements.every(
      (requirement) =>
        !requirement.required ||
        requirement.status === 'granted' ||
        requirement.status === 'not-required',
    ),
    requirements,
  };
}

function inspectMacMicrophone(): PermissionRequirement {
  const status = systemPreferences.getMediaAccessStatus('microphone');

  if (status === 'granted') {
    return {
      id: 'microphone',
      label: 'Microphone',
      status: 'granted',
      required: true,
      detail: 'Microphone access is ready for dictation capture.',
      action: 'none',
    };
  }

  if (status === 'not-determined') {
    return {
      id: 'microphone',
      label: 'Microphone',
      status: 'promptable',
      required: true,
      detail:
        'Toph needs microphone access before it can listen. I promise not to monologue into prod.',
      action: 'request',
    };
  }

  return {
    id: 'microphone',
    label: 'Microphone',
    status: 'denied',
    required: true,
    detail: 'Microphone access is blocked. Enable Toph in macOS Privacy & Security > Microphone.',
    action: 'open-settings',
  };
}

function inspectMacAccessibility(): PermissionRequirement {
  const trusted = systemPreferences.isTrustedAccessibilityClient(false);

  if (trusted) {
    return {
      id: 'accessibility',
      label: 'Accessibility',
      status: 'granted',
      required: true,
      detail: 'Accessibility access is ready for automatic paste into the focused app.',
      action: 'none',
    };
  }

  return {
    id: 'accessibility',
    label: 'Accessibility',
    status: 'missing',
    required: true,
    detail: 'Toph needs Accessibility access to paste transcripts into the focused app.',
    action: 'open-settings',
  };
}

async function openMacPermissionSettings(permissionId: PermissionRequirementId) {
  const path =
    permissionId === 'microphone'
      ? 'Privacy_Microphone'
      : permissionId === 'screen'
        ? 'Privacy_ScreenCapture'
        : 'Privacy_Accessibility';
  await shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${path}`);
}

function inspectMacPermissions(): PermissionState {
  return createPermissionState([inspectMacMicrophone(), inspectMacAccessibility()]);
}

function createMacPermissionManager(): PermissionManager {
  return {
    async inspectRequiredPermissions() {
      return inspectMacPermissions();
    },

    async performPermissionAction(permissionId) {
      if (permissionId === 'screen') {
        await openMacPermissionSettings(permissionId);
        return inspectMacPermissions();
      }

      if (permissionId === 'microphone') {
        const microphone = inspectMacMicrophone();
        if (microphone.status === 'promptable') {
          await systemPreferences.askForMediaAccess('microphone');
          return inspectMacPermissions();
        }
      }

      await openMacPermissionSettings(permissionId);
      return inspectMacPermissions();
    },
  };
}

export function createPermissionManager(): PermissionManager {
  if (process.platform === 'darwin') {
    return createMacPermissionManager();
  }

  return {
    async inspectRequiredPermissions() {
      return notRequiredPermissions;
    },

    async performPermissionAction() {
      return notRequiredPermissions;
    },
  };
}
