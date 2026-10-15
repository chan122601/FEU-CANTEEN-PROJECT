(function () {
    'use strict';
    const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
    const money = value => Number(value || 0).toLocaleString('en-PH', {style: 'currency', currency: 'PHP'});
    const read = key => { try { return JSON.parse(POSStore.getItem('feuCanteen' + key) || '[]'); } catch { return []; } };
    const stableSales = records => [...records].sort((a, b) => FEUData.saleDate(b).localeCompare(FEUData.saleDate(a)) || String(b.timestamp || '').localeCompare(String(a.timestamp || '')) || String(b.transaction).localeCompare(String(a.transaction)));
    function printHTML(title, content, receipt = false) {
        const frame = document.createElement('iframe');
        frame.title = 'Print ' + title;
        frame.style.cssText = 'position:fixed;width:1px;height:1px;bottom:0;left:0;border:0';
        document.body.append(frame);
        const doc = frame.contentDocument;
        doc.open();
        doc.write('<!doctype html><html><head><title>' + esc(title) + '</title><style>body{font:14px Arial;color:#1f2937;margin:24px}h1{color:#064e3b;font-size:22px}table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:8px;border-bottom:1px solid #ddd}button,.feu-filter,.feu-pagination,form,details{display:none!important}[hidden]{display:revert!important}tr{break-inside:avoid}thead{display:table-header-group}.bar-track{display:none}' + (receipt ? 'body{max-width:72mm;margin:4mm;font-size:12px}td,th{padding:5px 1px}h1{font-size:18px}@page{size:80mm auto;margin:4mm}' : '@page{size:auto;margin:12mm}') + '</style></head><body><h1>FEU CANTEEN</h1><h2>' + esc(title) + '</h2>' + content + '<p>Thank you for visiting FEU Roosevelt Canteen.</p></body></html>');
        doc.close();
        const cleanup = () => frame.remove();
        frame.contentWindow.addEventListener('afterprint', cleanup, {once: true});
        setTimeout(() => { frame.contentWindow.focus(); frame.contentWindow.print(); }, 100);
        setTimeout(cleanup, 120000);
    }
    function receipt(sale) {
        const settings = read('Settings');
        return `<p>${esc(settings.storeAddress || '')}<br>${esc(sale.transaction)}<br>${esc(sale.date)} ${esc(sale.time)}</p><table><thead><tr><th>Item / unit price</th><th>Qty</th><th>Amount</th></tr></thead><tbody>` +
            (sale.items || []).map(i => `<tr><td>${esc(i.name)}<br>${money(i.price)}</td><td>${Number(i.quantity)}</td><td>${money(i.subtotal)}</td></tr>`).join('') +
            `</tbody></table><p>Subtotal: ${money(sale.subtotal)}<br>Discount: ${esc(sale.discountName || sale.discountType || 'None')} (${money(sale.discount)})<br>Eligible amount: ${money(sale.eligibleAmount)}<br>VAT removed: ${money(sale.vatAdjustment)}<br>Tax: ${money(sale.tax)}<br><strong>Total: ${money(sale.total)}</strong><br>Payment: ${esc(sale.paymentMethod)}<br>` +
            (sale.paymentMethod === 'Cash' ? `Cash: ${money(sale.cash)}<br>Change: ${money(sale.change)}` : `Reference: ${esc(sale.referenceNumber)}`) +
            `</p><p>${esc(settings.receiptFooter || '')}</p>`;
    }
    window.FEUPrint = {html: printHTML, receipt, money, esc};

    function pager(host, state, count, render) {
        const info = FEUData.page(Array.from({length: count}), state.page, state.size);
        state.page = info.number;
        host.replaceChildren();
        host.className = 'feu-pagination';
        host.setAttribute('aria-label', 'Record pagination');
        const label = document.createElement('span');
        label.setAttribute('role', 'status');
        label.textContent = `Showing ${info.start}–${info.end} of ${count} records`;
        const sizeLabel = document.createElement('label');
        sizeLabel.textContent = 'Rows ';
        const select = document.createElement('select');
        [10, 25, 50, 100].forEach(n => select.add(new Option(String(n), String(n))));
        select.value = state.size;
        select.onchange = () => { state.size = Number(select.value); state.page = 1; render(); };
        sizeLabel.append(select);
        host.append(label, sizeLabel);
        const button = (text, page, disabled, current = false) => {
            const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.disabled = disabled;
            if (current) b.setAttribute('aria-current', 'page');
            b.onclick = () => { state.page = page; render(); };
            host.append(b);
        };
        button('Previous', state.page - 1, state.page === 1);
        const numbers = new Set([1, info.pages]);
        for (let n = Math.max(1, state.page - 2); n <= Math.min(info.pages, state.page + 2); n++) numbers.add(n);
        let previous = 0;
        [...numbers].sort((a, b) => a - b).forEach(n => {
            if (previous && n - previous > 1) host.append(Object.assign(document.createElement('span'), {textContent: '…'}));
            button(String(n), n, false, n === state.page); previous = n;
        });
        button('Next', state.page + 1, state.page === info.pages);
    }
    window.FEUPager = pager;
    function dateFilter(host, title, onApply, print) {
        let bounds = ['', ''];
        const form = document.createElement('form');
        form.className = 'feu-filter';
        form.setAttribute('aria-label', title + ' date filter');
        form.innerHTML = '<label>Period<select name="preset"><option value="all">All Dates</option><option value="today">Today</option><option value="yesterday">Yesterday</option><option value="last7">Last 7 Days</option><option value="thisMonth">This Month</option><option value="lastMonth">Last Month</option><option value="custom">Custom Date Range</option></select></label><label>Start date<input name="start" type="date"></label><label>End date<input name="end" type="date"></label><button class="primary-button">Apply Filter</button><button type="button" data-reset>Reset Filter</button><button type="button" data-print>Print / Save PDF</button><span role="status" aria-live="polite"></span>';
        const setDates = () => {
            const custom = form.elements.preset.value === 'custom';
            form.elements.start.disabled = !custom; form.elements.end.disabled = !custom;
            if (!custom) {
                const dates = FEUData.range(form.elements.preset.value);
                form.elements.start.value = dates[0]; form.elements.end.value = dates[1];
            }
        };
        form.elements.preset.onchange = setDates; setDates();
        form.onsubmit = event => {
            event.preventDefault();
            try {
                bounds = FEUData.range(form.elements.preset.value, form.elements.start.value, form.elements.end.value);
                form.querySelector('[role=status]').textContent = bounds[0] ? `${bounds[0]} to ${bounds[1]}` : 'All dates';
                onApply(bounds);
            } catch (error) { form.querySelector('[role=status]').textContent = error.message; }
        };
        form.querySelector('[data-reset]').onclick = () => { form.reset(); setDates(); bounds = ['', '']; form.querySelector('[role=status]').textContent = 'All dates'; onApply(bounds); };
        form.querySelector('[data-print]').onclick = () => print(bounds);
        host.prepend(form);
        return form;
    }

    const reports = [];
    window.FEUReports = {render() { reports.forEach(r => r.render()); }};
    function setupReports() {
        // Existing functions keep drawing the established cards and charts. Each
        // receives its own filtered dataset; legacy shared date inputs stay at All.
        document.querySelector('.financial-filter-bar').hidden = true;
        const salesFor = bounds => stableSales(read('Sales')).filter(s => FEUData.within(FEUData.saleDate(s), bounds));
        const add = (host, title, draw, inventory = false) => {
            const controller = {bounds: ['', ''], render() { draw(salesFor(this.bounds), this.bounds); }};
            reports.push(controller);
            if (inventory) {
                const note = document.createElement('p'); note.className = 'feu-note';
                note.textContent = 'Current inventory snapshot. Historical stock is not inferred from incomplete legacy history.';
                host.prepend(note);
                const button = document.createElement('button'); button.textContent = 'Print / Save PDF';
                button.onclick = () => printHTML(title, host.innerHTML); host.prepend(button);
            } else dateFilter(host, title, bounds => { controller.bounds = bounds; controller.render(); }, bounds => printHTML(title, `<p>${esc(bounds[0] || 'All dates')} ${esc(bounds[1] || '')}</p>` + host.innerHTML));
            controller.render();
        };
        add(document.querySelector('.report-stats'), 'Daily Sales Report', updateSummary);
        const financial = document.querySelector('.financial-summary');
        const periodLabel = bounds => bounds[0] ? bounds.join(' to ') : 'All dates';
        add(financial, 'Financial Summary', (sales, bounds) => {
            updateFinancialSummary(sales, read('Expenses').filter(e => FEUData.within(e.date, bounds)));
            ['financialSalesNote', 'financialExpensesNote'].forEach(id => document.getElementById(id).textContent = periodLabel(bounds));
        });
        add(document.getElementById('staffPerformance').closest('section'), 'Sales by Staff', (sales, bounds) => {
            updateStaffPerformance(sales); document.getElementById('staffPerformancePeriod').textContent = periodLabel(bounds);
        });
        add(document.getElementById('expenseList').closest('section'), 'Expenses', (_, bounds) => renderExpenses(read('Expenses').filter(e => FEUData.within(e.date, bounds))));
        add(document.getElementById('cashRevenue').closest('section'), 'Payment Performance', updatePaymentSummary);
        add(document.getElementById('stockUnits').closest('section'), 'Current Stock', () => updateInventorySummary(read('Inventory')), true);
        add(document.getElementById('bestProducts').closest('section'), 'Product Sales Report', updateBestProducts);
        add(document.getElementById('topCustomers').closest('section'), 'Customer Sales Report', sales => updateTopCustomers(sales, read('Customers')));
        add(document.getElementById('recentTransactions').closest('section'), 'Daily Transactions', updateRecentTransactions);
        const panel = document.createElement('section'); panel.className = 'report-panel';
        panel.innerHTML = '<h3>Discount Report</h3><p class="discount-summary"></p><div class="discount-report-table"></div>';
        document.querySelector('.reports-page').append(panel);
        add(panel, 'Discount Report', sales => {
            const records = sales.filter(s => Number(s.discount || 0) > 0 || Number(s.vatAdjustment || 0) > 0);
            panel.querySelector('.discount-summary').textContent = `Discounts: ${money(records.reduce((n, s) => n + Number(s.discount || 0), 0))} · VAT removed: ${money(records.reduce((n, s) => n + Number(s.vatAdjustment || 0), 0))}`;
            panel.querySelector('.discount-report-table').innerHTML = records.length ? '<table><thead><tr><th>Transaction</th><th>Date</th><th>Discount</th><th>Eligible</th><th>Discount amount</th><th>VAT removed</th></tr></thead><tbody>' + records.map(s => `<tr><td>${esc(s.transaction)}</td><td>${esc(FEUData.saleDate(s))}</td><td>${esc(s.discountName || s.discountType || 'Legacy discount')}</td><td>${money(s.eligibleAmount)}</td><td>${money(s.discount)}</td><td>${money(s.vatAdjustment)}</td></tr>`).join('') + '</tbody></table>' : '<p>No discounts found for this period.</p>';
        });
        window.loadReport = () => { if (FEU.secure) FEU.refresh(); FEUReports.render(); };
        const originalPrint = document.getElementById('printReport'), print = originalPrint.cloneNode(true);
        originalPrint.replaceWith(print);
        print.onclick = () => printHTML('Reports', document.querySelector('.reports-page').innerHTML);
    }
    function autoPagination() {
        const registry = new WeakMap();
        const scan = () => {
            document.querySelectorAll('main table, .account-page table, #bestProducts, #topCustomers').forEach(table => {
                if (table.dataset.serverPaged || table.closest('.feu-no-pagination')) return;
                const rows = table.tagName === 'TABLE' ? [...(table.tBodies[0]?.rows || [])] : [...table.children].filter(e => e.classList.contains('bar-row'));
                if (!rows.length) return;
                let state = registry.get(table);
                if (!state) {
                    const controls = document.createElement('nav');
                    table.after(controls);
                    state = {page: 1, size: 25, controls}; registry.set(table, state);
                }
                const render = () => {
                    const info = FEUData.page(rows, state.page, state.size); state.page = info.number;
                    rows.forEach((row, i) => { row.hidden = i < info.start - 1 || i >= info.end; });
                    pager(state.controls, state, rows.length, render);
                };
                if (!state.rows || state.rows[0] !== rows[0] || state.rows.length !== rows.length) {
                    state.rows = rows; state.page = 1; render();
                }
            });
            document.querySelectorAll('.feu-pagination').forEach(nav => { if (!nav.dataset.serverPaged && !nav.previousElementSibling?.matches('table,#bestProducts,#topCustomers')) nav.remove(); });
        };
        new MutationObserver(scan).observe(document.querySelector('main') || document.body, {childList: true, subtree: true});
        scan();
    }
    function salesEnhancements() {
        const toolbar = document.querySelector('.sales-toolbar') || document.getElementById('salesSearch').parentElement;
        const select = document.createElement('select'); select.id = 'salesDiscountFilter'; select.setAttribute('aria-label', 'Discount type');
        select.innerHTML = '<option value="all">All discounts</option><option value="none">No discount</option><option>Senior Citizen</option><option>PWD</option><option>Promotional</option><option>Custom</option><option value="legacy">Legacy discount</option>';
        toolbar.append(select);
        const oldFiltered = window.getFilteredSales;
        window.getFilteredSales = () => stableSales(oldFiltered()).filter(s => select.value === 'all' || (select.value === 'none' ? !Number(s.discount) && !Number(s.vatAdjustment) : select.value === 'legacy' ? Number(s.discount) > 0 && !s.discountType : s.discountType === select.value));
        select.onchange = () => renderSales();
        const button = document.createElement('button'); button.className = 'report-button'; button.textContent = 'Print Filtered Sales / PDF';
        button.onclick = () => {
            const records = getFilteredSales();
            printHTML('Filtered Sales Report', `<p>${records.length} transactions · Total ${money(records.reduce((n, s) => n + Number(s.total || 0), 0))} · Discounts ${money(records.reduce((n, s) => n + Number(s.discount || 0), 0))}</p><table><thead><tr><th>Transaction</th><th>Date</th><th>Payment</th><th>Discount</th><th>Total</th></tr></thead><tbody>` + records.map(s => `<tr><td>${esc(s.transaction)}</td><td>${esc(FEUData.saleDate(s))}</td><td>${esc(s.paymentMethod)}</td><td>${money(s.discount)}</td><td>${money(s.total)}</td></tr>`).join('') + '</tbody></table>');
        };
        toolbar.append(button);
        window.printSale = sale => printHTML('Receipt', receipt(sale), true);
        const oldLoad = window.loadSales;
        window.loadSales = () => { if (FEU.secure) FEU.refresh(); oldLoad(); };
        const totalNote = document.createElement('p'); totalNote.setAttribute('role', 'status');
        toolbar.after(totalNote);
        const originalStats = window.updateStats;
        window.updateStats = records => {
            originalStats(records);
            totalNote.textContent = 'Discount total: ' + money(records.reduce((n, s) => n + Number(s.discount || 0), 0));
        };
        if (FEU.secure) {
            const controls = document.createElement('nav'); controls.dataset.serverPaged = 'true';
            document.getElementById('salesTableContainer').after(controls);
            const state = {page: 1, size: 25};
            let signature = '', result = null, parameters = '', cachedQuery = '', filterError = '';
            const populateStaff = () => {
                const staff = document.getElementById('salesStaffFilter'), previous = staff.value;
                staff.replaceChildren(new Option('All Staff', 'all'));
                FEU.request('sales-staff').staff.forEach(s => staff.add(new Option(s.name || s.id || 'Unassigned', s.id)));
                if ([...staff.options].some(o => o.value === previous)) staff.value = previous;
            };
            window.getFilteredSales = () => {
                let bounds;
                try {
                    bounds = FEUData.range(document.getElementById('salesDateFilter').value,
                        document.getElementById('salesStartDate').value, document.getElementById('salesEndDate').value);
                    filterError = '';
                } catch (error) { filterError = error.message; return result?.records || []; }
                const params = new URLSearchParams({q: document.getElementById('salesSearch').value.trim(), start: bounds[0], end: bounds[1]});
                for (const [key, id] of [['payment', 'salesPaymentFilter'], ['staff', 'salesStaffFilter'], ['discount', 'salesDiscountFilter']]) {
                    const value = document.getElementById(id).value;
                    if (value !== 'all') params.set(key, value);
                }
                parameters = params.toString();
                if (signature !== parameters) { signature = parameters; state.page = 1; }
                const query = `sales?${parameters}&page=${state.page}&size=${state.size}`;
                if (cachedQuery !== query) { result = FEU.request(query); cachedQuery = query; }
                state.page = result.page;
                return result.records;
            };
            window.updateStats = () => {
                if (filterError) { totalNote.textContent = filterError; return; }
                if (!result) return;
                document.getElementById('totalSales').textContent = money(result.total);
                document.getElementById('totalTransactions').textContent = result.count;
                document.getElementById('itemsSold').textContent = result.items;
                document.getElementById('todaySales').textContent = money(result.todayTotal);
                totalNote.textContent = 'Discount total: ' + money(result.discount);
            };
            const originalRender = window.renderSales;
            const render = () => {
                try {
                    originalRender();
                    const table = document.querySelector('#salesTableContainer table');
                    if (table) table.dataset.serverPaged = 'true';
                    pager(controls, state, result.count, render);
                } catch (error) { totalNote.textContent = error.message; }
            };
            window.renderSales = render;
            // Existing change listeners captured the original renderer; append the
            // server pagination update after those handlers finish.
            ['salesSearch', 'salesDateFilter', 'salesStartDate', 'salesEndDate', 'salesPaymentFilter', 'salesStaffFilter'].forEach(id => {
                document.getElementById(id).addEventListener(id === 'salesSearch' ? 'input' : 'change', () => { state.page = 1; render(); });
            });
            window.loadSales = () => { FEU.refresh(); populateStaff(); state.page = 1; cachedQuery = ''; };
            button.onclick = () => {
                try {
                    getFilteredSales();
                    if (filterError) throw new Error(filterError);
                    const records = [];
                    for (let page = 1; ; page++) {
                        const batch = FEU.request(`sales?${parameters}&page=${page}&size=100`);
                        records.push(...batch.records); if (page >= batch.pages) break;
                    }
                    printHTML('Filtered Sales Report', `<p>${records.length} transactions · Total ${money(result.total)} · Discounts ${money(result.discount)}</p><table><thead><tr><th>Transaction</th><th>Date</th><th>Payment</th><th>Discount</th><th>Total</th></tr></thead><tbody>` + records.map(s => `<tr><td>${esc(s.transaction)}</td><td>${esc(FEUData.saleDate(s))}</td><td>${esc(s.paymentMethod)}</td><td>${money(s.discount)}</td><td>${money(s.total)}</td></tr>`).join('') + '</tbody></table>');
                } catch (error) { totalNote.textContent = error.message; }
            };
            populateStaff();
        }
        renderSales();
    }

    function securePOS() {
        if (!FEU.secure) return;
        let discounts = FEU.request('discounts').discounts;
        const host = document.createElement('div'); host.className = 'feu-discount-picker';
        host.innerHTML = '<label class="feu-field">Discount<select id="checkoutDiscount"><option value="">No discount</option></select></label><label><input id="discountEntitlement" type="checkbox"> Entitlement verified (no ID image stored)</label><label><input id="discountConsumption" type="checkbox"> Separate qualifying purchase for the eligible person’s exclusive consumption; no bulk or companion purchases</label><p id="quoteDetails" role="status"></p>';
        document.getElementById('checkoutButton').before(host);
        const select = host.querySelector('select');
        discounts.filter(d => d.active).forEach(d => select.add(new Option(`${d.name}${d.restricted ? ' (owner only)' : ''}`, d.id)));
        const payload = () => ({items: cart.map(i => ({id: i.id, quantity: Number(i.quantity)})), discountId: select.value,
            eligibilityConfirmed: document.getElementById('discountEntitlement').checked,
            exclusiveConsumption: document.getElementById('discountConsumption').checked});
        let currentQuote = null, quoteError = '', busy = false, requestId = '';
        const displayChannel = new BroadcastChannel('feu-customer-display');
        const publishDisplay = () => displayChannel.postMessage({items: cart.map(i => ({name: i.name, quantity: i.quantity, subtotal: Number(i.price) * Number(i.quantity)})), total: currentQuote?.total ?? null});
        displayChannel.onmessage = event => { if (event.data?.request) publishDisplay(); };
        const getQuote = () => {
            if (!cart.length) { currentQuote = {subtotal: 0, discount: 0, tax: 0, total: 0}; return currentQuote; }
            currentQuote = FEU.request('quote', payload());
            return currentQuote;
        };
        window.calculateTotal = () => { try { return getQuote().total; } catch { return 0; } };
        window.updateTotals = () => {
            try {
                quoteError = ''; const q = getQuote();
                ['subtotal', 'discount', 'tax', 'total'].forEach(key => document.getElementById(key).textContent = money(q[key]));
                document.getElementById('quoteDetails').textContent = q.discountType ? `${q.discountType} · Eligible ${money(q.eligibleAmount)} · VAT removed ${money(q.vatAdjustment)}` : 'No discount selected';
                document.getElementById('checkoutButton').disabled = !cart.length;
                publishDisplay();
            } catch (error) {
                quoteError = error.message; currentQuote = null;
                document.getElementById('quoteDetails').textContent = quoteError;
                document.getElementById('checkoutButton').disabled = true;
                publishDisplay();
            }
        };
        host.addEventListener('change', () => { requestId = ''; updateTotals(); });
        const originalOpen = window.openPayment;
        window.openPayment = () => { updateTotals(); if (!quoteError) { requestId = crypto.randomUUID(); originalOpen(); } };
        // Existing listeners captured original functions; explicitly rebind the two
        // action buttons using clones before installing the transactional handler.
        const replaceButton = (id, callback) => { const old = document.getElementById(id), next = old.cloneNode(true); old.replaceWith(next); next.onclick = callback; };
        replaceButton('checkoutButton', window.openPayment);
        window.completeSale = () => {
            if (busy || !cart.length) return;
            busy = true;
            const complete = document.getElementById('completePayment'); complete.disabled = true;
            try {
                if (posSettings.confirmSale && !confirm('Complete this sale?')) return;
                if (!requestId) requestId = crypto.randomUUID();
                const sale = FEU.request('checkout', {...payload(), requestId, paymentMethod,
                    cash: Number(document.getElementById('cashReceived').value), referenceNumber: document.getElementById('gcashReference').value.trim(), customerId: getSelectedCustomerId()});
                lastSale = sale;
                FEU.refresh();
                cart = []; select.value = ''; host.querySelectorAll('input').forEach(input => input.checked = false);
                loadProducts(); currentProducts = [...canteenProducts]; displayProducts(currentProducts); displayCart(); closePayment(); showReceipt(sale);
                const details = document.createElement('p');
                details.textContent = `${sale.discountName || 'No discount'} · Eligible ${money(sale.eligibleAmount)} · VAT removed ${money(sale.vatAdjustment)}`;
                document.getElementById('receiptContent').append(details);
                requestId = '';
            } catch (error) { alert(error.message); }
            finally { busy = false; complete.disabled = false; }
        };
        replaceButton('completePayment', window.completeSale);
        replaceButton('printReceipt', () => { if (lastSale) printHTML('Receipt', receipt(lastSale), true); });
        updateTotals();
    }
    document.addEventListener('DOMContentLoaded', () => {
        const banner = document.createElement('div'); banner.className = 'feu-mode';
        banner.textContent = FEU.secure ? 'Connected to secure POS server' : 'Offline browser storage · Shared accounts and secure recovery require the local backend';
        (document.querySelector('footer') || document.body).append(banner);
        if (FEU.secure && FEU.user) {
            const security = document.createElement('button'); security.type = 'button'; security.textContent = 'Account security';
            security.onclick = () => {
                const dialog = document.createElement('dialog'); dialog.className = 'feu-dialog';
                const close = document.createElement('button'); close.textContent = 'Close'; close.onclick = () => { dialog.close(); dialog.remove(); };
                dialog.append(close, FEUSecurityForm()); document.body.append(dialog); dialog.showModal();
            };
            document.querySelector('.topbar-right')?.append(security);
            document.querySelectorAll('[id^="refresh"]').forEach(button => button.addEventListener('click', () => FEU.refresh(), {capture: true}));
        }
        const page = location.pathname.split('/').pop();
        if (page === 'customer-display.html' && FEU.secure) {
            const channel = new BroadcastChannel('feu-customer-display');
            channel.onmessage = event => {
                const items = Array.isArray(event.data) ? event.data : Array.isArray(event.data?.items) ? event.data.items : [];
                document.getElementById('items').innerHTML = items.length ? items.map(i => `<div class="item"><strong>${esc(i.name)}</strong><span>× ${Number(i.quantity)}</span><span>${money(i.subtotal)}</span></div>`).join('') : '<p class="empty">Your order will appear here.</p>';
                document.getElementById('total').textContent = event.data?.total === null ? 'Awaiting checkout verification' : money(event.data?.total ?? items.reduce((n, i) => n + Number(i.subtotal || 0), 0));
            };
            channel.postMessage({request: true});
        }
        if (page === 'reports.html') setupReports();
        if (page === 'sales.html') salesEnhancements();
        if (page === 'pos.html') securePOS();
        if (page === 'settings.html' && FEU.secure) secureSettings();
        if (page !== 'pos.html') autoPagination();
    });

    function secureSettings() {
        ['clearSales', 'clearCustomers', 'resetProducts', 'resetAll', 'importButton'].forEach(id => {
            const button = document.getElementById(id);
            if (button) { button.disabled = true; button.title = 'Use the validated server migration workflow; bulk deletion is disabled.'; }
        });
        const section = document.createElement('section'); section.className = 'settings-card';
        section.innerHTML = '<h3>Restaurant tax configuration</h3><p>Confirm VAT registration, qualifying restaurant products and current statutory discount rules with your accountant before enabling Senior Citizen or PWD discounts. Use separate transactions for eligible personal consumption. Select the more favorable applicable offer; discounts cannot be combined.</p><label><input type="checkbox" id="taxInclusive"> Prices include VAT</label><label><input type="checkbox" id="statutoryReviewed"> Owner has reviewed restaurant eligibility and tax treatment</label><button type="button">Save tax configuration</button><p role="status"></p><h3>Import existing browser data</h3><p>Export a backup from the existing offline installation first. Import is allowed only into an empty server catalog and sales ledger. Existing browser data is retained; accounts must be enrolled separately.</p><input type="file" accept="application/json" id="serverMigration"><button type="button" id="migrateBackup">Validate and import backup</button>';
        document.querySelector('.settings-page').append(section);
        const settings = read('Settings');
        section.querySelector('#taxInclusive').checked = !!settings.taxInclusive;
        section.querySelector('#statutoryReviewed').checked = !!settings.statutoryReviewed;
        section.querySelector('button').onclick = () => {
            try {
                const next = {...read('Settings'), taxInclusive: section.querySelector('#taxInclusive').checked, statutoryReviewed: section.querySelector('#statutoryReviewed').checked};
                POSStore.setItem('feuCanteenSettings', JSON.stringify(next)); section.querySelector('[role=status]').textContent = 'Tax configuration saved.';
            } catch (error) { section.querySelector('[role=status]').textContent = error.message; }
        };
        section.querySelector('#migrateBackup').onclick = async () => {
            try {
                const file = section.querySelector('#serverMigration').files[0];
                if (!file) throw new Error('Select an exported POS backup.');
                const data = JSON.parse(await file.text());
                const result = FEU.request('import', {backup: data}); FEU.refresh();
                section.querySelector('[role=status]').textContent = `Imported ${result.products} products and ${result.sales} sales. Browser data was retained.`;
            } catch (error) { section.querySelector('[role=status]').textContent = error.message; }
        };
        // Existing settings serializer predates these fields. Preserve them.
        const originalSet = POSStore.setItem.bind(POSStore);
        POSStore.setItem = (key, value) => {
            if (key === 'feuCanteenSettings') {
                const previous = read('Settings');
                value = JSON.stringify({...previous, ...JSON.parse(value)});
            }
            return originalSet(key, value);
        };
    }
})();
