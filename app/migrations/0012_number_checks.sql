-- What Twilio Lookup said about each number, so the answer is kept rather than
-- re-bought every time somebody wonders.
--
-- line_type is the useful column: a landline cannot receive SMS at all, which
-- is the likeliest meaning of error 30005 and exactly what a number copied from
-- a printed directory turns out to be.
ALTER TABLE `people` ADD `phone_line_type` text;
--> statement-breakpoint
ALTER TABLE `people` ADD `phone_carrier` text;
--> statement-breakpoint
ALTER TABLE `people` ADD `phone_checked_at` text;
