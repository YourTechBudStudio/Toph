# Toph mobile

From the repository root:

```sh
pnpm install
pnpm --filter @toph/mobile android
```

`pnpm --filter @toph/mobile android` builds and installs the development build (`Toph Dev`) on a connected device or emulator. `pnpm --filter @toph/mobile release:android` builds and installs the release build (`Toph`) beside it.
