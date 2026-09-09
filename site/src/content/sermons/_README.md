# Sermons

Leave this empty. `site/scripts/import-sermons.mjs` fills it from your YouTube
channel once `youtubeChannelId` is set and a `YOUTUBE_API_KEY` exists, and it
runs nightly after that.

One file per service. The importer can only know what the video title tells it,
so a title like `September 6, 2026 | Sunday Morning | Pastor Smith | Hope That
Holds` yields a full entry, and `Live Stream` yields a bare one. See SETUP.md,
"Titling your uploads so the site can read them" — this is the highest-leverage
five minutes in the whole setup.
