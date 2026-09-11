-- Fairhaven Bucks: the ledger, and the cards children carry.
--
-- Play money. No cash value, no relationship to real currency, and nothing in
-- this feature ever touches a payment detail.
--
-- A LEDGER, NEVER A BALANCE. Every award, every spend and every attendance
-- credit is a row, and a child's balance is SUM(delta) over their rows. A
-- mutable balance column would be wrong in three separate ways: two teachers
-- awarding at once would lose one of the writes, a child who says "I had
-- more than that" could not be answered, and a mistake could not be undone
-- without inventing a number to overwrite it with.
--
-- The cost is a SUM on every read. At seventy children with a handful of rows
-- each that is nothing, and it stays nothing for years.
CREATE TABLE `kid_ledger` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`person_id` integer NOT NULL,
	-- SIGNED. Awards and attendance credits are positive, spending is
	-- negative, and a correction is whichever direction puts it right. One
	-- column rather than separate credit/debit columns, because a balance is
	-- then a sum rather than a subtraction somebody can get backwards.
	`delta` integer NOT NULL,
	-- 'attendance' — the automatic credit for being present
	-- 'award'      — a teacher gave it for something
	-- 'spend'      — swapped for something at the prize table
	-- 'correction' — putting right a mistake, in either direction
	`reason` text NOT NULL,
	`note` text,
	-- Set for an attendance credit, so the credit can be traced to the meeting
	-- that earned it — and so the index below has something to be unique on.
	`service_id` integer,
	-- Who did it. NULL when the kiosk did it rather than a person.
	`staff_id` integer,
	-- Release two, when the kiosk exists. Declared now so the column does not
	-- have to be added to a table that already has rows in it.
	`kiosk_device_id` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `kid_ledger_person_idx` ON `kid_ledger` (`person_id`);
--> statement-breakpoint

-- ONE attendance credit per child per meeting, enforced by the DATABASE.
--
-- This is the whole reason the automatic credit needs no application-level
-- locking. A child who taps a kiosk four times, or who is marked present by a
-- teacher after already scanning in, gets exactly one credit — not because the
-- code remembered to check, but because a second insert cannot exist.
--
-- PARTIAL, so it constrains only the automatic credits. A teacher awarding a
-- child twice in one morning for two different things is not a mistake, and
-- must not be blocked by the guard that stops double-crediting attendance.
--
-- SQLite supports partial indexes; this is why the reason lives in its own
-- column rather than being inferred from whether service_id is set.
CREATE UNIQUE INDEX `kid_ledger_attendance_once`
	ON `kid_ledger` (`person_id`, `service_id`) WHERE `reason` = 'attendance';
--> statement-breakpoint

-- The NFC cards, and the QR printed beside them.
--
-- A TABLE, not a column on the child. Re-issuing a lost card revokes the old
-- token and adds a new row, rather than overwriting — because two live tokens
-- for one child is two credits, and because a card handed to a seven-year-old
-- will end up in a car park and somebody will need to know which one to kill.
CREATE TABLE `kid_cards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`person_id` integer NOT NULL,
	-- Long, random and OPAQUE. It is not derived from the child's id, name or
	-- anything else guessable: a found card must be a meaningless string to
	-- whoever finds it, and meaningless without a session even to somebody who
	-- types it in.
	`token` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`issued_at` text NOT NULL,
	`revoked_at` text,
	-- Who issued it, so an unexpected card can be traced.
	`issued_by` text,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
-- Unique across every card ever issued, revoked ones included. A revoked token
-- must never be handed out again — the point of revoking is that the old card
-- in a car park stops working, and reissuing its number would undo that.
CREATE UNIQUE INDEX `kid_cards_token` ON `kid_cards` (`token`);
--> statement-breakpoint
CREATE INDEX `kid_cards_person_idx` ON `kid_cards` (`person_id`);
