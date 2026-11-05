/** The browser-tab title of every route: what the page is, then the company or section, then the site.
 *  One place, so history, bookmarks, tab strips and screen-reader page announcements can tell pages apart. */
const COMPANY_TAB: Record<string, string> = {
  '': 'מספרים', thesis: 'תזה', numbers: 'מספרים', review: 'סקירת דוח', financials: 'דוחות כספיים', report: 'יום הדוח', profit: 'מקורות רווח וענפים',
  ifrs17: 'IFRS 17', savings: 'חיסכון ארוך טווח', filings: 'מסמכים',
};
const INDUSTRY_TAB: Record<string, string> = {
  peers: 'טבלת עמיתים', sectors: 'השוואת ענפים', lines: 'שורות דוח', csm: 'IFRS 17 · CSM · הון', ifrs: 'IFRS 17 · CSM · הון', capital: 'IFRS 17 · CSM · הון',
  econ: 'רווחיות פנסיה וגמל', savings: 'עדשת חיסכון', headline: 'לאורך זמן', search: 'חיפוש בדוחות', matrix: 'מטריצת עמיתים',
};
const VALUATION_TAB: Record<string, string> = { '': 'P/B מוצדק', ri: 'הכנסה שיורית', expectations: 'ציפיות השוק', csm: 'הון ו-CSM', sotp: 'סכום החלקים', dcf: 'DCF' };
/** F2 TIME: the risk and time views and the watchlist */
const FUNDS_TIME: Record<string, string> = { map: 'מפת סיכון ותשואה', rank: 'אחוזון לאורך זמן', quilt: 'תשואה לפי שנה', persist: 'התמדה', glide: 'מסלולי גיל', watch: 'המעקב שלי' };
const MARKET_TAB: Record<string, string> = { overview: 'סקירת שוק', ranking: 'דירוג חברות', funds: 'קופות' };

/** `name` returns undefined while the company list loads and null for an id that is not on it (the page does not exist).
 *  `door` (W1, the three doors): `/` is the door picker until one is chosen, then that door's home. */
export function titleFor(path: string, name: (id: string) => string | null | undefined, door?: 'saver' | 'agent' | 'pro' | null): string | null {
  const p = path.replace(/\/+$/, '').split('/').slice(1).map(decodeURIComponent);
  const t = (...parts: (string | undefined)[]) => [...parts.filter(Boolean), 'fox'].join(' · ');
  switch (p[0] ?? '') {
    case '': return door === 'saver' ? t('החיסכון שלי') : door === 'agent' ? t('מסלולים, השוואה ודמי ניהול', 'סוכן') : door == null ? 'fox · כל מסלולי החיסכון, נטו ובמקור' : 'fox · ביטוח, פנסיה וגמל';
    case 'pro': return p[1] ? null : t('Pro', 'ביטוח, פנסיה וגמל');  // W1: the Pro home at a fixed address
    case 'my': return p[1] === 'statement' && !p[2] ? t('איך קוראים את הדוח השנתי', 'החיסכון שלי') : p[1] ? null : t('המוצרים שלי');  // W1: the saver's products; W3: the statement guide
    case 'clients': return p[1] === 'book' && !p[2] ? t('מבחן לחץ לתיק הלקוחות', 'סוכן') : p[1] ? null : t('תיקי לקוחות', 'סוכן');  // W3: the agent's client folders (private: no client name in the title); W11: the book stress test
    case 'companies': return t('חברות');
    case 'company': {
      if (!((p[2] ?? '') in COMPANY_TAB) || name(p[1]) === null) return null;
      return t(name(p[1]) ?? p[1], COMPANY_TAB[p[2] ?? '']);
    }
    case 'industry': return INDUSTRY_TAB[p[1] ?? 'peers'] ? t(INDUSTRY_TAB[p[1] ?? 'peers'], 'השוואה ענפית') : null;
    case 'savings': return p[1] ? null : t('עדשת חיסכון', 'חיסכון');
    case 'funds': if (p[1] === 'tools') return p[2] === 'hindsight' ? t('מה היה לי', 'חיסכון') : p[2] === 'fees' ? t('דמי ניהול לאורך קריירה', 'חיסכון') : p[2] ? null : t('כלים', 'חיסכון');
      if (p[1] === 'bm') return p[2] ? null : t('ביטוחי מנהלים ישנים', 'חיסכון');  // W2
      if (p[1] === 'default' || p[1] === 'trackers') return p[2] ? null : t(p[1] === 'default' ? 'קרנות ברירת מחדל' : 'מעבדת עוקבי המדד', 'חיסכון');
      return p[1] === 'makers' ? t('יצרן מול השוק', 'חיסכון') : p[1] === 'screen' ? t('מסלולים', 'חיסכון') : p[1] === 'compare' ? t('השוואת מסלולים', 'חיסכון')
      : p[1] === 'holdings' ? t('הרכב נכסים', 'חיסכון') : p[1] && FUNDS_TIME[p[1]] ? (p[2] ? null : t(FUNDS_TIME[p[1]], 'חיסכון')) : p[1] ? (p[2] ? null : t('מסלול', 'חיסכון')) : t('החודש בקופות', 'חיסכון');
    case 'managers': return t('דירוג מנהלים', 'חיסכון');
    case 'calendar': return t('לוח דיווחים');
    case 'book': return t('ספר הגרפים');
    case 'data': return p[1] === 'autopilot' && !p[2] ? t('טייס אוטומטי', 'נתונים ואיכות') : p[1] === 'api' && !p[2] ? t('API נתונים', 'נתונים ואיכות') : p[1] ? null : t('נתונים ואיכות');
    case 'restatements': return p[1] ? null : t('הצגות מחדש', 'השוואה ענפית');
    case 'presentations': return p[1] ? null : t('מצגות משקיעים');
    case 'credibility': return p[1] ? null : t('אמינות יעדים');  // lane S3
    case 'nowcast': return p[1] ? null : t('אומדנים לפני הדוח', 'טיוטה');  // module M1, unpublished
    case 'search': return t('חיפוש');
    case 'about': return p[1] ? null : t('על fox');  // Wave 0
    case 'methodology': return p[1] ? null : t('מתודולוגיה', 'על fox');  // W6 trust
    case 'questions': return p[2] ? null : p[1] ? t(p[1], 'שאלות') : t('שאלות');  // S1 / S6
    case 'findings': return p[1] ? null : t('ממצאים');  // S2
    case 'brief': return p[2] ? null : p[1] ? t('תדריך', 'תדריכים') : t('תדריכים');  // S3 (a meeting's name is private: never in the tab title)
    case 'watch': return p[1] ? null : t('מה השתנה בתשובות');  // S10
    case 'feed': return p[1] ? null : t('מה השתנה');  // module M2
    case 'attribution': return p[1] ? null : t('גשר ROE');  // module A4
    case 'positions': return p[2] ? null : p[1] ? t('עמדה', 'ספר העמדות') : t('ספר העמדות');  // module A6
    case 'warroom': return p[1] === 'regulation' ? t('רגולציה', 'חדר מלחמה') : p[1] ? null : t('מהלך דמי ניהול', 'חדר מלחמה');  // module A5 (A8: regulation)
    case 'drivers': return p[1] ? (p[2] || name(p[1]) === null ? null : t('מנגנונים', name(p[1]) ?? p[1])) : t('מנגנונים');  // module A1
    case 'scenarios': return p[1] ? null : t('חדר תרחישים');  // module A2
    case 'capital': return p[1] ? null : t('הון ואפשרויות הקצאה');  // module A7
    case 'fragility': return p[1] ? null : t('מוניטור שבריריות');  // module A10
    case 'expectations': return p[1] ? null : t('ציפיות השוק');  // module A3
    case 'consolidation': return p[1] ? (p[3] || !p[2] || name(p[1]) === null || name(p[2]) === null ? null : t(`${name(p[1]) ?? p[1]} ← ${name(p[2]) ?? p[2]}`, 'מסך האיחודים')) : t('מסך האיחודים');  // module A9
    case 'debt': return p[1] ? (name(p[1]) === null || p[2] ? null : t(name(p[1]) ?? p[1], 'חוב ופירעונות')) : t('חוב ופירעונות');
    case 'facts': return p[1] && !p[2] && name(p[1]) !== null ? t('עובדות', name(p[1]) ?? p[1]) : null;
    case 'ownership': return p[1] ? (p[2] || name(p[1]) === null ? null : t(name(p[1]) ?? p[1], 'בעלות')) : t('בעלות');  // lane OW
    case 'holdings': return p[1] ? (p[2] || name(p[1]) === null ? null : t(name(p[1]) ?? p[1], 'הרכב נכסים')) : t('הרכב נכסים', 'חיסכון');  // lane AL
    case 'doc': return p[1] ? t('קורא מסמכים') : null;
    case 'card': return p[1] && p[2] && !p[3] && name(p[1]) !== null ? t('כרטיס דוח', name(p[1]) ?? p[1], p[2].endsWith('FY') ? `FY'${p[2].slice(2, 4)}` : `${p[2].slice(4)}'${p[2].slice(2, 4)}`) : null;  // lane S2
    case 'market': return p[1] === 'group' ? t(p[2], 'שוק') : MARKET_TAB[p[1] ?? 'overview'] ? t(MARKET_TAB[p[1] ?? 'overview'], 'שוק') : null;
    case 'valuation': return p[1] ? (((p[2] ?? '') in VALUATION_TAB) && name(p[1]) !== null ? t(VALUATION_TAB[p[2] ?? ''], name(p[1]) ?? p[1], 'הערכת שווי') : null) : t('הערכת שווי');
    default: return null;
  }
}
