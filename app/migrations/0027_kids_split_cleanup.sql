-- Fairhaven Kids' own list - PHASE B of docs/kids-separation-plan.md (the pastor: "remove
-- them", 2026-10-10).
--
-- Phase A (0026) copied every Fairhaven Kids child into `kids` and kept the old tables
-- as legacy_*. The app has read only the new tables since. This finishes the
-- split:
--
--   1. Fairhaven Kids-meeting rows leave the church's `attendance` (0 at the split;
--      Fairhaven Kids registers live in kid_attendance now).
--   2. The children who were ONLY ever Fairhaven Kids leave `people`, so they are off
--      the People tab, check-in and every church list for good.
--   3. The legacy_* tables are dropped.
--
-- STEP 2 GUARDS ITSELF. A person is removed only if EVERY condition below
-- holds. Anyone with any tie to the church side - from Breeze, church
-- attendance, a group, a text, an invite, a sign-up, contact details, the
-- directory - is KEPT, because they are a church record that also happened to
-- be in Fairhaven Kids. At the split that kept 13 and removed 96 (checked 2026-10-10).
-- Their Fairhaven Kids copy in `kids` is untouched either way.
--
-- NOT REVERSIBLE except from the backup taken just before it ran.

DELETE FROM `attendance`
WHERE `service_id` IN (SELECT `id` FROM `services` WHERE `kind` IN ('kids-sunday', 'kids-wednesday'));

DELETE FROM `people`
WHERE `id` IN (SELECT `person_id` FROM `legacy_kid_profiles`)
  AND `id` IN (SELECT `id` FROM `kids`)
  AND `adult_child` = 'child'
  AND `breeze_id` IS NULL
  AND `phone_e164` IS NULL AND `phone` IS NULL AND `email` IS NULL
  AND `include_in_directory` = 0
  AND NOT EXISTS (SELECT 1 FROM `attendance` a WHERE a.`person_id` = `people`.`id`)
  AND NOT EXISTS (SELECT 1 FROM `people_groups` g WHERE g.`person_id` = `people`.`id`)
  AND NOT EXISTS (SELECT 1 FROM `message_log` m WHERE m.`person_id` = `people`.`id`)
  AND NOT EXISTS (SELECT 1 FROM `scheduled_messages` m WHERE m.`person_id` = `people`.`id`)
  AND NOT EXISTS (SELECT 1 FROM `directory_invites` d WHERE d.`person_id` = `people`.`id`)
  AND NOT EXISTS (SELECT 1 FROM `member_sessions` s WHERE s.`person_id` = `people`.`id`)
  AND NOT EXISTS (SELECT 1 FROM `signups` s WHERE s.`person_id` = `people`.`id`)
  AND NOT EXISTS (SELECT 1 FROM `visitors` v WHERE v.`became_person_id` = `people`.`id`)
  AND NOT EXISTS (SELECT 1 FROM `kid_guardians` g WHERE g.`member_person_id` = `people`.`id`);

DROP TABLE `legacy_kid_coming`;
DROP TABLE `legacy_kid_notes`;
DROP TABLE `legacy_kid_cards`;
DROP TABLE `legacy_kid_ledger`;
DROP TABLE `legacy_kid_guardians`;
DROP TABLE `legacy_kid_profiles`;
