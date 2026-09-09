PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_visitors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`service_id` integer NOT NULL,
	`name` text,
	`adult_child` text DEFAULT 'unknown' NOT NULL,
	`first_time` integer DEFAULT false NOT NULL,
	`became_person_id` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`became_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_visitors`("id", "service_id", "name", "adult_child", "first_time", "became_person_id", "created_at") SELECT "id", "service_id", "name", "adult_child", "first_time", "became_person_id", "created_at" FROM `visitors`;--> statement-breakpoint
DROP TABLE `visitors`;--> statement-breakpoint
ALTER TABLE `__new_visitors` RENAME TO `visitors`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `visitors_service_idx` ON `visitors` (`service_id`);