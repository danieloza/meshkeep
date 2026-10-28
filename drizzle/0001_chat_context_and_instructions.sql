ALTER TABLE `messages` ADD `context_files` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `instructions` text DEFAULT '' NOT NULL;