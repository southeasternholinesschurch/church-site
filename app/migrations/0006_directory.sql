-- Member directory: single-use invites, and member sessions kept in their own
-- table rather than sharing the staff one. Hand-written: both are plain
-- CREATE TABLE, and nothing existing is touched.
CREATE TABLE `directory_invites` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`person_id` integer NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` text,
	`created_by` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE UNIQUE INDEX `directory_invites_token_unique` ON `directory_invites` (`token`);--> statement-breakpoint
CREATE INDEX `directory_invites_person_idx` ON `directory_invites` (`person_id`);--> statement-breakpoint
CREATE TABLE `member_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX `member_sessions_person_idx` ON `member_sessions` (`person_id`);
