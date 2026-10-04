-- Which group a volunteer takes attendance for, remembered per account.
--
-- A teacher picks their class once and a bus captain picks their route once;
-- after that the attendance page opens on it. Stored as one short string —
-- 'all', 'class:3' or 'route:2' — rather than two nullable foreign keys,
-- because it is a PREFERENCE, not a relationship: a class or route that is
-- later removed should quietly fall back to the picker, not block a delete.
-- NULL means "has not chosen yet", which is what shows the picker.
ALTER TABLE `staff` ADD `kids_view` text;
