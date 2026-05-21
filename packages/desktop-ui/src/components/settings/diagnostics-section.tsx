import { useState } from 'react';

import { SettingsSection } from './settings-controls';

export function DiagnosticsSection({
  id,
  providerLabel,
  currentDesktop,
  sessionType,
  platform,
  providerReady,
  polishEnabled,
  polishRulePresetId,
  permissionsReady,
  pasteHelper,
  pasteDetail,
  shortcutBackend,
  shortcutRegistered,
  shortcutDetail,
  ruleSwitcherShortcutBackend,
  ruleSwitcherShortcutRegistered,
  ruleSwitcherShortcutDetail,
}: {
  id?: string;
  providerLabel: string | null;
  currentDesktop: string;
  sessionType: string;
  platform: NodeJS.Platform;
  providerReady: boolean;
  polishEnabled: boolean;
  polishRulePresetId: string | null;
  permissionsReady: boolean;
  pasteHelper: string | null;
  pasteDetail: string;
  shortcutBackend: string;
  shortcutRegistered: boolean;
  shortcutDetail: string;
  ruleSwitcherShortcutBackend: string;
  ruleSwitcherShortcutRegistered: boolean;
  ruleSwitcherShortcutDetail: string;
}) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const diagnosticRows = [
    [
      'Runtime',
      `${platform} on ${sessionType || 'unknown session'} under ${currentDesktop || 'unknown desktop'}.`,
    ],
    [
      'Shortcuts',
      `Dictation uses ${shortcutBackend} and is ${shortcutRegistered ? 'registered' : 'not registered'}; rule switcher uses ${ruleSwitcherShortcutBackend} and is ${ruleSwitcherShortcutRegistered ? 'registered' : 'not registered'}.`,
    ],
    [
      'Shortcut details',
      `Dictation: ${shortcutDetail || 'none'} Rule switcher: ${ruleSwitcherShortcutDetail || 'none'}`,
    ],
    [
      'Readiness',
      `${providerLabel ? `Provider ${providerLabel} is` : 'Provider is'} ${providerReady ? 'ready' : 'not ready'}, permissions are ${permissionsReady ? 'ready' : 'not ready'}, and writing is ${polishEnabled ? `using ${polishRulePresetId ?? 'no selected preset'}` : 'disabled'}.`,
    ],
    [
      'Paste',
      `${pasteHelper ? `Using ${pasteHelper}` : 'No paste helper'}; ${pasteDetail || 'no paste detail'}`,
    ],
  ];
  const exportText = diagnosticRows.map(([label, value]) => `${label}: ${value}`).join('\n');

  const copyDiagnostics = async () => {
    try {
      await navigator.clipboard.writeText(exportText);
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 1600);
    } catch {
      setCopyState('failed');
      window.setTimeout(() => setCopyState('idle'), 2200);
    }
  };

  return (
    <SettingsSection
      id={id}
      eyebrow="Advanced"
      description="Troubleshooting details for support. Hidden until you need them."
    >
      <div className="relative">
        <details className="group">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-text-primary transition-colors duration-150 hover:bg-white/4 [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">Show diagnostics</span>
            <span className="hidden group-open:inline">Hide diagnostics</span>
            <span className="text-text-tertiary transition-transform duration-150 group-open:rotate-90">
              &gt;
            </span>
          </summary>
          <dl className="border-t border-white/5">
            {diagnosticRows.map(([label, value], index) => (
              <div
                key={label}
                className={`grid min-h-11 grid-cols-[9.5rem_minmax(0,1fr)] items-start gap-x-5 px-4 py-3 max-[560px]:grid-cols-[7.25rem_minmax(0,1fr)] max-[560px]:gap-x-3 ${
                  index === diagnosticRows.length - 1 ? '' : 'border-b border-white/5'
                }`}
              >
                <dt className="text-[13px] leading-snug font-semibold text-text-tertiary">
                  {label}
                </dt>
                <dd className="m-0 min-w-0 text-sm leading-snug font-semibold text-text-primary wrap-anywhere">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </details>
        <button
          type="button"
          aria-label="Copy diagnostics"
          title="Copy diagnostics"
          className={`absolute top-2 right-11 inline-flex size-8 cursor-pointer items-center justify-center rounded-lg border transition-[background-color,color,transform] duration-200 ease-out hover:-translate-y-px hover:bg-white/10 hover:text-text-primary ${
            copyState === 'copied'
              ? 'border-accent-green/30 bg-accent-green/10 text-accent-green'
              : copyState === 'failed'
                ? 'border-accent-red/30 bg-accent-red/10 text-accent-red'
                : 'border-white/8 bg-white/5 text-accent-blue'
          }`}
          onClick={() => void copyDiagnostics()}
        >
          {copyState === 'copied' ? (
            <svg
              aria-hidden="true"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20 6 9 17l-5-5" />
            </svg>
          ) : copyState === 'failed' ? (
            <svg
              aria-hidden="true"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          ) : (
            <svg
              aria-hidden="true"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="9" y="9" width="13" height="13" rx="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          )}
        </button>
      </div>
    </SettingsSection>
  );
}
