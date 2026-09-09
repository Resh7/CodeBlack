CREATE TABLE `application_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`value_json` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_by` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `job_definitions` (
	`id` text PRIMARY KEY NOT NULL,
	`job_name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`pre_validation` text DEFAULT '' NOT NULL,
	`post_validation` text DEFAULT '' NOT NULL,
	`comment` text DEFAULT '' NOT NULL,
	`pre_instructions` text DEFAULT '' NOT NULL,
	`post_instructions` text DEFAULT '' NOT NULL,
	`raw_json` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`source_import_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `job_definitions_name_idx` ON `job_definitions` (`job_name`);--> statement-breakpoint
CREATE INDEX `job_definitions_source_idx` ON `job_definitions` (`source_import_id`);--> statement-breakpoint
CREATE TABLE `validation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`job_name` text NOT NULL,
	`phase` text NOT NULL,
	`status` text NOT NULL,
	`result_count` integer,
	`message` text NOT NULL,
	`executed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`executed_by` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `validation_runs_job_idx` ON `validation_runs` (`job_id`,`executed_at`);--> statement-breakpoint
CREATE TABLE `workbook_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`filename` text NOT NULL,
	`object_key` text NOT NULL,
	`content_type` text NOT NULL,
	`uploaded_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`uploaded_by` text NOT NULL,
	`status` text NOT NULL,
	`sheet_count` integer DEFAULT 0 NOT NULL,
	`row_count` integer DEFAULT 0 NOT NULL,
	`column_count` integer DEFAULT 0 NOT NULL,
	`sheets_json` text DEFAULT '[]' NOT NULL,
	`columns_json` text DEFAULT '[]' NOT NULL,
	`changes_json` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `workbook_imports_uploaded_at_idx` ON `workbook_imports` (`uploaded_at`);