const {JSDOM, ResourceLoader, VirtualConsole} = require('jsdom');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const owner = {id: 'owner', username: 'owner', name: 'Owner', role: 'Administrator', status: 'active', hasPin: true};
const inventory = Array.from({length: 105}, (_, id) => ({id: id + 1, name: `Rice Meal ${id + 1}`, category: 'Meals', price: 100, stock: 100, image: '🍚'}));
const sales = Array.from({length: 105}, (_, id) => ({transaction: `FC-${String(id).padStart(4, '0')}`, timestamp: id < 50 ? '2026-10-15T10:00:00+08:00' : '2026-09-15T10:00:00+08:00', date: id < 50 ? '10/15/2026' : '9/15/2026', time: '10:00 AM', items: [{id: 1, name: 'Rice Meal 1', price: 100, quantity: 1, subtotal: 100}], total: 90, subtotal: 100, discount: 10, discountType: 'Promotional', discountName: 'Promo', staffId: 'owner', staffName: 'Owner', paymentMethod: 'Cash', cash: 100, change: 10}));
const discount = {id: 'promo', name: 'Promo', type: 'Promotional', mode: 'percentage', value: 10, products: [], categories: [], start: '', end: '', active: true, restricted: false};
class Loader extends ResourceLoader {
    fetch(url) {
        const relative = new URL(url).pathname.replace(/^\//, '');
        const file = path.join(root, relative);
        return fs.existsSync(file) && file.endsWith('.js') ? Promise.resolve(fs.readFileSync(file)) : null;
    }
}
async function load(page, {secure = true, setup = false, guest = false, staff = false} = {}) {
    const file = page === 'index.html' ? page : `pages/${page}`;
    const calls = [], errors = [];
    const user = guest ? null : staff ? {...owner, role: 'Staff'} : owner;
    const resources = {};
    for (const suffix of ['Inventory', 'Sales', 'Customers', 'Expenses', 'InventoryHistory', 'Categories', 'CashDrawer', 'CashClosings', 'StockDiscrepancies']) resources['feuCanteen' + suffix] = {value: suffix === 'Inventory' ? structuredClone(inventory) : suffix === 'Sales' ? structuredClone(sales) : [], revision: 0};
    resources.feuCanteenSettings = {value: {taxEnabled: false, cashEnabled: true, gcashEnabled: true, confirmSale: false}, revision: 0};
    const console = new VirtualConsole(); console.on('jsdomError', error => { if (!/navigation|scrollIntoView|window.print/.test(error.message)) errors.push(error); });
    const dom = new JSDOM(fs.readFileSync(path.join(root, file), 'utf8'), {
        url: 'http://localhost:8000/' + file, resources: new Loader(), runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: console,
        beforeParse(window) {
            window.alert = message => calls.push({alert: message}); window.confirm = () => true;
            window.prompt = () => null;
            window.HTMLElement.prototype.scrollIntoView = function () {};
            window.BroadcastChannel = class {postMessage() {} close() {}};
            window.URL.createObjectURL = () => 'blob:test'; window.URL.revokeObjectURL = () => {};
            window.crypto.randomUUID = crypto.randomUUID;
            window.localStorage.setItem('feuCanteenSession', JSON.stringify(user));
            window.localStorage.setItem('feuCanteenUsers', JSON.stringify([owner]));
            for (const [key, resource] of Object.entries(resources)) window.localStorage.setItem(key, JSON.stringify(resource.value));
            window.XMLHttpRequest = class {
                open(method, url) { this.method = method; this.url = new URL(url, window.location.href); }
                setRequestHeader() {}
                send(raw) {
                    const body = raw ? JSON.parse(raw) : null, route = this.url.pathname.slice(5);
                    calls.push({route, body, method: this.method});
                    let value = {};
                    this.status = secure ? 200 : 404;
                    if (route === 'status') value = {backend: secure, needsSetup: setup, user, csrf: 'csrf'};
                    if (route === 'snapshot') value = {resources, user, csrf: 'csrf'};
                    if (route === 'users') value = {users: [owner, {...owner, id: 'staff', username: 'staff', role: 'Staff'}]};
                    if (route === 'discounts') value = this.method === 'GET' ? {discounts: [discount]} : body;
                    if (route === 'audit') value = {records: []};
                    if (route === 'sales-staff') value = {staff: [{id: 'owner', name: 'Owner'}]};
                    if (route === 'sales') {
                        const size = Number(this.url.searchParams.get('size') || 25), page = Number(this.url.searchParams.get('page') || 1);
                        value = {records: sales.slice((page - 1) * size, page * size), page, size, count: sales.length, pages: Math.ceil(sales.length / size), total: 9450, discount: 1050, items: 105, todayTotal: 4500};
                    }
                    if (route === 'resource') { resources[body.key] = {value: body.value, revision: body.revision + 1}; value = {revision: body.revision + 1}; }
                    if (route === 'quote' || route === 'checkout') {
                        const subtotal = body.items.reduce((n, i) => n + 100 * i.quantity, 0);
                        value = {...sales[0], items: body.items.map(i => ({...inventory.find(p => p.id === i.id), quantity: i.quantity, subtotal: 100 * i.quantity})), subtotal, discount: body.discountId ? subtotal / 10 : 0, total: body.discountId ? subtotal * .9 : subtotal, tax: 0, eligibleAmount: subtotal, vatAdjustment: 0};
                    }
                    this.responseText = JSON.stringify(value);
                }
            };
        }
    });
    await new Promise(resolve => dom.window.addEventListener('load', resolve, {once: true}));
    await new Promise(resolve => setTimeout(resolve, 30));
    return {dom, window: dom.window, document: dom.window.document, calls, errors};
}
const submit = (window, form) => form.dispatchEvent(new window.Event('submit', {bubbles: true, cancelable: true}));
async function main() {
    for (const secure of [false, true]) {
        for (const page of ['index.html', 'login.html', 'products.html', 'inventory.html', 'pos.html', 'sales.html', 'reports.html', 'customers.html', 'account.html', 'settings.html', 'discounts.html', 'customer-display.html']) {
            const app = await load(page, {secure});
            assert.deepEqual(app.errors.map(e => e.message), [], `${page} secure=${secure}`);
            app.dom.window.close();
        }
    }
    {
        const app = await load('login.html', {setup: true, guest: true});
        const form = app.document.getElementById('loginForm');
        for (const [key, value] of Object.entries({username: 'newowner', name: 'Owner', setupToken: 'test-token', password: 'Password123!', confirm: 'Password123!', pin: '123456'})) form.elements[key].value = value;
        assert.equal(form.elements.pin.type, 'password'); submit(app.window, form);
        assert.ok(app.calls.some(c => c.route === 'setup' && c.body.pin === '123456'));
        assert.equal(app.window.localStorage.getItem('pin'), null);
        app.window.close();
    }
    {
        const app = await load('products.html');
        const nav = [...app.document.querySelectorAll('.feu-pagination')][0];
        assert.ok(nav.textContent.includes('Showing 1–25 of 105 records'));
        nav.querySelector('select').value = '10'; nav.querySelector('select').dispatchEvent(new app.window.Event('change'));
        [...nav.querySelectorAll('button')].find(b => b.textContent === 'Next').click();
        assert.ok(nav.textContent.includes('Showing 11–20 of 105 records'));
        app.window.close();
    }
    {
        const app = await load('sales.html');
        const nav = app.document.querySelector('[data-server-paged].feu-pagination');
        assert.ok(nav.textContent.includes('Showing 1–25 of 105 records'));
        nav.querySelector('select').value = '10'; nav.querySelector('select').dispatchEvent(new app.window.Event('change'));
        [...nav.querySelectorAll('button')].find(b => b.textContent === 'Next').click();
        assert.ok(app.calls.some(c => c.route === 'sales' && c.method === 'GET'));
        assert.ok(nav.textContent.includes('Showing 11–20 of 105 records'));
        const writes = app.calls.filter(c => c.method !== 'GET').length;
        app.window.printSale({...sales[0], vatAdjustment: 12, eligibleAmount: 100});
        const frame = app.document.querySelector('iframe[title="Print Receipt"]');
        assert.ok(frame.contentDocument.body.textContent.includes('VAT removed'));
        assert.equal(app.calls.filter(c => c.method !== 'GET').length, writes);
        app.window.close();
    }
    {
        const app = await load('reports.html');
        const forms = app.document.querySelectorAll('.feu-filter');
        assert.equal(forms.length, 9);
        const product = [...forms].find(f => f.getAttribute('aria-label') === 'Product Sales Report date filter');
        const daily = app.document.getElementById('totalRevenue').textContent;
        product.elements.preset.value = 'custom'; product.elements.preset.dispatchEvent(new app.window.Event('change'));
        product.elements.start.value = '2026-09-01'; product.elements.end.value = '2026-09-30'; submit(app.window, product);
        assert.equal(app.document.getElementById('totalRevenue').textContent, daily);
        assert.ok(app.document.getElementById('bestProducts').textContent.includes('55 sold'));
        product.elements.start.value = '2026-10-30'; submit(app.window, product);
        assert.ok(product.textContent.includes('valid start and end'));
        app.window.close();
    }
    {
        const app = await load('pos.html');
        app.window.addToCart(1);
        app.document.getElementById('checkoutDiscount').value = 'promo';
        app.document.getElementById('checkoutDiscount').dispatchEvent(new app.window.Event('change', {bubbles: true}));
        app.document.getElementById('checkoutButton').click();
        app.document.getElementById('cashReceived').value = '200';
        app.document.getElementById('cashReceived').dispatchEvent(new app.window.Event('input', {bubbles: true}));
        app.document.getElementById('completePayment').disabled = false;
        app.document.getElementById('completePayment').click();
        assert.equal(app.calls.filter(c => c.route === 'checkout').length, 1);
        assert.equal(app.calls.find(c => c.route === 'checkout').body.discountId, 'promo');
        assert.equal(app.calls.filter(c => c.route === 'resource' && ['feuCanteenInventory', 'feuCanteenSales'].includes(c.body.key)).length, 0);
        assert.ok(app.document.getElementById('receiptContent').textContent.includes('VAT removed'));
        app.window.close();
    }
    console.log('All existing pages load in offline and server modes; setup, pagination, independent report filters and atomic POS wiring pass.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
