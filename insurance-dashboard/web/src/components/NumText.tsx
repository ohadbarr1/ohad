import { Fragment } from 'react';
import { glue } from '../lib/format';

/** A generated sentence (pipeline text: the flows letter, the feed, the under-median line) with its figures kept whole. The pipeline wraps
 *  each figure in LRI … PDI (U+2066 … U+2069); here each becomes an LTR, no-wrap span (.sgnum), so "−₪630" never breaks after the sign. */
export function NumText({ t }: { t: string }) {
  const parts = t.split(/⁦([^⁩]*)⁩/);
  return <>{parts.map((s, i) => (i % 2 ? <bdi key={i} dir="ltr" className="sgnum">{glue(s)}</bdi> : <Fragment key={i}>{glue(s)}</Fragment>))}</>;
}
