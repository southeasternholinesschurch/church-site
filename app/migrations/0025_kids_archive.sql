-- Archived from Fairhaven Kids only.
--
-- Archiving a child from the Fairhaven Kids side used to set people.archived, which
-- takes them out of the whole church: the People tab, check-in, the bulletin.
-- A child who stops coming to Fairhaven Kids has usually NOT left the church, so the
-- Fairhaven Kids button now sets this instead. It hides them from every Fairhaven Kids list,
-- register, card check-in and guardian text, and keeps their profile (class,
-- route, allergies, guardians) and all their history for if they come back.
-- people.archived still means "left the church" and still hides them here too.
ALTER TABLE `kid_profiles` ADD `archived` integer DEFAULT false NOT NULL;
