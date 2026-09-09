CREATE TABLE `groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `groups_name_unique` ON `groups` (`name`);--> statement-breakpoint
CREATE TABLE `message_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`person_id` integer,
	`phone_e164` text NOT NULL,
	`body` text NOT NULL,
	`direction` text NOT NULL,
	`twilio_sid` text,
	`status` text,
	`error_code` text,
	`segments` integer DEFAULT 1 NOT NULL,
	`scheduled_message_id` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`scheduled_message_id`) REFERENCES `scheduled_messages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `message_log_person_idx` ON `message_log` (`person_id`);--> statement-breakpoint
CREATE INDEX `message_log_created_idx` ON `message_log` (`created_at`);--> statement-breakpoint
CREATE INDEX `message_log_sid_idx` ON `message_log` (`twilio_sid`);--> statement-breakpoint
CREATE TABLE `people_groups` (
	`person_id` integer NOT NULL,
	`group_id` integer NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `people_groups_group_idx` ON `people_groups` (`group_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `people_groups_pair` ON `people_groups` (`person_id`,`group_id`);--> statement-breakpoint
CREATE TABLE `scheduled_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_key` text,
	`source` text DEFAULT 'sheet' NOT NULL,
	`body` text NOT NULL,
	`group_id` integer,
	`send_at` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`sent_at` text,
	`note` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scheduled_messages_source_key_unique` ON `scheduled_messages` (`source_key`);--> statement-breakpoint
CREATE INDEX `scheduled_due_idx` ON `scheduled_messages` (`status`,`send_at`);--> statement-breakpoint
ALTER TABLE `people` ADD `phone_e164` text;--> statement-breakpoint
ALTER TABLE `people` ADD `sms_consent` text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `people` ADD `sms_consent_source` text;--> statement-breakpoint
ALTER TABLE `people` ADD `sms_consent_at` text;