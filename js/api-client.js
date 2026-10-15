/* Compatibility boundary for the existing screens. Server mode keeps business
 * records in memory and persists through the authenticated API, never localStorage.
 * Synchronous writes preserve existing handlers' save-before-render ordering.
 */
(function () {
    'use strict';
    const base = window.FEU_API_BASE || '';
    const state = {secure: false, user: null, csrf: '', resources: {}, status: null};
    function request(path, body, method) {
        const xhr = new XMLHttpRequest();
        xhr.open(method || (body ? 'POST' : 'GET'), base + '/api/' + path, false);
        xhr.withCredentials = true;
        if (body) xhr.setRequestHeader('Content-Type', 'application/json');
        if (state.csrf) xhr.setRequestHeader('X-CSRF-Token', state.csrf);
        xhr.send(body ? JSON.stringify(body) : null);
        let data;
        try { data = JSON.parse(xhr.responseText); } catch { throw new Error('The POS server is unavailable.'); }
        if (xhr.status < 200 || xhr.status >= 300) throw new Error(data.error || 'Request failed.');
        return data;
    }
    function refresh() {
        const snapshot = request('snapshot' + (location.pathname.endsWith('sales.html') ? '?ledger=0' : ''));
        state.resources = snapshot.resources;
        state.user = snapshot.user;
        state.csrf = snapshot.csrf;
    }
    try {
        state.status = request('status');
        state.secure = state.status.backend === true;
        state.user = state.status.user;
        state.csrf = state.status.csrf;
        if (state.user) refresh();
    } catch (error) {
        if (typeof window.FEU_API_BASE === 'string') {
            document.addEventListener('DOMContentLoaded', () => {
                document.body.replaceChildren();
                const message = document.createElement('p');
                message.className = 'service-message';
                message.textContent = 'The configured POS server is unavailable. Reconnect and reload to continue.';
                document.body.append(message);
            });
            state.secure = true; // Fail closed; never silently switch to offline accounts.
            state.unavailable = true;
        }
    }
    window.FEU = Object.assign(state, {request, refresh, base});
    const transient = new Map();
    window.POSStore = state.secure ? {
        getItem(key) {
            if (key === 'feuCanteenSession') return state.user ? JSON.stringify(state.user) : null;
            if (key === 'feuCanteenUsers') return '[]';
            if (state.resources[key]) return JSON.stringify(state.resources[key].value);
            return transient.get(key) || null;
        },
        setItem(key, value) {
            if (key === 'feuCanteenSession' || key === 'feuCanteenUsers' || key === 'feuCanteenSales')
                throw new Error('This record can only be changed through its secure workflow.');
            if (state.resources[key]) {
                const data = JSON.parse(value);
                const saved = request('resource', {key, value: data, revision: state.resources[key].revision}, 'PUT');
                state.resources[key] = {value: data, revision: saved.revision};
            } else {
                transient.set(key, value);
                if (key === 'feuCanteenCurrentOrder') {
                    const channel = new BroadcastChannel('feu-customer-display');
                    channel.postMessage(JSON.parse(value));
                    channel.close();
                }
            }
        },
        removeItem(key) {
            if (key === 'feuCanteenSession') {
                request('logout', {});
                state.user = null;
                state.csrf = '';
            } else if (state.resources[key]) {
                throw new Error('Bulk deletion is disabled in server mode.');
            } else transient.delete(key);
        }
    } : window.localStorage;
    window.addEventListener('error', event => {
        if (state.secure && /permission|changed on another|secure workflow|Bulk deletion/.test(event.message)) {
            alert(event.message + ' Reload before continuing.');
        }
    });
})();
