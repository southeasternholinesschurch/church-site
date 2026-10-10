/**
 * Just enough of `node:fs` for the two tests that read the site's own files.
 *
 * `astro check` type-checks this folder alongside src/, and `node:fs` has no
 * types here — deliberately. The tests are told not to import from `node:`
 * because this is a Workers project: pulling in @types/node would let `Buffer`
 * and friends typecheck inside src/, where they do not exist at runtime, and
 * the failure would land in production rather than in CI.
 *
 * Two tests are the exception, because their whole job is to read files out of
 * site/ — site-copy.test.ts checks every copy YAML has the fields the page
 * reads, and sermon-bodies.test.ts checks no published sermon still carries an
 * editor's note. Neither can do that without touching the disk.
 *
 * So rather than the whole of @types/node, this declares the two functions
 * they actually call, with only the signatures they actually use. The cost of
 * being wrong here is confined to this folder.
 *
 * WHY THIS FILE EXISTS AT ALL: without it `astro check` reported 27 errors —
 * one "cannot find module" and 26 implicit-anys cascading off it, since
 * everything read from an untyped module is `any` and the config is strict.
 * That turned the Check app workflow red on EVERY push from 2026-09-11 to
 * 2026-09-30, which taught everyone to ignore its emails. A check nobody reads
 * is worse than no check: a real break would have arrived looking identical.
 */
declare module 'node:fs' {
  /** Only the plain form. `withFileTypes` would return Dirents, not strings. */
  export function readdirSync(path: string | URL): string[];
  /** Only the text form. Without an encoding this returns a Buffer. */
  export function readFileSync(path: string | URL, encoding: 'utf8'): string;
}
