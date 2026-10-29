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
