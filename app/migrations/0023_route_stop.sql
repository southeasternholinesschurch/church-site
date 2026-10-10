-- The order a bus route is driven in, so Calling and the bus attendance list
-- read house by house instead of alphabetically.
--
-- A plain number the caller types (1, 2, 3 - or 10, 20, 30 to leave room).
-- Brothers and sisters at one house share a number and stay together. NULL is
-- "not placed yet": those children sort to the bottom of their route, where a
-- new family is easy to spot. It means nothing off a route, and changing a
-- child's route clears it (child/[id].astro), because stop 4 on one route is
-- not stop 4 on another.
ALTER TABLE `kid_profiles` ADD `route_stop` integer;
