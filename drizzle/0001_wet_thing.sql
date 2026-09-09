ALTER TABLE `job_definitions` ADD `definition_kind` text DEFAULT 'VALIDATION' NOT NULL;--> statement-breakpoint
ALTER TABLE `workbook_imports` ADD `import_kind` text DEFAULT 'VALIDATION' NOT NULL;