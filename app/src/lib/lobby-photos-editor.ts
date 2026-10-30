/**
 * The Lobby tab's Photos card: the switches, and the dialog that adds or edits
 * an uploaded photograph (components/LobbyPhotos.astro).
 *
 * A photo is prepared HERE before it is sent: scaled to at most 2400 px wide
 * and re-encoded as JPEG, which also drops whatever the camera or phone wrote
 * into it — the location included. A phone photo is often 12 MB with GPS in
 * it; what reaches R2 is a few hundred KB of pixels.
 */
import { PHOTO_MAX_W, PHOTO_SOFT_W, validatePhoto } from './lobby-photos.ts';

interface Upload { id: number; src: string; alt: string; face: number; uses: ('give' | 'guest')[]; active: boolean }

async function prepare(file: File): Promise<{ blob: Blob; url: string; note: string }> {
  const bmp = await createImageBitmap(file);
  const w = Math.min(PHOTO_MAX_W, bmp.width), h = Math.round(bmp.height * w / bmp.width);
  const notes: string[] = [];
  if (bmp.width < PHOTO_SOFT_W) notes.push(`At ${bmp.width} pixels wide it will look soft on the TV.`);
  if (bmp.height > bmp.width) notes.push('It is a portrait photo; the screen will show only its middle.');
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const blob = await new Promise<Blob>((ok, fail) =>
    canvas.toBlob((b) => (b ? ok(b) : fail(new Error('could not encode'))), 'image/jpeg', 0.84));
  return { blob, url: URL.createObjectURL(blob), note: notes.join(' ') };
}

async function post(fd: FormData): Promise<{ ok: boolean; errors?: string[] }> {
  try {
    return await (await fetch('/api/lobby/photos', { method: 'POST', body: fd })).json();
  } catch {
    return { ok: false, errors: ['Could not reach the server. Check the connection and try again.'] };
  }
}

export function startPhotoEditor() {
  const card = document.getElementById('photos');
  const dlg = document.getElementById('photo-editor') as HTMLDialogElement | null;
  if (!card || !dlg) return;
  const uploads = JSON.parse(card.dataset.uploads ?? '[]') as Upload[];
  const form = dlg.querySelector('form') as HTMLFormElement;
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const img = $('lpe-img') as HTMLImageElement, band = $('lpe-band'), empty = $('lpe-empty');
  const note = $('lpe-note'), errors = $('lpe-errors'), del = $('lpe-delete') as HTMLButtonElement;
  const save = $('lpe-save') as HTMLButtonElement, file = $('lpe-file') as HTMLInputElement;
  const alt = form.elements.namedItem('alt') as HTMLInputElement;

  let editing: Upload | null = null;
  let prepared: { blob: Blob; url: string } | null = null;

  /** The band the Give and New here slides show, placed as the screen places it. */
  function drawBand() {
    const face = Number((form.elements.namedItem('face') as RadioNodeList).value || 0.45);
    const top = Math.min(640, Math.max(0, face * 1280 - 190)) / 1280 * 100;
    band.style.top = `${top}%`;
    $('lpe-count').textContent = `${alt.value.length} / ${alt.maxLength}`;
  }
  const showImage = (src: string | null) => {
    img.hidden = band.hidden = !src;
    empty.hidden = !!src;
    if (src) img.src = src;
  };
  const showErrors = (list: string[]) => { errors.hidden = !list.length; errors.textContent = list.join(' · '); };

  function open(u: Upload | null) {
    editing = u;
    prepared = null;
    form.reset();
    file.value = '';
    note.hidden = true;
    showErrors([]);
    $('lpe-title').textContent = u ? 'Edit photo' : 'Add a photo';
    $('lpe-file-wrap').hidden = !!u;    // an upload's picture is fixed; delete and add again to replace it
    del.hidden = !u;
    if (u) {
      alt.value = u.alt;
      (form.elements.namedItem('face') as RadioNodeList).value = String(u.face);
      (form.elements.namedItem('give') as HTMLInputElement).checked = u.uses.includes('give');
      (form.elements.namedItem('guest') as HTMLInputElement).checked = u.uses.includes('guest');
    }
    showImage(u ? u.src : null);
    drawBand();
    dlg!.showModal();
  }

  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (!f) return;
    showErrors([]);
    try {
      const p = await prepare(f);
      if (prepared) URL.revokeObjectURL(prepared.url);
      prepared = p;
      note.textContent = p.note;
      note.hidden = !p.note;
      showImage(p.url);
      drawBand();
    } catch {
      showErrors(['That file could not be opened as an image.']);
    }
  });
  form.addEventListener('input', drawBand);
  for (const b of dlg.querySelectorAll('[data-lpe-close]')) b.addEventListener('click', () => dlg.close());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const checked = validatePhoto({ alt: fd.get('alt'), face: fd.get('face'), give: fd.get('give'), guest: fd.get('guest') });
    const problems = checked.ok ? [] : [...checked.errors];
    if (!editing && !prepared) problems.push('Choose a photo.');
    if (problems.length) return showErrors(problems);
    fd.set('action', 'save');
    if (editing) fd.set('id', String(editing.id));
    if (prepared) fd.set('image', new File([prepared.blob], 'photo.jpg', { type: 'image/jpeg' }));
    save.disabled = true;
    save.textContent = 'Saving…';
    const res = await post(fd);
    save.disabled = false;
    save.textContent = 'Save';
    if (!res.ok) return showErrors(res.errors ?? ['That did not save.']);
    location.hash = 'photos';
    location.reload();
  });

  del.addEventListener('click', async () => {
    if (!editing || !confirm('Delete this photo? It is removed from the screen and from storage.')) return;
    const fd = new FormData();
    fd.set('action', 'delete');
    fd.set('id', String(editing.id));
    const res = await post(fd);
    if (!res.ok) return showErrors(res.errors ?? ['That did not delete.']);
    location.hash = 'photos';
    location.reload();
  });

  for (const b of card.querySelectorAll<HTMLElement>('[data-photo-new]')) b.addEventListener('click', () => open(null));
  for (const b of card.querySelectorAll<HTMLElement>('[data-photo-edit]')) {
    b.addEventListener('click', () => open(uploads.find((u) => u.id === Number(b.dataset.photoEdit)) ?? null));
  }

  /*
   * The switches act at once, without a page reload, so working down the grid
   * switching several off is quick. Each is confirmed by the server before the
   * tile changes, so what it shows is what was saved.
   */
  for (const b of card.querySelectorAll<HTMLButtonElement>('[data-photo-toggle], [data-builtin-toggle]')) {
    b.addEventListener('click', async () => {
      b.disabled = true;
      const fd = new FormData();
      if (b.dataset.builtinToggle) { fd.set('action', 'toggle-builtin'); fd.set('key', b.dataset.builtinToggle); }
      else { fd.set('action', 'toggle'); fd.set('id', b.dataset.photoToggle!); }
      const res = await post(fd) as { ok: boolean; on?: boolean; photo?: { active: boolean }; errors?: string[] };
      b.disabled = false;
      if (!res.ok) return alert((res.errors ?? ['That did not change.']).join(' '));
      const on = res.on ?? res.photo?.active ?? false;
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.textContent = on ? 'On' : 'Off';
      if (b.hasAttribute('aria-label')) b.setAttribute('aria-label', b.getAttribute('aria-label')!.replace(/: (on|off)$/, `: ${on ? 'on' : 'off'}`));
      b.closest('.lp__tile')?.classList.toggle('is-off', !on);
    });
  }
}
