-- Fairhaven Kids: children, their guardians, the five classes, and the bus routes.
--
-- Release one of the children's-ministry section. Deliberately does NOT create
-- kid_ledger, kid_cards or kiosk_devices — those are release two, and a table
-- that exists before anything writes to it is a schema decision made without
-- the benefit of the screen that would have argued with it.
--
-- Three shapes here are load-bearing:
--
--   1. Children stay in `people`. They are already there, with adult_child =
--      'child', and attendance/photos/archiving all hang off that row. This
--      migration adds what is TRUE OF A CHILD (class, allergies, route) beside
--      it rather than duplicating the person.
--
--   2. Guardians are NOT `people`. Most bus-ministry parents are not members,
--      and creating adult person rows for them would put them in the
--      congregation's people list, the messaging audience counts and the
--      attendance statistics. member_person_id links through for the case
--      where a guardian IS a member, so their details stay in sync with the
--      directory instead of being copied and going stale.
--
--   3. Routes are a TABLE, not a column. The brief proposed `bus_route text`,
--      but a bus captain's send rights are scoped BY ROUTE and the release
--      criteria require proving a captain cannot reach a route they are not
--      assigned to by submitting its id. A free-text string is not a
--      permission key: "Route 2", "route 2" and "Rte 2" are three routes to a
--      string comparison and one route to a human.

-- The five age groups. Fixed by age, and settled with the pastor 2026-09-08.
CREATE TABLE `kid_classes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	-- Editable. Seeded as "Ages 4-6" but the director may well rename these to
	-- whatever the church actually calls them from the platform.
	`name` text NOT NULL,
	`description` text,
	-- The age bounds as NUMBERS, not parsed back out of the name.
	--
	-- This is what lets a child's profile show "should probably be in Ages 7-9"
	-- when their birthday is on file. Class is stored EXPLICITLY on the profile
	-- and never derived: people.birthday is sparse (13 of 120 in the Breeze
	-- import had one) and bus-ministry children mostly have none at all, so
	-- deriving would silently file every child without a birthday into nothing.
	-- A suggestion a person confirms is right; an assumption is not.
	`min_age` integer,
	`max_age` integer,
	-- Youngest first, so the register list is in the order a person expects.
	`sort` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kid_classes_name` ON `kid_classes` (`name`);
--> statement-breakpoint

-- Bus routes. Not seeded: nobody has told us what they are called, and an
-- invented "Route 1" would be indistinguishable from a real one once a child
-- had been assigned to it.
CREATE TABLE `kid_routes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	-- Free text for the captain's own notes: which streets, where it turns.
	`notes` text,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kid_routes_name` ON `kid_routes` (`name`);
--> statement-breakpoint

-- What is true of a child, beside their `people` row.
CREATE TABLE `kid_profiles` (
	-- The person IS the key. One profile per child, and it cannot drift from
	-- the person record because it cannot exist without one.
	`person_id` integer PRIMARY KEY NOT NULL,
	`class_id` integer,
	-- NULL is the NORMAL case, not a gap to be filled: most children walk in
	-- with their family. Only bus-ministry children have a route.
	`route_id` integer,
	-- Its own column, deliberately, rather than a line in people.notes. This is
	-- the field a volunteer needs to find in four seconds while holding a
	-- biscuit tin, and notes is where things go to be scrolled past.
	`allergies` text,
	`medical_notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`class_id`) REFERENCES `kid_classes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`route_id`) REFERENCES `kid_routes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `kid_profiles_class_idx` ON `kid_profiles` (`class_id`);
--> statement-breakpoint
CREATE INDEX `kid_profiles_route_idx` ON `kid_profiles` (`route_id`);
--> statement-breakpoint

-- A child's grown-ups.
CREATE TABLE `kid_guardians` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	-- The CHILD, not the guardian. A guardian row belongs to one child; a
	-- parent of three children has three rows, which is the right trade at this
	-- scale — it keeps "who do I ring about Malachi" a single lookup.
	`person_id` integer NOT NULL,
	`name` text NOT NULL,
	-- 'mother', 'grandmother', 'aunt'. Free text on purpose: family shapes do
	-- not fit an enum, and guessing wrong in a dropdown is worse than a blank.
	`relationship` text,
	-- Same pair as people: what a human typed, and what Twilio needs. Never
	-- normalise in place — a failed normalisation silently corrupts a real
	-- number, and staff read the formatting they recognise.
	`phone` text,
	`phone_e164` text,
	`email` text,
	`address_street` text,
	`address_city` text,
	`address_state` text,
	`address_zip` text,
	-- Set when this guardian IS a member, so contact details stay in sync with
	-- the directory rather than being copied and going stale.
	--
	-- IT IS ALSO THE DOUBLE-TEXT GUARD. A parent who is a member exists in both
	-- tables; without deciding, in ONE place, which record is texted, they
	-- receive every bus message twice. A parent getting doubles is the kind of
	-- bug that gets the whole system switched off. See §7.2 of the brief before
	-- writing the kids audience builder.
	`member_person_id` integer,
	`is_primary` integer DEFAULT 0 NOT NULL,
	-- Mirrors people.sms_consent exactly, and that duplication is the price of
	-- keeping bus families out of the congregation's people list.
	--
	-- THE PRICE IS ONLY WORTH PAYING IF STOP SPANS BOTH TABLES. The webhook
	-- today updates `people` and nothing else, so a parent whose number exists
	-- only here could text STOP, have it logged as handled, and keep receiving
	-- texts indefinitely. Nothing may send to these rows until that is fixed
	-- and tested end to end from a guardian-only number.
	`sms_consent` text DEFAULT 'unknown' NOT NULL,
	-- 'verbal-at-intake', 'sms-start', 'sms-stop'. the pastor's answer to §10.7:
	-- consent is gathered verbally and by the family texting START, so the
	-- system needs somewhere to hold which of those it was, and when.
	`sms_consent_source` text,
	`sms_consent_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `kid_guardians_person_idx` ON `kid_guardians` (`person_id`);
--> statement-breakpoint
-- The index the STOP handler will need. Opt-out is matched by NUMBER, never by
-- person — one handset, one decision — so this is looked up on every inbound
-- STOP across every table holding an E.164 number.
CREATE INDEX `kid_guardians_phone_idx` ON `kid_guardians` (`phone_e164`);
--> statement-breakpoint

-- Who teaches what. For reports and for "your class" on a teacher's phone.
-- NOT a restriction: every Fairhaven Kids volunteer can see every child, which is
-- the pastor's decision and reasonable at seventy children and ten volunteers.
CREATE TABLE `kid_class_teachers` (
	`staff_id` integer NOT NULL,
	`class_id` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`class_id`) REFERENCES `kid_classes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kid_class_teachers_pair` ON `kid_class_teachers` (`staff_id`,`class_id`);
--> statement-breakpoint

-- Which class a child was in, on the attendance row that already exists.
--
-- EXTENDING attendance rather than creating a second table is the whole point.
-- A child is marked present two ways — the kiosk on arrival, and a teacher in
-- class — and two tables would mean two numbers that disagree with no way to
-- explain why. Kiosk scan creates the row with class_id NULL ("arrived at
-- church"); the teacher's register sets class_id on that SAME row ("was in
-- Miss Karen's class").
--
-- The existing unique(service_id, person_id) then does real work: a child who
-- taps four times gets one row, so the Fairhaven Bucks credit in release two fires
-- exactly once with no application-level locking. Do not weaken it.
--
-- Nullable, and null for every attendance row that already exists — the whole
-- congregation's history, none of which was a children's class.
ALTER TABLE `attendance` ADD `class_id` integer REFERENCES `kid_classes`(`id`);
--> statement-breakpoint
CREATE INDEX `attendance_class_idx` ON `attendance` (`class_id`);
--> statement-breakpoint

-- The five classes. Seeded rather than left to the director because they are
-- DECIDED and fixed by age (the pastor, 2026-09-08), and an empty classes screen on
-- day one is a worse first impression than five rows he can rename.
--
-- OR IGNORE against the unique name, so re-running this against a database
-- where somebody has already added them is a no-op rather than a failure.
INSERT OR IGNORE INTO `kid_classes` (`name`, `description`, `min_age`, `max_age`, `sort`, `active`, `created_at`)
VALUES
	('Ages 1-3',   'Nursery and toddlers',        1,  3, 1, 1, datetime('now')),
	('Ages 4-6',   'Pre-school and early school', 4,  6, 2, 1, datetime('now')),
	('Ages 7-9',   NULL,                          7,  9, 3, 1, datetime('now')),
	('Ages 10-12', NULL,                         10, 12, 4, 1, datetime('now')),
	-- Teens, technically. the pastor is content for them to live in the Fairhaven Kids
	-- dashboard rather than have a section of their own.
	('Ages 13-21', 'Teens',                      13, 21, 5, 1, datetime('now'));
