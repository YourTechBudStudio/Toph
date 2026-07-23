import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { PasteAttempt } from '@toph/desktop-contracts';

import type { ClipboardManager } from './clipboard';

const execFileAsync = promisify(execFile);

const windowsSendInputHelperSource = String.raw`
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

        public static int Main(string[] args)
        {
            if (args.Length == 1 && args[0] == "--inspect")
            {
                int expectedSize = IntPtr.Size == 8 ? 40 : 28;
                int actualSize = InputSize();
                if (actualSize != expectedSize)
                {
                    Console.Error.WriteLine(
                        "Windows INPUT structure has size " + actualSize + "; expected " + expectedSize + "."
                    );
                    return 1;
                }

                return 0;
            }

            if (args.Length != 0)
            {
                Console.Error.WriteLine("The Windows paste helper received an unsupported argument.");
                return 1;
            }

            uint sent = Paste();
            if (sent != 4)
            {
                Console.Error.WriteLine(
                    "Windows accepted " + sent + " of 4 paste input events. Input may be blocked by an elevated application."
                );
                return 1;
            }

            return 0;
        }
    }
}
`;

const helperVersion = createHash('sha256')
  .update(windowsSendInputHelperSource)
  .digest('hex')
  .slice(0, 12);
const defaultHelperPath = join(tmpdir(), `toph-windows-paste-${helperVersion}.exe`);

function quotePowerShellLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function createCompileScript(helperPath: string) {
  return String.raw`
$outputAssembly = ${quotePowerShellLiteral(helperPath)}
if (-not (Test-Path -LiteralPath $outputAssembly)) {
    $temporaryAssembly = "$outputAssembly.$PID.tmp.exe"
    $source = @'
${windowsSendInputHelperSource}
'@

    try {
        Add-Type -TypeDefinition $source -OutputAssembly $temporaryAssembly -OutputType ConsoleApplication
        Move-Item -LiteralPath $temporaryAssembly -Destination $outputAssembly -Force
    }
    finally {
        Remove-Item -LiteralPath $temporaryAssembly -Force -ErrorAction SilentlyContinue
    }
}
`;
}

type PowerShellExecutor = (script: string) => Promise<void>;
type HelperExecutor = (helperPath: string, args: string[]) => Promise<void>;

export interface WindowsPasteRunner {
  inspect: () => Promise<void>;
  paste: () => Promise<void>;
}

// Kept local: importing it from './clipboard' would pull `electron` into the
// node test runner, which imports this module directly.
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
        timeout: 15_000,
        windowsHide: true,
      },
    );
  } catch (error) {
    throw new Error(describePowerShellFailure(error), { cause: error });
  }
}

async function executeHelper(helperPath: string, args: string[]) {
  try {
    await execFileAsync(helperPath, args, {
      timeout: 3_000,
      windowsHide: true,
    });
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'stderr' in error &&
      typeof error.stderr === 'string'
    ) {
      const stderr = error.stderr.replace(/\s+/g, ' ').trim();
      if (stderr) {
        throw new Error(stderr.slice(0, 300), { cause: error });
      }
    }

    throw new Error('The Windows SendInput helper could not run', { cause: error });
  }
}

export function createWindowsPasteRunner(
  options: {
    executePowerShell?: PowerShellExecutor;
    executeHelper?: HelperExecutor;
    helperPath?: string;
  } = {},
): WindowsPasteRunner {
  const runPowerShell = options.executePowerShell ?? executePowerShell;
  const runHelper = options.executeHelper ?? executeHelper;
  const helperPath = options.helperPath ?? defaultHelperPath;
  let inspection: Promise<void> | null = null;

  const inspect = () => {
    if (!inspection) {
      inspection = (async () => {
        await runPowerShell(createCompileScript(helperPath));
        await runHelper(helperPath, ['--inspect']);
      })().catch((error: unknown) => {
        inspection = null;
        throw error;
      });
    }

    return inspection;
  };

  return {
    inspect,

    async paste() {
      await inspect();
      await runHelper(helperPath, []);
    },
  };
}

export function createWindowsClipboardManager(options: {
  copyText: (text: string) => PasteAttempt | null;
  runner?: WindowsPasteRunner;
}): ClipboardManager {
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
