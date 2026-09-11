#!/bin/sh
# Every copy file, against the pages it actually feeds. Run after any change to
# a page's text or its copy file — a key that stops reaching the page is a
# dashboard field that silently does nothing.
set -e
cd "$(dirname "$0")/.."
npx astro build >/dev/null
fail=0
run() { node scripts/prove-copy.mjs "$@" || fail=1; }
run home        dist/index.html
run about       dist/about/index.html
run im-new      dist/about/im-new/index.html
run beliefs     dist/about/beliefs/index.html
run staff       dist/about/staff/index.html
run contact     dist/contact/index.html
run give        dist/give/index.html
run events      dist/events/index.html
run livestream  dist/livestream/index.html
run directory   dist/directory/index.html
run bulletin    dist/bulletin/index.html
run ministries  dist/ministries/index.html dist/ministries/*/index.html
run sermons     dist/sermons/index.html
run thank-you   dist/contact/thank-you/index.html
run navigation  dist/index.html

# The last build in that run was made from sentinel values, and leaving it in
# dist/ means the next person to look at a built page sees ZQX7MARK where the
# footer should be. The real words are already back in the files; rebuild so
# the built copy matches them.
npx astro build >/dev/null

exit $fail
