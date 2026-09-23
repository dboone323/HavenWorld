/** Shared HTML escaper for every innerHTML template that interpolates
 *  server/user-provided data (chat, gallery, clubs, passport, guestbook…).
 *  Keep one implementation so escaping rules can't drift per component. */
export function escapeHtml(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}