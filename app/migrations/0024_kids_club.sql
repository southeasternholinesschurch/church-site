-- Who is on the Kids Club list (the Wednesday Fairhaven Kids Club meeting).
--
-- Club is a different crowd from Sunday: almost no bus-route children, nearly
-- all church children, a few others. So its attendance page lists these
-- children instead of a class or route. A child joins by being ticked at a
-- Club meeting from the "not on the list" section, or by the checkbox on their
-- profile; the checkbox is also how they come off it.
ALTER TABLE `kid_profiles` ADD `in_club` integer DEFAULT false NOT NULL;
