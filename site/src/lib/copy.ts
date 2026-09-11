/**
 * Page text, read from content with the page's own words as the fallback.
 *
 * Used as `t('hero.headline', 'A place to call home')`. If copy/<page>.yaml
 * carries that key it wins; otherwise the second argument is used.
 *
 * THE FALLBACK IS THE POINT. Moving several hundred sentences out of the pages
 * and into YAML is exactly the sort of migration where one mistyped key leaves
 * a blank heading on a live page and nobody notices for a week. Here the worst
 * a mistake can do is leave the original sentence showing — which is what the
 * page said yesterday, so it is never wrong, only un-edited.
 *
 * It also means a page works before its copy file exists, so this can be rolled
 * out a page at a time rather than in one commit that has to be perfect.
 */
import { getCollection } from 'astro:content';

type Dict = Record<string, unknown>;

/** "hero.headline" -> data.hero.headline, without throwing on a missing branch. */
function dig(data: Dict, path: string): unknown {
  let node: unknown = data;
  for (const part of path.split('.')) {
    if (node == null || typeof node !== 'object') return undefined;
    node = (node as Dict)[part];
  }
  return node;
}

export type Copy = (key: string, fallback: string) => string;

export async function copyFor(page: string): Promise<Copy> {
  const entries = await getCollection('copy');
  const entry = entries.find((e) => e.id === page || e.id === `${page}.yaml`);
  const data = (entry?.data ?? {}) as Dict;

  return (key, fallback) => {
    const v = dig(data, key);
    // An empty string is a deliberate "show nothing"; only absence falls back.
    return typeof v === 'string' ? v : fallback;
  };
}
