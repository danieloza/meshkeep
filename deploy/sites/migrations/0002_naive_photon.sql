CREATE TABLE `sync_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`member_id` text NOT NULL,
	`label` text NOT NULL,
	`expires_at` integer NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sync_tokens_token_hash_uq` ON `sync_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sync_tokens_member_idx` ON `sync_tokens` (`member_id`);--> statement-breakpoint
CREATE INDEX `sync_tokens_expires_idx` ON `sync_tokens` (`expires_at`);