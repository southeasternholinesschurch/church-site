# Plan: give Fairhaven Kids its own list of children

*Drafted and approved 2026-10-10. **Done 2026-10-10:** Phase A (migration 0026) and Phase B (0027) both applied to live the same day, at the pastor's request. People 242 → 146.*

## What you asked for

Today Fairhaven Kids children and church members share one list, called `people`. Every
church page therefore has to remember rules about which children it may show.
The goal is two separate lists:

- **The church list (`people`)** stays exactly as it is: members, their
  families, the directory and church texts.
- **A new Fairhaven Kids list (`kids`)** holds every child in Fairhaven Kids, with their class,
  route, allergies, guardians, Fairhaven Bucks and cards.

A church page can then never show an Fairhaven Kids child, because Fairhaven Kids children are
not in the list it reads. A child whose family attends the church and who also
comes to Fairhaven Kids is entered twice, once on each side. You said that is fine.

## What is in the live database today (checked 2026-10-10)

| What | Count | What happens to it |
|---|---|---|
| Children in Fairhaven Kids | 109 | Each is copied to the new Fairhaven Kids list, **keeping the same ID number**, so links and printed cards keep working |
| …of whom are church kids (from Breeze, or attend church services) | 13 | Their church record **stays** on the People tab, and Fairhaven Kids gets its own copy |
| …of whom were added through Fairhaven Kids and are nothing else | 96 | Copied to Fairhaven Kids, then **removed from the People tab** |
| Guardians | 41 | Re-attached to the Fairhaven Kids copy of their child |
| Fairhaven Bucks entries | 235 | Re-attached; every balance is checked to match before and after |
| Fairhaven Kids cards | 4 | Re-attached; the printed cards keep working |
| Fairhaven Kids attendance, Calling answers, notes, photos | 0 each | Nothing to move yet |
| Church attendance of the 13 church kids | 196 | **Untouched.** It belongs to their church record, which stays |
| Children who never came to Fairhaven Kids | 30 | Untouched |

Moving now is good timing. Calling, Kids Club and the Fairhaven Kids registers have no
history yet, so very little has to move.

## What changes for you, by page

**Church side**
- **People tab:** the 96 Fairhaven Kids-only children disappear, and nothing else changes.
- **Church check-in, groups, texts, bulletin birthdays, directory, attendance
  trends:** no visible change. They already showed only church records, and
  now that list holds no bus children.

**Fairhaven Kids side**
- Pages look and work the same.
- **Fairhaven Kids → Children:** the "Not in Fairhaven Kids" group (church children who aren't
  enrolled) goes away, because Fairhaven Kids no longer reads the church list.
- **Kids Club's "not on the list" fold:** shows Fairhaven Kids children only. A church
  child who starts coming to Club is added once with **Add a new child**.
- **Archive from Fairhaven Kids:** works the same. It no longer has any way to affect
  the People tab, because the two are separate.
- **Guardians who are church members:** they can stay linked to their church
  record, so a parent who texts STOP stops on both sides. This links an adult
  to an adult and does not put any child on the church list.

## How the move is done safely

It is done in two phases, so it can be undone right up to the last step.

**Before anything live is touched**
1. Take a full backup of the live database. It is saved outside the project
   folder, because it holds names and phone numbers, and deleted when we're
   done.
2. Rehearse the whole move on a copy of that backup on the laptop. Run every
   check below and click through every Fairhaven Kids page.

**Phase A: copy (reversible)**
3. One database change creates the new Fairhaven Kids tables and **copies** everything
   into them. The old tables are left exactly as they are.
4. Push the new app code, which reads only the new tables. Deploying takes
   about two minutes, and Fairhaven Kids pages may show an error during that time.
   Do it on a quiet weekday: not Saturday (calls), Sunday or Wednesday.
5. Run the checks. If anything is wrong, redeploy the old code. It still reads
   the untouched old tables, so nothing is lost.

**Phase B: clean up (after a week of normal use)**
6. A second database change removes the old Fairhaven Kids tables and the 96
   Fairhaven Kids-only children from `people`. **Only this step can't be undone except
   from the backup**, which is why it waits a week.
   - First it checks that none of the 96 has any church attendance, group, text
     history or directory record. If any does, it stops and lists them for you
     instead of removing anyone.

## The checks (after Phase A and again after Phase B)

- The row counts in the new tables match the table above: 109 / 41 / 235 / 4.
- Every child's Fairhaven Bucks balance is the same as before, compared child by child.
- Every class and route has the same number of children as before.
- Every guardian, Bucks entry and card points at a child that exists.
- The People tab count drops by exactly 96 (Phase B only), and the directory and
  church attendance trends don't change at all.
- A card scan, an attendance tick, a Calling answer, an Fairhaven Bucks award and a
  guardian text all work on the live app. The test text goes to a phone you
  choose.

## Decisions for you

1. **The 96 Fairhaven Kids-only children on the People tab: remove them or archive
   them?** I recommend **remove**. After the move nothing on the church side
   refers to them, and leaving them archived keeps 96 bus children sitting in
   the church list, which is what you're trying to end.
2. **The 13 church kids in Fairhaven Kids.** Their Fairhaven Kids class, route and Bucks go with
   the Fairhaven Kids copy, and their church record keeps its church attendance. Is
   that right? (I'll list their names on the laptop before Phase A, not here.)
3. **When to do Phase A.** I suggest a Monday or Tuesday.

## What gets changed in the code (for reference)

- **New tables:**
  - `kids`: name, birthday, address, photo and notes, plus everything now in
    `kid_profiles` (class, route, stop number, Kids Club, allergies, medical
    notes, archived).
  - `kid_attendance`: Fairhaven Kids registers, separate from church attendance.
- **Re-pointed from `people` to `kids`:** `kid_guardians`, `kid_ledger`
  (including the "one attendance credit per meeting" rule), `kid_cards`,
  `kid_notes`, `kid_coming`.
- **Unchanged:**
  - `kid_guardians.member_person_id` still links to a church adult.
  - `services` is shared (it holds dates, not people). Church pages already
    leave Fairhaven Kids meetings out.
- **Code to update:**
  - every page under `/kids`
  - card check-in (`kiosk/scan.ts`)
  - Fairhaven Kids photos and the card link
  - Fairhaven Kids texting and replies (`kids-recipients.ts`, `replies.astro`)
  - the van-list import script
  - the demo data (`seed-demo.mjs`) and the tests
- **Not touched:** the `church-site` template repo, any church page except to
  remove leftover Fairhaven Kids references, and the public website.
