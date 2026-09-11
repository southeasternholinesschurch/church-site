import { defineCollection, reference, z } from 'astro:content';

// Content collections give every editor (Decap CMS or the pastor by hand) a
// typed schema — a malformed sermon date or a missing YouTube ID fails the
// build loudly instead of quietly breaking a page in production.

// A handful of settings fields are "real URL once filled in, empty string
// placeholder until then" (TODOs in site.yaml). Plain z.string().url()
// rejects "" outright, so this accepts either and normalizes "" -> undefined
// for consumers ( `if (settings.calendarFeedUrl)` reads correctly either way).
const optionalUrl = () =>
  z
    .union([z.string().url(), z.literal('')])
    .optional()
    .transform((v) => (v ? v : undefined));

/**
 * The channel is an archive of full SERVICE recordings, not individually
 * titled sermons — every upload is named "August 23, 2026 Sunday Morning
 * Worship", with no speaker, scripture or series anywhere in its metadata.
 *
 * So only what the import can actually establish is required: the service
 * date, the service label, and the video. Everything else is optional
 * enrichment that someone can add by hand in the CMS, one entry at a time,
 * and the pages render richer when it's there. Making `speaker` required —
 * as it was — would have blocked the whole back-catalogue import.
 */
/**
 * A preaching series — the organising idea a run of sermons belongs to.
 *
 * A collection rather than a free-text field on each sermon, for one reason
 * that matters in practice: free text means "Ephesians", "Ephesians " and
 * "ephesians" are three different series, and nobody notices until the archive
 * has three pages with one sermon each. Sermons now REFERENCE an entry here,
 * so Astro fails the build on a name that does not exist instead of silently
 * inventing a series.
 *
 * It also gives a series somewhere to keep its own artwork and description,
 * which a string cannot.
 */
const series = defineCollection({
  type: 'content',
  schema: z.object({
    name: z.string(),
    /** One or two sentences, shown on the series page and in search results. */
    summary: z.string().optional(),
    /** Key into assets/series/ — the FILENAME, resolved by glob. See lib/sermon-assets.ts. */
    artwork: z.string().optional(),
    /** e.g. "Ephesians" or "The Sermon on the Mount". */
    scripture: z.string().optional(),
    draft: z.boolean().default(false),
  }),
});

const sermons = defineCollection({
  type: 'content',
  schema: z.object({
    date: z.coerce.date().describe('The date of the SERVICE, not the upload'),
    youtubeId: z.string().describe('The 11-character YouTube video ID, not the full URL'),
    service: z.string().default('Service').describe('Service label as written on the channel'),
    serviceType: z
      .enum(['sunday-morning', 'sunday-evening', 'wednesday', 'other'])
      .default('other'),

    // --- optional enrichment: absent on imported entries, added by hand ---
    title: z.string().optional().describe('The sermon title, if someone adds one'),
    speaker: z.string().optional(),
    /** The series this belongs to. A reference, so a typo fails the build. */
    series: reference('series').optional(),
    /**
     * Artwork for THIS sermon, overriding the series' own.
     *
     * The cascade is sermon -> series -> the YouTube thumbnail, so a church
     * with no graphics at all still gets a usable card and link preview.
     */
    image: z.string().optional(),
    scripture: z.string().optional(),

    draft: z.boolean().default(false),
  }),
});

/**
 * Church staff and leadership, shown on /about/staff.
 *
 * `photo` names a key in lib/staff-assets.ts rather than a filename, so a
 * typo can't break the build — an unmapped or absent value renders a visible
 * "Photo needed" marker instead, the same way ministries handle it.
 */
/** Articles of faith, shown on /about/beliefs. One entry per article. */
const beliefs = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    order: z.number(),
  }),
});

const staff = defineCollection({
  type: 'content',
  schema: z.object({
    name: z.string(),
    role: z.string(),
    order: z.number(),
    photo: z.string().optional(),
    /**
     * Vertical focal point for the circular crop, as a percentage.
     *
     * Portraits are cropped to a circle, which for a tall photo keeps only the
     * middle ~56% of its height. Centred (50%) clips the top of the head on a
     * seated portrait, so the default is 22% — measured against the real
     * photo, not guessed. Override per person when a photo frames differently.
     */
    focus: z.number().min(0).max(100).default(22),
    /** Override the alt text — e.g. when the photo shows more than one person. */
    photoAlt: z.string().optional(),
  }),
});

const ministries = defineCollection({
  type: 'content',
  schema: z.object({
    name: z.string(),
    order: z.number(),
    ageRange: z.string().optional(),
    // Which accent ramp (defined in src/styles/tokens.css) this ministry
    // section uses. "placeholder" ministries are clearly flagged so nobody
    // mistakes provisional colors/copy for final brand.
    //
    // The men's ministry was pulled on 2026-08-29 pending a rename, because
    // "Fairhaven Men" reads as an unintended word. It returned on 2026-09-02 as Fairhaven Men,
    // named for Isaiah 6:8 — so 'men' IS the men's ministry, not a fifth one.
    accent: z.enum(['men', 'kids', 'youth', 'women', 'seniors']),
    placeholder: z.boolean().default(false),
    summary: z.string(),
    /** When and where the group meets — shown on the ministries page.
     *  Optional because Fairhaven Ladies/Fairhaven Seniors don't have theirs confirmed. */
    meets: z.string().optional(),
    where: z.string().optional(),
    /**
     * The hero photograph, as a FILENAME key into assets/photos/ — resolved by
     * glob, so adding one is committing a file. Previously this lived in
     * lib/ministry-assets.ts as an import per ministry, which meant changing a
     * ministry photo was a TypeScript edit and therefore a developer's job.
     */
    photo: z.string().optional(),
    /**
     * Where to hold the crop, as a CSS object-position.
     *
     * This has to travel with the photo. The hero is far wider than any of
     * these pictures, so `object-fit: cover` discards the top and bottom, and
     * the right band depends entirely on how THAT photograph is framed — one
     * of these was tuned because a man's face sits at 45% of the frame.
     *
     * It lived in code beside the imports, so replacing a photo left the old
     * value pointing at nothing and silently cropped a face off. Here, it is
     * edited in the same place as the photo it belongs to.
     */
    photoFocus: z.string().optional(),
    /** Override the alt text — e.g. when the photo shows more than one person. */
    photoAlt: z.string().optional(),

  }),
});

// Singleton config objects — small, human-editable YAML files rather than a
// database, since this content changes rarely and doesn't need workflow.
const settings = defineCollection({
  type: 'data',
  schema: z.object({
    churchName: z.string(),
    address: z.string(),
    mapsUrl: z.string().url(),
    email: z.string().email(),
    phone: z.string().optional(),
    /** The Twilio number people text START to. Blank hides the opt-in. */
    smsNumber: z.string().optional(),
    /**
     * Cloudflare Web Analytics site token. Optional: with no token the beacon
     * is simply not rendered, so the site works exactly as before.
     *
     * Not a secret — it is a public site identifier that ships in the HTML of
     * every page. It lives here rather than in a Worker secret precisely so
     * that whoever runs the site next can paste a new one in through /admin
     * without a deploy or a developer.
     */
    webAnalyticsToken: z.string().optional(),
    serviceTimes: z.array(
      z.object({
        label: z.string(),
        day: z.enum(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']),
        // 24-hour "HH:MM" in America/Indiana/Indianapolis local time.
        time: z.string().regex(/^\d{2}:\d{2}$/),
      })
    ),
    socials: z.object({
      facebook: optionalUrl(),
      instagram: optionalUrl(),
      youtubeUrl: z.string().url(),
      youtubeChannelId: z.string().optional().describe('UC... channel ID, needed for live-detection API calls'),
    }),
    zeffyUrl: z.string().url(),
    givingLinksUrl: z.string().url().optional(),
    calendarFeedUrl: optionalUrl().describe('The https:// form of the iCloud public calendar webcal:// URL'),
  }),
});

const livestreamOverride = defineCollection({
  type: 'data',
  schema: z.object({
    active: z.boolean().default(false),
    youtubeUrl: optionalUrl(),
    note: z.string().optional().describe('Internal note for staff, not shown publicly'),
  }),
});

// Homepage banner — the "banners and seasonal graphics" the brief (§1)
// asks Decap CMS to manage. Staff upload an image via the CMS media
// library (commits straight into the git repo, no server needed — see
// docs/README.md), toggle it on, done. `image` is a plain public/ path
// string (not an astro:assets import) because the file doesn't exist at
// build/code time — it's whatever staff uploads later. That means it
// isn't auto-optimized the way the hardcoded brand assets are; ask
// the pastor to keep source photos reasonably web-sized before uploading.
const banner = defineCollection({
  type: 'data',
  schema: z.object({
    active: z.boolean().default(false),
    image: z.string().optional().describe('Path from the CMS media picker, e.g. /uploads/photo.jpg'),
    headline: z.string().optional(),
    linkUrl: optionalUrl(),
    linkLabel: z.string().optional(),
  }),
});

export const collections = {
  beliefs, staff, sermons, series, ministries, settings, livestreamOverride, banner };
