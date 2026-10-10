-- Behaviour notes on a child, written in the moment and read later.
--
-- The case this exists for (the pastor, 2026-09-11): a child misbehaves, the teacher
-- scans their card and types why they are being sent home. Half an hour later a
-- bus worker opens the same child's profile on the way back and reads it, so
-- they can tell the parent at the door what happened. Two different people, two
-- different screens, twenty minutes apart.
--
-- A TABLE, NOT A COLUMN ON kid_profiles. A column would mean the second note of
-- an evening overwrites the first, and two volunteers typing at once means one
-- of them silently loses. Rows also carry their own timestamp, which is the
-- thing that makes a note useful a week later.
--
-- Deliberately separate from kid_profiles.allergies and .medical_notes. Those
-- are standing facts about a child that are true until somebody changes them,
-- and they are shown in red above everything on the classroom screen. A note
-- about one Wednesday evening is not that, and must never be promoted into
-- looking like it.
CREATE TABLE `kid_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`person_id` integer NOT NULL,
	`body` text NOT NULL,
	-- Who wrote it. The id for the link, the name for the record: a note about
	-- a child's behaviour should still say who wrote it after that volunteer has
	-- left and their staff row is gone. Accountability is the point — an
	-- anonymous note about somebody's child is worth less than no note.
	`staff_id` integer,
	`author_name` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
-- Newest first for one child, which is the only way this is ever read.
CREATE INDEX `kid_notes_person_idx` ON `kid_notes` (`person_id`,`id`);
