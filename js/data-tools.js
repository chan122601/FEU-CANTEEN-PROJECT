(function (root) {
    'use strict';
    const dateKey = value => {
        const date = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        return new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit'}).format(date);
    };
    const shift = (key, days) => new Date(Date.parse(key + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
    function range(preset, start = '', end = '', now = new Date()) {
        const today = dateKey(now), month = today.slice(0, 7) + '-01';
        if (preset === 'today') return [today, today];
        if (preset === 'yesterday') return [shift(today, -1), shift(today, -1)];
        if (preset === 'last7') return [shift(today, -6), today];
        if (preset === 'thisWeek') {
            const day = new Date(today + 'T00:00:00Z').getUTCDay();
            return [shift(today, -((day + 6) % 7)), today];
        }
        if (preset === 'thisMonth') return [month, today];
        if (preset === 'lastMonth') return [shift(month, -1).slice(0, 7) + '-01', shift(month, -1)];
        if (preset === 'custom') {
            if (!start || !end || start > end) throw new Error('Choose a valid start and end date.');
            return [start, end];
        }
        return ['', ''];
    }
    function saleDate(sale) {
        if (sale.timestamp) return dateKey(sale.timestamp);
        const parts = String(sale.date || '').split('/');
        return parts.length === 3 ? `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}` : String(sale.date || '').slice(0, 10);
    }
    const within = (date, bounds) => (!bounds[0] || date >= bounds[0]) && (!bounds[1] || date <= bounds[1]);
    function page(records, number = 1, size = 25) {
        size = [10, 25, 50, 100].includes(Number(size)) ? Number(size) : 25;
        const pages = Math.max(1, Math.ceil(records.length / size));
        number = Math.max(1, Math.min(Number(number) || 1, pages));
        const offset = (number - 1) * size;
        return {records: records.slice(offset, offset + size), number, size, pages, count: records.length,
            start: records.length ? offset + 1 : 0, end: Math.min(offset + size, records.length)};
    }
    root.FEUData = {dateKey, range, saleDate, within, page};
    if (typeof module !== 'undefined') module.exports = root.FEUData;
})(typeof window === 'undefined' ? globalThis : window);
