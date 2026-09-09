/**
 * Reading a form body without throwing on a malformed one.
 *
 * `request.formData()` REJECTS when the body is empty or is not form-encoded,
 * and an unhandled rejection in a page's frontmatter is a 500. A browser
 * submitting a real form always sends a body, so nobody using the app hits
 * this — but scanners and bots POST empty bodies to every URL they find, and
 * each one produced a server error in the logs.
 *
 * An unreadable body is treated as an empty one, which every page already
 * handles: no `action`, so nothing matches, so it falls through and renders.
 */
export async function readForm(request: Request): Promise<FormData> {
  try {
    return await request.formData();
  } catch {
    return new FormData();
  }
}
