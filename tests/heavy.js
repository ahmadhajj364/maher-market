// Busy-store simulation: two tills on one shared mock database with network latency.
const { chromium } = require('playwright');
const fs = require('fs');
const FILE = process.argv[2]; const SALES = +(process.argv[3] || 30); const LAT = +(process.argv[4] || 150);
const store = new Map();
const P = 1000;
const CATS = ['Cleaning supplies · مواد تنظيف', 'Canned food · معلبات', 'Chocolate & candy · شوكولا وسكاكر', 'Drinks · مشروبات', 'Coffee & tea · قهوة وشاي'];
for (let i = 0; i < P; i++) store.set(`products/p${i}`, { id: `p${i}`, name: `Item ${i}`, nameAr: `صنف ${i}`, barcode: String(6280000000000 + i), price: 1 + (i % 5) * 0.5, cost: 0.5, boxSize: 12, reorder: 5, shelf: 20, openBox: 6, closed: 10, weighed: false, category: CATS[i % 5] });
for (let i = 0; i < 40; i++) store.set(`products/w${i}`, { id: `w${i}`, name: `Spice ${i}`, nameAr: `بهار ${i}`, barcode: '', price: 0, cost: 0, boxSize: 1, reorder: 0, shelf: 0, openBox: 0, closed: 0, weighed: true, category: 'Spices · بهارات' });
store.set('customers/c2', { id: 'c2', name: 'Um Hassan', phone: '', limit: 0, kind: 'customer', entries: {} });
store.set('customers/s1', { id: 's1', name: 'Hussein', phone: '', role: 'Cashier', kind: 'staff', entries: {} });
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
  const TILLS = +(process.argv[5] || 3);
  const browser = await chromium.launch();
  fs.writeFileSync(__dirname + '/page.html', '<!doctype html><html><head><meta charset=utf8></head><body>' + fs.readFileSync(FILE, 'utf8') + '</body></html>');
  const errs = [];
  for (let i = 0; i < TILLS + 1; i++) {
    const pg = await browser.newPage({ viewport: { width: 1200, height: 850 } });
    pg.on('pageerror', e => errs.push(`dev${i}: ${e.message}`));
    pg.on('console', m => { if (m.type() === 'error') errs.push(`dev${i} console: ${m.text().slice(0, 140)}`); });
    await pg.exposeFunction('__db', serve);
    await pg.addInitScript(MOCK + `;window.__init(${JSON.stringify([...store])});`);
    await pg.goto('file://' + __dirname + '/page.html');
    pages.push(pg);
  }
  await new Promise(r => setTimeout(r, 1500));
  const exp = { sold: {}, receipts: 0, bal: { c1: 0, c2: 0, s1: 0 }, recv: {}, pays: 0, paid: 0, linked: {} };
  const scanTimes = [], saleTimes = [];
  async function till(pg, idx) {
    for (let s = 0; s < SALES; s++) {
      const t0 = Date.now();
      const n = 1 + Math.floor(Math.random() * 6); let tot = 0;
      for (let k = 0; k < n; k++) {
        const i = Math.floor(Math.random() * 10);
        const a = Date.now();
        await pg.click('#tillSearch'); await pg.keyboard.type(String(6280000000000 + i), { delay: 0 }); await pg.keyboard.press('Enter');
        scanTimes.push(Date.now() - a);
        exp.sold['p' + i] = (exp.sold['p' + i] || 0) + 1; tot += 1 + (i % 5) * 0.5;
      }
      if (s % 9 === 4) { await pg.click('[data-act=addItem][data-id=w3]'); await pg.fill('#weighPrice', '90000'); await pg.click('[data-act=weighAdd]'); tot += 90000 / 89500; }
      const who = s % 6 === 1 ? 'c1' : s % 6 === 3 ? 'c2' : s % 10 === 7 ? 's1' : null;
      if (who) { await pg.click('[data-act=method][data-m=credit]'); await pg.selectOption('#payCustomer', who); }
      if (s % 8 === 2) await pg.dblclick('[data-act=finish]'); else await pg.click('[data-act=finish]');
      await pg.waitForSelector('[data-act=newSale]', { timeout: 20000 });
      const r = await pg.evaluate(() => document.querySelector('.receipt-paper').innerText);
      const m = r.match(/\$([0-9.]+)\n/); // total line
      if (who) exp.bal[who] += +(Math.round(tot * 100) / 100).toFixed(2);
      exp.receipts++; saleTimes.push(Date.now() - t0);
    }
  }
  async function office(pg) {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    for (let round = 0; round < 6; round++) {
      // deliveries + boxes on best sellers that tills are selling right now
      await pg.click('[data-tab=stock]'); await sleep(200);
      const p = 'p' + (round % 10);
      await pg.click(`[data-act=openReceive][data-id=${p}]`); await pg.fill('#rf-boxes', '2'); await pg.fill('#rf-pieces', '3'); await pg.click('#receiveForm button[type=submit]');
      exp.recv[p] = (exp.recv[p] || 0) + 27;
      // supplier from the product panel
      await pg.click(`tr[data-row=p${100 + round}] td.n`); await pg.fill('#qs-name', 'Supplier ' + round); await pg.fill('#qs-phone', '70 00' + round); await pg.click('#quickSupForm button[type=submit]');
      exp.linked['p' + (100 + round)] = 'Supplier ' + round; await sleep(150); await pg.click('[data-act=closeDrawer]');
      await pg.click('[data-tab=boxes]'); await sleep(150);
      await pg.click(`[data-act=openBoxNow][data-id=p${(round + 3) % 10}]`); await sleep(150);
      // debts: customers and employee, while tills put sales on the same accounts
      await pg.click('[data-tab=customers]'); await sleep(150);
      await pg.click('[data-act=openAddDebt][data-id=c1]'); await pg.fill('#ad-amount', '5'); await pg.click('#addDebtForm button[type=submit]'); exp.bal.c1 += 5; await sleep(150);
      await pg.click('[data-act=openCustomerPay][data-id=c2]').catch(() => {}); if (await pg.$('#custPayForm')) { await pg.fill('#cp-amount', '1'); await pg.click('#custPayForm button[type=submit]'); exp.bal.c2 -= 1; } await sleep(150);
      await pg.click('[data-act=debtTab][data-v=staff]'); await sleep(100);
      await pg.click('[data-act=openAddDebt][data-id=s1]'); await pg.fill('#ad-amount', '10'); await pg.fill('#ad-note', 'salaf'); await pg.click('#addDebtForm button[type=submit]'); exp.bal.s1 += 10; await sleep(150);
      await pg.click('[data-act=openCustomerPay][data-id=s1]'); await pg.fill('#cp-amount', '4'); await pg.check('#cp-salary'); await pg.click('#custPayForm button[type=submit]'); exp.bal.s1 -= 4; await sleep(150);
      await pg.click('[data-act=debtTab][data-v=customers]');
      // payments
      await pg.click('[data-tab=payments]'); await sleep(100);
      await pg.click('[data-act=openPayment]'); await pg.fill('#py-to', 'Bill ' + round); await pg.fill('#py-amount', '20'); await pg.click('#paymentForm button[type=submit]'); exp.pays++; await sleep(200);
      if (round % 2 === 1) { await pg.click('[data-act=markPaid]'); exp.paid++; await sleep(200); }
      await pg.click('[data-tab=today]'); await sleep(300);
    }
  }
  const T0 = Date.now();
  await Promise.all([...pages.slice(0, TILLS).map(till), office(pages[TILLS])]);
  await new Promise(r => setTimeout(r, LAT * 5 + 1000));
  const secs = ((Date.now() - T0) / 1000).toFixed(0);
  // ---- check the shared store ----
  let receipts = 0; const rids = new Set();
  for (const [k, v] of store) if (k.startsWith('sales/')) { const rs = Array.isArray(v.receipts) ? v.receipts : Object.values(v.receipts || {}); receipts += rs.length; rs.forEach(r => rids.add(r.id)); }
  const start = new Map(START);
  const totalOf = (p) => p.shelf + p.openBox + p.closed * p.boxSize - (Object.values(p.soldBy || {}).reduce((a, b) => a + b, 0) - (p.soldBase || 0));
  const wrong = [];
  for (let i = 0; i < 10; i++) { const k = `products/p${i}`; const want = totalOf(start.get(k)) - (exp.sold['p' + i] || 0) + (exp.recv['p' + i] || 0); const got = totalOf(store.get(k)); if (want !== got) wrong.push(`p${i}: want ${want} got ${got}`); }
  const balOf = (id) => { const c = store.get('customers/' + id); const es = Array.isArray(c.entries) ? c.entries : Object.values(c.entries || {}); return +es.reduce((s, e) => s + (e.type === 'sale' ? e.amount : -e.amount), 0).toFixed(2); };
  const debts = Object.fromEntries(Object.keys(exp.bal).map(id => [id, { expected: +exp.bal[id].toFixed(2), saved: balOf(id) }]));
  const pays = [...store].filter(([k]) => k.startsWith('payments/')).map(([, v]) => v);
  const sups = [...store].filter(([k]) => k.startsWith('suppliers/')).map(([, v]) => v);
  const linkedOk = Object.entries(exp.linked).filter(([pid, name]) => { const p = store.get('products/' + pid); const sp = p && sups.find(x => x.id === p.supplierId); return sp && sp.name === name; }).length;
  const avg = (a) => Math.round(a.reduce((x, y) => x + y, 0) / a.length); const p95 = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length * 0.95)];
  // render speed with 1,000 products: switch tabs on the office device
  const pg = pages[TILLS]; const tabTimes = {};
  for (const tb of ['stock', 'till', 'boxes', 'today', 'customers']) { const ms = await pg.evaluate(async (tb) => { const a = performance.now(); document.querySelector(`[data-tab=${tb}]`).click(); return performance.now() - a; }, tb); tabTimes[tb] = Math.round(ms) + ' ms'; }
  const typeMs = await pages[0].evaluate(async () => { const el = document.querySelector('#tillSearch'); el.focus(); const a = performance.now(); for (const ch of '6280000000005') { el.value += ch; el.dispatchEvent(new Event('input', { bubbles: true })); } return Math.round((performance.now() - a) / 13); });
  const big = Math.max(...[...store].filter(([k]) => k.startsWith('sales/') || k.startsWith('customers/')).map(([, v]) => JSON.stringify(v).length));
  console.log(JSON.stringify({ devices: TILLS + 1, products: P + 40, minutes: (secs / 60).toFixed(1), salesRung: exp.receipts, receiptsSaved: receipts, uniqueReceipts: rids.size,
    stockWrong: wrong, debts, paymentsAdded: `${pays.length} of ${exp.pays}`, paymentsPaid: `${pays.filter(p => p.paidAt).length} of ${exp.paid}`, suppliersLinked: `${linkedOk} of ${Object.keys(exp.linked).length}`,
    scanMs: { avg: avg(scanTimes), p95: p95(scanTimes) }, saleSeconds: { avg: (avg(saleTimes) / 1000).toFixed(1), p95: (p95(saleTimes) / 1000).toFixed(1) },
    tabSwitch: tabTimes, msPerKeystroke: typeMs, biggestDocBytes: big, errors: errs.slice(0, 10) }, null, 1));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
