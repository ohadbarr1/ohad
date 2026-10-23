/* Two "devices" and a mocked remote store converge. Run: npm run test:sync (bundles this file with esbuild and runs it in node).
   The in-memory remote applies the same rule as firestore.rules: a write with an older stamp than the stored one is refused. */
import { SyncEngine, type Entries, type LocalStore, type Stamp, type SyncAdapter } from '../src/lib/sync';

let failures = 0, passes = 0;
function ok(cond: unknown, what: string) { if (cond) { passes++; console.log(`  ok  ${what}`); } else { failures++; console.log(`  FAIL ${what}`); } }
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

class MemRemote implements SyncAdapter {
  docs: Entries = {};
  offline = false;
  writes = 0;
  async pull() { if (this.offline) throw new Error('offline'); return JSON.parse(JSON.stringify(this.docs)) as Entries; }
  async push(e: Entries) {
    if (this.offline) throw new Error('offline');
    const refused: string[] = [];
    for (const [k, v] of Object.entries(e)) {
      const cur = this.docs[k];
      if (cur && v.t < cur.t) { refused.push(k); continue; }  // firestore.rules: request.resource.data.t >= resource.data.t
      this.docs[k] = { ...v }; this.writes++;
    }
    return refused;
  }
}

class MemStore implements LocalStore {
  kv = new Map<string, string>();
  state: { stamps: Record<string, Stamp>; queue: string[] } = { stamps: {}, queue: [] };
  constructor(private skip: (k: string) => boolean = (k) => k === 'density') {}
  keys() { return [...this.kv.keys()].filter((k) => !this.skip(k)); }
  get(k: string) { return this.skip(k) ? null : this.kv.get(k) ?? null; }
  set(k: string, v: string | null) { if (v == null) this.kv.delete(k); else this.kv.set(k, v); }
  loadState() { return JSON.parse(JSON.stringify(this.state)); }
  saveState(s: { stamps: Record<string, Stamp>; queue: string[] }) { this.state = JSON.parse(JSON.stringify(s)); }
  // what useStored does: write, then announce the key (in the page, runInPage stamps it on that event)
  engine: SyncEngine | null = null;
  write(k: string, v: unknown) { if (v === undefined) this.kv.delete(k); else this.kv.set(k, JSON.stringify(v)); this.engine?.scan(k); }
  read(k: string) { const v = this.kv.get(k); return v == null ? undefined : JSON.parse(v); }
  synced() { return Object.fromEntries(this.keys().sort().map((k) => [k, this.kv.get(k)])); }
}

let clock = 1_000_000;
const now = () => clock;
const tick = (ms = 10) => { clock += ms; };

async function main() {
  const remote = new MemRemote();
  const phone = new MemStore(), desk = new MemStore();

  console.log('1. two devices with history meet for the first time');
  phone.write('watch', ['harel', 'phoenix']);
  phone.write('peers.views', [{ id: 'a1', n: 'CSM לפי חברה', q: 't=csm' }]);
  phone.write('density', 'compact');  // device-only
  tick();
  desk.write('watch', ['migdal']);
  desk.write('notes:harel', 'לבדוק את שחרור ה-CSM');
  const A = new SyncEngine(phone, remote, 'phone', now), B = new SyncEngine(desk, remote, 'desk', now);
  phone.engine = A; desk.engine = B;
  await A.sync(); tick(); await B.sync(); tick(); await A.sync();
  ok(eq(phone.synced(), desk.synced()), 'both devices hold the same keys and values');
  ok(eq(phone.read('watch')?.sort(), ['harel', 'migdal', 'phoenix']), 'watchlists united on first meeting, not replaced');
  ok(desk.read('peers.views')?.[0]?.n === 'CSM לפי חברה', 'a view saved on the phone opens on the desktop');
  ok(phone.read('notes:harel') === 'לבדוק את שחרור ה-CSM', 'a desktop note reaches the phone');
  ok(!('density' in remote.docs) && desk.read('density') === undefined, 'device-only key (density) is never sent');

  console.log('2. last write wins per key; different keys never collide');
  phone.write('notes:harel', 'גרסת הטלפון'); tick(5);
  desk.write('notes:harel', 'גרסת המחשב'); tick(5);
  phone.write('peers.sets', [{ id: 's1', n: 'חמש הגדולות', ids: ['harel', 'phoenix', 'migdal', 'clal', 'menora'] }]);
  await B.flush(); tick(); await A.flush(); tick(); await A.sync(); await B.sync();
  ok(phone.read('notes:harel') === 'גרסת המחשב' && desk.read('notes:harel') === 'גרסת המחשב', 'the later edit of the same key wins on both (refused older write is pulled back)');
  ok(desk.read('peers.sets')?.[0]?.id === 's1', 'an unrelated key written meanwhile is kept');

  console.log('3. offline queue');
  remote.offline = true;
  phone.write('note.harel|Q2\'26|csm_release', { t: 'כולל חד-פעמי', co: 'harel', p: "Q2'26", m: 'csm_release', at: clock });
  phone.write('watch', ['harel', 'migdal', 'phoenix', 'clal']);
  await A.flush();
  ok(A.status.state === 'offline' && A.status.queued === 2, 'offline: both writes stay queued');
  const A2 = new SyncEngine(phone, remote, 'phone', now);  // the page was closed and reopened while offline
  phone.engine = A2;
  ok(A2.status.queued === 0 && phone.state.queue.length === 2, 'the queue survives a reload (persisted)');
  remote.offline = false; tick();
  await A2.sync(); await B.sync();
  ok(eq(phone.synced(), desk.synced()), 'back online: converged');
  ok(desk.read('watch')?.includes('clal'), 'queued watchlist change arrived');

  console.log('4. removal travels as a tombstone');
  desk.write('notes:harel', undefined); tick();
  await B.flush(); await A.sync();
  ok(phone.read('notes:harel') === undefined, 'a note removed on the desktop is removed on the phone');
  ok(remote.docs['notes:harel']?.v === null, 'remote keeps a tombstone (v = null)');

  console.log('5. raw localStorage writers (recent pages) are picked up by the scan');
  phone.kv.set('recent', JSON.stringify([{ p: '/company/harel', t: 'הראל · הדוח האחרון' }])); tick();
  await A.sync(); await B.sync();
  ok(desk.read('recent')?.[0]?.p === '/company/harel', 'recent pages follow too');

  console.log('6. a third, empty device signs in');
  const tablet = new MemStore();
  await new SyncEngine(tablet, remote, 'tablet', now).sync();
  ok(eq(tablet.synced(), phone.synced()), 'a fresh device receives everything');

  console.log('7. quiet when nothing changed');
  const w0 = remote.writes; await A.sync(); await B.sync();
  ok(remote.writes === w0, 'no writes when nothing changed');

  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures) process.exit(1);
}
void main();
