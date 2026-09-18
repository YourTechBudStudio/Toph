# Real Dictation Architecture

## Purpose

This document gives the high-level shape of Toph's dictation pipeline and points to the source files that define the implementation. Keep detailed behavior in code rather than duplicating it here.

For terminology, start with `docs/architecture/dictation-mental-model.md`.

## Runtime Shape

Toph treats one toggle-on to toggle-off interval as one dictation session. The desktop main process records raw audio, derives speech-aware transcription batches, transcribes those batches, assembles a raw text output, optionally polishes it, stores the selected output, and asks the platform layer to paste it.

The renderer remains state-driven. It receives snapshots and invokes actions through desktop contracts; it does not own recording, persistence, transcription, polishing, or platform effects.

## Main Ownership Boundaries

- `apps/desktop/src/main/dictation.ts`: user-facing dictation orchestration and session lifecycle coordination.
- `apps/desktop/src/main/managers/audio-recorder.ts`: hidden capture renderer coordination and raw WAV writing.
- `apps/desktop/src/main/stores/session-store.ts`: SQLite persistence, session history, generated data cleanup, retention, and database-backed settings data.
- `apps/desktop/src/main/segmentation/session-segmentation-service.ts`: live and recorded-session segmentation entry points.
- `apps/desktop/src/main/segmentation/streaming/segmentation-pipeline-session.ts`: streaming VAD, timeline persistence, batch planning, and derived batch audio writing.
- `apps/desktop/src/main/transcription/session-transcription-coordinator.ts`: batch transcription scheduling, retry, cancellation, and completion waiting.
- `apps/desktop/src/main/providers/provider-definition.ts`: what a provider is, plus the transcription and inference client boundaries.
- `apps/desktop/src/main/providers/provider-registry.ts`: the closed list of provider definitions, with lookup by id and by role.
- `apps/desktop/src/main/providers/provider-service.ts`: connections, credentials, readiness, routing, and client resolution for every provider.
- `apps/desktop/src/main/providers/credential-storage.ts`: the on-disk credentials file, one entry per provider.
- `apps/desktop/src/main/providers/<provider>/`: one folder per provider, holding its definition, auth and clients.
- `apps/desktop/src/main/outputs/session-output-service.ts`: raw transcript assembly and persisted session outputs.
- `apps/desktop/src/main/polish/polish-service.ts`: optional LLM-based transcript polishing.
- `apps/desktop/src/main/provider-usage.ts`: provider usage and cost metadata shapes.
- `packages/desktop-contracts/src/index.ts`: renderer-facing app state, IPC channels, settings, provider, output, and capture contracts.

## Data And Contracts

Database implementation details live in `docs/architecture/database-schema.md`. The schema itself lives in `apps/desktop/src/main/db/schema.ts`.

Renderer-facing state is intentionally smaller than the persisted session model. The UI should show coherent recording, processing, polishing, failure, and history states without exposing internal timeline regions or provider batches as normal product concepts.

## Provider Boundaries

Transcription and text polishing use client interfaces so orchestration does not depend on one provider's request or response shape. Provider-specific auth, request formatting, retries, usage metadata, and pricing details should stay behind main-process provider services.

Each provider is described by a single `ProviderDefinition` module: the roles it serves, how it authenticates, the settings it declares, and how to build its clients. Everything else — auth, settings, routing, coordinators, IPC and UI — works from the registry and from the declared data the main process publishes, so adding a provider should not require editing those layers. Transcription and inference route independently: a recording is transcribed by the provider recorded on its session, while polishing resolves its client from current routing at call time.

## Platform Boundaries

The main process owns platform-sensitive behavior:

- microphone capture,
- global shortcuts,
- permissions,
- clipboard and paste,
- tray and windows,
- local filesystem and database access.

Renderer code should stay focused on presentation and contract-driven user actions.
