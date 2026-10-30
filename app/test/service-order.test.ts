/**
 * Service orders: the rules in lib/service-order.ts, and who may reach them.
 *
 * Run: node --experimental-strip-types --no-warnings test/service-order.test.ts
 *
 * Same plain style and no node: imports as the other tests here.
 */
import {
  isEvening, isIsoDate, itemsFromForm, LIMITS, longDate, parseItems, singersText, traditionalItems, TRADITIONAL,
} from '../src/lib/service-order.ts';
import { isPublicPath } from '../src/lib/public-paths.ts';
import { canAccess } from '../src/lib/permissions.ts';

let fail = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.error(`FAIL ${label}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${label}`);
};

/* ---- who reaches it: staff, never the public, never the Fairhaven Kids volunteers ---- */
eq('the list is not public', isPublicPath('/service-orders'), false);
eq('a printout is not public', isPublicPath('/service-orders/3/print'), false);
eq('an editor can make one', canAccess('editor', '/service-orders/3'), true);
eq('an admin can make one', canAccess('admin', '/service-orders'), true);
eq('a kids volunteer cannot', canAccess('kids', '/service-orders'), false);
eq('a kids director cannot', canAccess('kids-director', '/service-orders/3/print'), false);

/* ---- the Serving tab, which gathers this with sign-ups and singing ---- */
eq('the Serving overview is not public', isPublicPath('/serving'), false);
eq('an editor reaches Serving', canAccess('editor', '/serving'), true);
eq('a kids volunteer does not', canAccess('kids', '/serving'), false);
eq('a kids director does not', canAccess('kids-director', '/serving'), false);

/* ---- the traditional order, as the pastor gave it ---- */
eq('the usual order', TRADITIONAL, ['Opening Prayer', 'Congregational Singing', 'Testimony Time', 'Prayer Time',
  'Offering', 'Announcements', 'Special Song', 'Message', 'Altar Service or Benediction']);
const t = traditionalItems({ singers: 'Rachel & Ben', preacher: 'Bro. Reeve' });
eq('the singers go on Special Song', t.find((x) => x.title === 'Special Song')?.who, 'Rachel & Ben');
eq('the preacher goes on Message', t.find((x) => x.title === 'Message')?.who, 'Bro. Reeve');
eq('nothing else is guessed', t.filter((x) => x.who).length, 2);
eq('with nothing known, every leader is blank', traditionalItems().every((x) => x.who === ''), true);

/* ---- the singers, from the schedule ---- */
eq('two singers', singersText({ names: ['Rachel', 'Ben'], note: null }), 'Rachel & Ben');
eq('three singers', singersText({ names: ['A', 'B', 'C'], note: null }), 'A, B & C');
eq('a note stands as it is', singersText({ names: [], note: 'Revival' }), 'Revival');
eq('no slot, no singers', singersText(undefined), '');
eq('evening by name', isEvening('Sunday Evening Service'), true);
eq('night by name', isEvening('Wednesday Night Service'), true);
eq('morning is not evening', isEvening('Sunday Morning Worship'), false);
eq('an afternoon service is not evening', isEvening('Afternoon Service'), false);

/* ---- the editor's rows ---- */
eq('rows keep their order', itemsFromForm(['Choruses', 'Prayer'], ['', 'Bro. Mark'], ['Victory in Jesus', '']),
  [{ title: 'Choruses', who: '', notes: 'Victory in Jesus' }, { title: 'Prayer', who: 'Bro. Mark', notes: '' }]);
eq('a row with no title is dropped, even with a leader', itemsFromForm(['', 'Offering'], ['Someone', ''], ['', '']),
  [{ title: 'Offering', who: '', notes: '' }]);
eq('notes keep their lines', itemsFromForm(['Singing'], [''], ['Song one\r\nSong two'])[0]?.notes, 'Song one\nSong two');
eq('a title is one line', itemsFromForm(['Special\nSong'], [''], [''])[0]?.title, 'Special Song');
eq('long text is clipped', itemsFromForm(['x'.repeat(200)], [''], [''])[0]?.title.length, LIMITS.title);
eq('at most 40 parts', itemsFromForm(Array(60).fill('Song'), [], []).length, 40);
eq('missing who and notes are blank', itemsFromForm(['Welcome'], [], []), [{ title: 'Welcome', who: '', notes: '' }]);

/* ---- stored JSON ---- */
eq('a round trip', parseItems(JSON.stringify(t)), t);
eq('garbage opens as empty', parseItems('{not json'), []);
eq('not a list opens as empty', parseItems('{"a":1}'), []);
eq('null opens as empty', parseItems(null), []);
eq('bad rows are skipped', parseItems('[null, 3, {"title":"Offering"}]'), [{ title: 'Offering', who: '', notes: '' }]);

/* ---- dates ---- */
eq('the long date', longDate('2026-10-25'), 'Sunday, October 25, 2026');
eq('a real date', isIsoDate('2026-10-25'), true);
eq('not a date', isIsoDate('10/25/2026'), false);
eq('empty is not a date', isIsoDate(''), false);

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
if (fail) process.exit(1);
