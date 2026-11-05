-- Several connections per member and for the team. The scope was the primary
-- key, which allowed one connection each; each row now has an id of its own.
-- SQLite cannot change a primary key in place, so the table is rebuilt and
-- every row copied: nothing is deleted. An existing row gets a fresh UUID v4
-- and keeps its key, models and Effort marks; its chat shows all its models
-- (`chat_models` NULL), as before, and it counts as not yet checked.
CREATE TABLE `__new_providers` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`label` text NOT NULL,
	`base_url` text NOT NULL,
	`api_key_ciphertext` text NOT NULL,
	`key_preview` text NOT NULL,
	`models` text DEFAULT '[]' NOT NULL,
	`effort_models` text DEFAULT '[]' NOT NULL,
	`chat_models` text,
	`check_status` text,
	`checked_at` integer,
	`models_fetched_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_providers` ("id", "scope", "label", "base_url", "api_key_ciphertext", "key_preview", "models", "effort_models", "chat_models", "check_status", "checked_at", "models_fetched_at", "created_at", "updated_at")
SELECT
	lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
	"scope", "label", "base_url", "api_key_ciphertext", "key_preview", "models", "effort_models", NULL, NULL, NULL, "models_fetched_at", "created_at", "updated_at"
FROM `providers`;
--> statement-breakpoint
DROP TABLE `providers`;--> statement-breakpoint
ALTER TABLE `__new_providers` RENAME TO `providers`;--> statement-breakpoint
CREATE INDEX `providers_scope_idx` ON `providers` (`scope`);--> statement-breakpoint
ALTER TABLE `usage_events` ADD `provider_id` text;
