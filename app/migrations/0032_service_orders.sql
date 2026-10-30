-- Service orders: the running order of one service, printed three to a sheet
-- and cut into slips (the pastor, 2026-10-25). Staff-only; nothing here is public.
--
-- `items` is a JSON list of {title, who, notes}, read and written whole (see
-- lib/service-order.ts). `kind` is 'traditional' or 'custom', for the list page.
CREATE TABLE `service_orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`service_date` text NOT NULL,
	`line` text DEFAULT '' NOT NULL,
	`kind` text DEFAULT 'custom' NOT NULL,
	`items` text DEFAULT '[]' NOT NULL,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text
);
CREATE INDEX `service_orders_date_idx` ON `service_orders` (`service_date`);
