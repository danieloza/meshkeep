CREATE TABLE `file_texts` (
	`file_id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`path` text NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`indexed_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `file_texts_project_idx` ON `file_texts` (`project_id`);