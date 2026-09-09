import { sqliteTable, text, integer, index, unique } from 'drizzle-orm/sqlite-core';
// scheduled_messages references message_schedules, which is declared after it —
// the explicit column type is what lets that forward reference typecheck.
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

/**
 * Built from the REAL Breeze export's columns (docs/breeze-export-notes.md),
 * not from assumptions — that inspection is why several things here look the
 * way they do. Fields Breeze carries but the brief does not ask for (membership
 * status, marital status, school, employer) are deliberately absent: §10 says
 * the church does not track them, and a column that exists will eventually be
 * filled.
 */

export const people = sqliteTable('people', {
  id: integer('id').primaryKey({ autoIncrement: true }),

  /** Breeze's own ID, kept so a re-import can match rather than duplicate. */
  breezeId: integer('breeze_id').unique(),

  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),

  phone: text('phone'),
  email: text('email'),
  addressStreet: text('address_street'),
  addressCity: text('address_city'),
  addressState: text('address_state'),
  addressZip: text('address_zip'),

  /** R2 object key. Breeze's export carries no photos at all — these are
   *  uploaded through the dashboard one at a time, not migrated. */
  photoKey: text('photo_key'),

  /** YYYY-MM-DD. Sparse: 13 of 120 in the export had one. */
  birthday: text('birthday'),
  /** YYYY-MM-DD, same shape as birthday. Not in the Breeze export at all —
   *  every one of these is typed in by the member or the office. Only the
   *  month and day are ever shown; see the directory page. */
  anniversary: text('anniversary'),
  notes: text('notes'),

  /**
   * THREE states, not a boolean — this is the important one.
   *
   * The brief needs an adult/child flag because it drives both directory
   * visibility and attendance tallying, and a child appearing in the directory
   * is the exact failure the whole design guards against. But 40 of the 120
   * exported rows carry NO signal at all: no family role, no age, no birthday.
   *
   * A boolean forces those 40 to be guessed. Defaulting them to adult risks
   * listing a child; defaulting them to child hides real adults from the
   * directory. So unknown is a real, first-class state that the UI surfaces
   * and the directory treats as "not an adult" — safe by default, and visible
   * so it can be resolved rather than silently assumed.
   */
  adultChild: text('adult_child', { enum: ['adult', 'child', 'unknown'] })
    .notNull().default('unknown'),

  /** Staff-set, from consent gathered offline. Default OFF, per brief §8. */
  includeInDirectory: integer('include_in_directory', { mode: 'boolean' })
    .notNull().default(false),

  directoryStatus: text('directory_status', {
    enum: ['none', 'invited', 'active', 'revoked'],
  }).notNull().default('none'),

  /** Breeze's family grouping — 25 families across the export. Cheap to keep
   *  even though nothing surfaces it yet. */
  familyId: integer('family_id'),

  /** Breeze's "Added Date". Not required by the brief; kept as provenance. */
  addedOn: text('added_on'),

  /**
   * The phone number in E.164 (+13175550142), derived from `phone` and kept
   * ALONGSIDE it rather than replacing it. `phone` is what a human typed and
   * what staff read; this is what Twilio needs. Normalising in place would
   * throw away formatting the church recognises, and a failed normalisation
   * would silently corrupt a real number.
   */
  phoneE164: text('phone_e164'),
  /** What Twilio Lookup last said about phoneE164. 'landline' means SMS can
   *  never arrive, however opted-in the person is — which is the likeliest
   *  meaning of a 30005 failure. */
  phoneLineType: text('phone_line_type'),
  phoneCarrier: text('phone_carrier'),
  phoneCheckedAt: text('phone_checked_at'),

  /**
   * SMS consent. This exists only because texting moved IN-HOUSE — the build
   * brief §4 said consent would live in a third-party texting tool and that
   * this database would not store it, which is why the Breeze SMS column was
   * dropped on import. Bringing sending here makes us responsible for the
   * opt-out record, so it has to live here now.
   */
  smsConsent: text('sms_consent', { enum: ['unknown', 'opted_in', 'opted_out'] })
    .notNull().default('unknown'),
  /** WHERE the consent came from — 'breeze-import', 'asked-in-person',
   *  'sms-stop'. The distinction matters: an inherited flag from a previous
   *  tool is not the same evidence as someone being asked, and if consent is
   *  ever questioned "Breeze said so" is a weaker answer than a date. */
  smsConsentSource: text('sms_consent_source'),
  /** Null for imported consent, because there genuinely is no date for it. */
  smsConsentAt: text('sms_consent_at'),

  /**
   * Created by texting in, and still nameless. Someone who texts START from a
   * number we do not recognise is added immediately — refusing them because we
   * do not know their name would mean an opt-in that silently goes nowhere —
   * but the record is flagged so staff can find and complete it rather than
   * discovering an anonymous row months later.
   */
  needsProfile: integer('needs_profile', { mode: 'boolean' }).notNull().default(false),

  /** People are archived, never deleted — attendance history references them. */
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),

  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (t) => ({
  nameIdx: index('people_name_idx').on(t.lastName, t.firstName),
  archivedIdx: index('people_archived_idx').on(t.archived),
}));

/** One gathering that attendance is taken at. */
export const services = sqliteTable('services', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  /** YYYY-MM-DD in the church's own timezone — never a UTC timestamp. A
   *  service belongs to a calendar date, and storing an instant reintroduces
   *  exactly the off-by-one-day bug the public site already shipped once. */
  date: text('date').notNull(),
  /**
   * Plain TEXT in SQLite with no CHECK constraint, so the two Fairhaven Kids kinds
   * needed no migration — only this list. They are separate services rather
   * than a flag on Sunday school because `unique(date, kind)` below means a
   * children's register sharing a kind would collide with the service the
   * congregation is already in. See lib/services.ts for why they are kept off
   * the main attendance screens.
   */
  kind: text('kind', {
    enum: ['sunday-morning', 'sunday-school', 'sunday-evening', 'wednesday', 'other',
           'kids-sunday', 'kids-wednesday'],
  }).notNull(),
  label: text('label'),
  notes: text('notes'),
  createdAt: text('created_at').notNull(),
}, (t) => ({
  uniq: unique('services_date_kind').on(t.date, t.kind),
  dateIdx: index('services_date_idx').on(t.date),
}));

/** One row per person present. Absence is the absence of a row. */
export const attendance = sqliteTable('attendance', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  serviceId: integer('service_id').notNull().references(() => services.id, { onDelete: 'cascade' }),
  personId: integer('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
  /**
   * Which Fairhaven Kids class, when this row is a children's class register.
   *
   * NULL for every attendance row the congregation already has, and null for a
   * kiosk arrival ("came to church") until a teacher marks the register ("was
   * in Miss Karen's class"). The kiosk INSERTs and the teacher UPDATEs — the
   * same row, never a second one, which is what keeps the two counts from
   * disagreeing with no way to explain why. See migration 0014.
   */
  classId: integer('class_id').references(() => kidClasses.id),
  createdAt: text('created_at').notNull(),
}, (t) => ({
  /** Load-bearing well beyond attendance: it is what makes a child who taps
   *  four times get one row, so release two's Fairhaven Bucks credit fires exactly
   *  once with no application-level locking. Do not weaken it. */
  uniq: unique('attendance_service_person').on(t.serviceId, t.personId),
  classIdx: index('attendance_class_idx').on(t.classId),
  serviceIdx: index('attendance_service_idx').on(t.serviceId),
  personIdx: index('attendance_person_idx').on(t.personId),
}));

/**
 * Headcount for people who are not in the database — brief §10 wants the total
 * accurate without forcing a volunteer to create a person record for a guest
 * mid-service. Name is optional on purpose: "three visiting children" is a
 * legitimate entry and is better than nothing.
 */
export const visitors = sqliteTable('visitors', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  serviceId: integer('service_id').notNull().references(() => services.id, { onDelete: 'cascade' }),
  name: text('name'),
  /**
   * 'unknown' by default, and that is the usual case. Check-in does not ask
   * whether a guest is an adult or a child — three browser dialogs at a door
   * is a worse experience than a slightly softer number. Unknown visitors
   * count toward the TOTAL and the visitor tally but are deliberately left out
   * of the adult/child split, because filing them all as adults would be a
   * guess dressed up as data. (Plain TEXT in SQLite, so widening this needed
   * no migration.)
   */
  adultChild: text('adult_child', { enum: ['adult', 'child', 'unknown'] }).notNull().default('unknown'),
  /** Not asked at check-in either. The column stays so the brief's first-time
   *  guest count can be filled in later without a migration. */
  firstTime: integer('first_time', { mode: 'boolean' }).notNull().default(false),
  /** Set if this guest later became a person record, so the same human is not
   *  counted twice when looking back. */
  becamePersonId: integer('became_person_id').references(() => people.id),
  createdAt: text('created_at').notNull(),
}, (t) => ({
  serviceIdx: index('visitors_service_idx').on(t.serviceId),
}));

/**
 * Who may sign in. An allowlist, not self-registration: Google will happily
 * authenticate anyone on earth, so proving WHO you are is not the same as
 * being allowed in. The email must already be here.
 */
export const staff = sqliteTable('staff', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  name: text('name'),
  /**
   * Four roles, and NO check constraint in the database — `role` is plain TEXT
   * (see 0000_initial_schema.sql), which is why adding the two kids roles
   * needed no migration. The meaning of each lives in lib/permissions.ts;
   * this column only stores the word.
   */
  role: text('role', { enum: ['admin', 'editor', 'kids-director', 'kids'] })
    .notNull().default('editor'),
  /**
   * May this person send Fairhaven Kids texts?
   *
   * A CAPABILITY, not a role. Some bus captains send and most volunteers never
   * do — and a captain is a volunteer trusted with the phone bill, not a
   * different kind of person. Two more roles would have doubled the matrix to
   * express one boolean. Off by default, because the default for "may spend the
   * church's money and speak in its name" is no.
   */
  kidsCanText: integer('kids_can_text', { mode: 'boolean' }).notNull().default(false),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
  lastLoginAt: text('last_login_at'),
});

export const sessions = sqliteTable('sessions', {
  /** Random opaque token; the cookie holds this and nothing else. */
  id: text('id').primaryKey(),
  staffId: integer('staff_id').notNull().references(() => staff.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at').notNull(),
  createdAt: text('created_at').notNull(),
}, (t) => ({
  staffIdx: index('sessions_staff_idx').on(t.staffId),
}));

export type Person = typeof people.$inferSelect;
export type Service = typeof services.$inferSelect;
export type Staff = typeof staff.$inferSelect;


/** Named lists to send to. Ministries are the obvious starting set. */
export const groups = sqliteTable('groups', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  description: text('description'),
  createdAt: text('created_at').notNull(),
});

export const peopleGroups = sqliteTable('people_groups', {
  personId: integer('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
  groupId: integer('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
}, (t) => ({
  uniq: unique('people_groups_pair').on(t.personId, t.groupId),
  groupIdx: index('people_groups_group_idx').on(t.groupId),
}));

/**
 * A message queued to go out later. Rows arrive from the staff Google Sheet
 * (and can be created in the dashboard), but the SENT STATE LIVES HERE, never
 * in the sheet — a sheet is edited by hand and re-read on a schedule, so
 * trusting it for "has this gone?" is how a message fires twice.
 */
export const scheduledMessages = sqliteTable('scheduled_messages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  /** Stable identity of the sheet row, so re-reading matches rather than
   *  duplicates. Unique — this is the guard against double-sending. */
  sourceKey: text('source_key').unique(),
  source: text('source', { enum: ['sheet', 'dashboard', 'schedule'] }).notNull().default('sheet'),
  body: text('body').notNull(),
  groupId: integer('group_id').references(() => groups.id),
  /** ISO instant. Compared against now in the church's timezone by the caller. */
  sendAt: text('send_at').notNull(),
  status: text('status', { enum: ['pending', 'sent', 'failed', 'skipped'] })
    .notNull().default('pending'),
  sentAt: text('sent_at'),
  /** Why a send was skipped or failed — surfaced in the dashboard rather than
   *  swallowed, since a silent non-send is worse than a visible failure. */
  note: text('note'),
  /** The rule that produced this row. NULL for the singing reminder, which
   *  predates schedules and is generated from the roster sheet. */
  scheduleId: integer('schedule_id').references((): AnySQLiteColumn => messageSchedules.id),
  /** Resolved when the occurrence was expanded, not looked up again at send
   *  time — someone archived in between should show as a skipped row rather
   *  than disappear from the record. */
  personId: integer('person_id').references(() => people.id),
  phoneE164: text('phone_e164'),
  createdAt: text('created_at').notNull(),
}, (t) => ({
  dueIdx: index('scheduled_due_idx').on(t.status, t.sendAt),
  scheduleIdx: index('scheduled_schedule_idx').on(t.scheduleId),
}));

/**
 * A rule for sending a text later: once on a date, or every week.
 *
 * Birthday texts are deliberately NOT here — they are a standing arrangement in
 * app_settings, not something scheduled. See lib/birthday-settings.ts.
 *
 * The rule is expanded into scheduled_messages rows only when it comes DUE,
 * never in advance, so the audience is whoever qualifies at send time: a group
 * that gains a member on Friday reaches them on Saturday.
 */
export const messageSchedules = sqliteTable('message_schedules', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  /** Staff-facing label for the list. Never texted to anyone. */
  name: text('name').notNull(),
  /** May contain {first} / {name}, filled in per recipient. */
  body: text('body').notNull(),
  kind: text('kind', { enum: ['once', 'weekly'] }).notNull().default('once'),
  /** The audience, read in this order: recipientIds, then groupId, then
   *  everyone who can be texted. */
  groupId: integer('group_id').references(() => groups.id),
  /** JSON array of person ids, when the text goes to named individuals. */
  recipientIds: text('recipient_ids'),
  /** Local wall clock 'YYYY-MM-DDTHH:MM', not an instant — 8am stays 8am
   *  across a DST change, which storing UTC would not. */
  sendAt: text('send_at'),
  /** 0 = Sunday, for 'weekly'. */
  weekday: integer('weekday'),
  /** 'HH:MM' local, for 'weekly'. */
  localTime: text('local_time'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  /** Shown in the list as "last ran". Not consulted when deciding whether a
   *  rule is due — see lib/schedules.ts for why that matters. */
  lastRunAt: text('last_run_at'),
  createdBy: text('created_by'),
  createdAt: text('created_at').notNull(),
}, (t) => ({
  dueIdx: index('message_schedules_due_idx').on(t.active, t.kind),
}));

/** Every message in or out. The audit trail, and what the cost readout counts. */
export const messageLog = sqliteTable('message_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  /** Null for an inbound message from a number we do not recognise. */
  personId: integer('person_id').references(() => people.id),
  phoneE164: text('phone_e164').notNull(),
  body: text('body').notNull(),
  direction: text('direction', { enum: ['out', 'in'] }).notNull(),
  twilioSid: text('twilio_sid'),
  /** Twilio's own status: queued/sent/delivered/undelivered/failed. */
  status: text('status'),
  errorCode: text('error_code'),
  /** Segments actually billed — what the cost estimate is built from. */
  segments: integer('segments').notNull().default(1),
  scheduledMessageId: integer('scheduled_message_id').references(() => scheduledMessages.id),
  /**
   * Which part of the app sent this. 'kids' for the children's section; null
   * for everything else, including every message that predates the column.
   *
   * There is one Twilio number, so an INBOUND text carries no signal about
   * which part of the church it answers. This is how the children's replies tab
   * knows a conversation is theirs — because we started it there — rather than
   * inferring it from the sender being a guardian, which swept in every church
   * parent who texted about anything at all.
   */
  context: text('context'),
  createdAt: text('created_at').notNull(),
}, (t) => ({
  personIdx: index('message_log_person_idx').on(t.personId),
  contextIdx: index('message_log_context_idx').on(t.context),
  createdIdx: index('message_log_created_idx').on(t.createdAt),
  sidIdx: index('message_log_sid_idx').on(t.twilioSid),
}));

export type Group = typeof groups.$inferSelect;
export type ScheduledMessage = typeof scheduledMessages.$inferSelect;
export type MessageLogRow = typeof messageLog.$inferSelect;


/**
 * The weekly bulletin.
 *
 * Edited here, read by the PUBLIC site at build time through a read-only
 * endpoint. It lives in this database rather than in the site's git repo so
 * there is one place to log in — but the public page stays static, so it still
 * works in a pew with no signal, which is where it is actually read.
 *
 * The lists are JSON text. SQLite has no array type, and modelling an order of
 * service as its own table would mean joins and row ordering for something
 * that is only ever read and written whole.
 */
export const bulletins = sqliteTable('bulletins', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  /** The Sunday this is for, YYYY-MM-DD in church time. */
  serviceDate: text('service_date').notNull().unique(),
  title: text('title').notNull().default('Morning Worship'),
  /** Who is preaching. Shown in small type beside the sermon text — the pastor
   *  dropped the order of service as something nobody was reading, and this is
   *  the one line from it that mattered. */
  preacher: text('preacher'),
  /** [{ when, heading, detail }] */
  announcements: text('announcements').notNull().default('[]'),
  /** [{ text, since }] — carried over week to week, unlike announcements. */
  prayerRequests: text('prayer_requests').notNull().default('[]'),
  scripture: text('scripture'),
  scriptureRef: text('scripture_ref'),
  /**
   * Brief §6 asks for a publish step rather than edits going straight live.
   * A draft is invisible to the public site no matter how many times the site
   * rebuilds, so a half-finished bulletin cannot appear in a pew by accident.
   */
  status: text('status', { enum: ['draft', 'published'] }).notNull().default('draft'),
  publishedAt: text('published_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (t) => ({
  dateIdx: index('bulletins_date_idx').on(t.serviceDate),
}));

export type Bulletin = typeof bulletins.$inferSelect;
export interface Announcement { when: string; heading: string; detail: string }
/** `since` is the service date this request first appeared, so the editor can
 *  say how many weeks it has been carried. */
export interface PrayerRequest { text: string; since: string }


/**
 * A single-use invitation to the member directory.
 *
 * Single-use on purpose. A reusable link is a shared password: forwarded once
 * in a family group chat and the directory is open to whoever that reaches.
 * The cost is that a new phone or a cleared browser needs a fresh invite,
 * which the brief anticipates (§8) and which is the right side of that trade
 * for a document holding the congregation's addresses.
 */
export const directoryInvites = sqliteTable('directory_invites', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  personId: integer('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
  /** Long random token; the whole security of the link rests on it. */
  token: text('token').notNull().unique(),
  /** Invites expire whether or not they are used — a link found in an old
   *  message a year later must not still open the directory. */
  expiresAt: integer('expires_at').notNull(),
  usedAt: text('used_at'),
  /** When a text carrying this link was successfully handed to Twilio. NULL
   *  means it has never been sent, or the send failed — either way it should
   *  be tried again. This, not directoryStatus, is what stops a second text. */
  sentAt: text('sent_at'),
  /** Who generated it, so an unexpected invite can be traced. */
  createdBy: text('created_by'),
  createdAt: text('created_at').notNull(),
}, (t) => ({
  personIdx: index('directory_invites_person_idx').on(t.personId),
}));

/**
 * A member's session. DELIBERATELY SEPARATE from the staff `sessions` table.
 *
 * One table with a role column is how a member ends up holding a staff session
 * after somebody writes a query that forgets to check the column. Two tables
 * cannot be confused: staff middleware reads one, the directory reads the
 * other, and there is no value of any field that turns a member into staff.
 */
export const memberSessions = sqliteTable('member_sessions', {
  id: text('id').primaryKey(),
  personId: integer('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at').notNull(),
  createdAt: text('created_at').notNull(),
}, (t) => ({
  personIdx: index('member_sessions_person_idx').on(t.personId),
}));

export type DirectoryInvite = typeof directoryInvites.$inferSelect;


/**
 * Staff-editable settings. Key/value rather than a column each, so rewording a
 * message does not need a migration.
 *
 * Anything here is edited by people, which means anything here can be edited
 * WRONG — see getInviteTemplate in lib/directory for the shape that takes:
 * validate on save, and fall back to the built-in default on read rather than
 * trusting whatever is in the row.
 */
export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull(),
  updatedBy: text('updated_by'),
});


/**
 * Fairhaven Kids — the children's-ministry section.
 *
 * See migrations/0014_sekids.sql, which carries the reasoning in full. The
 * three decisions worth repeating here, because they are the ones a later
 * change is most likely to undo by accident:
 *
 *   1. Children stay in `people`. These tables add what is true of a CHILD
 *      beside that row; they do not duplicate the person.
 *   2. Guardians are NOT `people` rows — most bus-ministry parents are not
 *      members, and adding them would put them in the congregation's people
 *      list, the messaging counts and the attendance statistics.
 *   3. Routes are a table, because a bus captain's send rights are scoped by
 *      route and a free-text string is not a permission key.
 */

/** The five age groups. Fixed by age; settled with the pastor 2026-09-08. */
export const kidClasses = sqliteTable('kid_classes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  description: text('description'),
  /**
   * Age bounds as numbers, so "should probably be in Ages 7-9" is a query
   * rather than the name parsed back apart. Class is stored EXPLICITLY on the
   * profile and never derived from these: `people.birthday` is sparse and bus
   * children mostly have none, so deriving would file them nowhere in silence.
   */
  minAge: integer('min_age'),
  maxAge: integer('max_age'),
  sort: integer('sort').notNull().default(0),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
});

/** Bus routes. Not seeded — an invented route is indistinguishable from a real
 *  one once a child has been assigned to it. */
export const kidRoutes = sqliteTable('kid_routes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  notes: text('notes'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
});

/** What is true of a child, beside their `people` row. */
export const kidProfiles = sqliteTable('kid_profiles', {
  /** The person IS the key — one profile per child, and it cannot exist
   *  without the person it describes. */
  personId: integer('person_id').primaryKey()
    .references(() => people.id, { onDelete: 'cascade' }),
  classId: integer('class_id').references(() => kidClasses.id),
  /** NULL is the NORMAL case: only bus-ministry children have a route. */
  routeId: integer('route_id').references(() => kidRoutes.id),
  /** Its own column rather than a line in notes. This is what a volunteer has
   *  to find in four seconds; notes is where things go to be scrolled past. */
  allergies: text('allergies'),
  medicalNotes: text('medical_notes'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (t) => ({
  classIdx: index('kid_profiles_class_idx').on(t.classId),
  routeIdx: index('kid_profiles_route_idx').on(t.routeId),
}));

/** A child's grown-ups. */
export const kidGuardians = sqliteTable('kid_guardians', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  /** The CHILD, not the guardian. */
  personId: integer('person_id').notNull()
    .references(() => people.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /** Free text: family shapes do not fit an enum, and a wrong dropdown is
   *  worse than a blank. */
  relationship: text('relationship'),
  /** What a human typed, and what Twilio needs — kept side by side for the
   *  same reason as on `people`. */
  phone: text('phone'),
  phoneE164: text('phone_e164'),
  email: text('email'),
  addressStreet: text('address_street'),
  addressCity: text('address_city'),
  addressState: text('address_state'),
  addressZip: text('address_zip'),
  /**
   * Set when this guardian IS a member — and it is the DOUBLE-TEXT GUARD. A
   * parent who is also a member exists in both tables, and without deciding in
   * one place which record gets texted they receive every bus message twice.
   * See §7.2 of the brief before writing the kids audience builder.
   */
  memberPersonId: integer('member_person_id').references(() => people.id),
  isPrimary: integer('is_primary', { mode: 'boolean' }).notNull().default(false),
  /**
   * Mirrors people.smsConsent, and that duplication is the price of keeping
   * bus families out of the congregation's list.
   *
   * IT IS ONLY WORTH PAYING IF STOP SPANS BOTH TABLES. The webhook updates
   * `people` alone today, so a parent whose number exists only here could text
   * STOP, have it logged as handled, and keep receiving texts. Nothing may
   * send to these rows until that is fixed and tested from a guardian-only
   * number.
   */
  smsConsent: text('sms_consent', { enum: ['unknown', 'opted_in', 'opted_out'] })
    .notNull().default('unknown'),
  /** 'verbal-at-intake' | 'sms-start' | 'sms-stop' — the pastor gathers consent
   *  verbally and by the family texting START, and both need a date. */
  smsConsentSource: text('sms_consent_source'),
  smsConsentAt: text('sms_consent_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (t) => ({
  personIdx: index('kid_guardians_person_idx').on(t.personId),
  /** What the STOP handler looks up. Opt-out is matched by NUMBER, never by
   *  person — one handset, one decision. */
  phoneIdx: index('kid_guardians_phone_idx').on(t.phoneE164),
}));

/** Who teaches what. For reports and for "your class" on a teacher's phone —
 *  NOT a restriction. Every Fairhaven Kids volunteer can see every child. */
export const kidClassTeachers = sqliteTable('kid_class_teachers', {
  staffId: integer('staff_id').notNull()
    .references(() => staff.id, { onDelete: 'cascade' }),
  classId: integer('class_id').notNull()
    .references(() => kidClasses.id, { onDelete: 'cascade' }),
  createdAt: text('created_at').notNull(),
}, (t) => ({
  uniq: unique('kid_class_teachers_pair').on(t.staffId, t.classId),
}));

export type KidClass = typeof kidClasses.$inferSelect;
export type KidRoute = typeof kidRoutes.$inferSelect;
export type KidProfile = typeof kidProfiles.$inferSelect;
export type KidGuardian = typeof kidGuardians.$inferSelect;


/**
 * Fairhaven Bucks — play money, and the cards children carry.
 *
 * No cash value, no relationship to real currency, and nothing here ever goes
 * near a payment detail. See migrations/0015_sekids_bucks.sql for the full
 * reasoning; the two things worth repeating are that this is a LEDGER rather
 * than a balance, and that one attendance credit per child per meeting is
 * enforced by a partial unique index rather than by application code.
 */
export const kidLedger = sqliteTable('kid_ledger', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  personId: integer('person_id').notNull()
    .references(() => people.id, { onDelete: 'cascade' }),
  /** Signed. Awards and credits positive, spending negative — so a balance is
   *  a sum rather than a subtraction somebody can get backwards. */
  delta: integer('delta').notNull(),
  reason: text('reason', { enum: ['attendance', 'award', 'spend', 'correction'] }).notNull(),
  note: text('note'),
  /** Set for an attendance credit, and what the partial index is unique on. */
  serviceId: integer('service_id').references(() => services.id),
  /** Who did it. Null when the kiosk did rather than a person. */
  staffId: integer('staff_id').references(() => staff.id),
  /** Release two. Declared now so the column is not added to a populated table. */
  kioskDeviceId: integer('kiosk_device_id'),
  createdAt: text('created_at').notNull(),
}, (t) => ({
  personIdx: index('kid_ledger_person_idx').on(t.personId),
  /*
   * The partial unique index that makes the automatic credit fire exactly once
   * is NOT declared here — drizzle has no partial-index syntax, so it lives in
   * the migration alone. It is real in the database and it is load-bearing:
   * see kid_ledger_attendance_once in 0015. Do not "add" it here and do not
   * assume its absence from this file means it is not there.
   */
}));

/** A child's card. A table, not a column — reissuing revokes rather than
 *  overwrites, because two live tokens for one child is two credits. */
export const kidCards = sqliteTable('kid_cards', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  personId: integer('person_id').notNull()
    .references(() => people.id, { onDelete: 'cascade' }),
  /** Long, random, opaque, and unique across every card ever issued —
   *  revoked ones included, so a token can never be handed out twice. */
  token: text('token').notNull().unique(),
  /**
   * The tag's UID, if a reader has told us one.
   *
   * NOT a substitute for the token and never interchangeable with it. A UID is
   * burned in by the chip manufacturer, is often printed on the card, and is
   * trivially cloned onto a blank tag — so it may check a child IN and nothing
   * more. The token above is what opens a child's profile. Cloning a UID buys
   * you the ability to mark somebody present; if the UID were the profile key
   * it would buy you their address.
   *
   * Unique where present (partial index, in migration 0016) so one tag cannot
   * belong to two children and make a scan ambiguous.
   */
  uid: text('uid'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  issuedAt: text('issued_at').notNull(),
  revokedAt: text('revoked_at'),
  issuedBy: text('issued_by'),
}, (t) => ({
  personIdx: index('kid_cards_person_idx').on(t.personId),
}));

export type KidLedgerRow = typeof kidLedger.$inferSelect;
export type KidCard = typeof kidCards.$inferSelect;


/**
 * A registered check-in tablet.
 *
 * Its own table and its own principal — see lib/kiosk.ts and §6.3 of the brief
 * for why this is not a `staff` row with a narrow role.
 */
export const kioskDevices = sqliteTable('kiosk_devices', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  /** The pairing secret, held in a cookie on that one tablet. */
  token: text('token').notNull().unique(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  /** Written on a scan, so a director can tell a working tablet from one
   *  unplugged since March. */
  lastSeenAt: text('last_seen_at'),
  revokedAt: text('revoked_at'),
  createdBy: text('created_by'),
  createdAt: text('created_at').notNull(),
});

export type KioskDevice = typeof kioskDevices.$inferSelect;


/**
 * Which bus routes a captain may text.
 *
 * The audience is derived from THIS, never from what the browser submitted —
 * a captain editing a route id in a form must reach nobody new. The director is
 * deliberately absent: they may text any route, and listing every route against
 * them would be a list to keep in step forever.
 */
export const kidRouteCaptains = sqliteTable('kid_route_captains', {
  staffId: integer('staff_id').notNull()
    .references(() => staff.id, { onDelete: 'cascade' }),
  routeId: integer('route_id').notNull()
    .references(() => kidRoutes.id, { onDelete: 'cascade' }),
  createdAt: text('created_at').notNull(),
}, (t) => ({
  uniq: unique('kid_route_captains_pair').on(t.staffId, t.routeId),
}));
