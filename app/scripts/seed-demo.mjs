/**
 * Fills the DEMO database with an invented congregation.
 *
 *   npx wrangler d1 migrations apply changeme-demo --remote
 *   node scripts/seed-demo.mjs > /tmp/seed.sql
 *   npx wrangler d1 execute changeme-demo --remote --file /tmp/seed.sql
 *
 * Everything here is fiction. Numbers are in the 555-01xx range, which is
 * reserved for it and can never reach a real handset — belt and braces on top
 * of the demo Worker having no Twilio credentials at all.
 *
 * Shaped like a real small church rather than like tidy test data: households
 * share a surname, an address and sometimes a phone; roughly a third of people
 * are children; some records are deliberately INCOMPLETE, because a demo where
 * every field is filled hides the "Missing details" filter that is one of the
 * more useful things here.
 */
const SURNAMES = ['Whitfield','Barlow','Hargrove','Ashworth','Pennington','Calloway',
  'Redmond','Thackery','Milburn','Ellison','Stanfield','Braddock','Ainsworth',
  'Fairbanks','Holloway','Winslow','Kirkland','Danforth','Ravenel','Sutcliffe',
  'Beaumont','Carrington','Alderidge','Marchetti','Lockhart','Prescott'];
const MEN = ['Marcus','Daniel','Samuel','Caleb','Silas','Josiah','Aaron','Simon','Levi',
  'Amos','Gideon','Ezra','Titus','Enoch','Barnabas','Reuben','Asher','Jonah','Micah','Elias'];
const WOMEN = ['Eleanor','Ruth','Miriam','Naomi','Hannah','Lydia','Priscilla','Abigail',
  'Esther','Tabitha','Rhoda','Joanna','Phoebe','Damaris','Salome','Keturah','Dorcas','Anna','Susanna','Martha'];
const KIDS = ['Eli','Nora','Jude','Clara','Isaac','Ivy','Theo','Mabel','Silas','June',
  'Ezra','Hazel','Micah','Wren','Asa','Opal','Rufus','Cora','Boaz','Etta'];
const STREETS = ['Willow Bend Dr.','Rosewood Ave.','Chapel Hill Rd.','Maple Ridge Ln.',
  'Sycamore St.','Bellview Ct.','Orchard Way','Kingsley Dr.','Meadowlark Ln.',
  'Fairmount Ave.','Hawthorne St.','Cedar Crest Rd.','Prospect St.','Linden Ave.'];
const CITIES = [['Fairmont','46140'],['Ridgeway','46203'],['Lakemont','46176'],
  ['Brookfield','46107'],['Westbury','46239']];

let seed = 20260905;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pick = (a) => a[Math.floor(rnd() * a.length)];
const chance = (p) => rnd() < p;
const q = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const pad = (n) => String(n).padStart(2, '0');
const date = () => `1900-${pad(1 + Math.floor(rnd() * 12))}-${pad(1 + Math.floor(rnd() * 28))}`;

const out = [];
/*
 * Fairhaven Bucks first, before anything else is cleared.
 *
 * kid_ledger references BOTH services and staff with ON DELETE no action —
 * deliberately, so a service that children earned credits at cannot quietly
 * vanish from under them in the real app. The consequence here is that this
 * script has to clear the ledger before it clears either, or the very first
 * DELETE fails on a foreign key and the whole reseed stops.
 */
out.push('DELETE FROM kiosk_devices;');
out.push('DELETE FROM kid_cards; DELETE FROM kid_ledger;');
out.push('DELETE FROM attendance; DELETE FROM visitors; DELETE FROM services;');
out.push('DELETE FROM message_log; DELETE FROM scheduled_messages; DELETE FROM message_schedules;');
out.push('DELETE FROM people_groups; DELETE FROM groups; DELETE FROM directory_invites;');
out.push('DELETE FROM kid_class_teachers; DELETE FROM kid_guardians; DELETE FROM kid_profiles;');
out.push('DELETE FROM kid_classes; DELETE FROM kid_routes;');
out.push('DELETE FROM signups; DELETE FROM signup_slots; DELETE FROM signup_sheets;');
out.push('DELETE FROM people; DELETE FROM bulletins; DELETE FROM app_settings;');
// Anyone a visitor added through the Access screen. The demo has no sign-in,
// so these rows do nothing — but leaving them means the screen fills up with
// whatever people typed.
out.push('DELETE FROM staff; DELETE FROM sessions; DELETE FROM member_sessions;');

let id = 0, line = 100;
const people = [];
for (let h = 0; h < 42; h++) {
  const last = SURNAMES[h % SURNAMES.length];
  const street = `${1000 + Math.floor(rnd() * 8999)} ${pick(STREETS)}`;
  const [city, zip] = pick(CITIES);
  // A tenth of households have no address on file, so "Missing details" has
  // something to find — a demo where everything is complete hides the feature.
  const hasAddr = chance(0.9);
  const adults = chance(0.75) ? 2 : 1;
  const kids = chance(0.45) ? 1 + Math.floor(rnd() * 3) : 0;
  const sharedPhone = chance(0.25) ? `(317) 555-0${line++}` : null;

  for (let a = 0; a < adults; a++) {
    const first = a === 0 ? pick(MEN) : pick(WOMEN);
    const phone = sharedPhone ?? (chance(0.88) ? `(317) 555-0${line++}` : null);
    people.push({ id: ++id, first, last, phone,
      email: chance(0.35) ? `${first.toLowerCase()}.${last.toLowerCase()}@example.org` : null,
      street: hasAddr ? street : null, city: hasAddr ? city : null, zip: hasAddr ? zip : null,
      birthday: chance(0.8) ? date() : null,
      anniversary: adults === 2 && chance(0.7) ? date() : null,
      kind: 'adult', dir: 1 });
  }
  for (let k = 0; k < kids; k++) {
    people.push({ id: ++id, first: pick(KIDS), last, phone: null, email: null,
      street: hasAddr ? street : null, city: hasAddr ? city : null, zip: hasAddr ? zip : null,
      birthday: chance(0.75) ? date() : null, anniversary: null,
      // Children are NEVER in the directory. Same rule as the real app, and it
      // has to hold here too or a prospect sees the wrong thing.
      kind: 'child', dir: 0 });
  }
}
for (const p of people) {
  const e164 = p.phone ? `+1${p.phone.replace(/\D/g, '')}` : null;
  const consent = p.phone ? (chance(0.94) ? 'opted_in' : 'opted_out') : 'unknown';
  const status = p.dir && e164 && consent === 'opted_in'
    ? (chance(0.66) ? 'active' : chance(0.5) ? 'invited' : 'none') : 'none';
  out.push(`INSERT INTO people (id, first_name, last_name, phone, phone_e164, email,
    address_street, address_city, address_state, address_zip, birthday, anniversary,
    adult_child, include_in_directory, directory_status, sms_consent, archived,
    needs_profile, created_at, updated_at) VALUES (${p.id}, ${q(p.first)}, ${q(p.last)},
    ${q(p.phone)}, ${q(e164)}, ${q(p.email)}, ${q(p.street)}, ${q(p.city)},
    ${p.street ? "'IN'" : 'NULL'}, ${q(p.zip)}, ${q(p.birthday)}, ${q(p.anniversary)},
    ${q(p.kind)}, ${p.dir}, ${q(status)}, ${q(consent)}, 0, 0,
    datetime('now'), datetime('now'));`);
}

// groups
const GROUPS = [['Choir','Sings on a Sunday'],['Youth parents','Parents of teenagers'],
  ['Prayer chain','Urgent requests'],['Deacons',null]];
GROUPS.forEach(([n, d], i) => {
  out.push(`INSERT INTO groups (id, name, description, created_at) VALUES (${i + 1}, ${q(n)}, ${q(d)}, datetime('now'));`);
});
for (const p of people.filter((x) => x.kind === 'adult')) {
  for (let g = 1; g <= 4; g++) if (chance(0.18)) out.push(`INSERT INTO people_groups (person_id, group_id) VALUES (${p.id}, ${g});`);
}

// a term of services, with attendance that looks like a real church's
const KINDS = [['sunday-morning', 0.62], ['sunday-evening', 0.34], ['wednesday', 0.3]];
let sid = 0;
for (let w = 10; w >= 1; w--) {
  for (const [kind, rate] of KINDS) {
    const d = new Date(Date.UTC(2026, 8, 5) - w * 7 * 86400000 + (kind === 'wednesday' ? 3 * 86400000 : 0));
    const iso = d.toISOString().slice(0, 10);
    // Column is `date`, not `service_date` — checked against the live schema
    // rather than guessed, which is how the first attempt failed.
    out.push(`INSERT INTO services (id, date, kind, created_at) VALUES (${++sid}, '${iso}', ${q(kind)}, datetime('now'));`);
    for (const p of people) if (chance(rate)) out.push(`INSERT INTO attendance (service_id, person_id, created_at) VALUES (${sid}, ${p.id}, datetime('now'));`);
    const visitors = Math.floor(rnd() * 4);
    for (let v = 0; v < visitors; v++) out.push(`INSERT INTO visitors (service_id, name, adult_child, first_time, created_at) VALUES (${sid}, ${q(pick(MEN) + ' ' + pick(SURNAMES))}, 'adult', ${chance(0.5) ? 1 : 0}, datetime('now'));`);
  }
}

// ---- Fairhaven Kids -----------------------------------------------------------------
// The children's ministry. Seeded so the section is worth clicking through:
// classes with children in them, allergies to find, bus-ministry children whose
// families are NOT members, and a register already half taken.
//
// Note what is deliberately incomplete. A demo where every child has a class, a
// guardian and a phone number hides exactly the work the section exists to do.

// The five age groups. Re-inserted rather than left to migration 0014, because
// this script wipes what it owns so a reset is deterministic.
const KID_CLASSES = [
  [1, 'Ages 1-3', 'Nursery and toddlers', 1, 3],
  [2, 'Ages 4-6', 'Pre-school and early school', 4, 6],
  [3, 'Ages 7-9', null, 7, 9],
  [4, 'Ages 10-12', null, 10, 12],
  [5, 'Ages 13-21', 'Teens', 13, 21],
];
for (const [cid, name, desc, lo, hi] of KID_CLASSES) {
  out.push(`INSERT INTO kid_classes (id, name, description, min_age, max_age, sort, active, created_at)
    VALUES (${cid}, ${q(name)}, ${q(desc)}, ${lo}, ${hi}, ${cid}, 1, datetime('now'));`);
}

/*
 * Fairhaven Kids volunteers, so the classes screen has somebody to assign.
 *
 * The staff table is emptied above — that clears whatever a visitor typed into
 * the Access screen — so these are re-created every reseed as the canonical
 * set. They are invented, on example.org, and the demo has no sign-in anyway:
 * these rows grant nothing, they are here so the teacher assignment on
 * /kids/classes is a feature you can see rather than an empty dropdown.
 */
const KID_STAFF = [
  ['marion', 'Marion S.', 'kids-director'],
  ['karen',   'Karen H.',   'kids'],
  ['bethany', 'Bethany R.', 'kids'],
  ['darrell', 'Darrell M.', 'kids'],
  ['pastor',  'Pastor',     'admin'],
];
KID_STAFF.forEach(([handle, name, role], i) => {
  out.push(`INSERT INTO staff (id, email, name, role, active, created_at)
    VALUES (${i + 1}, ${q(handle + '@example.org')}, ${q(name)}, ${q(role)}, 1, datetime('now'));`);
});
// Who teaches what. Not a restriction — every volunteer sees every child — but
// it is what "your class" on a phone will read from.
[[2, 1], [2, 2], [3, 3], [4, 4], [1, 5]].forEach(([staffId, classId]) => {
  out.push(`INSERT INTO kid_class_teachers (staff_id, class_id, created_at)
    VALUES (${staffId}, ${classId}, datetime('now'));`);
});

const KID_ROUTES = [[1, 'Route 1 — Eastside', 'Prospect St. and the streets off it'],
                    [2, 'Route 2 — Fountain Square', 'Pickup 3:45-4:15'],
                    [3, 'Route 3 — Beech Grove', null]];
for (const [rid, name, notes] of KID_ROUTES) {
  out.push(`INSERT INTO kid_routes (id, name, notes, active, created_at)
    VALUES (${rid}, ${q(name)}, ${q(notes)}, 1, datetime('now'));`);
}

const ALLERGIES = ['Peanuts — EpiPen in the office', 'Dairy', 'Bee stings',
                   'Penicillin', 'Eggs and tree nuts'];
const RELATIONSHIPS = ['mother', 'father', 'grandmother', 'grandfather', 'aunt'];
const classForAge = (age) => (KID_CLASSES.find(([, , , lo, hi]) => age >= lo && age <= hi) ?? [null])[0];

// The church's own children. Most join Fairhaven Kids; a few deliberately do not, so
// the "not in Fairhaven Kids yet" case has something in it.
const churchKids = people.filter((p) => p.kind === 'child');
const kidRows = [];
for (const k of churchKids) {
  if (!chance(0.82)) continue;                 // some children are simply not enrolled
  const age = 1 + Math.floor(rnd() * 20);
  // A realistic birth year, so the "suggested class" hint has something true to
  // work from. The generic people birthdays are all year 1900 — fine where only
  // the month and day are ever shown, useless for an age.
  const by = 2026 - age;
  out.push(`UPDATE people SET birthday = '${by}-${pad(1 + Math.floor(rnd() * 12))}-${pad(1 + Math.floor(rnd() * 28))}' WHERE id = ${k.id};`);
  // A tenth are enrolled but not yet placed in a class — the director's to-do.
  const cid = chance(0.9) ? classForAge(age) : null;
  kidRows.push({ id: k.id, cid, age });
  out.push(`INSERT INTO kid_profiles (person_id, class_id, route_id, allergies, medical_notes, created_at, updated_at)
    VALUES (${k.id}, ${cid ?? 'NULL'}, NULL, ${chance(0.18) ? q(pick(ALLERGIES)) : 'NULL'}, NULL,
    datetime('now'), datetime('now'));`);
  // Their guardian IS a member, so the row links through rather than copying
  // contact details that would then go stale.
  const parent = people.find((a) => a.kind === 'adult' && a.last === k.last);
  if (parent) {
    out.push(`INSERT INTO kid_guardians (person_id, name, relationship, phone, phone_e164,
      member_person_id, is_primary, sms_consent, sms_consent_source, sms_consent_at, created_at, updated_at)
      VALUES (${k.id}, ${q(parent.first + ' ' + parent.last)}, ${q(pick(RELATIONSHIPS))},
      ${q(parent.phone)}, ${q(parent.phone ? '+1' + parent.phone.replace(/\D/g, '') : null)},
      ${parent.id}, 1, 'opted_in', 'verbal-at-intake', datetime('now'), datetime('now'), datetime('now'));`);
  }
}

// Bus-ministry children. ENTIRELY NEW RECORDS whose families are not members —
// which is the whole reason kid_guardians exists rather than more people rows.
const BUS_KIDS = ['Amari','Destiny','Jayden','Aaliyah','Marcus','Zoe','Elijah','Nevaeh',
                  'Xavier','Trinity','Isaiah','Serenity'];
const BUS_LAST = ['Colvin','Ramsey','Okafor','Delgado','Boone','Nakamura'];
for (let b = 0; b < 12; b++) {
  const age = 4 + Math.floor(rnd() * 14);
  const first = BUS_KIDS[b], last = pick(BUS_LAST);
  const kidId = ++id;
  const by = 2026 - age;
  out.push(`INSERT INTO people (id, first_name, last_name, adult_child, include_in_directory,
    directory_status, sms_consent, archived, needs_profile, birthday, created_at, updated_at)
    VALUES (${kidId}, ${q(first)}, ${q(last)}, 'child', 0, 'none', 'unknown', 0, 0,
    '${by}-${pad(1 + Math.floor(rnd() * 12))}-${pad(1 + Math.floor(rnd() * 28))}',
    datetime('now'), datetime('now'));`);
  out.push(`INSERT INTO kid_profiles (person_id, class_id, route_id, allergies, medical_notes, created_at, updated_at)
    VALUES (${kidId}, ${classForAge(age) ?? 'NULL'}, ${1 + Math.floor(rnd() * 3)},
    ${chance(0.22) ? q(pick(ALLERGIES)) : 'NULL'}, NULL, datetime('now'), datetime('now'));`);
  // The guardian's number exists ONLY here. This is the shape that made the
  // STOP handler span two tables — see lib/consent.ts.
  const gphone = chance(0.85) ? `(317) 555-0${line++}` : null;
  out.push(`INSERT INTO kid_guardians (person_id, name, relationship, phone, phone_e164,
    member_person_id, is_primary, sms_consent, sms_consent_source, sms_consent_at, created_at, updated_at)
    VALUES (${kidId}, ${q(pick(WOMEN) + ' ' + last)}, ${q(pick(RELATIONSHIPS))},
    ${q(gphone)}, ${q(gphone ? '+1' + gphone.replace(/\D/g, '') : null)}, NULL, 1,
    ${gphone ? (chance(0.85) ? "'opted_in'" : "'opted_out'") : "'unknown'"},
    'verbal-at-intake', datetime('now'), datetime('now'), datetime('now'));`);
  kidRows.push({ id: kidId, cid: classForAge(age), age });
}

const creditable = [];
// Two Fairhaven Kids services, with a register partly taken — some children arrived and
// were marked by the kiosk (class_id null), others were ticked off in class.
for (const [kind, offset] of [['kids-sunday', 0], ['kids-wednesday', 3]]) {
  const d = new Date(Date.UTC(2026, 8, 5) - 7 * 86400000 + offset * 86400000);
  out.push(`INSERT INTO services (id, date, kind, created_at) VALUES (${++sid}, '${d.toISOString().slice(0, 10)}', ${q(kind)}, datetime('now'));`);
  for (const k of kidRows) {
    if (!chance(0.66)) continue;
    // A third are present but not yet assigned to a class on the row: they
    // scanned in at the door and no teacher has taken the register yet.
    const inClass = k.cid && chance(0.7);
    out.push(`INSERT INTO attendance (service_id, person_id, class_id, created_at)
      VALUES (${sid}, ${k.id}, ${inClass ? k.cid : 'NULL'}, datetime('now'));`);
    creditable.push([k.id, sid]);
  }
}

/*
 * Fairhaven Bucks histories.
 *
 * The attendance credits are written alongside the register rows above, one per
 * child per meeting, because that is exactly what the app does — seeding a
 * balance any other way would show a number the ledger could not explain.
 * A handful of awards and spends on top, so a history is worth reading and the
 * undo button has something to act on.
 */
const PER_VISIT = 5;
const AWARD_FOR = ['Said the memory verse', 'Helped tidy up', 'Brought a friend',
                   'Kind to a new child', 'Answered every question'];
const SPENT_ON = ['Bouncy ball', 'Sticker sheet', 'Pencil case', 'Sweets', 'Toy car'];
for (const [personId, serviceId] of creditable) {
  out.push(`INSERT INTO kid_ledger (person_id, delta, reason, service_id, created_at)
    VALUES (${personId}, ${PER_VISIT}, 'attendance', ${serviceId}, datetime('now'));`);
}
for (const k of kidRows) {
  if (chance(0.45)) out.push(`INSERT INTO kid_ledger (person_id, delta, reason, note, staff_id, created_at)
    VALUES (${k.id}, ${1 + Math.floor(rnd() * 5)}, 'award', ${q(pick(AWARD_FOR))}, 2, datetime('now'));`);
  if (chance(0.3)) out.push(`INSERT INTO kid_ledger (person_id, delta, reason, note, staff_id, created_at)
    VALUES (${k.id}, -${1 + Math.floor(rnd() * 8)}, 'spend', ${q(pick(SPENT_ON))}, 2, datetime('now'));`);
}
/*
 * Cards. Most enrolled children have one; a few deliberately do not, and one
 * has a revoked card as well as a live one so the "earlier cards have been
 * revoked" line has something to say.
 *
 * The tokens are invented hex of the right shape. They are not produced by
 * crypto.getRandomValues like the real ones — this is a seed script, and a
 * demo card token opens nothing that matters — but they are the right length,
 * so the page renders at the width it really will.
 */
const fakeToken = () => Array.from({ length: 64 },
  () => '0123456789abcdef'[Math.floor(rnd() * 16)]).join('');
for (const k of kidRows) {
  if (!chance(0.8)) continue;
  if (chance(0.15)) {
    out.push(`INSERT INTO kid_cards (person_id, token, active, issued_at, revoked_at, issued_by)
      VALUES (${k.id}, '${fakeToken()}', 0, datetime('now','-60 days'), datetime('now','-20 days'), 'marion@example.org');`);
  }
  out.push(`INSERT INTO kid_cards (person_id, token, active, issued_at, issued_by)
    VALUES (${k.id}, '${fakeToken()}', 1, datetime('now','-20 days'), 'marion@example.org');`);
}

out.push(`INSERT INTO app_settings (key, value, updated_at, updated_by)
  VALUES ('kid_bucks_per_visit', '${PER_VISIT}', datetime('now'), 'marion@example.org');`);

/*
 * A kiosk the demo visitor can pair in one click.
 *
 * The token is invented and opens nothing that matters — the demo is its own
 * worker with its own database of invented people, and DEMO_INSTANCE makes
 * texting impossible there regardless. It exists so somebody shown the app can
 * press "Pair this device" and watch the check-in screen appear, rather than
 * reading a description of it.
 */
out.push(`INSERT INTO kiosk_devices (id, name, token, active, created_at)
  VALUES (1, 'Foyer tablet', '${fakeToken()}', 1, datetime('now'));`);

// a bulletin, with prayer requests carried over
out.push(`INSERT INTO bulletins (service_date, title, preacher, scripture, scripture_ref,
  announcements, prayer_requests, status, published_at, created_at, updated_at) VALUES
  ('2026-09-06', 'Morning Worship', 'Pastor ${pick(SURNAMES)}',
   'For God so loved the world, that he gave his only begotten Son.', 'John 3:16',
   '[{"when":"Sunday - after the service","heading":"Fellowship lunch","detail":"Bring something to share."}]',
   '[{"text":"${pick(WOMEN)} ${pick(SURNAMES)} - recovering well after surgery","since":"2026-08-16"},
     {"text":"The ${pick(SURNAMES)} family, travelling this month","since":"2026-08-30"},
     {"text":"Our missionaries in East Asia","since":"2026-06-07"}]',
   'published', datetime('now'), datetime('now'), datetime('now'));`);

// birthday texts switched on, so the Messaging page shows the feature working
out.push(`INSERT INTO app_settings (key, value, updated_at, updated_by) VALUES
  ('birthday_texts_on','1',datetime('now'),'demo@example.org'),
  ('birthday_texts_time','09:00',datetime('now'),'demo@example.org'),
  ('birthday_texts_body','Happy birthday, {first}! We thank God for you today and we are praying for you. - The Pastoral Team',datetime('now'),'demo@example.org');`);

/* ------------------------------------------------------- sign-up sheets --
 *
 * Four of them, because the interesting thing about this feature is the STATES
 * a sheet can be in, and one sheet can only be in one of them. A meal train
 * part-filled, a volunteer list with places left, a pitch-in with two of its
 * four parts full, and one whose days have all passed — which is shut without
 * anybody having pressed Close, and is the behaviour most worth showing.
 *
 * DATES ARE RELATIVE TO THE RESEED, not written down. A demo with a meal train
 * dated last March is a demo of a closed sheet, and the whole point of the
 * public page is the taken/available display on a live one. Re-run
 * refresh-demo.mjs and it is current again.
 */
const DEMO_WEEKDAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const DEMO_MONTHS = ['January','February','March','April','May','June','July',
  'August','September','October','November','December'];
/* Noon UTC, never new Date(iso) — that is UTC midnight, which in Indianapolis is
 * the evening BEFORE. Same note as addDaysIso in lib/signups.ts. */
const inDays = (n) => {
  const d = new Date(`${new Date().toISOString().slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/* The same wording the builder writes when it sets the days — see dayLabel(). */
const dayName = (iso) => {
  const d = new Date(`${iso}T12:00:00Z`);
  return `${DEMO_WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${DEMO_MONTHS[d.getUTCMonth()]}`;
};

const adultsPool = people.filter((x) => x.kind === 'adult');
let sheetId = 0, slotId = 0;
const sheet = (o) => {
  sheetId++;
  out.push(`INSERT INTO signup_sheets (id, token, title, intro, kind, status, event_date,
    closes_on, ask_headcount, reminder_body, created_by, created_at, updated_at) VALUES
    (${sheetId}, '${fakeToken().slice(0, 32)}', ${q(o.title)}, ${q(o.intro)}, ${q(o.kind)},
     ${q(o.status ?? 'open')}, ${q(o.eventDate ?? null)}, NULL, ${o.headcount ? 1 : 0}, NULL,
     'demo@example.org', datetime('now','-9 days'), datetime('now','-9 days'));`);
  return sheetId;
};
const slot = (sh, sort, label, onDate, capacity, takers) => {
  slotId++;
  out.push(`INSERT INTO signup_slots (id, sheet_id, sort, label, detail, on_date, capacity)
    VALUES (${slotId}, ${sh}, ${sort}, ${q(label)}, NULL, ${q(onDate)},
            ${capacity === null ? 'NULL' : capacity});`);
  takers.forEach((t, i) => {
    // Seats are 1-based and unique per slot — see nextSeat() in lib/signups.ts.
    out.push(`INSERT INTO signups (sheet_id, slot_id, seat, person_id, name, headcount,
      note, phone_e164, sms_consent, sms_consent_source, sms_consent_at, remind,
      created_by, created_at) VALUES (${sh}, ${slotId}, ${i + 1},
      ${t.personId ?? 'NULL'}, ${q(t.name)}, ${t.headcount ?? 'NULL'}, ${q(t.note ?? null)},
      ${q(t.phone ?? null)}, ${q(t.phone ? 'opted_in' : null)},
      ${q(t.phone ? 'signup-sheet' : null)}, ${t.phone ? "datetime('now','-5 days')" : 'NULL'},
      ${t.remind ? 1 : 0}, NULL, datetime('now','-5 days'));`);
  });
};
/* A member the app recognised: no number and no consent stored on the row. The
 * reminder reads their number from `people` at send time, so a change of number
 * follows them and a STOP stops them. Somebody who typed their name gets the
 * tick-box instead, and that is the only case that stores anything. */
const member = (p, extra = {}) => ({ personId: p.id, name: `${p.first} ${p.last}`, ...extra });
const guest = (p, extra = {}) => ({ name: `${p.first} ${p.last}`, ...extra });

// 1. A meal train, running from four days out. Four of seven days taken.
const mealFamily = adultsPool[3];
const meals = sheet({
  title: `Meals for the ${mealFamily.last} family`,
  intro: `The ${mealFamily.last}s are home with their new baby. Meals can be left at the door any time after 4pm — there is a cool box on the porch if nobody answers.`,
  kind: 'meal-train',
});
const mealTakers = [
  member(adultsPool[6], { remind: 1, note: 'Chicken and rice, enough for four.' }),
  member(adultsPool[11]),
  null,
  guest(adultsPool[17], { phone: '+13175550188', remind: 1 }),
  null,
  member(adultsPool[22], { note: 'Will bring a pudding as well.' }),
  null,
];
mealTakers.forEach((t, i) => {
  const day = inDays(4 + i);
  slot(meals, i, dayName(day), day, 1, t ? [t] : []);
});

// 2. A volunteer list. One slot, so the public page does not fold it away.
const workday = sheet({
  title: 'Autumn workday — volunteers needed',
  intro: 'Saturday morning, 8am until we are done. Bring gloves. Rakes and ladders are provided, and there is coffee.',
  kind: 'list',
  eventDate: inDays(12),
});
slot(workday, 0, 'Sign up', inDays(12), 8, [
  member(adultsPool[1]), member(adultsPool[8]), guest(adultsPool[14]),
  member(adultsPool[19]), member(adultsPool[25], { note: 'Can bring a trailer.' }),
]);

// 3. A pitch-in, with two of its four parts full.
const dinner = sheet({
  title: 'Harvest fellowship dinner',
  intro: 'Straight after the evening service. Bring your dish warm if you can — there are only two ovens in the kitchen.',
  kind: 'dish',
  eventDate: inDays(18),
  headcount: true,
});
const d = inDays(18);
slot(dinner, 0, 'Main dish', d, 2, [
  member(adultsPool[2], { headcount: 4, note: 'Beef and noodles.' }),
  member(adultsPool[9], { headcount: 2, note: 'Ham.' }),
]);
slot(dinner, 1, 'Salad or side', d, 6, [
  member(adultsPool[4], { headcount: 3 }), guest(adultsPool[13], { headcount: 2 }),
  member(adultsPool[21], { headcount: 5, note: 'Green beans.' }),
]);
slot(dinner, 2, 'Bread or rolls', d, 3, [member(adultsPool[16], { headcount: 2 })]);
slot(dinner, 3, 'Dessert', d, 4, [
  member(adultsPool[5], { headcount: 2 }), member(adultsPool[12], { headcount: 4 }),
  guest(adultsPool[18], { headcount: 1 }), member(adultsPool[24], { headcount: 3, note: 'Two pies.' }),
]);

// 4. Every day on it has passed, so it is shut and says so — without anybody
//    having pressed Close. Nobody remembers to press Close.
const past = adultsPool[30];
const done = sheet({
  title: `Meals for the ${past.last} family`,
  intro: `${past.first} is home from hospital and doing well. Thank you to everybody who cooked.`,
  kind: 'meal-train',
});
[7, 6, 5, 4].forEach((back, i) => {
  const day = inDays(-back);
  slot(done, i, dayName(day), day, 1, [member(adultsPool[(i * 7) % adultsPool.length])]);
});


console.log(out.join('\n'));
