import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { PasteAttempt, PasteSupport } from '@toph/desktop-contracts';

const execFileAsync = promisify(execFile);

const windowsSendInputTypeDefinition = String.raw`
$source = @'
using System;
using System.Runtime.InteropServices;

namespace Toph
{
    public static class WindowsPaste
    {
        private const uint InputKeyboard = 1;
        private const uint KeyEventKeyUp = 0x0002;
        private const ushort VirtualKeyControl = 0x11;
        private const ushort VirtualKeyV = 0x56;

        [StructLayout(LayoutKind.Sequential)]
        private struct Input
        {
            public uint type;
            public InputUnion value;
        }

        [StructLayout(LayoutKind.Explicit)]
        private struct InputUnion
        {
            [FieldOffset(0)]
            public KeyboardInput keyboard;

            [FieldOffset(0)]
            public MouseInput mouse;

            [FieldOffset(0)]
            public HardwareInput hardware;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct KeyboardInput
        {
            public ushort virtualKey;
            public ushort scanCode;
            public uint flags;
            public uint time;
            public UIntPtr extraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct MouseInput
        {
            public int deltaX;
            public int deltaY;
            public uint mouseData;
            public uint flags;
            public uint time;
            public UIntPtr extraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct HardwareInput
        {
            public uint message;
            public ushort parameterLow;
            public ushort parameterHigh;
        }

        [DllImport("user32.dll", SetLastError = true)]
        private static extern uint SendInput(uint inputCount, Input[] inputs, int inputSize);

        private static Input Key(ushort virtualKey, uint flags)
        {
            return new Input
            {
                type = InputKeyboard,
                value = new InputUnion
                {
                    keyboard = new KeyboardInput
                    {
                        virtualKey = virtualKey,
                        flags = flags
                    }
                }
            };
        }

        public static int InputSize()
        {
            return Marshal.SizeOf(typeof(Input));
        }

        public static uint Paste()
        {
            Input[] inputs = new Input[]
            {
                Key(VirtualKeyControl, 0),
                Key(VirtualKeyV, 0),
                Key(VirtualKeyV, KeyEventKeyUp),
                Key(VirtualKeyControl, KeyEventKeyUp)
            };

            uint sent = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(Input)));
            if (sent != inputs.Length)
            {
                Input[] cleanup = new Input[]
                {
                    Key(VirtualKeyV, KeyEventKeyUp),
                    Key(VirtualKeyControl, KeyEventKeyUp)
                };
                SendInput((uint)cleanup.Length, cleanup, Marshal.SizeOf(typeof(Input)));
            }

            return sent;
        }
    }
}
'@

Add-Type -TypeDefinition $source
`;

const windowsSendInputProbeScript = `${windowsSendInputTypeDefinition}
$expectedSize = if ([IntPtr]::Size -eq 8) { 40 } else { 28 }
$actualSize = [Toph.WindowsPaste]::InputSize()
if ($actualSize -ne $expectedSize) {
    [Console]::Error.WriteLine("Windows INPUT structure has size $actualSize; expected $expectedSize.")
    exit 1
}
exit 0
`;

const windowsSendInputPasteScript = `${windowsSendInputTypeDefinition}
$sent = [Toph.WindowsPaste]::Paste()
if ($sent -ne 4) {
    [Console]::Error.WriteLine("Windows accepted $sent of 4 paste input events. Input may be blocked by an elevated application.")
    exit 1
}
exit 0
`;

type PowerShellExecutor = (script: string) => Promise<void>;

export interface WindowsPasteRunner {
  inspect: () => Promise<void>;
  paste: () => Promise<void>;
}

export interface WindowsClipboardManager {
  describePasteSupport: () => Promise<PasteSupport>;
  copyAndPasteText: (text: string) => Promise<PasteAttempt>;
}

function describeError(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
}

function describePowerShellFailure(error: unknown) {
  if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
    return 'Windows PowerShell is unavailable';
  }

  if (error && typeof error === 'object' && 'stderr' in error && typeof error.stderr === 'string') {
    const stderr = error.stderr.replace(/\s+/g, ' ').trim();
    if (stderr) {
      return stderr.slice(0, 300);
    }
  }

  return 'Windows PowerShell could not run the SendInput helper';
}

async function executePowerShell(script: string) {
  try {
    await execFileAsync(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
      {
        timeout: 3_000,
        windowsHide: true,
      },
    );
  } catch (error) {
    throw new Error(describePowerShellFailure(error), { cause: error });
  }
}

export function createWindowsPasteRunner(
  options: { executePowerShell?: PowerShellExecutor } = {},
): WindowsPasteRunner {
  const runPowerShell = options.executePowerShell ?? executePowerShell;
  let inspection: Promise<void> | null = null;

  return {
    inspect() {
      if (!inspection) {
        inspection = runPowerShell(windowsSendInputProbeScript).catch((error: unknown) => {
          inspection = null;
          throw error;
        });
      }

      return inspection;
    },

    async paste() {
      await runPowerShell(windowsSendInputPasteScript);
    },
  };
}

export function createWindowsClipboardManager(options: {
  copyText: (text: string) => PasteAttempt | null;
  runner?: WindowsPasteRunner;
}): WindowsClipboardManager {
  const runner = options.runner ?? createWindowsPasteRunner();

  return {
    async describePasteSupport() {
      try {
        await runner.inspect();
        return {
          helper: 'windows-sendinput',
          detail:
            'Clipboard-first mode is active. Auto-paste will be attempted with Windows SendInput.',
        };
      } catch (error) {
        return {
          helper: null,
          detail: `Clipboard write is ready, but the Windows SendInput helper is unavailable. ${describeError(error)}.`,
        };
      }
    },

    async copyAndPasteText(text) {
      const copyFailure = options.copyText(text);
      if (copyFailure) {
        return copyFailure;
      }

      try {
        await runner.paste();
        return {
          helper: 'windows-sendinput',
          status: 'success',
          detail:
            'Transcript copied to the clipboard and paste was attempted with Windows SendInput.',
          copiedToClipboard: true,
        };
      } catch (error) {
        return {
          helper: 'windows-sendinput',
          status: 'failed',
          detail: `Transcript copied to the clipboard, but Windows automatic paste failed. The target may be running as Administrator. ${describeError(error)}.`,
          copiedToClipboard: true,
        };
      }
    },
  };
}
