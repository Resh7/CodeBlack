CREATE TABLE `integration_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`display_name` text NOT NULL,
	`environment` text NOT NULL,
	`description` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`non_secret_config_json` text DEFAULT '{}' NOT NULL,
	`secret_reference` text NOT NULL,
	`status` text DEFAULT 'NOT_CONFIGURED' NOT NULL,
	`last_tested_at` text,
	`last_latency_ms` integer,
	`capabilities_json` text DEFAULT '[]' NOT NULL,
	`last_error_category` text,
	`last_diagnostic` text,
	`last_correlation_id` text,
	`config_version` integer DEFAULT 1 NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `integration_connections_type_idx` ON `integration_connections` (`type`);--> statement-breakpoint
CREATE INDEX `integration_connections_status_idx` ON `integration_connections` (`status`);--> statement-breakpoint
ALTER TABLE `validation_runs` ADD `duration_ms` integer;--> statement-breakpoint
ALTER TABLE `validation_runs` ADD `correlation_id` text;