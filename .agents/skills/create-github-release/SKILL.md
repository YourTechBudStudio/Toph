---
name: create-github-release
description: Draft GitHub release notes from commits since the last release
disable-model-invocation: true
---

Draft a GitHub release for **Toph**. The version comes from the root `package.json` — the user passes no arguments. Follow the steps in order. Don't write release notes until prerequisites pass and the user has confirmed.

## Prerequisites — stop if any check fails

Read the `version` field from the root `package.json` and compute the tag as `v<version>` (always prefix with `v` — that's the convention). If any check below fails, surface the issue and stop. Don't try to fix things on the user's behalf.

- Root `package.json` exists and has a valid semver `version`.
- The computed tag doesn't already exist: `git tag --list "<tag>"` is empty and `gh release view "<tag>"` fails.
- Current branch is `master`: `git rev-parse --abbrev-ref HEAD` returns `master`.
- Working tree is clean: `git status --porcelain` is empty.
- Local `master` is up to date with `origin/master`: `git fetch origin master` then verify `git rev-parse HEAD` equals `git rev-parse origin/master`.

## Confirm with the user before drafting

Once prerequisites pass, ask the user to confirm — explicitly — before doing any more work:

> About to draft release `<tag>` from `master` at commit `<short-sha>` — `<commit subject>`. Continue?

Wait for an explicit yes. Don't proceed on silence.

## Collect commits

Find the previous release tag (`gh release view --json tagName -q .tagName`, fall back to `git describe --tags --abbrev=0`, fall back to the root commit if there are no tags). Then:

```sh
git log <previous-ref>..HEAD --no-merges --pretty=format:"%h%x09%an%x09%s"
```

## Build context selectively

Before grouping or drafting, do a quick triage pass over the commit list. Don't inspect every commit by default.

Only gather extra context for commits that are likely to matter to the release notes, such as:

- Vague subjects: `misc`, `update`, `cleanup`, `fix stuff`, `refactor`, `changes`, `wip`.
- Consequential-sounding commits whose user or product impact is unclear.
- Commits that touch user-facing areas like dictation, transcription, overlays, settings, onboarding, shortcuts, permissions, pricing, installation, or reliability.
- Large commits, commits that appear to bundle multiple changes, or commits where the conventional prefix doesn't explain the outcome.

For those selected commits, gather context in the cheapest useful way:

1. Start with `git show --stat --oneline <sha>` or `git show --name-status <sha>`.
2. If the product impact is still unclear, inspect the relevant diff with `git show <sha>`.
3. If the diff still doesn't make the user-facing outcome clear, ask the user concise questions before drafting.

When asking questions:

- Batch them together instead of interrupting for every commit.
- Ask only what would change the release notes.
- Reference the commit short SHA and subject so the user has context.
- Phrase questions in product/business terms, not implementation terms.

Example:

> I need a little context before drafting. For `abc1234` — `refactor transcription flow` — was this purely internal cleanup, or did it improve dictation speed/reliability in a way users would notice?

Do this context-gathering and question-answering phase before writing the release draft or inviting feedback.

Release notes should stay product-focused. Translate technical changes into user outcomes when supported by the diff or the user's answers. If the impact is purely internal, keep it brief under **Under the hood** or omit it. Don't invent behavior that isn't in the diff or the user's answers.

## Group the work

Bucket commits using conventional-commit prefixes when present:

- **New** — `feat:`
- **Fixed** — `fix:`
- **Improved** — `refactor:`, `perf:`, user-facing `style:`
- **Under the hood** — everything else, collapsed (don't list each dependency bump)

Drop noise commits (`wip`, `fix typo`, review fixups) when the final state is already covered by a later commit.

## Draft in Toph tone

Load the `frontend-design` skill and use its "Voice & Copywriting (Toph tone)" section. Tone in one sentence: witty, nerdy, comedic-villain-but-friendly, developer humor, useful first, one punchline per surface, no emojis.

Skeleton (the title uses `<version>` without the `v` prefix):

```markdown
# Toph <version> — <short evocative title>

<One-line opener in Toph voice.>

## New

- <feature, one line each>

## Fixed

- <bug → behavior now, one line each>

## Improved

- <refactor / perf / polish>

## Under the hood

- <internals, single tight list>

## Contributors

Thanks to <@author1>, <@author2> for shipping this one.

**Full changelog:** https://github.com/<owner>/<repo>/compare/<prev-tag>...<tag>
```

Use GitHub @-handles only when you can map them confidently (check `gh api /repos/{owner}/{repo}/commits/<sha>` if unsure). Otherwise use the plain author name.

## Show the draft, invite feedback

Print the draft. Ask:

> Want me to tweak anything — tone, grouping, emphasis? Once you're happy, I'll push this as a **draft** release on GitHub.

Do not create the release yet.

## On approval, publish as a GitHub draft

Resolve the target SHA with `git rev-parse HEAD`. Write the notes to a temp file under `/var/folders/0n/rfz3pwlx6vdb_w2ftnq5ycqc0000gn/T/opencode/` (so Markdown survives), then:

```sh
gh release create "<tag>" \
  --draft \
  --title "<title from the draft>" \
  --notes-file <temp-file> \
  --target <resolved-sha>
```

`--target` must be the SHA, not a branch name — this pins the future tag to the exact commit the notes describe. The tag itself isn't created until the draft is published.

Report the URL back to the user.

## Guardrails

- Never publish a non-draft release. Never `git commit`, `git tag`, or `git push`.
- If `gh` isn't authenticated, surface it. Don't work around it.
