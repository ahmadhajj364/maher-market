// Busy-store simulation: two tills on one shared mock database with network latency.
const { chromium } = require('playwright');
const fs = require('fs');
const FILE = process.argv[2]; const SALES = +(process.argv[3] || 30); const LAT = +(process.argv[4] || 150);
const store = new Map();
const P = 30;
for (let i = 0; i < P; i++) store.set(`products/p${i}`, { id: `p${i}`, name: `Item ${i}`, nameAr: `صنف ${i}`, barcode: String(6280000000000 + i), price: 1 + (i % 5) * 0.5, cost: 0.5, boxSize: 12, reorder: 5, shelf: 20, openBox: 6, closed: 10, weighed: false, category: '' });
store.set('customers/c1', { id: 'c1', name: 'Abu Ali', phone: '', limit: 0, kind: 'customer', entries: [] });
store.set('settings/main', { rate: 89500, vat: 11, shelfMin: 2 });
const START = JSON.parse(JSON.stringify([...store]));
const pages = [];
const deepMerge = (a, b) => { const o = { ...a }; for (const [k, v] of Object.entries(b)) o[k] = (v && typeof v === 'object' && !Array.isArray(v) && o[k] && typeof o[k] === 'object' && !Array.isArray(o[k])) ? deepMerge(o[k], v) : v; return o; };
async function serve(op, path, data) {
  await new Promise(r => setTimeout(r, LAT * (0.3 + Math.random())));
  if (op === 'set') store.set(path, data);
  else if (op === 'update') { if (!store.has(path)) return { error: 'invalid_argument' }; store.set(path, deepMerge(store.get(path), data)); }
  else if (op === 'delete') store.delete(path);
  else if (op === 'get') return { doc: store.get(path) ?? null };
  const doc = store.get(path) ?? null;
  for (const pg of pages) pg.evaluate(([p, d]) => window.__push(p, d), [path, doc]).catch(() => {});
  return { ok: true };
}
const MOCK = `
(() => {
  const local = new Map(); const docSubs = []; const colSubs = [];
  const snapDoc = (p) => ({ id: p.split('/').pop(), exists: local.has(p), data: () => local.get(p), metadata: {} });
  const fire = (path) => {
    docSubs.filter(s => s.p === path).forEach(s => s.n(snapDoc(path)));
    const col = path.split('/').slice(0, -1).join('/');
    colSubs.filter(s => s.c === col).forEach(s => s.n({ docs: [...local.keys()].filter(k => k.split('/').slice(0, -1).join('/') === col && (!s.f || s.f(local.get(k)))).map(snapDoc) }));
  };
  window.__push = (p, d) => { if (d === null) local.delete(p); else local.set(p, d); fire(p); };
  window.__init = (entries) => { entries.forEach(([k, v]) => local.set(k, v)); };
  const merge = (a, b) => { const o = { ...a }; for (const [k, v] of Object.entries(b)) o[k] = (v && typeof v === 'object' && !Array.isArray(v) && o[k] && typeof o[k] === 'object' && !Array.isArray(o[k])) ? merge(o[k], v) : v; return o; };
  const call = async (op, p, d) => { const r = await window.__db(op, p, d); if (r && r.error) { const e = new Error(r.error); e.code = r.error; throw e; } return r; };
  const docRef = (p) => ({ id: p.split('/').pop(), path: p,
    set: async (d) => { local.set(p, JSON.parse(JSON.stringify(d))); fire(p); await call('set', p, d); },
    update: async (d) => { if (!local.has(p)) { const e = new Error('missing'); e.code = 'invalid_argument'; throw e; } local.set(p, merge(local.get(p), JSON.parse(JSON.stringify(d)))); fire(p); await call('update', p, d); },
    delete: async () => { local.delete(p); fire(p); await call('delete', p); },
    get: async () => { const r = await call('get', p); return { exists: !!r.doc, data: () => r.doc }; },
    onSnapshot: (n) => { docSubs.push({ p, n }); setTimeout(() => n(snapDoc(p)), 5); return () => {}; } });
  const coll = (c, f) => { const q = { path: c, where: (fld, op, v) => coll(c, (d) => (!f || f(d)) && (op === '>=' ? d[fld] >= v : op === '==' ? d[fld] === v : true)), orderBy: () => q, limit: () => q,
      onSnapshot: (n) => { const s = { c, f, n }; colSubs.push(s); setTimeout(() => fire(c + '/__none__'), 5); return () => {}; }, doc: (id) => docRef(c + '/' + (id || Math.random().toString(36).slice(2))) };
    return q; };
  window.claude = { use: async (n) => n === 'db' ? { doc: docRef, collection: (c) => coll(c) } : n === 'user' ? { can: async () => true } : null };
})();`;
(async () => {
  const browser = await chromium.launch();
  const html = '<!doctype html><html><head><meta charset=utf8></head><body>' + fs.readFileSync(FILE, 'utf8') + '</body></html>';
  fs.writeFileSync(__dirname + '/page.html', html);
  const errs = [];
  for (let i = 0; i < 2; i++) {
    const pg = await browser.newPage({ viewport: { width: 1200, height: 850 } });
    pg.on('pageerror', e => errs.push(`till${i}: ${e.message}`));
    await pg.exposeFunction('__db', serve);
    await pg.addInitScript(MOCK + `;window.__init(${JSON.stringify([...store])});`);
    await pg.goto('file://' + __dirname + '/page.html');
    pages.push(pg);
  }
  await new Promise(r => setTimeout(r, 600));
  const expectSold = {}; let expectReceipts = 0, expectCredit = 0, doubleClicks = 0;
  async function run(pg, idx) {
    for (let s = 0; s < SALES; s++) {
      const n = 1 + Math.floor(Math.random() * 5); let tot = 0;
      for (let k = 0; k < n; k++) {
        const i = Math.floor(Math.random() * 8); // a few best sellers, so both tills hit the same items
        await pg.click('#tillSearch'); await pg.keyboard.type(String(6280000000000 + i), { delay: 0 }); await pg.keyboard.press('Enter');
        expectSold['p' + i] = (expectSold['p' + i] || 0) + 1; tot += 1 + (i % 5) * 0.5;
      }
      const credit = s % 7 === 3;
      if (credit) { await pg.click('[data-act=method][data-m=credit]'); await pg.selectOption('#payCustomer', 'c1'); expectCredit += tot; }
      if (s % 10 === 5) { await pg.dblclick('[data-act=finish]'); doubleClicks++; } else await pg.click('[data-act=finish]');
      expectReceipts++;
      await pg.waitForSelector('[data-act=newSale]', { timeout: 15000 });
    }
  }
  const t0 = Date.now();
  await Promise.all(pages.map(run));
  await new Promise(r => setTimeout(r, LAT * 4 + 500));
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  // results from the shared server store
  let receipts = 0, saleTotal = 0;
  for (const [k, v] of store) if (k.startsWith('sales/')) { const rs = Array.isArray(v.receipts) ? v.receipts : Object.values(v.receipts || {}); receipts += rs.length; rs.forEach(r => saleTotal += r.total); }
  const start = new Map(START);
  const totalOf = (p) => p.shelf + p.openBox + p.closed * p.boxSize - (Object.values(p.soldBy || {}).reduce((a, b) => a + b, 0) - (p.soldBase || 0));
  let stockWrong = 0, stockLost = 0;
  for (let i = 0; i < 8; i++) { const k = `products/p${i}`; const want = totalOf(start.get(k)) - (expectSold['p' + i] || 0); const got = totalOf(store.get(k)); if (want !== got) { stockWrong++; stockLost += got - want; } }
  const c = store.get('customers/c1'); const ents = Array.isArray(c.entries) ? c.entries : Object.values(c.entries || {});
  const bal = ents.reduce((s, e) => s + (e.type === 'sale' ? e.amount : -e.amount), 0);
  const big = Math.max(...[...store].filter(([k]) => k.startsWith('sales/')).map(([, v]) => JSON.stringify(v).length));
  console.log(JSON.stringify({ seconds: secs, salesRung: expectReceipts, receiptsSaved: receipts, doubleClicks, productsWithWrongStock: `${stockWrong} of 8`, stockUnitsNotDeducted: stockLost,
    creditExpected: +expectCredit.toFixed(2), creditRecorded: +bal.toFixed(2), salesDocs: [...store.keys()].filter(k => k.startsWith('sales/')).length, biggestSalesDocBytes: big, pageErrors: errs }, null, 1));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
