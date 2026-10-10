-- Which group a volunteer takes attendance for, remembered per account.
--
-- A teacher picks their class once and a bus captain picks their route once;
-- after that the attendance page opens on it. Stored as one short string -
-- 'all', 'class:3' or 'route:2' - because it is a PREFERENCE, not a
-- relationship: a class or route that is later removed should quietly fall
-- back to the picker, not block a delete.
--
-- A TABLE OF ITS OWN, not a column on `staff`, deliberately. Sign-in reads the
-- whole staff row (findActiveStaff selects every column), so a new staff column
-- that the deployed code knows about and the database does not yet have would
-- fail every login - and migrations here are applied by hand, after or before
-- the deploy depending on who is quicker. A separate table can only ever
-- affect the attendance page, which treats "no table yet" as "no choice yet".
CREATE TABLE `kid_staff_view` (
	`staff_id` integer PRIMARY KEY NOT NULL,
	`view` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE cascade
);
