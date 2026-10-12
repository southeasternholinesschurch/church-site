-- Pastoral care: the care log, the follow-up list, and guest cards.
--
-- THREE TABLES, AND THE SPLIT BETWEEN THE LAST TWO IS THE DESIGN.
--
--   guest_cards  - what a visitor told us, from the card on the public site.
--                  Kept as they wrote it: a record, not a workflow.
--   care_items   - the FOLLOW-UP LIST. Something that needs doing for somebody
--                  by a date: a regular who has stopped coming, a guest card
--                  that has arrived, a reminder a pastor set ("visit again in
--                  two weeks"). An item is opened, and it is closed.
--   care_notes   - the CARE LOG. What actually happened: a visit, a call, a
--                  card. Dated, signed, and kept.
--
-- An item is the question and a note is the answer. Closing an item never
-- deletes anything, and the history of a person's care is read from the notes,
-- which is why closing a follow-up with a reason writes that reason as a note.
--
-- None of this is reachable by a volunteer. /care is admin-only in
-- lib/permissions.ts, for the same reason people.notes is not where pastoral
-- detail belongs: the People page is open to everybody who takes attendance.

CREATE TABLE `guest_cards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text,
	-- What they typed, and the textable form beside it — the same pair as
	-- `people`, for the same reason.
	`phone` text,
	`phone_e164` text,
	`email` text,
	-- 'here'     - filled in at church, from the pew card (/welcome)
	-- 'planning' - from Plan Your Visit, before they have come (/visit)
	`kind` text DEFAULT 'here' NOT NULL,
	-- YYYY-MM-DD in church time: the day they came, or the day they plan to.
	`visit_date` text,
	`first_time` integer DEFAULT false NOT NULL,
	-- JSON array of what they asked for: 'visit', 'call', 'kids', 'faith'.
	-- Read and written whole, so JSON rather than child rows.
	`wants` text DEFAULT '[]' NOT NULL,
	`message` text,
	-- "Who's coming with you?" on a planned visit. Free text: a family is not
	-- a number of adults and a number of children.
	`party` text,
	`heard_from` text,
	-- A FOURTH TABLE HOLDING A PHONE NUMBER AND A CONSENT DECISION.
	-- lib/consent.ts has been extended to cover it in this same change: a STOP
	-- reaches these rows like every other. The tick-box on the card IS the
	-- consent wording; unticked, nothing is stored here.
	`sms_consent` text,
	`sms_consent_source` text,
	`sms_consent_at` text,
	-- Set when the card is turned into a person on the People list.
	`person_id` integer,
	-- A daily-peppered hash of the sender's address, used ONLY to count how many
	-- cards one connection sends in an hour. Never the address itself.
	`ip_hash` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `guest_cards_created_idx` ON `guest_cards` (`created_at`);
--> statement-breakpoint
-- What the STOP handler looks up. Opt-out is matched by NUMBER, never by person.
CREATE INDEX `guest_cards_phone_idx` ON `guest_cards` (`phone_e164`);
--> statement-breakpoint
CREATE INDEX `guest_cards_ip_idx` ON `guest_cards` (`ip_hash`, `created_at`);
--> statement-breakpoint

CREATE TABLE `care_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	-- Exactly one of these two is set. A guest who is later added to People
	-- gets person_id as well, so their history follows them.
	`person_id` integer,
	`guest_id` integer,
	-- 'missing' | 'guest' | 'reminder'. Plain TEXT with no CHECK, the same
	-- decision services.kind made, so a fourth source needs no migration.
	`kind` text NOT NULL,
	`reason` text NOT NULL,
	-- YYYY-MM-DD in church time. An item due in the future is "coming up" and
	-- stays off the list until then — which is all a snooze is.
	`due_on` text NOT NULL,
	-- THE GUARD against a second item for the same thing, the same shape as
	-- scheduled_messages.source_key. A regular who has stopped coming is
	-- 'missing:{person}:{last date seen}', so the list can be recomputed on
	-- every visit to the page without ever adding them twice — and if they come
	-- back and later stop again, the date differs and they are listed again.
	`source_key` text,
	-- Who has said they will take it. Optional: with one pastor it is noise.
	`assigned_staff_id` integer,
	`status` text DEFAULT 'open' NOT NULL,
	`resolution` text,
	`resolved_at` text,
	`resolved_by` text,
	`created_by` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`guest_id`) REFERENCES `guest_cards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assigned_staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `care_items_source_key_unique` ON `care_items` (`source_key`);
--> statement-breakpoint
CREATE INDEX `care_items_open_idx` ON `care_items` (`status`, `due_on`);
--> statement-breakpoint
CREATE INDEX `care_items_person_idx` ON `care_items` (`person_id`);
--> statement-breakpoint
CREATE INDEX `care_items_guest_idx` ON `care_items` (`guest_id`);
--> statement-breakpoint

CREATE TABLE `care_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`person_id` integer,
	`guest_id` integer,
	-- 'visit' | 'hospital' | 'call' | 'text' | 'card' | 'note'
	`kind` text NOT NULL,
	`body` text,
	-- The day it HAPPENED, which is not always the day it was written down: a
	-- Saturday hospital visit is usually typed up on Monday.
	`on_date` text NOT NULL,
	`staff_id` integer,
	-- Captured at the time, like kid_notes: a note should not become anonymous
	-- when somebody leaves the staff list.
	`author_name` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`guest_id`) REFERENCES `guest_cards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `care_notes_person_idx` ON `care_notes` (`person_id`, `on_date`);
--> statement-breakpoint
CREATE INDEX `care_notes_guest_idx` ON `care_notes` (`guest_id`);
--> statement-breakpoint
CREATE INDEX `care_notes_created_idx` ON `care_notes` (`created_at`);
