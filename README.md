# Toph

A free, open-source voice-to-text dictation app. Think WisprFlow or Granola,
but yours to use, modify, and improve.

## Why the name Toph?

In _Avatar: The Last Airbender_, [Toph](https://avatar.fandom.com/wiki/Toph_Beifong) is the blind earthbender who "sees" the
world through vibrations — every footstep, every heartbeat, every lie. She
doesn't need eyes; she just listens to the ground.

That felt like the right vibe for a dictation app. Toph hears what you say and
gives it shape, while staying invisibly out of the way until you need it.

(Also: short, memorable, not a stretched acronym. We're not sorry.)

## What Toph is built around

A few stubborn principles, in rough order of stubbornness:

1. **Bring your own subscription.** If you're already paying for ChatGPT (or
   whatever AI you've sworn loyalty to), Toph should just use that. No second
   meter running.
2. **Auto-edit like it cares.** Dictation that ships with `um`s, false starts,
   and "wait, actually..." trails is just transcription. Toph cleans up after
   you so the output reads like you meant to say it.
3. **No rant left behind.** Ramble for an hour straight and it should Just
   Work — no silent timeouts, no chunk limits, no "please speak in shorter
   bursts."
4. **Open source, in your hands.** Yours to read, fork, extend, embed. If you
   don't like how something works, the code is right there — go fix it.

## Getting started

Download Toph from the [latest release](https://github.com/YourTechBudStudio/Toph/releases/latest):

| Platform            | Download                       | Notes                                         |
| ------------------- | ------------------------------ | --------------------------------------------- |
| macOS Apple silicon | `Toph-*-mac-arm64.dmg`         | Open the DMG and drag Toph into Applications. |
| macOS Intel         | `Toph-*-mac-x64.dmg`           | Open the DMG and drag Toph into Applications. |
| Linux x64           | `Toph-*-linux-x86_64.AppImage` | Use the install/update steps below.           |

### Linux install/update

Install Toph into a user-owned location so in-app updates can replace the
AppImage without `sudo`. The commands below need `curl`, `wget`, and the usual
desktop-file tools available on most Linux desktops:

```bash
mkdir -p "$HOME/.local/share/toph" "$HOME/.local/bin" "$HOME/.local/share/applications"

TOPH_VERSION="$(curl -fsSIL -o /dev/null -w '%{url_effective}' \
  https://github.com/YourTechBudStudio/Toph/releases/latest | sed 's#.*/v##')"

wget -O "$HOME/.local/share/toph/Toph.AppImage" \
  "https://github.com/YourTechBudStudio/Toph/releases/download/v${TOPH_VERSION}/Toph-${TOPH_VERSION}-linux-x86_64.AppImage"

chmod +x "$HOME/.local/share/toph/Toph.AppImage"
ln -sfn "$HOME/.local/share/toph/Toph.AppImage" "$HOME/.local/bin/toph"

cat > "$HOME/.local/share/applications/toph.desktop" <<EOF
[Desktop Entry]
Name=Toph
Exec=$HOME/.local/bin/toph
Type=Application
Terminal=false
Categories=Utility;
EOF

update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
```

After that, launch Toph from your app launcher or run `toph` from a terminal.
If Toph cannot safely update this AppImage later, it will show these steps in
the app before sending you back here.

Windows builds are not part of the official release flow yet.

## Updating your rules

Toph ships with three Polish presets — General, Engineer, and Email & Writing —
that get seeded into your local database the first time you open the app. After
that, **they're yours**. Rename them, rewrite them, scribble all over them in
Settings → Polish, and Toph will never silently overwrite your edits.

The flip side: when we improve a built-in preset (smarter heading detection,
better backtick rules, new structural commands), **your existing preset stays
exactly as it was**. We won't push the change down on top of your work.

If you want our latest cut, the source of truth lives in
[`apps/desktop/src/main/polish/rules/`](apps/desktop/src/main/polish/rules/).
Two ways to pull in an update:

- **Copy-paste.** Open the file (e.g., `engineer.txt`), grab the contents, and
  paste them into the preset body in Settings → Polish.
- **Nuke and re-seed.** Delete the preset in Settings → Polish and restart the
  app. Toph will re-create it from the latest source. Caveat: this also drops
  any customizations you made to it.

We're still iterating on these prompts. Worth checking back every so often.

## Want to get your hands dirty?

Building from source is straightforward:

```bash
pnpm install
pnpm build
pnpm start
```

That's it. The build step takes care of compiling native modules against
Electron automatically.

## Development notes

**Native modules** — The desktop app depends on `better-sqlite3`, which needs
to be compiled against Electron's Node.js runtime. This happens automatically
during `pnpm build`. If you change Electron, Node.js, or native dependency
versions and the app fails with a `NODE_MODULE_VERSION` mismatch, run:

```bash
pnpm --filter @toph/desktop run rebuild:native
```

**Database migrations** — After changing the schema in
`apps/desktop/src/main/db/schema.ts`, generate a migration with:

```bash
pnpm --filter @toph/desktop exec drizzle-kit generate
```

Don't edit files in `apps/desktop/drizzle` directly — those are generated.

## License

Toph source code is licensed under Apache 2.0. See `LICENSE` and `NOTICE` for
details.

The Toph name and logo aren't covered by that license — see `TRADEMARKS.md`
for the short version (it's friendly, we promise).
