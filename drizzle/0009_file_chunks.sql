-- Check existing paths first, before creating any new schema. Diagnose duplicates:
-- SELECT project_id, relative_path, COUNT(*) FROM files GROUP BY project_id,
-- relative_path HAVING COUNT(*) > 1;
CREATE UNIQUE INDEX `files_project_path_uq` ON `files` (`project_id`, `relative_path`);
--> statement-breakpoint
CREATE TABLE `file_chunk_states` (
  `file_id` text PRIMARY KEY NOT NULL REFERENCES `files`(`id`) ON DELETE cascade,
  `project_id` text NOT NULL,
  `file_sha` text NOT NULL,
  `extractor_version` text NOT NULL,
  `status` text NOT NULL CONSTRAINT `file_chunk_states_status_check` CHECK (`status` IN ('indexing', 'indexed', 'unsupported', 'failed')),
  `attempts` integer NOT NULL,
  `lease_id` text,
  `claimed_at` integer NOT NULL,
  `chunk_count` integer NOT NULL,
  `reason` text,
  `indexed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `file_chunk_states_project_file_idx` ON `file_chunk_states` (`project_id`, `file_id`);
--> statement-breakpoint
CREATE TABLE `file_chunks` (
  `file_id` text NOT NULL REFERENCES `files`(`id`) ON DELETE cascade,
  `project_id` text NOT NULL,
  `path` text NOT NULL,
  `ordinal` integer NOT NULL,
  `chunk_key` text NOT NULL,
  `start_char` integer NOT NULL,
  `end_char` integer NOT NULL,
  `content` text NOT NULL,
  `label` text NOT NULL,
  `place` text NOT NULL,
  `heading` text NOT NULL,
  `header_cut` integer NOT NULL,
  PRIMARY KEY (`file_id`, `ordinal`)
);
--> statement-breakpoint
CREATE INDEX `file_chunks_project_file_idx` ON `file_chunks` (`project_id`, `file_id`);
--> statement-breakpoint
CREATE INDEX `file_chunks_chunk_key_idx` ON `file_chunks` (`chunk_key`);
--> statement-breakpoint
-- This is a rowid table: FTS5 uses its implicit SQLite rowid.
CREATE VIRTUAL TABLE `file_chunks_fts` USING fts5(path, label, content, content='file_chunks', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2');
--> statement-breakpoint
CREATE TRIGGER `file_chunks_fts_ai` AFTER INSERT ON `file_chunks` BEGIN
  INSERT INTO `file_chunks_fts` (rowid, path, label, content) VALUES (new.rowid, new.path, new.label, new.content);
END;
--> statement-breakpoint
CREATE TRIGGER `file_chunks_fts_ad` AFTER DELETE ON `file_chunks` BEGIN
  INSERT INTO `file_chunks_fts` (`file_chunks_fts`, rowid, path, label, content) VALUES ('delete', old.rowid, old.path, old.label, old.content);
END;
--> statement-breakpoint
CREATE TRIGGER `file_chunks_fts_au` AFTER UPDATE ON `file_chunks` BEGIN
  INSERT INTO `file_chunks_fts` (`file_chunks_fts`, rowid, path, label, content) VALUES ('delete', old.rowid, old.path, old.label, old.content);
  INSERT INTO `file_chunks_fts` (rowid, path, label, content) VALUES (new.rowid, new.path, new.label, new.content);
END;
