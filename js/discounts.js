document.addEventListener('DOMContentLoaded', () => {
    'use strict';
    const host = document.querySelector('.discounts-page');
    if (!host) return;
    if (!FEU.secure) {
        host.innerHTML = '<h2>Discount Management</h2><p>Connect the POS backend to manage discounts with server-enforced permissions and transaction records.</p>';
        return;
    }
    const {esc, money} = FEUPrint;
    let discounts = [], editing = '';
    host.innerHTML = '<div class="account-heading"><div><span class="eyebrow">FEU CANTEEN</span><h2>Discount Management</h2><p>Configure offers and qualifying restaurant purchases.</p></div></div><section class="report-panel"><label class="feu-field">Search discounts<input id="discountSearch" type="search" placeholder="Name or type"></label><div id="discountTable"></div></section><section class="report-panel"><h3 id="discountFormTitle">Create discount</h3><form class="feu-form" id="discountForm"><label class="feu-field">Discount name<input name="name" maxlength="80" required></label><label class="feu-field">Type<select name="type"><option>Promotional</option><option>Custom</option><option>Senior Citizen</option><option>PWD</option></select></label><label class="feu-field">Calculation<select name="mode"><option value="percentage">Percentage</option><option value="fixed">Fixed amount (PHP)</option></select></label><label class="feu-field">Value<input name="value" type="number" min="0.01" step="0.01" required></label><label class="feu-field">Applicable products (optional for promotions)<select name="products" multiple size="5"></select></label><label class="feu-field">Applicable categories<select name="categories" multiple size="5"></select></label><p>Selected products OR categories qualify. With neither selected, promotions apply to all items. Statutory discounts require an explicit scope. Hold Ctrl to select several options.</p><label class="feu-field">Effective date<input name="start" type="date"></label><label class="feu-field">Expiration date<input name="end" type="date"></label><label><input name="active" type="checkbox" checked> Active</label><label><input name="restricted" type="checkbox"> Restricted to owner checkout</label><div><button class="primary-button">Save discount</button><button type="button" id="cancelDiscount">Cancel editing</button></div><p role="status" aria-live="polite"></p></form></section><section class="report-panel"><h3>Recent audit records</h3><div id="discountAudit"></div></section>';
    const form = document.getElementById('discountForm');
    const inventory = JSON.parse(POSStore.getItem('feuCanteenInventory') || '[]');
    inventory.forEach(p => form.elements.products.add(new Option(p.name, p.id)));
    [...new Set(inventory.map(p => p.category))].sort().forEach(c => form.elements.categories.add(new Option(c, c)));
    function render() {
        discounts = FEU.request('discounts').discounts;
        const search = document.getElementById('discountSearch').value.toLowerCase();
        const records = discounts.filter(d => (d.name + ' ' + d.type).toLowerCase().includes(search));
        document.getElementById('discountTable').innerHTML = records.length ? '<table><thead><tr><th>Name / type</th><th>Value</th><th>Scope</th><th>Dates</th><th>Status</th><th>Updated</th><th>Actions</th></tr></thead><tbody>' + records.map(d => `<tr><td>${esc(d.name)}<br>${esc(d.type)}</td><td>${d.mode === 'fixed' ? money(d.value) : Number(d.value) + '%'}</td><td>${d.products.length} products / ${d.categories.map(esc).join(', ') || 'no categories'}</td><td>${esc(d.start || 'Any')} – ${esc(d.end || 'Any')}</td><td>${d.active ? 'Active' : 'Inactive'}${d.restricted ? ' · Owner only' : ''}</td><td>${esc(d.updatedBy)}<br>${esc(d.updatedAt)}<br>Created: ${esc(d.createdBy)} ${esc(d.createdAt)}</td><td><button type="button" data-edit="${esc(d.id)}">Edit</button></td></tr>`).join('') + '</tbody></table>' : '<p>No discounts found.</p>';
        document.querySelectorAll('[data-edit]').forEach(button => button.onclick = () => {
            const d = discounts.find(d => d.id === button.dataset.edit); editing = d.id;
            ['name', 'type', 'mode', 'value', 'start', 'end'].forEach(k => form.elements[k].value = d[k]);
            ['active', 'restricted'].forEach(k => form.elements[k].checked = d[k]);
            ['products', 'categories'].forEach(k => [...form.elements[k].options].forEach(option => option.selected = d[k].map(String).includes(option.value)));
            document.getElementById('discountFormTitle').textContent = 'Edit discount'; form.scrollIntoView({block: 'start'});
        });
        const audits = FEU.request('audit').records;
        document.getElementById('discountAudit').innerHTML = '<table><thead><tr><th>Time</th><th>Action</th><th>Actor</th><th>Record</th></tr></thead><tbody>' + audits.map(a => `<tr><td>${esc(a.timestamp)}</td><td>${esc(a.action)}</td><td>${esc(a.actor)}</td><td>${esc(a.details)}</td></tr>`).join('') + '</tbody></table>';
    }
    form.elements.type.onchange = () => {
        const statutory = ['Senior Citizen', 'PWD'].includes(form.elements.type.value);
        if (statutory) { form.elements.mode.value = 'percentage'; form.elements.value.value = '20'; }
        form.elements.mode.disabled = statutory; form.elements.value.readOnly = statutory;
    };
    form.onsubmit = event => {
        event.preventDefault();
        const values = Object.fromEntries(new FormData(form));
        values.mode = form.elements.mode.value; values.value = Number(values.value);
        ['products', 'categories'].forEach(k => values[k] = [...form.elements[k].selectedOptions].map(o => o.value));
        ['active', 'restricted'].forEach(k => values[k] = form.elements[k].checked);
        if (editing) values.id = editing;
        try {
            FEU.request('discounts', values); editing = ''; form.reset(); form.elements.type.onchange(); render();
            document.getElementById('discountFormTitle').textContent = 'Create discount'; form.querySelector('[role=status]').textContent = 'Discount saved.';
        } catch (error) { form.querySelector('[role=status]').textContent = error.message; }
    };
    document.getElementById('cancelDiscount').onclick = () => { editing = ''; form.reset(); form.elements.type.onchange(); document.getElementById('discountFormTitle').textContent = 'Create discount'; };
    document.getElementById('discountSearch').oninput = render;
    try { render(); } catch (error) { host.textContent = error.message; }
});
