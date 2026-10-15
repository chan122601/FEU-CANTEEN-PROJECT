const assert = require('node:assert/strict');
const {page, range, within, saleDate} = require('../js/data-tools.js');
for (const count of [0, 10, 25, 30, 50, 105]) {
    for (const size of [10, 25, 50, 100]) {
        const records = Array.from({length: count}, (_, id) => ({id}));
        const first = page(records, 1, size);
        assert.equal(first.pages, Math.max(1, Math.ceil(count / size)));
        assert.equal(first.records.length, Math.min(size, count));
        const last = page(records, 999, size);
        assert.equal(last.end, count);
        assert.equal(last.start, count ? (last.number - 1) * size + 1 : 0);
    }
}
assert.equal(page(Array(50), 1, 10).pages, 5);
assert.equal(page(Array(30), 1, 25).pages, 2);
const now = new Date('2026-10-14T17:00:00Z');
assert.deepEqual(range('today', '', '', now), ['2026-10-15', '2026-10-15']);
assert.deepEqual(range('yesterday', '', '', now), ['2026-10-14', '2026-10-14']);
assert.deepEqual(range('last7', '', '', now), ['2026-10-09', '2026-10-15']);
assert.deepEqual(range('thisMonth', '', '', now), ['2026-10-01', '2026-10-15']);
assert.deepEqual(range('lastMonth', '', '', now), ['2026-09-01', '2026-09-30']);
assert.deepEqual(range('lastMonth', '', '', new Date('2024-03-01')), ['2024-02-01', '2024-02-29']);
assert.throws(() => range('custom', '2026-10-20', '2026-10-01'));
assert.equal(saleDate({timestamp: '2026-10-14T17:00:00Z'}), '2026-10-15');
const records = Array.from({length: 105}, (_, id) => ({id, date: id < 50 ? '2026-10-15' : '2026-10-14', name: id % 2 ? 'Rice' : 'Tea'}));
const filtered = records.filter(r => r.name === 'Rice' && within(r.date, ['2026-10-15', '2026-10-15']));
assert.equal(page(filtered, 2, 10).records.length, 10);
assert.equal(page(filtered, 2, 10).count, 25);
console.log('Date, timezone, combined filtering and pagination tests passed.');
