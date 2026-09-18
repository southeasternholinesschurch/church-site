-- Sign-up sheets: a meal train, a volunteer list, a pitch-in.
--
-- ONE MODEL, THREE PRESETS. All three are a list of SLOTS with a capacity that
-- people CLAIM. `kind` decides only how the slots are made and what the public
-- form asks for; everything downstream is written once. Three tables here
-- rather than three features upstairs.
--
-- Two shapes are load-bearing:
--
--   1. Slots are CHILD ROWS, not a JSON column on the sheet — deliberately
--      unlike bulletins.announcements. That JSON is right because a bulletin is
--      only ever read and written whole. A slot is pointed at by sign-ups made
--      concurrently from different phones, so it needs a stable id that
--      survives an edit to the row above it.
--
--   2. UNIQUE (slot_id, seat). Two families being told they both have Tuesday
--      is the one failure this feature cannot have, and counting before
--      inserting does not prevent it: two phones read the same count in the
--      same moment. The database refuses the second row, which is why the
--      application can safely compute a seat and try.

CREATE TABLE `signup_sheets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	-- 16 bytes, 128 bits — the same as a directory invite. The whole security
	-- of the link rests on it. A friendly slug was considered and left out: it
	-- would make sheets guessable, and the link is delivered by text and by the
	-- pew link-tree, where its length costs nothing.
	`token` text NOT NULL,
	`title` text NOT NULL,
	-- The editable paragraph under the heading on the public page.
	`intro` text,
	-- 'meal-train' | 'list' | 'dish'. Plain TEXT with no CHECK, the same
	-- decision services.kind made, so a fourth preset needs no migration.
	`kind` text NOT NULL,
	-- 'draft' | 'open' | 'closed'. A DRAFT IS NOT PUBLIC AT ALL: it renders the
	-- same page as a token that never existed, so a half-built meal train
	-- cannot collect meals from a link somebody pasted early.
	`status` text DEFAULT 'draft' NOT NULL,
	-- YYYY-MM-DD in church time, never a UTC instant. An instant is how the
	-- public site once shipped an off-by-one day.
	`event_date` text,
	`closes_on` text,
	-- Off unless switched on, per sheet. A name is enough by default.
	`ask_headcount` integer DEFAULT 0 NOT NULL,
	-- Staff-editable reminder wording. NULL means the built-in default.
	`reminder_body` text,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `signup_sheets_token_unique` ON `signup_sheets` (`token`);
--> statement-breakpoint
CREATE INDEX `signup_sheets_status_idx` ON `signup_sheets` (`status`);
--> statement-breakpoint

CREATE TABLE `signup_slots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sheet_id` integer NOT NULL,
	`sort` integer NOT NULL,
	`label` text NOT NULL,
	`detail` text,
	-- YYYY-MM-DD for a meal-train day. NULL for a dish or a list, which take
	-- their date from the sheet.
	`on_date` text,
	-- NULL MEANS NO LIMIT. Not zero, and not a large number standing in for
	-- unlimited — both of those read as a cap somebody forgot to set.
	`capacity` integer,
	FOREIGN KEY (`sheet_id`) REFERENCES `signup_sheets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `signup_slots_sheet_idx` ON `signup_slots` (`sheet_id`);
--> statement-breakpoint

CREATE TABLE `signups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sheet_id` integer NOT NULL,
	`slot_id` integer NOT NULL,
	-- 1-based, within the slot. See the unique index at the foot of this file.
	`seat` integer NOT NULL,
	-- Set when the browser carried a member session, so staff can tell a
	-- recognised member from a typed name. NULL for everyone else.
	`person_id` integer,
	-- Always present, even for a member — this is what the sheet displays.
	`name` text NOT NULL,
	`headcount` integer,
	`note` text,
	-- A THIRD TABLE HOLDING A PHONE NUMBER AND A CONSENT DECISION.
	-- lib/consent.ts existed because there were two, and it says so in its own
	-- doc comment. It has been extended to cover this one. Anything added here
	-- that stores a number must be added there too, or a STOP is recorded as
	-- handled while the texts keep arriving.
	`phone_e164` text,
	`sms_consent` text,
	`sms_consent_source` text,
	`sms_consent_at` text,
	`remind` integer DEFAULT 0 NOT NULL,
	-- Staff email when the office added this on somebody's behalf; NULL when
	-- the person did it themselves.
	`created_by` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`sheet_id`) REFERENCES `signup_sheets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`slot_id`) REFERENCES `signup_slots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
-- THE GUARD. Do not weaken it, and do not replace the insert-and-check pattern
-- with count-then-insert: the count is read at one moment and acted on at
-- another, and the gap between them is exactly where two people get Tuesday.
CREATE UNIQUE INDEX `signups_slot_seat` ON `signups` (`slot_id`,`seat`);
--> statement-breakpoint
CREATE INDEX `signups_sheet_idx` ON `signups` (`sheet_id`);
--> statement-breakpoint
CREATE INDEX `signups_slot_idx` ON `signups` (`slot_id`);
--> statement-breakpoint
-- What the STOP handler looks up. Opt-out is matched by NUMBER, never by
-- person — one handset, one decision. See kid_guardians_phone_idx.
CREATE INDEX `signups_phone_idx` ON `signups` (`phone_e164`);
