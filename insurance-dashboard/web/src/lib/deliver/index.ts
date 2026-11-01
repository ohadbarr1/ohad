/* STUB — S3 (sa2-b) placeholder so this branch builds. REPLACE ON MERGE with S4's real web/src/lib/deliver/index.ts (the Deliverable
   Factory's renderers). Same signature as S4's: exportDoc(doc, format, opts?) → Promise<void>, triggers the download itself.
   This stub renders nothing: it only tells the caller the renderers are not in this build. */
import type { Doc } from '../doc';

export type DeliverFormat = 'pptx' | 'docx' | 'pdf' | 'txt';
export interface ExportOpts { filename?: string }
export async function exportDoc(doc: Doc, format: DeliverFormat, opts?: ExportOpts): Promise<void> {
  void doc; void opts;
  throw new Error(`ייצוא ${format.toUpperCase()} עוד לא זמין בבנייה הזו`);
}
