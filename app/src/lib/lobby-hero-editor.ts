/**
 * The hero frame editor on the dashboard: a dialog with the TV in it.
 *
 * The preview draws the frame with heroHtml() and the screen's own stylesheet
 * (styles/lobby-hero.css), so what is shown here is what the foyer will see —
 * including the logo and clock bar, which is why the text is only ever offered
 * the bottom corners.
 *
 * The graphic is prepared HERE, in the browser, before it is sent: cropped to
 * 16:9 from its middle, scaled to at most 3840×2160, re-encoded as JPEG (which
 * also drops whatever the camera or phone wrote into it — location included).
 * A Worker has no image library,
 * and a 12 MB phone photo has no business being sent to a TV.
 */
import {
  heroHtml, validateHero,
  type HeroAccent, type HeroCorner, type HeroTitleStyle, type HeroTone, type LobbyHero,
} from './lobby-heroes.ts';

type Hero = LobbyHero & { active: boolean };
interface Prepared { blob: Blob | null; url: string }

const MAX_W = 3840;
const SOFT_W = 1920;   // below this a 4K screen will show the graphic soft

async function prepare(file: File): Promise<Prepared & { note: string }> {
  const bmp = await createImageBitmap(file);
  let sx = 0, sy = 0, sw = bmp.width, sh = bmp.height;
  const notes: string[] = [];
  if (Math.abs(sw / sh - 16 / 9) > 0.01) {
    if (sw / sh > 16 / 9) { sw = Math.round(sh * 16 / 9); sx = Math.round((bmp.width - sw) / 2); }
    else { sh = Math.round(sw * 9 / 16); sy = Math.round((bmp.height - sh) / 2); }
    notes.push(`It was ${bmp.width} × ${bmp.height}, so it has been cropped to 16:9 from the middle.`);
  }
  const w = Math.min(MAX_W, sw), h = Math.round(w * 9 / 16);
  if (w < SOFT_W) notes.push(`At ${w} pixels wide it will look soft on the TV; 3840 × 2160 is ideal.`);

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, w, h);
  const blob = await new Promise<Blob>((ok, fail) =>
    canvas.toBlob((b) => (b ? ok(b) : fail(new Error('could not encode'))), 'image/jpeg', 0.88));

  bmp.close();
  return { blob, url: URL.createObjectURL(blob), note: notes.join(' ') };
}

async function post(fd: FormData): Promise<{ ok: boolean; errors?: string[] }> {
  try {
    const res = await fetch('/api/lobby/heroes', { method: 'POST', body: fd });
    return await res.json();
  } catch {
    return { ok: false, errors: ['Could not reach the server. Check the connection and try again.'] };
  }
}

export function startHeroEditor() {
  const dlg = document.getElementById('hero-editor') as HTMLDialogElement | null;
  if (!dlg) return;
  const heroes = JSON.parse(dlg.dataset.heroes ?? '[]') as Hero[];
  const form = dlg.querySelector('form') as HTMLFormElement;
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const screen = $('he-screen'), stage = $('he-stage'), frame = $('he-frame'), empty = $('he-empty');
  const note = $('he-note'), errors = $('he-errors'), del = $('he-delete') as HTMLButtonElement;
  const save = $('he-save') as HTMLButtonElement, file = $('he-file') as HTMLInputElement;
  const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement | RadioNodeList;

  let editing: Hero | null = null;
  let image: Prepared | null = null;

  const fit = () => { stage.style.transform = `scale(${screen.clientWidth / 1920})`; };
  new ResizeObserver(fit).observe(screen);

  const values = () => {
    const fd = new FormData(form);
    return {
      kicker: String(fd.get('kicker') ?? ''), title: String(fd.get('title') ?? ''), subtitle: String(fd.get('subtitle') ?? ''),
      corner: String(fd.get('corner') ?? 'bottom-right'), tone: String(fd.get('tone') ?? 'dark'),
      accent: String(fd.get('accent') ?? 'red'), titleStyle: String(fd.get('titleStyle') ?? 'serif'),
      shade: String(fd.get('shade') ?? '70'), startsOn: String(fd.get('startsOn') ?? ''), endsOn: String(fd.get('endsOn') ?? ''),
    };
  };

  /** Redraw the TV. `play` runs the entrance; otherwise the frame is shown at rest. */
  function draw(play = false) {
    const v = values();
    for (const el of form.querySelectorAll<HTMLElement>('[data-count]')) {
      const input = field(el.dataset.count!) as HTMLInputElement;
      const n = input.value.length, max = input.maxLength;
      el.textContent = `${n} / ${max}`;
      el.classList.toggle('is-over', n > max);
    }
    $('he-shade-n').textContent = `${v.shade}%`;
    empty.hidden = !!image;
    if (!image) { frame.innerHTML = ''; return; }
    // Drawn from what is typed, even mid-edit; heroHtml escapes all of it.
    frame.innerHTML = heroHtml({
      kicker: v.kicker.trim(), title: v.title.trim() || 'Your title', subtitle: v.subtitle.trim(),
      corner: v.corner as HeroCorner, tone: v.tone as HeroTone, accent: v.accent as HeroAccent,
      titleStyle: v.titleStyle as HeroTitleStyle, shade: Number(v.shade), image: image.url,
    });
    if (play) {
      const f = frame.querySelector<HTMLElement>('.hero-frame')!;
      f.classList.add('is-playing');
      f.style.setProperty('--life', '30s');
    }
  }

  function showErrors(list: string[]) {
    errors.hidden = !list.length;
    errors.textContent = list.join(' · ');
  }

  function open(hero: Hero | null) {
    editing = hero;
    form.reset();
    showErrors([]);
    note.hidden = true;
    file.value = '';
    $('he-title').textContent = hero ? 'Edit hero frame' : 'New hero frame';
    del.hidden = !hero;
    if (hero) {
      for (const k of ['kicker', 'title', 'subtitle', 'corner', 'tone', 'accent', 'titleStyle'] as const) {
        (field(k) as HTMLInputElement).value = hero[k];
      }
      (field('shade') as HTMLInputElement).value = String(hero.shade);
      (field('startsOn') as HTMLInputElement).value = hero.startsOn ?? '';
      (field('endsOn') as HTMLInputElement).value = hero.endsOn ?? '';
      (field('active') as HTMLInputElement).checked = hero.active;
      image = { blob: null, url: hero.image };
    } else {
      image = null;
    }
    dlg!.showModal();
    fit();
    draw(true);
  }

  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (!f) return;
    showErrors([]);
    try {
      const p = await prepare(f);
      if (image?.blob) URL.revokeObjectURL(image.url);
      image = p;
      note.textContent = p.note;
      note.hidden = !p.note;
      draw(true);
    } catch {
      showErrors(['That file could not be opened as an image.']);
    }
  });
  form.addEventListener('input', () => draw(false));
  $('he-play').addEventListener('click', () => draw(true));
  for (const b of dlg.querySelectorAll('[data-he-close]')) b.addEventListener('click', () => dlg.close());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = values();
    const checked = validateHero(v);
    const problems = checked.ok ? [] : [...checked.errors];
    if (!image) problems.push('Choose a graphic for the frame.');
    if (problems.length) return showErrors(problems);

    const fd = new FormData();
    fd.set('action', 'save');
    if (editing) fd.set('id', String(editing.id));
    for (const [k, val] of Object.entries(v)) fd.set(k, val);
    fd.set('active', (field('active') as HTMLInputElement).checked ? '1' : '0');
    if (image!.blob) {
      fd.set('image', new File([image!.blob], 'hero.jpg', { type: 'image/jpeg' }));
    }
    save.disabled = true;
    save.textContent = 'Saving…';
    const res = await post(fd);
    save.disabled = false;
    save.textContent = 'Save';
    if (!res.ok) return showErrors(res.errors ?? ['That did not save.']);
    location.reload();
  });

  del.addEventListener('click', async () => {
    if (!editing || !confirm(`Delete “${editing.title}”? The graphic is removed as well.`)) return;
    const fd = new FormData();
    fd.set('action', 'delete');
    fd.set('id', String(editing.id));
    const res = await post(fd);
    if (!res.ok) return showErrors(res.errors ?? ['That did not delete.']);
    location.reload();
  });

  for (const b of document.querySelectorAll<HTMLElement>('[data-hero-new]')) b.addEventListener('click', () => open(null));
  for (const b of document.querySelectorAll<HTMLElement>('[data-hero-edit]')) {
    b.addEventListener('click', () => open(heroes.find((h) => h.id === Number(b.dataset.heroEdit)) ?? null));
  }
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-hero-toggle]')) {
    b.addEventListener('click', async () => {
      b.disabled = true;
      const fd = new FormData();
      fd.set('action', 'toggle');
      fd.set('id', b.dataset.heroToggle!);
      const res = await post(fd);
      if (res.ok) location.reload(); else { b.disabled = false; alert((res.errors ?? ['That did not change.']).join(' ')); }
    });
  }
}
