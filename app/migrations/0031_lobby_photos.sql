-- Photographs uploaded on the Lobby tab, to join the built-in ones that sit
-- behind the lobby screen's scenes.
--
-- PUBLIC BY DESIGN, like lobby_heroes: shown on the foyer TV and served to it
-- without a session (/api/lobby/photo/{id}). Children's photographs are
-- welcome here (the pastor, 2026-10-22); the editor resizes and re-encodes every
-- upload in the browser, which drops the camera's metadata, location included.
--
-- `face` is where the faces are, as a fraction of the height, so a scene that
-- shows only a strip of the picture can show the people. `uses` is a comma
-- list of the invitations it may sit behind: 'give', 'guest', or empty.
CREATE TABLE `lobby_photos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`image_key` text NOT NULL,
	`alt` text NOT NULL,
	`face` real DEFAULT 0.45 NOT NULL,
	`uses` text DEFAULT '' NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text
);
