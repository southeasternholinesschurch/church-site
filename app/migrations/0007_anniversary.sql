-- Wedding anniversary, so the directory can carry the two dates a church
-- actually uses. Hand-written: a single nullable column, nothing existing is
-- touched. Same YYYY-MM-DD text format as `birthday` — SQLite has no date
-- type, and matching the neighbouring column beats inventing a second shape.
ALTER TABLE `people` ADD `anniversary` text;
