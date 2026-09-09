-- Someone who texts START from an unknown number is created on the spot, with
-- no name. Written by hand: drizzle-kit wants an interactive answer about
-- column changes, and ADD COLUMN is non-destructive and unambiguous.
ALTER TABLE `people` ADD `needs_profile` integer DEFAULT false NOT NULL;
