CREATE TABLE `bulletins` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`service_date` text NOT NULL,
	`title` text DEFAULT 'Morning Worship' NOT NULL,
	`order_of_service` text DEFAULT '[]' NOT NULL,
	`announcements` text DEFAULT '[]' NOT NULL,
	`scripture` text,
	`scripture_ref` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`published_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bulletins_service_date_unique` ON `bulletins` (`service_date`);--> statement-breakpoint
CREATE INDEX `bulletins_date_idx` ON `bulletins` (`service_date`);