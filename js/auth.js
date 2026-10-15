(function () {
    'use strict';
    const field = (label, name, type = 'text', extra = '') => `<label class="feu-field">${label}<input name="${name}" type="${type}" ${extra} required></label>`;
    const pinField = () => field('Six-digit recovery PIN', 'pin', 'password', 'inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" autocomplete="off"');
    function bind(form, action, success) {
        form.addEventListener('submit', event => {
            event.preventDefault();
            const values = Object.fromEntries(new FormData(form));
            const output = form.querySelector('[role=status]');
            try {
                if (values.confirm !== undefined && values.confirm !== values.password) throw new Error('Passwords do not match.');
                FEU.request(action, values);
                output.textContent = success;
                form.reset();
                if (action === 'login') location.href = '../index.html';
                if (action === 'setup' || action === 'recover') {
                    setTimeout(() => location.reload(), 800);
                }
            } catch (error) { output.textContent = error.message; }
        });
    }
    function securityForm() {
        const form = document.createElement('form');
        form.className = 'feu-form';
        form.innerHTML = '<h3>Account security</h3><p>Verify your current password to set or change your recovery PIN. Changing your password signs out all sessions.</p>' +
            field('Current password', 'currentPassword', 'password', 'autocomplete="current-password"') +
            pinField() + field('New password (optional)', 'password', 'password', 'minlength="10" maxlength="128" autocomplete="new-password"') +
            field('Confirm new password', 'confirm', 'password', 'autocomplete="new-password"') +
            '<button class="primary-button">Save security settings</button><p role="status" aria-live="polite"></p>';
        form.elements.password.required = false;
        form.elements.confirm.required = false;
        form.addEventListener('submit', event => {
            event.preventDefault();
            const values = Object.fromEntries(new FormData(form));
            try {
                if (values.password !== values.confirm) throw new Error('Passwords do not match.');
                FEU.request('security', values);
                if (values.password) location.href = location.pathname.includes('/pages/') ? 'login.html' : 'pages/login.html';
                else { form.reset(); form.querySelector('[role=status]').textContent = 'Recovery PIN updated.'; }
            } catch (error) { form.querySelector('[role=status]').textContent = error.message; }
        });
        return form;
    }
    window.FEUSecurityForm = securityForm;
    document.addEventListener('DOMContentLoaded', () => {
        if (location.pathname.endsWith('login.html')) {
            const form = document.getElementById('loginForm');
            const recovery = document.createElement('details');
            recovery.className = 'feu-recovery';
            recovery.innerHTML = '<summary>Forgot password?</summary>';
            form.after(recovery);
            if (!FEU.secure) {
                recovery.append(Object.assign(document.createElement('p'), {textContent: 'Secure recovery requires the POS backend. Contact the owner if you cannot sign in to this offline installation.'}));
                return;
            }
            if (FEU.unavailable) return;
            if (FEU.user) { location.href = '../index.html'; return; }
            const setup = FEU.status.needsSetup;
            document.querySelector('.login-heading h2').textContent = setup ? 'Set up your canteen account' : 'Welcome back';
            document.querySelector('.login-heading p').textContent = setup ? 'Use the setup token from your server operator.' : 'Sign in to your secure POS server.';
            form.className = 'feu-form';
            form.innerHTML = (setup ? field('Server setup token', 'setupToken', 'password', 'autocomplete="off"') + field('Your name', 'name') : '') +
                field('Username', 'username', 'text', 'autocomplete="username"') +
                field('Password', 'password', 'password', 'autocomplete="current-password" minlength="10" maxlength="128"') +
                (setup ? field('Confirm password', 'confirm', 'password') + pinField() : '') +
                `<button class="login-button">${setup ? 'Create owner account' : 'Sign in'}</button><p role="status" aria-live="polite"></p>`;
            bind(form, setup ? 'setup' : 'login', setup ? 'Account created. Returning to sign in…' : 'Signed in.');
            const reset = document.createElement('form');
            reset.className = 'feu-form';
            reset.innerHTML = '<p>Enter your username and recovery PIN to choose a new password.</p>' + field('Username', 'username', 'text', 'autocomplete="username"') + pinField() +
                field('New password', 'password', 'password', 'minlength="10" maxlength="128" autocomplete="new-password"') +
                field('Confirm new password', 'confirm', 'password', 'autocomplete="new-password"') +
                '<button class="primary-button">Reset password</button><p role="status" aria-live="polite"></p><p>Forgotten your PIN? Contact the owner for identity verification and operator-approved recovery.</p>';
            recovery.append(reset);
            bind(reset, 'recover', 'Password reset. Returning to sign in…');
        }
        if (!FEU.secure || !FEU.user) return;
        if (location.pathname.endsWith('account.html')) {
            const host = document.querySelector('.account-page');
            if (!host) return;
            host.replaceChildren();
            host.innerHTML = '<div class="account-heading"><div><span class="eyebrow">FEU CANTEEN</span><h2>Accounts</h2><p>Manage staff access and your account security.</p></div></div>';
            const security = document.createElement('section');
            security.className = 'account-card';
            security.append(securityForm());
            host.append(security);
            const panel = document.createElement('section');
            panel.className = 'account-card';
            panel.innerHTML = '<h3>Staff accounts</h3><div id="secureAccounts"></div><details><summary>Add staff account</summary><form class="feu-form">' +
                field('Name', 'name') + field('Username', 'username') + field('Initial password', 'password', 'password', 'minlength="10" maxlength="128"') + pinField() +
                '<button class="primary-button">Create staff account</button><p role="status" aria-live="polite"></p></form></details>';
            host.append(panel);
            const render = () => {
                const users = FEU.request('users').users;
                const tableHost = panel.querySelector('#secureAccounts');
                tableHost.replaceChildren();
                const table = document.createElement('table');
                table.innerHTML = '<thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead><tbody></tbody>';
                users.forEach(user => {
                    const row = table.tBodies[0].insertRow();
                    [user.name, user.username, user.role, user.status].forEach(value => row.insertCell().textContent = value);
                    const cell = row.insertCell();
                    if (user.role === 'Staff') {
                        const button = document.createElement('button');
                        button.textContent = user.status === 'active' ? 'Disable' : 'Enable';
                        button.onclick = () => {
                            try { FEU.request('users', {id: user.id, name: user.name, status: user.status === 'active' ? 'inactive' : 'active'}); render(); }
                            catch (error) { alert(error.message); }
                        };
                        const edit = document.createElement('button');
                        edit.textContent = 'Edit name';
                        edit.onclick = () => {
                            const name = prompt('Staff display name', user.name);
                            if (!name?.trim()) return;
                            try { FEU.request('users', {id: user.id, name: name.trim(), status: user.status}); render(); }
                            catch (error) { alert(error.message); }
                        };
                        cell.append(edit, button);
                    }
                });
                tableHost.append(table);
            };
            panel.querySelector('form').onsubmit = event => {
                event.preventDefault();
                const form = event.currentTarget;
                try { FEU.request('users', Object.fromEntries(new FormData(form))); form.reset(); render(); form.querySelector('[role=status]').textContent = 'Staff account created.'; }
                catch (error) { form.querySelector('[role=status]').textContent = error.message; }
            };
            render();
        }
    });
})();
