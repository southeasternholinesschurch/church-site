# Breeze ChMS export — structure notes (Phase 0)

Source: `YOUR-SUBDOMAIN-people-08-29-2026.xlsx`, single sheet `Simple`, 120 people
rows + header. **This file is not, and must never be, committed to this repo or any Cloudflare/
Render account outside the eventual server app's own database** — it contains real member PII
(names, phone numbers, emails, home addresses, birthdates). It stays in the pastor's Downloads folder;
this doc records structure/format only, no real values.

This is the Phase 0 deliverable the brief asks for (§11: "get a real Breeze export FIRST and
inspect actual columns/format before building the schema"). The actual Phase 3 schema isn't
built yet — this just makes sure it won't be built on assumptions.

## Columns present

| Breeze column | Populated | Notes |
|---|---|---|
| Breeze ID | 120/120, unique int | Good migration key — keep as an external-reference field |
| First / Last Name | 120/120 | |
| Middle Name, Nickname, Maiden Name | 0/120 | Unused in this export |
| Gender | 46/120 | Sparse |
| Status | 32/120 (`Member`/`Attender`) | **Brief §10 says no membership-status field — drop on migration, per the pastor's explicit spec, even though Breeze has partial data here** |
| Marital Status | 32/120 | Not in the brief's schema — not migrating |
| Birthdate | 13/120, `MM/DD/YYYY` string | Very sparse |
| Birthdate Month/Day | 13/120, `"Month DD"` string | Redundant with Birthdate |
| Age | 13/120, int | Very sparse |
| Family | 120/120, int | Family grouping ID — 25 distinct families, sizes 1–6. Brief says family grouping is optional/only-if-cheap; this makes it near-free to carry over as metadata even if not surfaced in the UI |
| Family Role | 80/120 (`Head of Household`/`Spouse`/`Adult`/`Child`) | See "Adult/child gap" below — **this is the important one** |
| School, Graduation Year, Employer | 0/120 | Unused |
| Grade | 120/120 but **always literal `False`** | An export artifact, not real data — ignore entirely |
| Mobile | 70/120, `(XXX) XXX-XXXX` | The only phone in use |
| Home, Work | 0/120 | Unused — one phone field is enough |
| SMS Enrollment Status | 120/120, all `"Opted In"` | **Brief §1/§10: texting consent lives in the separate texting tool, not our DB — not migrating this field** |
| Email | 17/120 | Sparse |
| Street Address / City / State / Zip | 16/120 | Sparse |
| Added Date | 120/120, `MM/DD/YYYY` string | Date added to Breeze — optional to carry over as a "member since" style field, not required by the brief |
| **Photo** | **No column at all** | Confirms brief §11's warning — photos need separate handling, not in this export. Breeze photos would come from a separate export/zip; realistically Phase 3 may just have staff upload photos individually via the dashboard rather than bulk-migrating |

## Adult/child gap — needs the pastor's input before Phase 3

The brief requires an adult/child flag that drives both directory visibility and attendance
tallying (§8, §10) — this has to be right, since a misclassified child showing in the directory
is exactly the failure mode the brief is protecting against.

The only two signals available are `Family Role` (Head of Household/Spouse/Adult → adult;
Child → child) and `Age`/`Birthdate` — and they don't overlap the way you'd want:

- All 24 rows marked `Family Role: Child` have **no** Age/Birthdate on file
- **40 of 120 rows have no Family Role, no Age, and no Birthdate** — no signal at all to
  auto-classify these as adult or child

That's a third of the roster with no reliable auto-classification. Options once Phase 3 starts:
1. Import everyone with a known signal automatically, default the other 40 to "adult, unconfirmed"
   and have the pastor do a one-time manual pass in the dashboard before the directory (Phase 5) goes
   live — probably the fastest path given this is a ~150-person church he already knows personally
2. Pull a richer Breeze export/report that includes Age or Birthdate for everyone, if Breeze has
   that data even when it doesn't show in this particular export view

Not blocking anything right now — just flagging it so it doesn't surprise anyone during the
Phase 3 migration.

## Other notes
- 120 rows, not the ~150 the brief estimates — could just be rounding, or this export/view
  excludes some people (e.g. inactive). Worth a quick sanity check with the pastor before migration,
  not urgent now.
- Everything not listed above and not in the brief's schema (§10) — Marital Status, School,
  Grade, Employer, Graduation Year, Maiden/Middle Name/Nickname — is either empty in this export
  or simply not part of what the brief asks the new DB to track. Not migrating.
