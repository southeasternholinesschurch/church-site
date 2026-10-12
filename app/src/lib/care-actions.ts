/**
 * Every form on the care screens, handled in one place.
 *
 * The follow-up list, a person's care page and a guest's card all offer the
 * same few acts — log what happened, snooze, close, assign, set a reminder —
 * and they must mean the same thing wherever they are pressed. Three pages each
 * with their own copy of "logging a contact closes the follow-up" is how one of
 * them ends up not closing it.
 *
 * Returns a short code for the page to show as its confirmation, or an error
 * sentence. Everything is re-read and re-checked here rather than trusted from
 * the form: an item id in a replayed form may have been closed by the other
 * pastor in the meantime.
 */
import {
  churchDate, careKindLabel, isCareKind, nextDate, shortDate,
} from './care';
import {
  addNote, addReminder, assignItem, closeItem, itemById, snoozeItem, careStaff,
  guestToPerson, deleteGuest, itemsFor, type Actor,
} from './care-db';
import { getDb, schema } from '../db';
import { eq } from 'drizzle-orm';

type Env = { DB: D1Database };

export type CareResult = { done: string } | { error: string } | { redirect: string };

const str = (form: FormData, k: string, max = 4000): string => {
  const v = form.get(k);
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
};
const num = (form: FormData, k: string): number | null => {
  const n = Number(form.get(k));
  return Number.isInteger(n) && n > 0 ? n : null;
};
const isIso = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

export async function careAction(env: Env, form: FormData, by: Actor): Promise<CareResult | null> {
  const action = str(form, 'action', 40);
  if (!action) return null;
  const today = churchDate();

  /* ---- log what happened, against an item or a person/guest directly ---- */
  if (action === 'log') {
    const kind = str(form, 'kind', 20);
    if (!isCareKind(kind)) return { error: 'Choose what kind of contact it was.' };
    const onDate = str(form, 'onDate', 10) || today;
    // A contact cannot have happened tomorrow; a date typed as next year is a
    // slip, and the log is evidence, so it is refused rather than kept.
    if (!isIso(onDate) || onDate > today) return { error: 'The date it happened has to be today or earlier.' };
    const body = str(form, 'body') || null;

    const itemId = num(form, 'itemId');
    const item = itemId ? await itemById(env, itemId) : null;
    const personId = item?.personId ?? num(form, 'personId');
    const guestId = item ? (item.personId ? null : item.guestId) : num(form, 'guestId');
    if (!personId && !guestId) return { error: 'That follow-up is no longer there.' };

    await addNote(env, { personId, guestId, kind, onDate, body }, by);
    const closing = `${careKindLabel(kind)} ${shortDate(onDate)}`;
    if (item && item.status === 'open') {
      await closeItem(env, item.id, closing, by);
    } else if (!item && form.get('closeOpen') === 'on') {
      /*
       * Logged from a person's own page, with "this answers what is open"
       * ticked: every follow-up for them that is DUE is answered by this.
       * Not the ones still in the future — a reminder to visit after next
       * week's surgery is not answered by today's phone call.
       */
      const open = (await itemsFor(env, personId ? { personId } : { guestId: guestId! }))
        .filter((i) => i.status === 'open' && i.dueOn <= today);
      for (const i of open) await closeItem(env, i.id, closing, by);
    }
    const again = nextDate(today, str(form, 'next', 20), str(form, 'nextOn', 10));
    if (again) {
      await addReminder(env, { personId, guestId }, again, 'Check in again', by);
      return { done: 'logged-again' };
    }
    return { done: 'logged' };
  }

  /* ---- a reminder with no contact yet: "visit after her surgery" -------- */
  if (action === 'remind') {
    const personId = num(form, 'personId');
    const guestId = personId ? null : num(form, 'guestId');
    if (!personId && !guestId) return { error: 'Nobody to remind you about.' };
    const due = nextDate(today, str(form, 'next', 20), str(form, 'nextOn', 10));
    if (!due) return { error: 'Choose when to be reminded.' };
    await addReminder(env, { personId, guestId }, due, str(form, 'reason', 200) || 'Check in', by);
    return { done: 'reminded' };
  }

  const itemId = num(form, 'itemId');

  /* ---- not now: "away until the 20th" ------------------------------------ */
  if (action === 'snooze' && itemId) {
    const until = nextDate(today, str(form, 'next', 20), str(form, 'nextOn', 10));
    if (!until) return { error: 'Choose when it should come back.' };
    const item = await itemById(env, itemId);
    if (!item || item.status !== 'open') return { done: 'gone' };
    await snoozeItem(env, itemId, until);
    const why = str(form, 'reason', 500);
    if (why) {
      await addNote(env, { personId: item.personId, guestId: item.personId ? null : item.guestId,
        kind: 'note', onDate: today, body: `Snoozed until ${shortDate(until)}: ${why}` }, by);
    }
    return { done: 'snoozed' };
  }

  /* ---- nothing to do: "moved to Florida", "spoke at church" -------------- */
  if (action === 'close' && itemId) {
    const item = await itemById(env, itemId);
    if (!item || item.status !== 'open') return { done: 'gone' };
    const why = str(form, 'reason', 500);
    await closeItem(env, itemId, why || 'Closed', by);
    // The reason is history, so it goes in the log as well as on the item —
    // the item is gone from view once closed, the log is what is read later.
    if (why) {
      await addNote(env, { personId: item.personId, guestId: item.personId ? null : item.guestId,
        kind: 'note', onDate: today, body: `Closed the follow-up: ${why}` }, by);
    }
    return { done: 'closed' };
  }

  if (action === 'assign' && itemId) {
    const raw = num(form, 'staffId');
    // Only somebody who can actually see this list. A stale form naming a
    // former admin assigns to nobody rather than to someone locked out of it.
    const allowed = raw && (await careStaff(env)).some((s) => s.id === raw) ? raw : null;
    await assignItem(env, itemId, allowed);
    return { done: allowed ? 'assigned' : 'unassigned' };
  }

  if (action === 'delete-note') {
    const noteId = num(form, 'noteId');
    if (noteId) await getDb(env).delete(schema.careNotes).where(eq(schema.careNotes.id, noteId));
    return { done: 'note-deleted' };
  }

  /* ---- guest cards ------------------------------------------------------- */
  if (action === 'to-person') {
    const guestId = num(form, 'guestId');
    if (!guestId) return { error: 'That card is no longer there.' };
    const personId = await guestToPerson(env, guestId, by);
    if (!personId) return { error: 'That card is no longer there.' };
    return { redirect: `/people/${personId}?saved=from-guest` };
  }

  if (action === 'delete-guest') {
    const guestId = num(form, 'guestId');
    if (guestId) await deleteGuest(env, guestId);
    return { redirect: '/care?done=guest-deleted' };
  }

  return null;
}

/** What each confirmation says. One list, so every page says the same thing. */
export const CARE_DONE: Record<string, string> = {
  logged: 'Saved to the care log, and the follow-up is closed.',
  'logged-again': 'Saved to the care log. A reminder to check in again is on the list for that day.',
  reminded: 'Reminder set. It will appear on the list on that day.',
  snoozed: 'Snoozed. It will come back on the list on that day.',
  closed: 'Closed.',
  gone: 'That one was already dealt with — perhaps by someone else a moment ago.',
  assigned: 'Assigned.',
  unassigned: 'Nobody is assigned to it now.',
  'note-deleted': 'Note deleted.',
  'guest-deleted': 'Guest card deleted, with its follow-up.',
  settings: 'Saved.',
};
