-- "Coming Sunday?" - the answer a family gives on the call the day before.
--
-- The van workers use it to know which houses to drive to. One row per child
-- per WEEK, where the week is named by the Sunday it is for ('2026-10-11').
-- That is the whole reset: next week's Sunday is a different key, so every
-- child is simply unanswered again with nothing to clear and no job to run. Old
-- weeks stay as a record of who said what.
--
-- No row means NOT ASKED, which is a real state and is shown with no colour -
-- not the same as 'no', and never guessed into one.
CREATE TABLE `kid_coming` (
	`person_id` integer NOT NULL,
	`week` text NOT NULL,
	`answer` text NOT NULL,
	`staff_id` integer,
	`updated_at` text NOT NULL,
	PRIMARY KEY (`person_id`, `week`),
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE set null
);
