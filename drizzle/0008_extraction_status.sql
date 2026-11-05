-- What became of each file's text: indexed, none by design (`unsupported`), or
-- a failed read that is retried up to a limit. Before this, a failed read was
-- stored as empty text and never tried again.
ALTER TABLE `file_texts` ADD `status` text DEFAULT 'indexed' NOT NULL;--> statement-breakpoint
ALTER TABLE `file_texts` ADD `reason` text;--> statement-breakpoint
ALTER TABLE `file_texts` ADD `attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- An existing row with no text cannot say whether the file is empty, has no
-- text by design, or failed to read. Each one is read once more, by the next
-- indexing round of its project, which records what it finds. Nothing is
-- removed.
UPDATE `file_texts` SET `status` = 'failed', `attempts` = 0 WHERE `content` = '';
