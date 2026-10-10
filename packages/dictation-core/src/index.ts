export { createId } from './ids';

export { TimelineAssembler, type TimelineAssemblerPolicy } from './segmentation/timeline-assembler';
export { LiveBatchPlanner, type LiveBatchPlanningPolicy } from './segmentation/live-batch-planner';
export type {
  BatchSourceRangeReason,
  PlannedBatchSourceRange,
  PlannedTranscriptionBatch,
  SpeechProbabilityFrame,
  TimelineRegionDraft,
  TimelineRegionKind,
} from './segmentation/types';

export { createSessionTranscriptionCoordinator } from './transcription/session-transcription-coordinator';
export type {
  BatchSkipReason,
  BatchTranscriptRecord,
  SessionTranscriptionCoordinator,
  SessionTranscriptionOutcome,
  TranscriptionBatchRecord,
  TranscriptionBatchStatus,
  TranscriptionCoordinatorEvent,
  TranscriptionStore,
} from './transcription/session-transcription-coordinator';
export {
  isTransientTranscriptionProviderError,
  TransientTranscriptionProviderError,
} from './transcription/transcription-client';
export type {
  TranscriptionClient,
  TranscriptionClientResult,
} from './transcription/transcription-client';
export { assembleRawTranscriptText } from './transcription/raw-transcript';

export {
  createOpenAiTranscriptionClient,
  type OpenAiTranscriptionClientContext,
} from './providers/openai/transcription-client';
export { verifyOpenAiConnection } from './providers/openai/connection-check';
export {
  endpointFromCredentials,
  isOfficialOpenAiEndpoint,
  isRetryableStatus,
  normalizeBaseUrl,
  readRequestId,
  readResponseBody,
  type OpenAiEndpoint,
} from './providers/openai/http';

export { toProviderUsageEvent } from './usage/provider-usage';
export type {
  ProviderUsageDetails,
  ProviderUsageEventRecord,
  ProviderUsageOperationKind,
  ProviderUsageRelatedEntityKind,
} from './usage/provider-usage';
export type {
  AudioDurationUsage,
  CostEstimateInput,
  CostEstimator,
  CostSource,
  PricingUsage,
  TokenUsage,
  UsageCostEstimate,
} from './usage/pricing';

export {
  createDefaultAppSettings,
  normalizeAppSettings,
  parseAppSettingsFile,
} from './settings/app-settings-schema';
export type {
  AppSettingsFile,
  ProviderDeclaration,
  ProviderSettingsDeclarations,
} from './settings/app-settings-schema';

export {
  batchSourceRanges,
  batchTranscripts,
  dictionaryEntries,
  polishRulePresets,
  providerUsageEvents,
  recordingSessions,
  sessionOutputs,
  timelineRegions,
  transcriptionBatches,
} from './db/schema';
export type {
  BatchSourceRange,
  BatchTranscript,
  DictionaryEntry,
  PolishRulePreset,
  ProviderUsageEvent,
  RecordingSession,
  RecordingSessionStatus,
  SessionOutput,
  SessionOutputKind,
  TimelineRegion,
  TranscriptionBatch,
} from './db/schema';
export { retainableSessionStatuses, retainedSessionCount } from './db/retention';

export { createRulePresetHash, defaultPolishRulePresets } from './polish/builtin-rules';
export { shippedRulePresetBodyHashes } from './polish/rule-preset-history';
export { shouldUpgradeRulePresetBody } from './polish/rule-preset-upgrade';
export { createPolishService } from './polish/polish-service';
export type {
  PolishChunkResult,
  PolishOutputs,
  PolishRulesStore,
  PolishService,
  PolishSettingsReader,
} from './polish/polish-service';
export {
  chunkCloseThresholdChars,
  createSessionPolishCoordinator,
} from './polish/session-polish-coordinator';
export type {
  OrderedBatchTranscript,
  PolishCoordinatorStore,
  SessionPolishCoordinator,
} from './polish/session-polish-coordinator';
export {
  ensureDictionaryEnabledLimit,
  maxEnabledDictionaryEntries,
  normalizeDictionaryEntryDraft,
  normalizeRulePresetDraft,
} from './polish/writing-drafts';
export type { PolishRulePresetDraft } from '@toph/desktop-contracts';
export {
  defaultDictionaryEntries,
  seedDefaultDictionaryEntries,
  type DictionarySeedStore,
} from './polish/default-dictionary';

export {
  isTransientInferenceProviderError,
  TransientInferenceProviderError,
} from './inference/inference-client';
export type { InferenceClient, InferenceClientResult } from './inference/inference-client';
export {
  createOpenAiInferenceClient,
  type OpenAiInferenceClientContext,
} from './providers/openai/inference-client';
export { createSessionOutputService } from './outputs/session-output-service';
export type { SessionOutputService, SessionOutputStore } from './outputs/session-output-service';
