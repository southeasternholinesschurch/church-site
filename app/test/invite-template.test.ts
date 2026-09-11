/**
 * The editable invite wording.
 *
 * The failure this guards against is specific: someone rewords the message,
 * drops {link} without noticing, and sixty-two people get a text telling them
 * about a directory with no way into it. That is not recoverable by editing —
 * the texts have gone.
 *
 * So it is checked on save AND on read, and both are tested here.
 *
 *   npm test
 */
import { renderInvite, invalidTemplateReason, DEFAULT_INVITE_MESSAGE, INVITE_LINK_TOKEN }
  from '../src/lib/invite-template.ts';

let fail = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(46)} got ${JSON.stringify(got)}${ok ? '' : `  want ${JSON.stringify(want)}`}`);
};
const ok = (label: string, got: unknown) => eq(label, got === null, true);
const bad = (label: string, got: unknown) => eq(label, typeof got === 'string', true);

const O = 'https://app.yourchurch.org';
const T = 'abc123';
const LINK = `${O}/directory/join/${T}`;

console.log('the default wording is itself valid');
ok('default passes validation', invalidTemplateReason(DEFAULT_INVITE_MESSAGE));
eq('default renders the link', renderInvite(DEFAULT_INVITE_MESSAGE, O, T).includes(LINK), true);
eq('and leaves no placeholder behind',
   renderInvite(DEFAULT_INVITE_MESSAGE, O, T).includes(INVITE_LINK_TOKEN), false);

console.log('\na message with no link is refused');
bad('no placeholder at all', invalidTemplateReason('Come and see the directory!'));
bad('empty', invalidTemplateReason(''));
bad('only whitespace', invalidTemplateReason('   \n  '));
bad('near-miss {links}', invalidTemplateReason('Here: {links}'));
bad('near-miss {Link}', invalidTemplateReason('Here: {Link}'));
bad('over 900 characters', invalidTemplateReason('x'.repeat(901) + '{link}'));

console.log('\nreasonable rewordings are accepted');
ok('short', invalidTemplateReason('Directory: {link}'));
ok('chatty', invalidTemplateReason('Hi! Here is your church directory link: {link} - Pastor the pastor'));
ok('link first', invalidTemplateReason('{link} is your personal directory link.'));
ok('900 exactly', invalidTemplateReason('x'.repeat(894) + '{link}'));

console.log('\nsubstitution');
eq('replaces the placeholder', renderInvite('A {link} B', O, T), `A ${LINK} B`);
eq('replaces EVERY occurrence', renderInvite('{link} and {link}', O, T), `${LINK} and ${LINK}`);
eq('leaves other braces alone', renderInvite('{name}: {link}', O, T), `{name}: ${LINK}`);
eq('no placeholder, no change', renderInvite('nothing here', O, T), 'nothing here');

console.log(fail ? `\n${fail} FAILING` : '\nall passing');
process.exit(fail ? 1 : 0);
