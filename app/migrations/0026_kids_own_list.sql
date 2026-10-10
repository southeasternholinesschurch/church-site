-- Fairhaven Kids gets its own list of children - PHASE A of docs/kids-separation-plan.md.
--
-- Until now Fairhaven Kids children were rows in `people` (the congregation) with a
-- `kid_profiles` row beside them, so every church page had to remember which
-- children it may show. From here Fairhaven Kids reads only its own tables:
--
--   kids            - the child: who they are + everything kid_profiles held
--   kid_attendance  - Fairhaven Kids registers, separate from the church's attendance
--   kid_guardians, kid_ledger, kid_cards, kid_notes, kid_coming
--                   - rebuilt with kid_id -> kids(id) in place of person_id
--
-- EVERY CHILD KEEPS THEIR ID NUMBER (kids.id = the old people.id), so
-- /kids/child/123 links and the Fairhaven Bucks ledger line up without translation.
--
-- NOTHING IS DELETED HERE. The old tables are renamed legacy_* and left intact,
-- so going back is: rename them back and redeploy the previous code. Phase B
-- (a later migration) drops the legacy tables and removes the Fairhaven Kids-only
-- children from `people`, once this has run for a week.
--
-- Index names stay unique across the database, so each old index is dropped
-- before its table is renamed and recreated on the new table.

-- ---- kids ---------------------------------------------------------------------
CREATE TABLE `kids` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`birthday` text,
	`address_street` text,
	`address_city` text,
	`address_state` text,
	`address_zip` text,
	`photo_key` text,
	`notes` text,
	`class_id` integer,
	`route_id` integer,
	`route_stop` integer,
	`in_club` integer DEFAULT false NOT NULL,
	`allergies` text,
	`medical_notes` text,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`class_id`) REFERENCES `kid_classes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`route_id`) REFERENCES `kid_routes`(`id`) ON UPDATE no action ON DELETE no action
);

-- A child archived on EITHER side (left the church, or only Fairhaven Kids) arrives
-- archived; restoring is one tap on their Fairhaven Kids page.
INSERT INTO `kids` (`id`, `first_name`, `last_name`, `birthday`, `address_street`, `address_city`,
	`address_state`, `address_zip`, `photo_key`, `notes`, `class_id`, `route_id`, `route_stop`,
	`in_club`, `allergies`, `medical_notes`, `archived`, `created_at`, `updated_at`)
SELECT p.`id`, p.`first_name`, p.`last_name`, p.`birthday`, p.`address_street`, p.`address_city`,
	p.`address_state`, p.`address_zip`, p.`photo_key`, p.`notes`, k.`class_id`, k.`route_id`, k.`route_stop`,
	k.`in_club`, k.`allergies`, k.`medical_notes`, (k.`archived` OR p.`archived`), k.`created_at`,
	max(k.`updated_at`, p.`updated_at`)
FROM `kid_profiles` k JOIN `people` p ON p.`id` = k.`person_id`;

CREATE INDEX `kids_name_idx` ON `kids` (`last_name`,`first_name`);
CREATE INDEX `kids_class_idx` ON `kids` (`class_id`);
CREATE INDEX `kids_route_idx` ON `kids` (`route_id`);

DROP INDEX `kid_profiles_class_idx`;
DROP INDEX `kid_profiles_route_idx`;
ALTER TABLE `kid_profiles` RENAME TO `legacy_kid_profiles`;

-- ---- kid_attendance -----------------------------------------------------------
CREATE TABLE `kid_attendance` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`service_id` integer NOT NULL,
	`kid_id` integer NOT NULL,
	`class_id` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`kid_id`) REFERENCES `kids`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`class_id`) REFERENCES `kid_classes`(`id`) ON UPDATE no action ON DELETE no action
);
-- Only Fairhaven Kids meetings, and only children who are in Fairhaven Kids. The church's own
-- `attendance` rows are not touched (Phase B removes the Fairhaven Kids-meeting ones).
INSERT INTO `kid_attendance` (`service_id`, `kid_id`, `class_id`, `created_at`)
SELECT a.`service_id`, a.`person_id`, a.`class_id`, a.`created_at`
FROM `attendance` a JOIN `services` s ON s.`id` = a.`service_id`
WHERE s.`kind` IN ('kids-sunday', 'kids-wednesday')
  AND a.`person_id` IN (SELECT `id` FROM `kids`);
CREATE UNIQUE INDEX `kid_attendance_service_kid` ON `kid_attendance` (`service_id`,`kid_id`);
CREATE INDEX `kid_attendance_service_idx` ON `kid_attendance` (`service_id`);
CREATE INDEX `kid_attendance_class_idx` ON `kid_attendance` (`class_id`);

-- ---- kid_guardians ------------------------------------------------------------
DROP INDEX `kid_guardians_person_idx`;
DROP INDEX `kid_guardians_phone_idx`;
ALTER TABLE `kid_guardians` RENAME TO `legacy_kid_guardians`;
CREATE TABLE `kid_guardians` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kid_id` integer NOT NULL,
	`name` text NOT NULL,
	`relationship` text,
	`phone` text,
	`phone_e164` text,
	`email` text,
	`address_street` text,
	`address_city` text,
	`address_state` text,
	`address_zip` text,
	`member_person_id` integer,
	`is_primary` integer DEFAULT 0 NOT NULL,
	`sms_consent` text DEFAULT 'unknown' NOT NULL,
	`sms_consent_source` text,
	`sms_consent_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`kid_id`) REFERENCES `kids`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
INSERT INTO `kid_guardians` (`id`, `kid_id`, `name`, `relationship`, `phone`, `phone_e164`, `email`,
	`address_street`, `address_city`, `address_state`, `address_zip`, `member_person_id`, `is_primary`,
	`sms_consent`, `sms_consent_source`, `sms_consent_at`, `created_at`, `updated_at`)
SELECT `id`, `person_id`, `name`, `relationship`, `phone`, `phone_e164`, `email`,
	`address_street`, `address_city`, `address_state`, `address_zip`, `member_person_id`, `is_primary`,
	`sms_consent`, `sms_consent_source`, `sms_consent_at`, `created_at`, `updated_at`
FROM `legacy_kid_guardians` WHERE `person_id` IN (SELECT `id` FROM `kids`);
CREATE INDEX `kid_guardians_kid_idx` ON `kid_guardians` (`kid_id`);
CREATE INDEX `kid_guardians_phone_idx` ON `kid_guardians` (`phone_e164`);

-- ---- kid_ledger ---------------------------------------------------------------
DROP INDEX `kid_ledger_person_idx`;
DROP INDEX `kid_ledger_attendance_once`;
ALTER TABLE `kid_ledger` RENAME TO `legacy_kid_ledger`;
CREATE TABLE `kid_ledger` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kid_id` integer NOT NULL,
	`delta` integer NOT NULL,
	`reason` text NOT NULL,
	`note` text,
	`service_id` integer,
	`staff_id` integer,
	`kiosk_device_id` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`kid_id`) REFERENCES `kids`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action
);
INSERT INTO `kid_ledger` (`id`, `kid_id`, `delta`, `reason`, `note`, `service_id`, `staff_id`,
	`kiosk_device_id`, `created_at`)
SELECT `id`, `person_id`, `delta`, `reason`, `note`, `service_id`, `staff_id`, `kiosk_device_id`, `created_at`
FROM `legacy_kid_ledger` WHERE `person_id` IN (SELECT `id` FROM `kids`);
CREATE INDEX `kid_ledger_kid_idx` ON `kid_ledger` (`kid_id`);
-- One attendance credit per child per meeting. Load-bearing - see 0015.
CREATE UNIQUE INDEX `kid_ledger_attendance_once`
	ON `kid_ledger` (`kid_id`, `service_id`) WHERE `reason` = 'attendance';

-- ---- kid_cards ----------------------------------------------------------------
DROP INDEX `kid_cards_token`;
DROP INDEX `kid_cards_person_idx`;
DROP INDEX `kid_cards_uid`;
ALTER TABLE `kid_cards` RENAME TO `legacy_kid_cards`;
CREATE TABLE `kid_cards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kid_id` integer NOT NULL,
	`token` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`issued_at` text NOT NULL,
	`revoked_at` text,
	`issued_by` text,
	`uid` text,
	FOREIGN KEY (`kid_id`) REFERENCES `kids`(`id`) ON UPDATE no action ON DELETE cascade
);
INSERT INTO `kid_cards` (`id`, `kid_id`, `token`, `active`, `issued_at`, `revoked_at`, `issued_by`, `uid`)
SELECT `id`, `person_id`, `token`, `active`, `issued_at`, `revoked_at`, `issued_by`, `uid`
FROM `legacy_kid_cards` WHERE `person_id` IN (SELECT `id` FROM `kids`);
CREATE UNIQUE INDEX `kid_cards_token` ON `kid_cards` (`token`);
CREATE INDEX `kid_cards_kid_idx` ON `kid_cards` (`kid_id`);
CREATE UNIQUE INDEX `kid_cards_uid` ON `kid_cards` (`uid`) WHERE `uid` IS NOT NULL;

-- ---- kid_notes ----------------------------------------------------------------
DROP INDEX `kid_notes_person_idx`;
ALTER TABLE `kid_notes` RENAME TO `legacy_kid_notes`;
CREATE TABLE `kid_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kid_id` integer NOT NULL,
	`body` text NOT NULL,
	`staff_id` integer,
	`author_name` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`kid_id`) REFERENCES `kids`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE set null
);
INSERT INTO `kid_notes` (`id`, `kid_id`, `body`, `staff_id`, `author_name`, `created_at`)
SELECT `id`, `person_id`, `body`, `staff_id`, `author_name`, `created_at`
FROM `legacy_kid_notes` WHERE `person_id` IN (SELECT `id` FROM `kids`);
CREATE INDEX `kid_notes_kid_idx` ON `kid_notes` (`kid_id`,`id`);

-- ---- kid_coming ---------------------------------------------------------------
ALTER TABLE `kid_coming` RENAME TO `legacy_kid_coming`;
CREATE TABLE `kid_coming` (
	`kid_id` integer NOT NULL,
	`week` text NOT NULL,
	`answer` text NOT NULL,
	`staff_id` integer,
	`updated_at` text NOT NULL,
	PRIMARY KEY (`kid_id`, `week`),
	FOREIGN KEY (`kid_id`) REFERENCES `kids`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE set null
);
INSERT INTO `kid_coming` (`kid_id`, `week`, `answer`, `staff_id`, `updated_at`)
SELECT `person_id`, `week`, `answer`, `staff_id`, `updated_at`
FROM `legacy_kid_coming` WHERE `person_id` IN (SELECT `id` FROM `kids`);
