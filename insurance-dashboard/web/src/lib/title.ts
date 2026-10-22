/** The browser-tab title of every route: what the page is, then the company or section, then the site.
 *  One place, so history, bookmarks, tab strips and screen-reader page announcements can tell pages apart. */
const COMPANY_TAB: Record<string, string> = {
  '': 'סקירה', review: 'סקירת דוח', financials: 'דוחות כספיים', report: 'יום הדוח', profit: 'מקורות רווח וענפים',
  ifrs17: 'IFRS 17', savings: 'חיסכון ארוך טווח', filings: 'מסמכים',
};
const INDUSTRY_TAB: Record<string, string> = {
  sectors: 'השוואת ענפים', lines: 'שורות דוח', csm: 'כלכלת CSM', ifrs: 'IFRS 17 · CSM', capital: 'הון ודיבידנד',
  econ: 'רווחיות פנסיה וגמל', savings: 'נכסים מנוהלים', headline: 'לאורך זמן', search: 'חיפוש בדוחות', matrix: 'מטריצת עמיתים',
};
const MARKET_TAB: Record<string, string> = { overview: 'סקירת שוק', ranking: 'דירוג חברות', funds: 'קופות' };

export function titleFor(path: string, name: (id: string) => string | undefined): string | null {
  const p = path.replace(/\/+$/, '').split('/').slice(1).map(decodeURIComponent);
  const t = (...parts: (string | undefined)[]) => [...parts.filter(Boolean), 'fox'].join(' · ');
  switch (p[0] ?? '') {
    case '': return 'fox · ביטוח, פנסיה וגמל';
    case 'companies': return t('חברות');
    case 'company': {
      if (!((p[2] ?? '') in COMPANY_TAB)) return null;
      return t(name(p[1]) ?? p[1], COMPANY_TAB[p[2] ?? '']);
    }
    case 'industry': return INDUSTRY_TAB[p[1] ?? 'sectors'] ? t(INDUSTRY_TAB[p[1] ?? 'sectors'], 'השוואה ענפית') : null;
    case 'funds': return p[1] === 'makers' ? t('יצרן מול השוק', 'קופות') : p[1] ? t('מסלול', 'קופות') : t('מסלולים', 'קופות');
    case 'managers': return t('מנהלים', 'קופות');
    case 'calendar': return t('לוח דיווחים');
    case 'market': return p[1] === 'group' ? t(p[2], 'שוק') : MARKET_TAB[p[1] ?? 'overview'] ? t(MARKET_TAB[p[1] ?? 'overview'], 'שוק') : null;
    case 'valuation': return p[1] ? t(name(p[1]) ?? p[1], p[2] === 'sotp' ? 'סכום החלקים' : 'הערכת שווי') : t('הערכת שווי');
    default: return null;
  }
}
