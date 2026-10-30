-- Hero frames for the lobby screen: a full-screen graphic the pastor uploads, with
-- three lines of text set in one bottom corner over a vignette.
--
-- PUBLIC BY DESIGN. Everything in a row here is shown on the foyer TV and is
-- served to it without a session (/api/lobby/feed, /api/lobby/hero/{id}). Do
-- not add anything to this table that is not meant for a wall.
--
-- The image lives in R2 (the PHOTOS bucket, under `lobby-hero/`), never in the
-- repo.
--
-- Dates are YYYY-MM-DD in church time and INCLUSIVE. NULL means open-ended.
CREATE TABLE `lobby_heroes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`image_key` text NOT NULL,
	`kicker` text DEFAULT '' NOT NULL,
	`title` text NOT NULL,
	`subtitle` text DEFAULT '' NOT NULL,
	`corner` text DEFAULT 'bottom-right' NOT NULL,
	`tone` text DEFAULT 'dark' NOT NULL,
	`accent` text DEFAULT 'red' NOT NULL,
	`title_style` text DEFAULT 'serif' NOT NULL,
	`shade` integer DEFAULT 70 NOT NULL,
	`starts_on` text,
	`ends_on` text,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text
);
