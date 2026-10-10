CREATE TABLE `batch_source_ranges` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`timeline_region_id` text,
	`sequence` integer NOT NULL,
	`source_start_ms` integer NOT NULL,
	`source_end_ms` integer NOT NULL,
	`derived_start_ms` integer NOT NULL,
	`derived_end_ms` integer NOT NULL,
	`reason` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `batch_transcripts` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`provider` text NOT NULL,
	`model` text,
	`text` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `dictionary_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`term` text NOT NULL,
	`hint` text,
	`enabled` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `polish_rule_presets` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`body` text NOT NULL,
	`body_hash` text NOT NULL,
	`is_builtin` integer NOT NULL,
	`sort_order` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `provider_usage_events` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`operation_kind` text NOT NULL,
	`related_entity_kind` text NOT NULL,
	`related_entity_id` text NOT NULL,
	`provider` text NOT NULL,
	`model` text,
	`billing_mode` text NOT NULL,
	`audio_duration_ms` integer,
	`billable_duration_ms` integer,
	`input_tokens` integer,
	`cached_input_tokens` integer,
	`output_tokens` integer,
	`estimated_cost_usd_micros` integer DEFAULT 0 NOT NULL,
	`cost_source` text DEFAULT 'none' NOT NULL,
	`pricing_catalog_provider_id` text,
	`pricing_catalog_model_id` text,
	`provider_request_id` text,
	`provider_response_json` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `recording_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`duration_ms` integer,
	`raw_audio_path` text NOT NULL,
	`transcription_provider_id` text,
	`transcription_model` text,
	`status` text NOT NULL,
	`selected_output_id` text,
	`error_message` text
);
--> statement-breakpoint
CREATE TABLE `session_outputs` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`kind` text NOT NULL,
	`text` text NOT NULL,
	`source_output_id` text,
	`provider` text,
	`model` text,
	`rule_preset_id` text,
	`rule_preset_hash` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `timeline_regions` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`kind` text NOT NULL,
	`start_ms` integer NOT NULL,
	`end_ms` integer NOT NULL,
	`confidence` integer,
	`created_live` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `transcription_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`status` text NOT NULL,
	`source_duration_ms` integer NOT NULL,
	`derived_audio_duration_ms` integer NOT NULL,
	`created_live` integer NOT NULL,
	`derived_audio_path` text,
	`created_at` integer NOT NULL,
	`transcription_attempts` integer NOT NULL,
	`transcription_started_at` integer,
	`transcribed_at` integer,
	`error_message` text
);
