CREATE TABLE `attendance` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`service_id` integer NOT NULL,
	`person_id` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `attendance_service_idx` ON `attendance` (`service_id`);--> statement-breakpoint
CREATE INDEX `attendance_person_idx` ON `attendance` (`person_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `attendance_service_person` ON `attendance` (`service_id`,`person_id`);--> statement-breakpoint
CREATE TABLE `people` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`breeze_id` integer,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`phone` text,
	`email` text,
	`address_street` text,
	`address_city` text,
	`address_state` text,
	`address_zip` text,
	`photo_key` text,
	`birthday` text,
	`notes` text,
	`adult_child` text DEFAULT 'unknown' NOT NULL,
	`include_in_directory` integer DEFAULT false NOT NULL,
	`directory_status` text DEFAULT 'none' NOT NULL,
	`family_id` integer,
	`added_on` text,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `people_breeze_id_unique` ON `people` (`breeze_id`);--> statement-breakpoint
CREATE INDEX `people_name_idx` ON `people` (`last_name`,`first_name`);--> statement-breakpoint
CREATE INDEX `people_archived_idx` ON `people` (`archived`);--> statement-breakpoint
CREATE TABLE `services` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`kind` text NOT NULL,
	`label` text,
	`notes` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `services_date_idx` ON `services` (`date`);--> statement-breakpoint
CREATE UNIQUE INDEX `services_date_kind` ON `services` (`date`,`kind`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`staff_id` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_staff_idx` ON `sessions` (`staff_id`);--> statement-breakpoint
CREATE TABLE `staff` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`name` text,
	`role` text DEFAULT 'editor' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`last_login_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `staff_email_unique` ON `staff` (`email`);--> statement-breakpoint
CREATE TABLE `visitors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`service_id` integer NOT NULL,
	`name` text,
	`adult_child` text DEFAULT 'adult' NOT NULL,
	`first_time` integer DEFAULT false NOT NULL,
	`became_person_id` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`became_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `visitors_service_idx` ON `visitors` (`service_id`);