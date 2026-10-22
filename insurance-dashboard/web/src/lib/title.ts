/** The browser-tab title of every route: what the page is, then the company or section, then the site.
 *  One place, so history, bookmarks, tab strips and screen-reader page announcements can tell pages apart. */
const COMPANY_TAB: Record<string, string> = {
  '': 'הדוח האחרון', review: 'סקירת דוח', financials: 'דוחות כספיים', report: 'יום הדוח', profit: 'מקורות רווח וענפים',
  ifrs17: 'IFRS 17', savings: 'חיסכון ארוך טווח', filings: 'מסמכים',
};
const INDUSTRY_TAB: Record<string, string> = {
  peers: 'טבלת עמיתים', sectors: 'השוואת ענפים', lines: 'שורות דוח', csm: 'IFRS 17 · CSM · הון', ifrs: 'IFRS 17 · CSM · הון', capital: 'IFRS 17 · CSM · הון',
  econ: 'רווחיות פנסיה וגמל', savings: 'עדשת חיסכון', headline: 'לאורך זמן', search: 'חיפוש בדוחות', matrix: 'מטריצת עמיתים',
};
const VALUATION_TAB: Record<string, string> = { '': 'P/B מוצדק', ri: 'הכנסה שיורית', csm: 'הון ו-CSM', sotp: 'סכום החלקים', dcf: 'DCF' };
const MARKET_TAB: Record<string, string> = { overview: 'סקירת שוק', ranking: 'דירוג חברות', funds: 'קופות' };

/** `name` returns undefined while the company list loads and null for an id that is not on it (the page does not exist). */
export function titleFor(path: string, name: (id: string) => string | null | undefined): string | null {
  const p = path.replace(/\/+$/, '').split('/').slice(1).map(decodeURIComponent);
  const t = (...parts: (string | undefined)[]) => [...parts.filter(Boolean), 'fox'].join(' · ');
  switch (p[0] ?? '') {
    case '': return 'fox · ביטוח, פנסיה וגמל';
    case 'companies': return t('חברות');
    case 'company': {
      if (!((p[2] ?? '') in COMPANY_TAB) || name(p[1]) === null) return null;
      return t(name(p[1]) ?? p[1], COMPANY_TAB[p[2] ?? '']);
    }
    case 'industry': return INDUSTRY_TAB[p[1] ?? 'peers'] ? t(INDUSTRY_TAB[p[1] ?? 'peers'], 'ענף') : null;
    case 'funds': return p[1] === 'makers' ? t('יצרן מול השוק', 'קופות') : p[1] ? t('מסלול', 'קופות') : t('מסלולים', 'קופות');
    case 'managers': return t('מנהלים', 'קופות');
    case 'calendar': return t('לוח דיווחים');
    case 'book': return t('ספר הגרפים');
    case 'data': return p[1] ? null : t('נתונים ואיכות');
    case 'restatements': return p[1] ? null : t('הצגות מחדש', 'השוואה ענפית');
    case 'presentations': return p[1] ? null : t('מצגות משקיעים');
    case 'search': return t('חיפוש');
    case 'doc': return p[1] ? t('קורא מסמכים') : null;
    case 'market': return p[1] === 'group' ? t(p[2], 'שוק') : MARKET_TAB[p[1] ?? 'overview'] ? t(MARKET_TAB[p[1] ?? 'overview'], 'שוק') : null;
    case 'valuation': return p[1] ? (((p[2] ?? '') in VALUATION_TAB) && name(p[1]) !== null ? t(VALUATION_TAB[p[2] ?? ''], name(p[1]) ?? p[1], 'הערכת שווי') : null) : t('הערכת שווי');
    default: return null;
  }
}
