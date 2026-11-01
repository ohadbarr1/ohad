/* S4 · the Deliverable Factory's document model. Every deliverable (one-pager, memo, board paper, talking points, exhibit pack, email
   summary) is a Doc: a list of blocks whose numbers are the same sourced figures the answers carry (answer_core `fig`). The renderers
   (PPTX, DOCX, PDF/print, plain-text email) take a Doc; the producers (an answer, a finding, a meeting brief) build one.
   Rules every renderer keeps: every figure carries its source footnote (an unsourced number cannot be rendered); target / forward /
   estimate figures carry their basis label; no fox branding anywhere (no mark, no site name, no "fox-" file prefix): the author is the
   person whose name is set in this browser. */
import type { Fig } from './answers';

export type DocKind = 'onepager' | 'memo' | 'board' | 'talking' | 'exhibits' | 'email';

/** a run of text with figure tokens ({id}) resolved against `figs` of the block or the doc */
export interface Rich { text: string; figs?: Record<string, Fig> }

export type Block =
  | { k: 'h'; level: 1 | 2 | 3; text: string }
  | { k: 'p'; rich: Rich }
  | { k: 'bullets'; items: Rich[] }
  /** talking point: the line, the number for it, the comeback to the obvious objection */
  | { k: 'point'; line: Rich; fig?: string; comeback?: Rich }
  /** a chart or table: the answer_core exhibit shape (kind cat | hbar | line | table) */
  | { k: 'exhibit'; ex: import('./answers').Exhibit; figs: Record<string, Fig>; note?: string }
  | { k: 'table'; head: string[]; rows: (string | Rich)[][]; foot?: string[] }
  /** the decision framing of a memo / board paper */
  | { k: 'options'; items: { name: string; pro: Rich[]; con: Rich[] }[]; rec?: Rich }
  | { k: 'callout'; tone: 'info' | 'warn'; rich: Rich }
  | { k: 'pagebreak' };

export interface Doc {
  kind: DocKind;
  title: string;
  subtitle?: string;
  /** the author's name as set in this browser (never "fox") */
  author: string;
  /** dd.mm.yy */
  date: string;
  /** as-of of the data, e.g. "Q2'26 · 08/26" */
  asof?: string;
  blocks: Block[];
  /** every figure the doc quotes, by id; the sources section / footnotes are built from their provenance */
  figs: Record<string, Fig>;
  /** assumptions and basis mixes stated once (board paper appendix) */
  assumptions?: string[];
}
