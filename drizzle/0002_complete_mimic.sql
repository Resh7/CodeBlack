CREATE TABLE `integration_audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`actor_id` text NOT NULL,
	`environment` text NOT NULL,
	`integration` text NOT NULL,
	`target_id` text NOT NULL,
	`result` text NOT NULL,
	`duration_ms` integer,
	`row_count` integer,
	`correlation_id` text NOT NULL,
	`detail_json` text DEFAULT '{}' NOT NULL,
	`occurred_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `integration_audit_target_idx` ON `integration_audit_events` (`target_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `integration_audit_time_idx` ON `integration_audit_events` (`occurred_at`);