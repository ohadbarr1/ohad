/** Addresses of the primary sources. Every link out of the site is built here. */
export type RegDs = 'gemel' | 'pensia' | 'insurance';
export interface RegResource { id: string; name: string; modified?: string | null }

export const DS_LABEL: Record<RegDs, string> = { gemel: 'גמל-נט', pensia: 'פנסיה-נט', insurance: 'ביטוח-נט' };
const CKAN = 'https://data.gov.il';

export const pdfPage = (url: string, pg: number | null | undefined) => (pg ? `${url}#page=${pg}` : url);
export const mayaReport = (rid: number | string) => `https://maya.tase.co.il/he/reports/${rid}`;
/** The regulator publishes each dataset in three files by year; a period lives in exactly one of them. */
export function resourceOf(list: RegResource[] | undefined, period: number): RegResource | null {
  const y = Math.floor(period / 100), mark = y <= 2022 ? '1999' : y === 2023 ? '2023' : '2024';
  return list?.find((r) => r.name.includes(mark)) ?? null;
}
export const ckanResourcePage = (pkg: string, id: string) => `${CKAN}/dataset/${pkg}/resource/${id}`;
/** the dataset's own page on data.gov.il (the regulator's three open datasets: gemelnet, pensia-net, insurance) */
export const ckanDataset = (pkg: string) => `${CKAN}/dataset/${pkg}`;
/** The regulator's public sites behind the datasets. No per-fund address pattern could be verified on them (W6), so the link is to the
 *  site, and the record itself is reached through data.gov.il. */
export const REG_SITE: Record<RegDs, { name: string; url: string }> = {
  gemel: { name: 'גמל-נט', url: 'https://gemelnet.cma.gov.il/views/dafmakdim.aspx' },
  pensia: { name: 'פנסיה-נט', url: 'https://pensyanet.cma.gov.il/' },
  insurance: { name: 'ביטוח-נט', url: 'https://bituachnet.cma.gov.il/' },
};
export function ckanQuery(id: string, filters: Record<string, unknown>, fields?: string[], limit = 32000) {
  return `${CKAN}/api/3/action/datastore_search?resource_id=${id}&limit=${limit}${fields ? `&fields=${fields.join(',')}` : ''}&filters=${encodeURIComponent(JSON.stringify(filters))}`;
}
