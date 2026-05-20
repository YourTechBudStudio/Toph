const { chmod, rm, rename, writeFile } = require('node:fs/promises');
const { join } = require('node:path');

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'linux') {
    return;
  }

  const executableName = context.packager.executableName;
  const executablePath = join(context.appOutDir, executableName);
  const binaryPath = `${executablePath}.bin`;

  await rm(binaryPath, { force: true });
  await rename(executablePath, binaryPath);
  await writeFile(
    executablePath,
    `#!/usr/bin/env sh
set -eu

APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ -n "\${ELECTRON_RUN_AS_NODE:-}" ]; then
  exec "$APP_DIR/${executableName}.bin" "$@"
fi

exec "$APP_DIR/${executableName}.bin" --no-sandbox --disable-gpu "$@"
`,
  );
  await chmod(executablePath, 0o755);
};
