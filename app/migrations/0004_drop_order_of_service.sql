-- the pastor dropped the order of service: nobody was reading it, and the one line
-- that mattered was who is preaching. Written by hand rather than generated,
-- so the preacher can be LIFTED OUT of the order JSON during the rebuild
-- instead of being lost with the column.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_bulletins` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`service_date` text NOT NULL,
	`title` text DEFAULT 'Morning Worship' NOT NULL,
	`preacher` text,
	`announcements` text DEFAULT '[]' NOT NULL,
	`scripture` text,
	`scripture_ref` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`published_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_bulletins`
  (`id`,`service_date`,`title`,`preacher`,`announcements`,`scripture`,`scripture_ref`,
   `status`,`published_at`,`created_at`,`updated_at`)
SELECT
  `id`,`service_date`,`title`,
  -- whoever was against the "Message" line becomes the preacher
  (SELECT json_extract(value,'$.who') FROM json_each(`order_of_service`)
     WHERE lower(json_extract(value,'$.item')) LIKE 'message%'
       AND coalesce(json_extract(value,'$.who'),'') != '' LIMIT 1),
  `announcements`,`scripture`,`scripture_ref`,`status`,`published_at`,`created_at`,`updated_at`
FROM `bulletins`;--> statement-breakpoint
DROP TABLE `bulletins`;--> statement-breakpoint
ALTER TABLE `__new_bulletins` RENAME TO `bulletins`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `bulletins_service_date_unique` ON `bulletins` (`service_date`);--> statement-breakpoint
CREATE INDEX `bulletins_date_idx` ON `bulletins` (`service_date`);
