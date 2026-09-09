-- Scheduled and automated texts.
--
-- Two tables working together, deliberately:
--
--   message_schedules  — the RULE a staff member creates ("every Saturday 6pm",
--                        "on their birthday"). Edited, paused, deleted.
--   scheduled_messages — the per-recipient QUEUE, one row per person per send.
--                        Already existed for the Monday singing reminder; its
--                        unique source_key is what makes double-texting
--                        structurally impossible rather than merely unlikely,
--                        which is why the queue reuses it instead of starting
--                        a second mechanism with its own bugs.
--
-- The rule is expanded into queue rows only when it comes DUE, never in
-- advance. Group membership and phone numbers change; resolving the audience
-- at send time means a schedule made in September still texts the right people
-- in December.

CREATE TABLE `message_schedules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	-- What it is called in the list. Staff-facing only, never texted.
	`name` text NOT NULL,
	-- The message. May contain {first} / {name}, filled per recipient.
	`body` text NOT NULL,
	-- once     — one date and time, then done
	-- weekly   — a weekday and time, every week
	-- birthday — each person on their own birthday, at a set time
	`kind` text DEFAULT 'once' NOT NULL,
	-- NULL means everyone who can be texted. Ignored for birthday, whose
	-- audience is "the person whose birthday it is".
	`group_id` integer,
	-- Local wall-clock in the church's timezone, NOT an instant. 'YYYY-MM-DDTHH:MM'.
	-- Storing the instant would be wrong across a DST boundary: 8am is 8am to
	-- the congregation whatever UTC thinks.
	`send_at` text,
	-- weekly only. 0 = Sunday, matching JS getDay().
	`weekday` integer,
	-- weekly and birthday. 'HH:MM' local.
	`local_time` text,
	`active` integer DEFAULT 1 NOT NULL,
	-- Set when the rule last produced queue rows, so a repeating rule cannot
	-- fire twice in one window and the list can show when it last ran.
	`last_run_at` text,
	`created_by` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `message_schedules_due_idx` ON `message_schedules` (`active`,`kind`);
--> statement-breakpoint
-- Which rule produced this queue row. NULL for the singing reminder, which
-- predates schedules and is generated from the roster sheet instead.
ALTER TABLE `scheduled_messages` ADD `schedule_id` integer REFERENCES `message_schedules`(`id`);
--> statement-breakpoint
-- Resolved at expansion time. The queue must not have to re-derive an audience
-- at send time: a person archived between expansion and send should still show
-- as a row that was skipped, not vanish from the record.
ALTER TABLE `scheduled_messages` ADD `person_id` integer REFERENCES `people`(`id`);
--> statement-breakpoint
ALTER TABLE `scheduled_messages` ADD `phone_e164` text;
--> statement-breakpoint
CREATE INDEX `scheduled_schedule_idx` ON `scheduled_messages` (`schedule_id`);
