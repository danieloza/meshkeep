CREATE TABLE `chat_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`project_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`client_request_id` text NOT NULL,
	`model` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`reserved_input_tokens` integer NOT NULL,
	`reserved_output_tokens` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_runs_member_request_uq` ON `chat_runs` (`member_id`,`client_request_id`);--> statement-breakpoint
CREATE INDEX `chat_runs_member_status_idx` ON `chat_runs` (`member_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `chat_runs_status_created_idx` ON `chat_runs` (`status`,`created_at`);