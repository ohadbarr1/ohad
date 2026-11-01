import { useStored } from './local';

/** The three doors (plan 01.11.26): one data engine, three audiences. The choice lives in this browser only. */
export type Door = 'saver' | 'agent' | 'pro';
export const DOORS: [Door, string, string][] = [
  ['saver', 'חוסך', 'מה יש לי, כמה אני משלם, ומה לעשות'],
  ['agent', 'סוכן', 'השוואה, נתוני החלטה ומסמך ללקוח'],
  ['pro', 'Pro', 'הטרמינל המלא: חברות, ענף, שווי ותרחישים'],
];
export const DOOR_KEY = 'door';
/** null until the reader picks a door on the home page */
export const useDoor = () => useStored<Door | null>(DOOR_KEY, null);
