import {
  formatShortcutChord,
  resolveDefaultDictationPromptShortcutChord,
  resolveDefaultScreenshotContextShortcutChord,
  type DictationPromptState,
  type DesktopApi,
  type ScreenshotContextState,
} from '@toph/desktop-contracts';

import { Button } from '../button';
import { SettingsIcon, SettingsRow, SettingsSection, SettingsSwitch } from './settings-controls';

function formatStatusLabel(screenshots: ScreenshotContextState) {
  if (screenshots.status === 'disabled') return 'Off';
  if (screenshots.status === 'ready') return 'Ready';
  if (screenshots.status === 'capturing') return 'Capturing';
  if (screenshots.status === 'permission-needed') return 'Permission needed';
  if (screenshots.status === 'unavailable') return 'Unavailable';
  return 'Error';
}

function formatDictationPromptStatusLabel(dictationPrompt: DictationPromptState) {
  if (dictationPrompt.status === 'disabled') return 'Off';
  if (dictationPrompt.status === 'ready') return 'Ready';
  if (dictationPrompt.status === 'capturing') return 'Capturing';
  if (dictationPrompt.status === 'captured') return 'Captured';
  if (dictationPrompt.status === 'ignored') return 'Ignored';
  return 'Error';
}

export function ScreenshotContextSection({
  screenshots,
  dictationPrompt,
  platform,
  disabled,
  busy,
  dictationPromptBusy,
  client,
  onEnabledChange,
  onDictationPromptEnabledChange,
}: {
  screenshots: ScreenshotContextState;
  dictationPrompt: DictationPromptState;
  platform: NodeJS.Platform;
  disabled: boolean;
  busy: boolean;
  dictationPromptBusy: boolean;
  client: DesktopApi;
  onEnabledChange: (enabled: boolean) => void;
  onDictationPromptEnabledChange: (enabled: boolean) => void;
}) {
  const manualShortcutLabel = formatShortcutChord(
    resolveDefaultScreenshotContextShortcutChord(platform),
    platform,
  );
  const dictationPromptShortcutLabel = formatShortcutChord(
    resolveDefaultDictationPromptShortcutChord(platform),
    platform,
  );

  return (
    <SettingsSection
      eyebrow="Context"
      description={`Optionally add active-display screenshots and spoken prompt instructions as extra context for polished dictation. Capture screenshots with ${manualShortcutLabel}; toggle Dictation Prompt with ${dictationPromptShortcutLabel}.`}
    >
      <SettingsRow
        label="Screenshot Context"
        description={screenshots.detail}
        icon={
          <SettingsIcon tone="blue">
            <svg
              width="17"
              height="17"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="4" width="14" height="10" rx="2" />
              <path d="M8 17h4M10 14v3" />
            </svg>
          </SettingsIcon>
        }
      >
        <span className="text-xs font-semibold text-text-tertiary">
          {formatStatusLabel(screenshots)}
        </span>
        {screenshots.action !== 'none' && (
          <Button
            onClick={() => void client.performPermissionAction('screen')}
            disabled={disabled || busy}
          >
            {screenshots.action === 'request' ? 'Request Access' : 'Open Settings'}
          </Button>
        )}
        <SettingsSwitch
          checked={screenshots.enabled}
          disabled={disabled || busy}
          label="Screenshot Context"
          onCheckedChange={onEnabledChange}
        />
      </SettingsRow>

      <SettingsRow
        label="Dictation Prompt"
        description={dictationPrompt.detail}
        icon={
          <SettingsIcon tone="cyan">
            <svg
              width="17"
              height="17"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M7 6a3 3 0 0 1 6 0v3a3 3 0 0 1-6 0V6Z" />
              <path d="M4 9a6 6 0 0 0 12 0M10 15v3M7 18h6" />
            </svg>
          </SettingsIcon>
        }
      >
        <span className="text-xs font-semibold text-text-tertiary">
          {formatDictationPromptStatusLabel(dictationPrompt)}
        </span>
        <SettingsSwitch
          checked={dictationPrompt.enabled}
          disabled={disabled || dictationPromptBusy}
          label="Dictation Prompt"
          onCheckedChange={onDictationPromptEnabledChange}
        />
      </SettingsRow>
    </SettingsSection>
  );
}
