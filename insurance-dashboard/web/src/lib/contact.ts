/** F3 trust (fox 3.0, phase 0): who is behind fox, the conflict-of-interest disclosure and the corrections channel of /about.
 *  OWNER FILLS THESE IN. Every value starts empty, and /about shows a block only once its value is set:
 *    OWNER_NAME  the owner's name as it should appear on the site (e.g. 'ישראל ישראלי')
 *    CONTACT     the corrections channel: an e-mail address or an https:// URL (a form, a GitHub issues page)
 *  The disclosure wording below was approved with the plan (05.11.26); `{name}` is replaced by OWNER_NAME. */
export const OWNER_NAME = '';
export const CONTACT = '';
export const DISCLOSURE = '{name} עובד בענף הביטוח; fox הוא פרויקט עצמאי, בלי עמלות, בלי לידים ובלי פרסום. הפניקס מכוסה כמו כל חברה אחרת.';

/** the disclosure with the owner's name, or null while OWNER_NAME is empty (the block is then not shown) */
export const disclosure = (name: string = OWNER_NAME): string | null => (name.trim() ? DISCLOSURE.replace('{name}', name.trim()) : null);
/** the corrections channel as a link target: mailto: for an address, the URL as is; null while CONTACT is empty */
export const contactHref = (c: string = CONTACT): string | null => (!c.trim() ? null : /^https?:\/\//.test(c.trim()) ? c.trim() : `mailto:${c.trim()}`);
