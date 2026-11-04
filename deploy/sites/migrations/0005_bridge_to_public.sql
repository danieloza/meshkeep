-- One-time bridge for the MeshKeep database on OpenAI Sites.
-- That database was migrated with the private lineage (0000_odd_havok ..
-- 0004_sanitize_public_demo, possibly 0005_lovely_selene). The public repository
-- has its own lineage (0000_high_mimic .. 0004_model_effort). The difference is
-- only additive, so this adds what the public schema has and the private one
-- lacks. Existing rows are kept; messages are indexed for search.
--
-- providers: the private 0005 stored API keys in plain text (`api_key`); the
-- public schema keeps them encrypted. The table is recreated, so a provider
-- saved there has to be connected again in Settings › Model providers.
DROP TABLE IF EXISTS `providers`;
--> statement-breakpoint
CREATE TABLE `providers` (
	`scope` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`base_url` text NOT NULL,
	`api_key_ciphertext` text NOT NULL,
	`key_preview` text NOT NULL,
	`models` text DEFAULT '[]' NOT NULL,
	`models_fetched_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
-- from public 0001_chat_context_and_instructions
ALTER TABLE `messages` ADD `context_files` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `instructions` text DEFAULT '' NOT NULL;
--> statement-breakpoint
-- from public 0002_file_texts
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
--> statement-breakpoint
-- from public 0003_search_index
-- Full-text search over conversations and file text. Written by hand because
-- drizzle cannot describe FTS5 virtual tables.
--
-- Both indexes are external-content tables: the text stays in `messages` and
-- `file_texts`, and the index stores only what search needs. Triggers keep the
-- index in step with every insert, update and delete, including the rows that
-- ON DELETE CASCADE removes when a conversation, file or project is deleted.
--
-- `remove_diacritics 2` lets "zolw" find "żółw", which matters for Polish text.
CREATE VIRTUAL TABLE `messages_fts` USING fts5(content, content='messages', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2');
--> statement-breakpoint
CREATE TRIGGER `messages_fts_ai` AFTER INSERT ON `messages` BEGIN
  INSERT INTO `messages_fts` (rowid, content) VALUES (new.rowid, new.content);
END;
--> statement-breakpoint
CREATE TRIGGER `messages_fts_ad` AFTER DELETE ON `messages` BEGIN
  INSERT INTO `messages_fts` (`messages_fts`, rowid, content) VALUES ('delete', old.rowid, old.content);
END;
--> statement-breakpoint
CREATE TRIGGER `messages_fts_au` AFTER UPDATE OF content ON `messages` BEGIN
  INSERT INTO `messages_fts` (`messages_fts`, rowid, content) VALUES ('delete', old.rowid, old.content);
  INSERT INTO `messages_fts` (rowid, content) VALUES (new.rowid, new.content);
END;
--> statement-breakpoint
-- Conversations that existed before this migration become searchable at once.
INSERT INTO `messages_fts` (`messages_fts`) VALUES ('rebuild');
--> statement-breakpoint
CREATE VIRTUAL TABLE `file_texts_fts` USING fts5(path, content, content='file_texts', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2');
--> statement-breakpoint
CREATE TRIGGER `file_texts_fts_ai` AFTER INSERT ON `file_texts` BEGIN
  INSERT INTO `file_texts_fts` (rowid, path, content) VALUES (new.rowid, new.path, new.content);
END;
--> statement-breakpoint
CREATE TRIGGER `file_texts_fts_ad` AFTER DELETE ON `file_texts` BEGIN
  INSERT INTO `file_texts_fts` (`file_texts_fts`, rowid, path, content) VALUES ('delete', old.rowid, old.path, old.content);
END;
--> statement-breakpoint
CREATE TRIGGER `file_texts_fts_au` AFTER UPDATE ON `file_texts` BEGIN
  INSERT INTO `file_texts_fts` (`file_texts_fts`, rowid, path, content) VALUES ('delete', old.rowid, old.path, old.content);
  INSERT INTO `file_texts_fts` (rowid, path, content) VALUES (new.rowid, new.path, new.content);
END;
--> statement-breakpoint
-- from public 0004_model_effort
ALTER TABLE `providers` ADD `effort_models` text DEFAULT '[]' NOT NULL;
