/** W7 (wave 2): shapes shared by the clearing-house parser (lib/maslaka.ts), the client folder (lib/clients.ts),
 *  the saver's products (lib/mine.ts) and the agent documents. Everything here is optional on the records that carry it,
 *  because older folders and files in the browser were saved without it. */

/** one deposit row from the file (PerutHafkadotMetchilatShana / PerutHafkadaAchrona): who paid what, for which salary month */
export interface DepositRow {
  ym: string;                 // 'YYYY-MM' the salary month the deposit is for (TAARICH-ERECH-HAFKADA), or the payment month when that is all the file gives
  paid?: string | null;       // 'YYYY-MM-DD' when it reached the fund
  employee?: number | null;   // תגמולי עובד
  employer?: number | null;   // תגמולי מעסיק
  severance?: number | null;  // פיצויים
  total?: number | null;      // SCHUM-HAFKADA-SHESHULAM when the parts are not itemised
  salary?: number | null;     // השכר המבוטח לחודש, when the file states it
}

/** the guaranteed annuity coefficient written in an old policy, when the file or the agent states it */
export interface GuaranteedCoef { v: number; at: number | null; src: 'file' | 'agent' }

/** fields the wave-2 lanes read from an imported product beyond balance and fees */
export interface HeldExtra {
  code?: string | null;              // KIDOD-ACHID, the 30-digit unified code of the account's track
  deposits?: DepositRow[];           // the deposit rows the file carried, newest last
  salary?: number | null;            // insured monthly salary when stated anywhere in the account
  insTrack?: string | null;          // SHEM-MASLUL-HABITUAH (pension insurance track)
  coefGuaranteed?: GuaranteedCoef | null;
}
