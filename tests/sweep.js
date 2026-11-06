// Click-through check: every page in English and Arabic at phone and laptop size, every button on every page,
// and each form end to end with the result checked in the database. Uses the same stand-in backend as supabase-load.js.
// Run: PGURL=... node tests/sweep.js
const src = require('fs').readFileSync(__dirname + '/supabase-load.js', 'utf8');
// the harness's top-level declarations become this script's (var, so they outlive the eval)
eval(src.slice(0, src.indexOf('(async () => {\n  await setupDb();')).replace(/^const \{ chromium \}.*$/m, '').replace(/(^|; )const /gm, '$1var '));
const { chromium } = require('playwright');
const problems = [];
const bad = (m) => { problems.push(m); console.log('PROBLEM:', m); };
async function openApp(browser, vp, lang) {
  const ctx = await browser.newContext({ viewport: vp, isMobile: vp.width < 500, hasTouch: vp.width < 500 });
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  await ctx.addInitScript(`try { localStorage.setItem('maher-lang', '${lang}'); } catch (e) {}`);
  await ctx.route('https://maher.test/**', (r) => { const u = new URL(r.request().url()); if (u.pathname === '/') return r.fulfill({ contentType: 'text/html', body: html }); const f = path.join(ROOT, u.pathname); return fs.existsSync(f) ? r.fulfill({ path: f }) : r.fulfill({ status: 404, body: '' }); });
  await ctx.route('https://cdn.jsdelivr.net/**', (r) => r.fulfill({ path: UMD, contentType: 'application/javascript' }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await ctx.route(HOST + '/**', rest);
  await ctx.routeWebSocket(/kuxosgksxtpulowsfdtp\.supabase\.co\/realtime/, realtime);
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => bad(`${lang} ${vp.width}px page error: ${e.message}`));
  pg.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED/.test(m.text())) bad(`${lang} ${vp.width}px console: ${m.text().slice(0, 200)}`); });
  await pg.goto('https://maher.test/');
  await pg.fill('#lg-email', USER.email); await pg.fill('#lg-pass', USER.password); await pg.click('#loginForm button[type=submit]');
  await pg.waitForSelector('#tillSearch', { timeout: 20000 });
  return pg;
}
const TABS = ['till', 'stock', 'suppliers', 'boxes', 'customers', 'payments', 'today', 'settings'];
const doc = async (p) => (await pool.query('select data from docs where path = $1 and not deleted', [p])).rows[0]?.data;
const docsOf = async (c) => (await pool.query('select data from docs where col = $1 and not deleted', [c])).rows.map((r) => r.data);
const toastText = (pg) => pg.evaluate(() => { const t = document.querySelector('#toast'); return t && !t.hidden ? t.textContent : ''; });
const closed = (pg, sel) => pg.waitForSelector(sel, { state: 'detached', timeout: 8000 }).catch(() => bad('form stayed open: ' + sel));

(async () => {
  await setupDb();
  await pool.query("insert into docs (path, col, data, version) values ('opened/o1', 'opened', '{\"id\":\"o1\",\"name\":\"Ketchup 500 g\",\"left\":7,\"at\":\"2026-11-06T10:00:00Z\"}', nextval('docs_version_seq')), ('payments/py1', 'payments', '{\"id\":\"py1\",\"to\":\"Electricity\",\"amount\":40,\"currency\":\"USD\",\"due\":\"2026-11-01\",\"paidAt\":null}', nextval('docs_version_seq')), ('suppliers/s1', 'suppliers', '{\"id\":\"s1\",\"name\":\"Abu Karim\",\"phone\":\"70 123 456\",\"independent\":true}', nextval('docs_version_seq'))");
  const browser = await chromium.launch();
  // 1. every page, both languages, phone and laptop: errors, sideways scrolling, text cut off
  for (const vp of [{ width: 390, height: 800 }, { width: 1280, height: 800 }]) for (const lang of ['en', 'ar']) {
    const pg = await openApp(browser, vp, lang);
    for (const tab of TABS) {
      await pg.click(`[data-tab=${tab}]`); await sleep(250);
      const m = await pg.evaluate(() => {
        const out = { scroll: document.documentElement.scrollWidth - innerWidth, cut: [] };
        document.querySelectorAll('main button, main h2, main h3, nav.tabs button').forEach((el) => { const r = el.getBoundingClientRect(); if (r.width && (r.right > innerWidth + 1 || r.left < -1) && !el.closest('.tbl')) out.cut.push((el.innerText || '').slice(0, 30)); });
        return out;
      });
      if (m.scroll > 0) bad(`${lang} ${vp.width}px ${tab}: page scrolls sideways by ${m.scroll}px`);
      if (m.cut.length) bad(`${lang} ${vp.width}px ${tab}: cut off: ${m.cut.slice(0, 4).join(' | ')}`);
      await pg.screenshot({ path: `${process.env.SHOTS || '/tmp'}/sw-${vp.width}-${lang}-${tab}.png`, fullPage: true });
      // every button on the page opens without errors (skip ones that change data)
      const acts = await pg.evaluate(() => [...new Set([...document.querySelectorAll('main [data-act]')].filter((b) => !b.disabled && b.offsetParent).map((b) => b.dataset.act + '|' + (b.dataset.id || '') + '|' + (b.dataset.tab || '') + '|' + (b.dataset.v || b.dataset.m || b.dataset.sec || b.dataset.cat || '')))]);
      for (const a of acts) {
        const [act] = a.split('|');
        if (/^(del|finish|markPaid|saveSettings|removeExamples|signOut|lang|tab|unlink|linkSupplier|newSale|clearCart|copy)/.test(act)) continue;
        const [, id, , extra] = a.split('|');
        const sel = `main [data-act=${act}]` + (id ? `[data-id="${id}"]` : '') + (extra ? `[data-v="${extra}"],main [data-act=${act}][data-m="${extra}"],main [data-act=${act}][data-sec="${extra}"],main [data-act=${act}][data-cat="${extra}"]` : '');
        const el = await pg.$(sel); if (!el) continue;
        await el.click({ timeout: 3000 }).catch((e) => bad(`${lang} ${vp.width}px ${tab}: could not press ${act}: ${e.message.split('\n')[0]}`));
        await sleep(120);
        if (await pg.$('#overlay .drawer')) {
          const over = await pg.evaluate(() => { const d = document.querySelector('#overlay .drawer'); return d.scrollWidth - d.clientWidth; });
          if (over > 2) bad(`${lang} ${vp.width}px ${tab}: drawer from ${act} scrolls sideways by ${over}px`);
          await pg.keyboard.press('Escape'); await sleep(80);
        }
        if (await pg.evaluate(() => document.querySelector('main').dataset.tab) !== tab) await pg.click(`[data-tab=${tab}]`);
      }
      await pg.evaluate(() => { const c = document.querySelector('[data-act=clearCart]'); if (c) c.click(); });
    }
    await pg.context().close();
  }
  // 2. each form end to end, checked in the database
  const pg = await openApp(browser, { width: 1280, height: 800 }, 'en');
  const step = async (name, fn) => { try { await fn(); } catch (e) { bad(`${name}: ${e.message.split('\n')[0]}`); await pg.keyboard.press('Escape').catch(() => {}); } };
  await step('add product', async () => {
    await pg.click('[data-tab=stock]'); await pg.click('main [data-act=openProduct]:not([data-id])');
    await pg.fill('#pf-name', 'Test Soap'); await pg.fill('#pf-nameAr', 'صابون'); await pg.fill('#pf-barcode', '999111'); await pg.fill('#pf-price', '2.5'); await pg.fill('#pf-cost', '1.5'); await pg.fill('#pf-boxSize', '24'); await pg.fill('#pf-reorder', '10');
    await pg.click('#productForm button[type=submit]'); await closed(pg, '#productForm'); await sleep(300);
    const p = (await docsOf('products')).find((x) => x.barcode === '999111'); if (!p || p.price !== 2.5 || p.boxSize !== 24) bad('add product: not saved right ' + JSON.stringify(p));
  });
  const soap = async () => (await docsOf('products')).find((x) => x.barcode === '999111');
  await step('receive 3 boxes', async () => {
    const id = (await soap()).id; await pg.click(`[data-act=openReceive][data-id=${id}]`); await pg.fill('#rf-boxes', '3'); await pg.click('#receiveForm button[type=submit]'); await closed(pg, '#receiveForm'); await sleep(300);
    if ((await soap()).closed !== 3) bad('receive: closed should be 3, is ' + (await soap()).closed);
  });
  await step('take out too many', async () => {
    const id = (await soap()).id; await pg.click(`[data-act=openCount][data-id=${id}]`); await pg.fill('#tk-boxes', '5'); await pg.click('#takeForm button[type=submit]'); await sleep(400);
    if ((await soap()).closed !== 3) bad('take out 5 of 3 changed stock');
    if (!(await pg.$('#takeForm'))) bad('take out 5 of 3: form closed with no warning');
    await pg.keyboard.press('Escape');
  });
  await step('take out 1 box', async () => {
    const id = (await soap()).id; await pg.click(`[data-act=openCount][data-id=${id}]`); await pg.fill('#tk-boxes', '1'); await pg.click('#takeForm button[type=submit]'); await closed(pg, '#takeForm'); await sleep(300);
    if ((await soap()).closed !== 2) bad('take out 1: closed should be 2, is ' + (await soap()).closed);
  });
  await step('count', async () => {
    const id = (await soap()).id; await pg.click(`[data-act=openCount][data-id=${id}]`); await pg.fill('#cf-shelf', '7'); await pg.fill('#cf-open', '5'); await pg.fill('#cf-closed', '1'); await pg.click('#countForm button[type=submit]'); await closed(pg, '#countForm'); await sleep(300);
    const p = await soap(); if (p.shelf !== 7 || p.openBox !== 5 || p.closed !== 1) bad('count not saved ' + JSON.stringify([p.shelf, p.openBox, p.closed]));
  });
  await step('sell 2 soap cash with change in LBP', async () => {
    await pg.click('[data-tab=till]'); await pg.fill('#tillSearch', '999111'); await pg.keyboard.press('Enter'); await pg.fill('#tillSearch', '999111'); await pg.keyboard.press('Enter');
    await pg.fill('#payLbp', '500000'); await sleep(200); await pg.click('[data-act=finish]'); await pg.waitForSelector('[data-act=newSale]', { timeout: 10000 }); await sleep(500);
    const p = await soap(); const sold = Object.values(p.soldBy || {}).reduce((a, b) => a + b, 0) - (p.soldBase || 0);
    if (sold !== 2) bad('sale: soap sold should be 2, is ' + sold);
    const txt = await pg.evaluate(() => document.querySelector('.receipt-paper').innerText); if (!/5\.00/.test(txt)) bad('receipt total missing $5.00: ' + txt.slice(0, 200));
    await pg.click('[data-act=newSale]');
  });
  await step('weighed sale on credit', async () => {
    await pg.click('[data-tab=customers]'); await pg.click('main [data-act=openNewCustomer]'); await pg.fill('#cu-name', 'Abu Samir'); await pg.click('#customerForm button[type=submit]'); await closed(pg, '#customerForm'); await sleep(300);
    const c = (await docsOf('customers')).find((x) => x.name === 'Abu Samir'); if (!c) return bad('customer not added');
    await pg.click('[data-tab=till]'); await pg.click('[data-act=addItem][data-id=w1]'); await pg.fill('#weighPrice', '179000'); await pg.click('[data-act=weighAdd]');
    await pg.click('[data-act=method][data-m=credit]'); await pg.selectOption('#payCustomer', c.id); await pg.click('[data-act=finish]'); await pg.waitForSelector('[data-act=newSale]', { timeout: 10000 }); await sleep(500);
    const c2 = await doc('customers/' + c.id); const bal = Object.values(c2.entries || {}).reduce((s, e) => s + (e.type === 'sale' ? e.amount : -e.amount), 0);
    if (Math.abs(bal - 2) > 0.01) bad('credit sale: balance should be $2.00, is ' + bal);
    await pg.click('[data-act=newSale]');
  });
  await step('customer pays part', async () => {
    const c = (await docsOf('customers')).find((x) => x.name === 'Abu Samir');
    await pg.click('[data-tab=customers]'); await pg.click(`[data-act=openCustomerPay][data-id="${c.id}"]`); await pg.fill('#cp-amount', '1.5'); await pg.click('#custPayForm button[type=submit]'); await closed(pg, '#custPayForm'); await sleep(300);
    const c2 = await doc('customers/' + c.id); const bal = Object.values(c2.entries || {}).reduce((s, e) => s + (e.type === 'sale' ? e.amount : -e.amount), 0);
    if (Math.abs(bal - 0.5) > 0.01) bad('customer pay: balance should be $0.50, is ' + bal);
  });
  await step('employee salaf', async () => {
    await pg.click('[data-act=debtTab][data-v=staff]'); await pg.click('main [data-act=openNewCustomer]'); await pg.fill('#cu-name', 'Hassan'); await pg.click('#customerForm button[type=submit]'); await closed(pg, '#customerForm'); await sleep(300);
    const s = (await docsOf('customers')).find((x) => x.name === 'Hassan'); if (!s || s.kind !== 'staff') return bad('employee not added as staff');
    await pg.click(`[data-act=openAddDebt][data-id="${s.id}"]`); await pg.fill('#ad-amount', '20'); await pg.click('#addDebtForm button[type=submit]'); await closed(pg, '#addDebtForm'); await sleep(300);
    await pg.click(`[data-act=openCustomerPay][data-id="${s.id}"]`); await pg.fill('#cp-amount', '20'); await pg.check('#cp-salary'); await pg.click('#custPayForm button[type=submit]'); await closed(pg, '#custPayForm'); await sleep(300);
    const s2 = await doc('customers/' + s.id); const bal = Object.values(s2.entries || {}).reduce((x, e) => x + (e.type === 'sale' ? e.amount : -e.amount), 0);
    if (Math.abs(bal) > 0.01) bad('salaf: balance should be 0, is ' + bal);
  });
  await step('supplier add, edit, link, delete', async () => {
    await pg.click('[data-tab=suppliers]'); await pg.click('main [data-act=openSupplier]:not([data-id])'); await pg.fill('#su-name', 'Gandour rep'); await pg.fill('#su-phone', '03 111 222'); await pg.click('#supplierForm button[type=submit]'); await closed(pg, '#supplierForm'); await sleep(300);
    const s = (await docsOf('suppliers')).find((x) => x.name === 'Gandour rep'); if (!s) return bad('supplier not added');
    await pg.click(`main [data-act=openSupplier][data-id="${s.id}"]`); await pg.fill('#su-phone', '03 999 999'); await pg.click('#supplierForm button[type=submit]'); await closed(pg, '#supplierForm'); await sleep(300);
    if ((await doc('suppliers/' + s.id)).phone !== '03 999 999') bad('supplier edit not saved');
    const id = (await soap()).id; await pg.click('[data-tab=stock]'); await pg.click(`[data-act=productInfo][data-id=${id}]`); await sleep(200);
    if (await pg.$('#pi-sup')) { await pg.selectOption('#pi-sup', s.id); await pg.click('[data-act=linkSupplier]'); await sleep(500); if ((await soap()).supplierId !== s.id) bad('link supplier not saved'); }
    else bad('product panel has no supplier picker');
    await pg.keyboard.press('Escape');
    // a supplier still linked to a product can't be deleted; after unlinking it can
    await pg.click('[data-tab=suppliers]'); await pg.click(`main [data-act=openSupplier][data-id="${s.id}"]`); await pg.click('[data-act=delSupplier]'); await sleep(300);
    if (!/./.test(await toastText(pg))) bad('linked supplier delete gave no message'); await pg.keyboard.press('Escape');
    await pg.click('[data-tab=stock]'); await pg.click(`main [data-act=openProduct][data-id=${(await soap()).id}]`); await pg.selectOption('#pf-supplier', ''); await pg.click('#productForm button[type=submit]'); await closed(pg, '#productForm'); await sleep(400);
    if ((await soap()).supplierId) bad('unlink supplier not saved');
    await pg.click('[data-tab=suppliers]'); await pg.click(`main [data-act=openSupplier][data-id="${s.id}"]`); await pg.click('[data-act=delSupplier]'); await pg.click('[data-act=delSupplier]'); await sleep(500);
    if (await doc('suppliers/' + s.id)) bad('supplier not deleted');
    await pg.keyboard.press('Escape');
  });
  await step('opened box add, edit, delete', async () => {
    await pg.click('[data-tab=boxes]'); await pg.click('main [data-act=openOpened]:not([data-id])'); await pg.fill('#ob-name', 'Tuna box'); await pg.fill('#ob-left', '20'); await pg.click('#openedForm button[type=submit]'); await closed(pg, '#openedForm'); await sleep(300);
    const o = (await docsOf('opened')).find((x) => x.name === 'Tuna box'); if (!o || o.left !== 20) return bad('opened box not added');
    await pg.click(`[data-act=openOpened][data-id="${o.id}"]`); await pg.fill('#ob-left', '13'); await pg.click('#openedForm button[type=submit]'); await closed(pg, '#openedForm'); await sleep(300);
    if ((await doc('opened/' + o.id)).left !== 13) bad('opened box edit not saved');
    await pg.click(`[data-act=openOpened][data-id="${o.id}"]`); await pg.click('[data-act=delOpened]'); await pg.click('[data-act=delOpened]'); await sleep(500);
    if (await doc('opened/' + o.id)) bad('opened box not deleted');
    if (await pg.$(`[data-act=openOpened][data-id="${o.id}"]`)) bad('deleted opened box still on screen');
  });
  await step('payment add, edit, pay, delete', async () => {
    await pg.click('[data-tab=payments]'); await pg.click('main [data-act=openPayment]:not([data-id])'); await pg.fill('#py-to', 'Rent'); await pg.fill('#py-amount', '300'); await pg.click('#paymentForm button[type=submit]'); await closed(pg, '#paymentForm'); await sleep(300);
    const p = (await docsOf('payments')).find((x) => x.to === 'Rent'); if (!p || p.amount !== 300) return bad('payment not added');
    await pg.click(`main [data-act=markPaid][data-id="${p.id}"]`).catch(() => bad('no Paid button for new payment')); await sleep(400);
    if (!(await doc('payments/' + p.id)).paidAt) bad('mark paid not saved');
    await pg.click('[data-act=payTab][data-v=paid]').catch(() => {}); await sleep(200);
    await pg.click(`main [data-act=openPayment][data-id="${p.id}"]`); await pg.click('[data-act=delPayment]'); await pg.click('[data-act=delPayment]'); await sleep(500);
    if (await doc('payments/' + p.id)) bad('payment not deleted');
  });
  await step('settings', async () => {
    await pg.click('[data-tab=settings]'); await pg.fill('#setRate', '90000'); await pg.click('[data-act=saveSettings]'); await sleep(500);
    if ((await doc('settings/main')).rate !== 90000) bad('rate not saved');
    const tag = await pg.textContent('#rateTag'); if (!/90,000/.test(tag)) bad('rate on header not updated: ' + tag);
  });
  await step('edit and delete product', async () => {
    const id = (await soap()).id; await pg.click('[data-tab=stock]'); await pg.click(`main [data-act=openProduct][data-id=${id}]`); await pg.fill('#pf-price', '2.75'); await pg.click('#productForm button[type=submit]'); await closed(pg, '#productForm'); await sleep(300);
    const p = await soap(); if (p.price !== 2.75 || p.closed !== 1) bad('product edit lost data ' + JSON.stringify([p.price, p.closed]));
    await pg.click(`main [data-act=openProduct][data-id=${id}]`); await pg.click('[data-act=delProduct]'); await pg.click('[data-act=delProduct]'); await sleep(500);
    if (await soap()) bad('product not deleted');
  });
  await step('sign out and back in', async () => {
    await pg.click('[data-tab=settings]'); await pg.click('main [data-act=signOut]'); await pg.waitForSelector('#loginForm', { timeout: 10000 });
    if (await pg.isVisible('nav.tabs button')) bad('tabs visible while signed out');
  });
  await browser.close(); await pool.end();
  console.log(JSON.stringify({ problems: problems.length, list: problems }, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
