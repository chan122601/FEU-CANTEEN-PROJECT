"""Isolated HTTP integration tests: no production database or browser storage."""
import concurrent.futures
import http.cookiejar
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.request
import urllib.error

spec = importlib.util.spec_from_file_location('feu_server', Path(__file__).parents[1] / 'server' / 'server.py')
api = importlib.util.module_from_spec(spec)
spec.loader.exec_module(api)


class Client:
    def __init__(self, origin):
        self.origin = origin
        self.csrf = ''
        self.cookies = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookies))

    def call(self, path, body=None, method=None, origin=None):
        request = urllib.request.Request(self.origin + '/api/' + path,
                                         data=json.dumps(body).encode() if body is not None else None,
                                         method=method or ('POST' if body is not None else 'GET'),
                                         headers={'Content-Type': 'application/json', 'Origin': origin or self.origin,
                                                  'X-CSRF-Token': self.csrf})
        try:
            response = self.opener.open(request)
        except urllib.error.HTTPError as error:
            response = error
        payload = json.load(response)
        if payload.get('csrf'):
            self.csrf = payload['csrf']
        return response.status, payload


class Integration(unittest.TestCase):
    def setUp(self):
        scratch = Path(__file__).parents[1] / 'test-results'
        scratch.mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=scratch)
        api.DB = str(Path(self.temp.name) / 'test.sqlite3')
        os.environ['FEU_SETUP_TOKEN'] = 'isolated-test-setup-token'
        self.server = api.make_server(port=0)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.origin = f'http://127.0.0.1:{self.server.server_port}'
        self.owner = Client(self.origin)
        self.assertEqual(200, self.owner.call('setup', {'username': 'owner', 'password': 'OwnerPassword!1',
            'pin': '123456', 'setupToken': os.environ['FEU_SETUP_TOKEN']})[0])
        self.assertEqual(200, self.owner.call('login', {'username': 'owner', 'password': 'OwnerPassword!1'})[0])

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()

    def save(self, suffix, value, client=None):
        client = client or self.owner
        snapshot = client.call('snapshot')[1]
        key = 'feuCanteen' + suffix
        return client.call('resource', {'key': key, 'value': value, 'revision': snapshot['resources'][key]['revision']}, 'PUT')

    def catalog(self, stock=100):
        self.assertEqual(200, self.save('Inventory', [dict(id=1, name='Rice Meal', category='Meals', price=112, stock=stock),
                                                     dict(id=2, name='Nonqualifying item', category='Other', price=50, stock=stock)])[0])

    def discount(self, **changes):
        data = dict(name='Meal Promotion', type='Promotional', mode='percentage', value=10,
                    products=['1'], categories=[], start='', end='', active=True, restricted=False)
        data.update(changes)
        status, result = self.owner.call('discounts', data)
        self.assertEqual(200, status, result)
        return result

    def cart(self, **changes):
        data = dict(items=[dict(id=1, quantity=1)], paymentMethod='Cash', cash=200,
                    requestId='isolated-request-123456')
        data.update(changes)
        return data

    def test_setup_login_hashing_and_csrf(self):
        self.assertFalse(self.owner.call('status')[1]['needsSetup'])
        self.assertEqual(409, self.owner.call('setup', dict(username='again'))[0])
        with api.connect() as db:
            row = db.execute('SELECT * FROM users').fetchone()
            self.assertTrue(row['pin'].startswith('pbkdf2_sha256$'))
            self.assertNotIn('123456', row['pin'])
            self.assertTrue(row['password'].startswith('pbkdf2_sha256$'))
        guest = Client(self.origin)
        self.assertEqual(401, guest.call('snapshot')[0])
        self.assertEqual(401, guest.call('login', dict(username='owner', password='wrong'))[0])
        old = self.owner.csrf
        self.owner.csrf = 'forged'
        self.assertEqual(403, self.owner.call('resource', {'key': 'feuCanteenInventory', 'value': [], 'revision': 0}, 'PUT')[0])
        self.owner.csrf = old
        self.assertEqual(403, self.owner.call('security', {'currentPassword': 'OwnerPassword!1', 'pin': '654321'}, origin='https://evil.invalid')[0])
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(self.origin + '/server/data/pos.sqlite3')
        self.assertEqual(404, ctx.exception.code)

    def test_pin_change_recovery_generic_errors_and_session_invalidation(self):
        self.assertEqual(403, self.owner.call('security', {'currentPassword': 'wrong', 'pin': '654321'})[0])
        self.assertEqual(400, self.owner.call('security', {'currentPassword': 'OwnerPassword!1', 'pin': '12345'})[0])
        self.assertEqual(200, self.owner.call('security', {'currentPassword': 'OwnerPassword!1', 'pin': '654321'})[0])
        guest = Client(self.origin)
        failure = guest.call('recover', dict(username='owner', pin='000000', password='NewPassword!1'))
        unknown = guest.call('recover', dict(username='unknown', pin='000000', password='NewPassword!1'))
        self.assertEqual(failure, unknown)
        self.assertEqual(200, guest.call('recover', dict(username='owner', pin='654321', password='NewPassword!1'))[0])
        self.assertEqual(401, self.owner.call('snapshot')[0])
        self.assertEqual(401, guest.call('login', dict(username='owner', password='OwnerPassword!1'))[0])
        self.assertEqual(200, guest.call('login', dict(username='owner', password='NewPassword!1'))[0])

    def test_recovery_lockout_survives_connection_and_migration(self):
        guest = Client(self.origin)
        for _ in range(5):
            self.assertEqual(400, guest.call('recover', dict(username='owner', pin='999999', password='PasswordNew!'))[0])
        api.migrate()
        self.assertEqual(429, Client(self.origin).call('recover', dict(username='owner', pin='123456', password='PasswordNew!'))[0])
        with api.connect() as db:
            db.execute('UPDATE attempts SET until=0')
        self.assertEqual(200, guest.call('recover', dict(username='owner', pin='123456', password='PasswordNew!'))[0])

    def test_staff_permissions_and_disablement(self):
        self.catalog()
        self.assertEqual(200, self.owner.call('users', dict(username='cashier', name='Cashier', password='StaffPassword!1', pin='234567'))[0])
        staff = Client(self.origin)
        self.assertEqual(200, staff.call('login', dict(username='cashier', password='StaffPassword!1'))[0])
        self.assertEqual(403, self.save('Inventory', [], staff)[0])
        self.assertEqual(403, staff.call('discounts', {'name': 'Unauthorized'})[0])
        self.assertEqual(403, staff.call('users')[0])
        snapshot = staff.call('snapshot')[1]
        self.assertNotIn('feuCanteenExpenses', snapshot['resources'])
        self.assertNotIn('password', json.dumps(snapshot))
        discount = self.discount(restricted=True)
        self.assertEqual(403, staff.call('quote', self.cart(discountId=discount['id']))[0])
        self.assertEqual(200, staff.call('checkout', self.cart())[0])
        uid = next(u['id'] for u in self.owner.call('users')[1]['users'] if u['username'] == 'cashier')
        self.assertEqual(200, self.owner.call('users', dict(id=uid, status='inactive'))[0])
        self.assertEqual(401, staff.call('snapshot')[0])

    def test_discount_scope_rounding_dates_edit_and_duplicates(self):
        self.catalog()
        d = self.discount()
        data = self.cart(discountId=d['id'], items=[dict(id=1, quantity=1), dict(id=2, quantity=1)])
        q = self.owner.call('quote', data)[1]
        self.assertEqual(112, q['eligibleAmount'])
        self.assertEqual(11.2, q['discount'])
        self.assertEqual(150.8, q['total'])
        self.assertEqual(409, self.owner.call('discounts', d | {'id': None})[0])
        self.assertEqual(400, self.owner.call('discounts', d | {'value': 101})[0])
        self.assertEqual(400, self.owner.call('discounts', d | {'start': '2026-12-01', 'end': '2026-01-01'})[0])
        self.assertEqual(200, self.owner.call('discounts', d | {'mode': 'fixed', 'value': 999})[0])
        self.assertEqual(50, self.owner.call('quote', data)[1]['total'])
        self.assertEqual(200, self.owner.call('discounts', d | {'active': False})[0])
        self.assertEqual(400, self.owner.call('quote', data)[0])

    def test_statutory_vat_and_nonvat_do_not_stack_or_include_other_items(self):
        self.catalog()
        d = self.discount(name='Senior Restaurant', type='Senior Citizen', value=20)
        data = self.cart(discountId=d['id'], eligibilityConfirmed=True, exclusiveConsumption=True)
        self.assertEqual(400, self.owner.call('quote', data)[0])
        self.save('Settings', dict(taxEnabled=True, taxRate=12, taxInclusive=True, statutoryReviewed=True))
        self.assertEqual(400, self.owner.call('quote', data | {'eligibilityConfirmed': False})[0])
        q = self.owner.call('quote', data)[1]
        self.assertEqual((100, 20, 12, 0, 80), tuple(q[k] for k in ['eligibleAmount', 'discount', 'vatAdjustment', 'tax', 'total']))
        self.assertEqual(400, self.owner.call('quote', data | {'items': [dict(id=1, quantity=1), dict(id=2, quantity=1)]})[0])
        self.save('Settings', dict(taxEnabled=False, statutoryReviewed=True))
        self.assertEqual(89.6, self.owner.call('quote', data)[1]['total'])
        pwd = self.discount(name='PWD Restaurant', type='PWD', value=20)
        self.assertEqual(89.6, self.owner.call('quote', data | {'discountId': pwd['id']})[1]['total'])

    def test_checkout_atomic_idempotent_and_persistent(self):
        self.catalog(stock=2)
        data = self.cart()
        status, sale = self.owner.call('checkout', data)
        self.assertEqual(200, status, sale)
        self.assertEqual(88, sale['change'])
        self.assertEqual(sale, self.owner.call('checkout', data)[1])
        before = self.owner.call('snapshot')[1]
        self.assertEqual(1, before['resources']['feuCanteenInventory']['value'][0]['stock'])
        self.assertEqual(1, len(before['resources']['feuCanteenSales']['value']))
        self.assertEqual(409, self.owner.call('checkout', self.cart(items=[dict(id=1, quantity=2)], requestId='another-request-123456'))[0])
        self.assertEqual(before['resources'], self.owner.call('snapshot')[1]['resources'])
        # Reopen schema and fresh connections: records survive restart without seeding.
        api.migrate()
        self.assertEqual(sale['transaction'], self.owner.call('sales')[1]['records'][0]['transaction'])
        self.assertEqual(400, self.owner.call('checkout', self.cart(paymentMethod='GCash', referenceNumber='', requestId='gcash-request-123456'))[0])
        self.assertEqual(200, self.owner.call('checkout', self.cart(paymentMethod='GCash', referenceNumber='TEST-REF', requestId='gcash-request-123456'))[0])

    def test_concurrent_last_item_and_stale_writes(self):
        self.catalog(stock=1)
        snapshot = self.owner.call('snapshot')[1]
        data = snapshot['resources']['feuCanteenInventory']
        def checkout(index):
            client = Client(self.origin)
            client.cookies = self.owner.cookies
            client.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(client.cookies))
            client.csrf = self.owner.csrf
            return client.call('checkout', self.cart(requestId='parallel-request-' + str(index)))[0]
        with concurrent.futures.ThreadPoolExecutor(2) as pool:
            self.assertEqual([200, 409], sorted(pool.map(checkout, [1, 2])))
        self.assertEqual(409, self.owner.call('resource', dict(key='feuCanteenInventory', value=data['value'], revision=data['revision']), 'PUT')[0])

    def test_sales_pagination_search_filters_and_print_read_only(self):
        self.catalog(stock=150)
        # Seed isolated ledger directly, avoiding 105 HTTP transactions.
        with api.connect() as db:
            for i in range(105):
                sale = dict(transaction=f'TEST-{i:04}', date='10/15/2026', total=i, discount=1, items=[], paymentMethod='Cash' if i % 2 else 'GCash')
                db.execute('INSERT INTO sales VALUES (?,?,?,?,?,?,?,?,?)', (sale['transaction'], '2026-10-15' if i < 50 else '2026-10-14', sale['paymentMethod'], 'Custom', 'test', i, 1, api.encode(sale), f'test-{i}'))
        for size in [10, 25, 50, 100]:
            result = self.owner.call(f'sales?size={size}')[1]
            self.assertEqual(105, result['count'])
            self.assertEqual(size, len(result['records']))
            self.assertEqual((105 + size - 1) // size, result['pages'])
        self.assertEqual(5, len(self.owner.call('sales?size=100&page=2')[1]['records']))
        result = self.owner.call('sales?size=10&page=2&payment=Cash&discount=Custom&start=2026-10-15&end=2026-10-15&q=TEST')[1]
        self.assertEqual(25, result['count'])
        self.assertEqual(10, len(result['records']))
        self.assertEqual(0, self.owner.call('sales?q=missing')[1]['count'])
        self.assertEqual(400, self.owner.call('sales?size=30')[0])
        before = self.owner.call('snapshot')[1]['resources']
        self.owner.call('sales?size=25')
        self.assertEqual(before, self.owner.call('snapshot')[1]['resources'])

    def test_import_preserves_records_and_rejects_overwrite(self):
        backup = {'data': {'feuCanteenInventory': [dict(id=9, name='Existing rice', category='Meals', price=30, stock=4)],
                           'feuCanteenSales': [dict(transaction='OLD-001', timestamp='2026-10-01T09:00:00+08:00', date='10/1/2026', total=30, items=[])],
                           'feuCanteenCustomers': [dict(id='old-customer', name='Existing Customer')]}}
        self.assertEqual(200, self.owner.call('import', {'backup': backup})[0])
        self.assertEqual(409, self.owner.call('import', {'backup': backup})[0])
        result = self.owner.call('snapshot')[1]['resources']
        self.assertEqual(4, result['feuCanteenInventory']['value'][0]['stock'])
        self.assertEqual('OLD-001', result['feuCanteenSales']['value'][0]['transaction'])

    def test_server_restart_retains_accounts_sales_and_stock(self):
        self.catalog(stock=2)
        sale = self.owner.call('checkout', self.cart())[1]
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.server = api.make_server(port=0)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        client = Client(f'http://127.0.0.1:{self.server.server_port}')
        self.assertEqual(200, client.call('login', {'username': 'owner', 'password': 'OwnerPassword!1'})[0])
        resources = client.call('snapshot')[1]['resources']
        self.assertEqual(1, resources['feuCanteenInventory']['value'][0]['stock'])
        self.assertEqual(sale['transaction'], resources['feuCanteenSales']['value'][0]['transaction'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
