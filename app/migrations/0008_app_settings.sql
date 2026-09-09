-- A small key/value store for things staff can change without a deploy.
--
-- Hand-written: one table, nothing existing is touched. Deliberately generic
-- rather than a column per setting — the alternative is a migration every time
-- somebody wants to reword a sentence, which is how a setting ends up
-- hard-coded instead.
CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text
);
