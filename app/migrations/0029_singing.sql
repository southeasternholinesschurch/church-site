-- The singing schedule, kept here instead of in a Google Sheet.
--
-- ONE ROW PER SUNDAY, TWO CELLS, EXACTLY THE SHAPE OF THE SHEET IT REPLACES:
--
--   Sunday      | Morning                    | Evening
--   2026-10-11  | Ada Aldridge, Erin Thorne  | Youth-led Service
--
-- A cell holds what the pastor typed into the sheet: names separated by commas, or a
-- note ("Fall Revival") where there are no singers. It is parsed by the SAME
-- code that read the sheet (roster.ts), so the bulletin, the Monday reminder and
-- the printed schedule cannot read one Sunday three different ways.
--
-- Text rather than links to `people` on purpose. A guest singer is not in the
-- database, a note is not a person, and a schedule is planned months ahead by
-- someone typing names. The names are matched to people when the reminder goes
-- out, exactly as they were from the sheet — and the editor shows, as you type
-- the quarter in, which names will and will not be reached.
--
-- The first row written here is what moves the bulletin and the reminder off
-- the sheet: an EMPTY table means "still on the sheet", a table with anything
-- in it means "the schedule lives here now". See lib/singing-db.ts.
CREATE TABLE `singing_schedule` (
	`sunday` text PRIMARY KEY NOT NULL,
	`morning` text,
	`evening` text,
	`updated_at` text NOT NULL,
	`updated_by` text
);
