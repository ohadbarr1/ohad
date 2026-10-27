import '../styles/density.css';

/* One density, no switch: compact rows (26 px) on a screen of 1920 px and wider, comfortable (34 px) below. Kept on
   <html data-density> so every stylesheet keys off one attribute. Imported once, by the layout, before the first paint. */
const mq = typeof window !== 'undefined' ? window.matchMedia('(min-width: 1920px)') : null;
const apply = () => { if (mq) document.documentElement.dataset.density = mq.matches ? 'compact' : 'comfortable'; };
apply();
mq?.addEventListener('change', apply);
