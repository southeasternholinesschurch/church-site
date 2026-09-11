-- Who may text a bus route.
--
-- Sending is a CAPABILITY, not a role. Some bus captains send; most volunteers
-- never do; the children's director sends to anyone. Expressing that as two more
-- roles would multiply the permission matrix for no gain — a "captain" is a
-- volunteer who happens to have been trusted with the phone bill, not a
-- different kind of person in the app.
--
-- So: a flag on the staff record, plus the routes that person is assigned to.
ALTER TABLE `staff` ADD `kids_can_text` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint

-- Which routes a captain may text.
--
-- THE AUDIENCE IS DERIVED FROM THIS, NEVER FROM THE FORM. A captain who edits a
-- route id in the browser must reach nobody new — that is a release requirement
-- and it is the reason routes became a table rather than free text on a child.
--
-- The director is deliberately absent from this table: they may text any route,
-- and enumerating every route against them would be a list to keep in step with
-- reality forever.
CREATE TABLE `kid_route_captains` (
	`staff_id` integer NOT NULL,
	`route_id` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`route_id`) REFERENCES `kid_routes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kid_route_captains_pair` ON `kid_route_captains` (`staff_id`,`route_id`);
