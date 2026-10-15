"""FEU POS local API. Python 3.11+, standard library only.

Run behind an HTTPS reverse proxy for network use. Data is NEVER served as static files.
"""
import argparse
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import time
from datetime import datetime, timezone, timedelta
from decimal import Decimal, ROUND_HALF_UP
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, parse_qs, unquote

ROOT = Path(__file__).resolve().parents[1]
DB = os.environ.get('FEU_DATABASE', str(ROOT / 'server' / 'data' / 'pos.sqlite3'))
ITERATIONS = 600_000
TZ = timezone(timedelta(hours=8))
KEYS = ['Inventory', 'Categories', 'Settings', 'Customers', 'Expenses',
        'InventoryHistory', 'CashDrawer', 'CashClosings', 'StockDiscrepancies']
PREFIX = 'feuCanteen'
GENERIC_ERROR = 'Unable to verify recovery details. Try again later or contact the owner.'


class Problem(Exception):
    def __init__(self, message, status=400):
        self.message, self.status = message, status


def require(condition, message='Invalid request.', status=400):
    if not condition:
        raise Problem(message, status)


def encode(value):
    return json.dumps(value, ensure_ascii=True, separators=(',', ':'))


class Connection(sqlite3.Connection):
    def __exit__(self, *args):
        try:
            return super().__exit__(*args)
        finally:
            self.close()


def connect():
    db = sqlite3.connect(DB, timeout=15, factory=Connection)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA foreign_keys=ON')
    return db


def migrate():
    Path(DB).parent.mkdir(parents=True, exist_ok=True)
    with connect() as db:
        db.executescript('''
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
          name TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
          password TEXT NOT NULL, pin TEXT, version INTEGER NOT NULL DEFAULT 1);
        CREATE TABLE IF NOT EXISTS sessions (
          token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
          csrf TEXT NOT NULL, expires REAL NOT NULL, version INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS attempts (
          key TEXT PRIMARY KEY, count INTEGER NOT NULL, until REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS resources (
          key TEXT PRIMARY KEY, value TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS sales (
          id TEXT PRIMARY KEY, date TEXT NOT NULL, payment TEXT NOT NULL,
          discount_type TEXT NOT NULL, staff_id TEXT NOT NULL, total REAL NOT NULL,
          discount REAL NOT NULL, payload TEXT NOT NULL, request_id TEXT NOT NULL UNIQUE);
        CREATE INDEX IF NOT EXISTS sales_date ON sales(date DESC, id DESC);
        CREATE INDEX IF NOT EXISTS sales_payment_date ON sales(payment, date DESC, id DESC);
        CREATE TABLE IF NOT EXISTS discounts (
          id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS audit (
          id INTEGER PRIMARY KEY, timestamp TEXT NOT NULL, actor TEXT NOT NULL,
          action TEXT NOT NULL, details TEXT NOT NULL);
        PRAGMA user_version=1;
        ''')
        for suffix in KEYS:
            db.execute('INSERT OR IGNORE INTO resources(key,value) VALUES (?,?)',
                       (PREFIX + suffix, '{}' if suffix == 'Settings' else '[]'))


def hash_secret(value):
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac('sha256', value.encode(), bytes.fromhex(salt), ITERATIONS).hex()
    return f'pbkdf2_sha256${ITERATIONS}${salt}${digest}'


def matches(value, encoded):
    try:
        algorithm, rounds, salt, digest = encoded.split('$')
        if algorithm != 'pbkdf2_sha256':
            return False
        actual = hashlib.pbkdf2_hmac('sha256', value.encode(), bytes.fromhex(salt), int(rounds)).hex()
        return hmac.compare_digest(actual, digest)
    except (ValueError, AttributeError):
        return False


def password(value):
    require(isinstance(value, str) and 10 <= len(value) <= 128,
            'Use a password of 10–128 characters.')
    return value


def pin(value):
    require(isinstance(value, str) and re.fullmatch(r'[0-9]{6}', value),
            'Recovery PIN must contain exactly six digits.')
    return value


def public_user(row):
    return {k: row[k] for k in ('id', 'username', 'name', 'role', 'status')} | {'hasPin': bool(row['pin'])}


def audit(db, actor, action, details=''):
    db.execute('INSERT INTO audit(timestamp,actor,action,details) VALUES (?,?,?,?)',
               (datetime.now(timezone.utc).isoformat(), actor, action, details))


def read(db, suffix):
    return json.loads(db.execute('SELECT value FROM resources WHERE key=?', (PREFIX + suffix,)).fetchone()[0])


def write(db, suffix, value):
    db.execute('UPDATE resources SET value=?,revision=revision+1 WHERE key=?', (encode(value), PREFIX + suffix))


def cents(value):
    try:
        amount = Decimal(str(value))
        require(amount.is_finite() and 0 <= amount <= 100_000_000)
        return int((amount * 100).quantize(Decimal('1'), rounding=ROUND_HALF_UP))
    except (ValueError, ArithmeticError):
        raise Problem('Invalid amount.')


def rounded(value):
    return int(Decimal(value).quantize(Decimal('1'), rounding=ROUND_HALF_UP))


def discount_valid(data):
    name = str(data.get('name', '')).strip()
    kind = data.get('type')
    require(1 <= len(name) <= 80 and kind in ['Senior Citizen', 'PWD', 'Promotional', 'Custom'])
    require(data.get('mode') in ['percentage', 'fixed'])
    value = cents(data.get('value', 0))
    require(value > 0 and (data['mode'] != 'percentage' or value <= 10000))
    for field in ['start', 'end']:
        require(isinstance(data.get(field, ''), str))
        if data.get(field):
            try:
                datetime.strptime(data[field], '%Y-%m-%d')
            except ValueError:
                raise Problem('Invalid effective or expiration date.')
    require(not data.get('start') or not data.get('end') or data['start'] <= data['end'], 'Expiration precedes effective date.')
    require(isinstance(data.get('products', []), list) and isinstance(data.get('categories', []), list))
    if kind in ['Senior Citizen', 'PWD']:
        require(data['mode'] == 'percentage' and value == 2000, 'Statutory restaurant discount must be 20%.')
        require(data.get('products') or data.get('categories'), 'Explicitly select qualifying restaurant products or categories.')
    return {k: data.get(k, default) for k, default in dict(name=name, type=kind, mode='percentage',
            value=0, products=[], categories=[], start='', end='', active=True, restricted=False).items()} | {'name': name}


def quote(db, request, actor):
    products = {str(p['id']): p for p in read(db, 'Inventory')}
    items, seen = [], set()
    require(isinstance(request.get('items'), list) and 0 < len(request['items']) <= 200, 'Cart is empty or too large.')
    for line in request['items']:
        key, quantity = str(line.get('id')), line.get('quantity')
        require(key in products and key not in seen and type(quantity) is int and 1 <= quantity <= 10000,
                'Invalid product or quantity.')
        seen.add(key)
        p = products[key]
        require(int(p['stock']) >= quantity, f"Insufficient stock for {p['name']}.", 409)
        price = cents(p['price'])
        items.append(dict(id=p['id'], name=p['name'], category=p.get('category', ''),
                          price=price / 100, quantity=quantity, subtotal=price * quantity / 100))
    subtotal = sum(cents(i['subtotal']) for i in items)
    settings = read(db, 'Settings')
    rate = Decimal(str(settings.get('taxRate', 0))) if settings.get('taxEnabled') else Decimal(0)
    require(rate.is_finite() and 0 <= rate <= 100)
    discount, eligible, vat_removed, kind, name = 0, 0, 0, '', ''
    selected = request.get('discountId')
    if selected:
        row = db.execute('SELECT payload FROM discounts WHERE id=?', (selected,)).fetchone()
        require(row is not None, 'Discount unavailable.')
        d = json.loads(row[0])
        today = datetime.now(TZ).date().isoformat()
        require(d['active'] is True and (not d['start'] or today >= d['start']) and
                (not d['end'] or today <= d['end']), 'Discount is inactive or outside its effective dates.')
        require(not d['restricted'] or actor['role'] == 'Administrator', 'Owner authorization is required.', 403)
        kind, name = d['type'], d['name']
        qualifying = [i for i in items if (not d['products'] and not d['categories']) or
                      str(i['id']) in [str(x) for x in d['products']] or i['category'] in d['categories']]
        eligible = sum(cents(i['subtotal']) for i in qualifying)
        require(eligible > 0, 'No eligible products in this cart.')
        if kind in ['Senior Citizen', 'PWD']:
            require(settings.get('statutoryReviewed') is True,
                    'Owner must review restaurant eligibility and tax configuration before statutory discounts are enabled.')
            require(request.get('eligibilityConfirmed') is True and request.get('exclusiveConsumption') is True,
                    'Verify entitlement and ring up only the eligible person’s qualifying consumption separately.')
            require(len(qualifying) == len(items), 'Separate non-qualifying purchases into another transaction.')
            require(rate in [0, 12], 'Statutory discounts support non-VAT or 12% VAT-inclusive restaurant prices only.')
            if rate:
                require(settings.get('taxInclusive') is True, 'Configure VAT-inclusive prices for statutory discounts.')
                base = rounded(Decimal(eligible) / Decimal('1.12'))
                vat_removed = eligible - base
                eligible = base
            discount = rounded(Decimal(eligible) * Decimal('.20'))
        else:
            discount = min(eligible, rounded(Decimal(eligible) * Decimal(str(d['value'])) / 100)
                           if d['mode'] == 'percentage' else cents(d['value']))
    taxable = subtotal - vat_removed - discount
    statutory = kind in ['Senior Citizen', 'PWD']
    if statutory:
        tax = 0
    elif settings.get('taxInclusive') and rate:
        tax = taxable - rounded(Decimal(taxable) / (1 + rate / 100))
    else:
        tax = rounded(Decimal(taxable) * rate / 100)
    total = taxable + (0 if settings.get('taxInclusive') or statutory else tax)
    return dict(items=items, subtotal=subtotal / 100, eligibleAmount=eligible / 100,
                discount=discount / 100, discountType=kind, discountName=name, discountId=selected or '',
                vatAdjustment=vat_removed / 100, tax=tax / 100, taxRate=float(rate), total=total / 100)


class Handler(BaseHTTPRequestHandler):
    server_version = 'FEU-POS'

    def log_message(self, fmt, *args):
        # Never log credentials or request bodies.
        pass

    def reply(self, status, value, cookie=None):
        payload = encode(value).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        origin = self.headers.get('Origin')
        if origin and origin in self.server.origins:
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Access-Control-Allow-Credentials', 'true')
            self.send_header('Vary', 'Origin')
        if cookie:
            self.send_header('Set-Cookie', cookie)
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_OPTIONS(self):
        if self.headers.get('Origin') not in self.server.origins:
            return self.reply(403, {'error': 'Origin denied.'})
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', self.headers['Origin'])
        self.send_header('Access-Control-Allow-Credentials', 'true')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS')
        self.end_headers()

    def do_GET(self):
        if not urlsplit(self.path).path.startswith('/api/'):
            return self.static()
        self.dispatch()

    def do_POST(self):
        self.dispatch()

    def do_PUT(self):
        self.dispatch()

    def static(self):
        path = unquote(urlsplit(self.path).path).lstrip('/') or 'index.html'
        target = (ROOT / path).resolve()
        allowed = path == 'index.html' or path.split('/')[0] in ['pages', 'js', 'css', 'assets']
        if not allowed or not target.is_relative_to(ROOT) or not target.is_file() or target.suffix.lower() not in [
                '.html', '.js', '.css', '.png', '.jpg', '.jpeg', '.svg', '.ico', '.webp', '.woff', '.woff2']:
            return self.reply(404, {'error': 'Not found.'})
        import mimetypes
        content = target.read_bytes()
        self.send_response(200)
        self.send_header('Content-Type', mimetypes.guess_type(str(target))[0] or 'application/octet-stream')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'same-origin')
        self.send_header('Content-Length', str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def session(self, db):
        cookies = SimpleCookie()
        try:
            cookies.load(self.headers.get('Cookie', ''))
        except Exception:
            return None
        token = cookies.get('feu_session')
        if not token:
            return None
        digest = hashlib.sha256(token.value.encode()).hexdigest()
        return db.execute('''SELECT u.*,s.csrf FROM sessions s JOIN users u ON u.id=s.user_id
            WHERE s.token=? AND s.expires>? AND s.version=u.version AND u.status='active' ''',
                          (digest, time.time())).fetchone()

    def throttle(self, db, key, limit, window):
        row = db.execute('SELECT count,until FROM attempts WHERE key=?', (key,)).fetchone()
        now = time.time()
        if row and row['until'] > now and row['count'] >= limit:
            raise Problem(GENERIC_ERROR, 429)
        count, until = (row['count'] + 1, row['until']) if row and row['until'] > now else (1, now + window)
        db.execute('INSERT OR REPLACE INTO attempts VALUES (?,?,?)', (key, count, until))
        db.commit()  # Failed attempts must survive request rollback and restart.
        db.execute('BEGIN IMMEDIATE')

    def dispatch(self):
        cookie = None
        try:
            path = urlsplit(self.path).path
            args = parse_qs(urlsplit(self.path).query)
            require(path.startswith('/api/'), 'Not found.', 404)
            body = {}
            if self.command != 'GET':
                require(self.headers.get('Origin') in self.server.origins, 'Origin denied.', 403)
                require(self.headers.get('Content-Type', '').split(';')[0] == 'application/json', 'JSON required.', 415)
                length = int(self.headers.get('Content-Length', '0'))
                require(0 < length <= 10_000_000, 'Request too large.', 413)
                body = json.loads(self.rfile.read(length))
                require(isinstance(body, dict))
            with connect() as db:
                db.execute('BEGIN IMMEDIATE' if self.command != 'GET' else 'BEGIN')
                user = self.session(db)
                if path == '/api/status' and self.command == 'GET':
                    result = {'backend': True, 'needsSetup': not db.execute('SELECT 1 FROM users LIMIT 1').fetchone(),
                              'user': public_user(user) if user else None, 'csrf': user['csrf'] if user else ''}
                elif path in ['/api/setup', '/api/login', '/api/recover'] and self.command == 'POST':
                    username = str(body.get('username', '')).strip().lower()
                    require(len(username) <= 80)
                    self.throttle(db, 'ip:' + self.client_address[0] + ':' + path, 30, 900)
                    self.throttle(db, 'account:' + path + ':' + username, 5, 900)
                    account = db.execute('SELECT * FROM users WHERE username=?', (username,)).fetchone()
                    if path == '/api/setup':
                        require(not db.execute('SELECT 1 FROM users LIMIT 1').fetchone(), 'Setup is already complete.', 409)
                        expected = os.environ.get('FEU_SETUP_TOKEN', '')
                        require(expected and hmac.compare_digest(str(body.get('setupToken', '')), expected), 'Setup token is invalid.', 403)
                        require(re.fullmatch(r'[a-z0-9_.-]{3,80}', username), 'Invalid username.')
                        uid = secrets.token_hex(12)
                        db.execute('INSERT INTO users(id,username,name,role,password,pin) VALUES (?,?,?,?,?,?)',
                                   (uid, username, str(body.get('name') or 'Canteen Owner')[:80], 'Administrator',
                                    hash_secret(password(body.get('password'))), hash_secret(pin(body.get('pin')))))
                        audit(db, uid, 'account.setup')
                        result = {'ok': True}
                    elif path == '/api/recover':
                        entered = str(body.get('pin', ''))
                        # Equal cost for unknown users and accounts without recovery PINs.
                        stored = account['pin'] if account and account['pin'] else self.server.dummy_hash
                        valid = matches(entered, stored)
                        require(valid and account and account['pin'] and account['status'] == 'active' and
                                re.fullmatch(r'[0-9]{6}', entered), GENERIC_ERROR, 400)
                        new_password = hash_secret(password(body.get('password')))
                        db.execute('UPDATE users SET password=?,version=version+1 WHERE id=?', (new_password, account['id']))
                        db.execute('DELETE FROM sessions WHERE user_id=?', (account['id'],))
                        audit(db, account['id'], 'password.recovered')
                        result = {'ok': True}
                    else:
                        valid = matches(str(body.get('password', '')), account['password'] if account else self.server.dummy_hash)
                        require(valid and account and account['status'] == 'active', 'Invalid username or password.', 401)
                        token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
                        db.execute('INSERT INTO sessions VALUES (?,?,?,?,?)',
                                   (hashlib.sha256(token.encode()).hexdigest(), account['id'], csrf, time.time() + 28800, account['version']))
                        cookie = 'feu_session=' + token + '; HttpOnly; Path=/; Max-Age=28800; SameSite=' + ('None; Secure' if self.server.secure else 'Strict')
                        audit(db, account['id'], 'account.login')
                        db.execute('DELETE FROM attempts WHERE key=?', ('account:' + path + ':' + username,))
                        result = {'user': public_user(account), 'csrf': csrf}
                else:
                    require(user is not None, 'Sign in to continue.', 401)
                    if self.command != 'GET':
                        require(hmac.compare_digest(self.headers.get('X-CSRF-Token', ''), user['csrf']), 'Refresh your session.', 403)
                    owner = user['role'] == 'Administrator'
                    if path == '/api/logout' and self.command == 'POST':
                        db.execute('DELETE FROM sessions WHERE user_id=?', (user['id'],))
                        cookie = 'feu_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Strict'
                        result = {'ok': True}
                    elif path == '/api/security' and self.command == 'POST':
                        self.throttle(db, 'security:' + user['id'], 5, 900)
                        user = self.session(db)
                        require(user is not None, 'Sign in to continue.', 401)
                        require(matches(str(body.get('currentPassword', '')), user['password']), 'Current password is incorrect.', 403)
                        if body.get('pin'):
                            db.execute('UPDATE users SET pin=? WHERE id=?', (hash_secret(pin(body['pin'])), user['id']))
                        if body.get('password'):
                            db.execute('UPDATE users SET password=?,version=version+1 WHERE id=?', (hash_secret(password(body['password'])), user['id']))
                            db.execute('DELETE FROM sessions WHERE user_id=?', (user['id'],))
                        audit(db, user['id'], 'account.security_changed')
                        result = {'ok': True}
                    elif path == '/api/snapshot' and self.command == 'GET':
                        permitted = KEYS if owner else ['Inventory', 'Categories', 'Settings', 'Customers']
                        resources = {r['key']: {'value': json.loads(r['value']), 'revision': r['revision']}
                                     for r in db.execute('SELECT * FROM resources') if r['key'] in [PREFIX + k for k in permitted]}
                        # Accounts, password hashes and PIN hashes are never included.
                        resources[PREFIX + 'Sales'] = {'value': [json.loads(r[0]) for r in db.execute('SELECT payload FROM sales ORDER BY date DESC,id DESC')]
                                                       if args.get('ledger', ['1'])[0] != '0' else [], 'revision': 0}
                        result = {'resources': resources, 'user': public_user(user), 'csrf': user['csrf']}
                    elif path == '/api/resource' and self.command == 'PUT':
                        require(owner, 'Owner permission required.', 403)
                        key, value = body.get('key'), body.get('value')
                        require(key in [PREFIX + x for x in KEYS], 'Protected resource.', 403)
                        self.validate_resource(key, value)
                        changed = db.execute('UPDATE resources SET value=?,revision=revision+1 WHERE key=? AND revision=?',
                                             (encode(value), key, body.get('revision'))).rowcount
                        require(changed == 1, 'Data changed on another terminal. Refresh before saving.', 409)
                        audit(db, user['id'], 'resource.updated', key)
                        result = {'revision': body['revision'] + 1}
                    elif path == '/api/import' and self.command == 'POST':
                        require(owner, 'Owner permission required.', 403)
                        require(not read(db, 'Inventory') and not db.execute('SELECT 1 FROM sales LIMIT 1').fetchone(),
                                'Import requires an empty server catalog and sales ledger.', 409)
                        backup = body.get('backup', {})
                        require(isinstance(backup, dict))
                        source = backup.get('data', backup)
                        require(isinstance(source, dict))
                        imported = {}
                        for suffix in KEYS:
                            aliases = {'Inventory': 'products', 'InventoryHistory': 'inventoryHistory', 'CashDrawer': 'cashDrawer',
                                       'CashClosings': 'cashClosings', 'StockDiscrepancies': 'stockDiscrepancies'}
                            value = source.get(PREFIX + suffix, source.get(aliases.get(suffix, suffix[0].lower() + suffix[1:])))
                            if value is not None:
                                self.validate_resource(PREFIX + suffix, value)
                                imported[suffix] = value
                        require('Inventory' in imported, 'Backup has no product inventory.')
                        legacy_sales = source.get(PREFIX + 'Sales', source.get('sales', []))
                        require(isinstance(legacy_sales, list))
                        for index, sale in enumerate(legacy_sales):
                            require(isinstance(sale, dict) and isinstance(sale.get('items'), list))
                            transaction = str(sale.get('transaction', '')).strip()
                            require(transaction and len(transaction) <= 100, 'Every sale requires a transaction number.')
                            for amount in ['total', 'discount', 'subtotal', 'tax']:
                                cents(sale.get(amount, 0))
                            for item in sale['items']:
                                require(isinstance(item, dict) and type(item.get('quantity')) is int and item['quantity'] > 0)
                                cents(item.get('price', 0))
                                cents(item.get('subtotal', 0))
                            if sale.get('timestamp'):
                                date = datetime.fromisoformat(sale['timestamp'].replace('Z', '+00:00')).astimezone(TZ).date().isoformat()
                            else:
                                date = datetime.strptime(sale['date'], '%m/%d/%Y').date().isoformat()
                            db.execute('INSERT INTO sales VALUES (?,?,?,?,?,?,?,?,?)',
                                       (transaction, date, sale.get('paymentMethod', 'Cash'), sale.get('discountType', ''),
                                        str(sale.get('staffId', '')), sale['total'], sale.get('discount', 0), encode(sale), 'import-' + transaction))
                        for suffix, value in imported.items():
                            write(db, suffix, value)
                        audit(db, user['id'], 'data.imported', f"{len(imported['Inventory'])} products, {len(legacy_sales)} sales")
                        result = {'products': len(imported['Inventory']), 'sales': len(legacy_sales)}
                    elif path == '/api/users':
                        require(owner, 'Owner permission required.', 403)
                        if self.command == 'GET':
                            result = {'users': [public_user(r) for r in db.execute('SELECT * FROM users ORDER BY username,id')]}
                        else:
                            require(self.command == 'POST')
                            uid = body.get('id')
                            if uid:
                                require(uid != user['id'], 'Use your security settings to update your own account.')
                                target = db.execute('SELECT * FROM users WHERE id=?', (uid,)).fetchone()
                                require(target and target['role'] == 'Staff', 'Only staff accounts can be managed here.')
                                require(body.get('status') in ['active', 'inactive'])
                                db.execute('UPDATE users SET name=?,status=?,version=version+1 WHERE id=?',
                                           (str(body.get('name') or target['name'])[:80], body['status'], uid))
                                db.execute('DELETE FROM sessions WHERE user_id=?', (uid,))
                            else:
                                username = str(body.get('username', '')).strip().lower()
                                require(re.fullmatch(r'[a-z0-9_.-]{3,80}', username), 'Invalid username.')
                                uid = secrets.token_hex(12)
                                db.execute('INSERT INTO users(id,username,name,role,password,pin) VALUES (?,?,?,?,?,?)',
                                           (uid, username, str(body.get('name') or username)[:80], 'Staff',
                                            hash_secret(password(body.get('password'))), hash_secret(pin(body.get('pin')))))
                            audit(db, user['id'], 'account.updated', uid)
                            result = {'ok': True}
                    elif path == '/api/discounts':
                        if self.command == 'GET':
                            result = {'discounts': [json.loads(r[0]) for r in db.execute('SELECT payload FROM discounts ORDER BY name,id')]}
                        else:
                            require(self.command == 'POST' and owner, 'Owner permission required.', 403)
                            d = discount_valid(body)
                            uid = body.get('id') or secrets.token_hex(12)
                            previous = db.execute('SELECT payload FROM discounts WHERE id=?', (uid,)).fetchone()
                            previous = json.loads(previous[0]) if previous else {}
                            stamp = datetime.now(timezone.utc).isoformat()
                            d.update(id=uid, createdAt=previous.get('createdAt', stamp), createdBy=previous.get('createdBy', user['username']),
                                     updatedAt=stamp, updatedBy=user['username'])
                            db.execute('INSERT INTO discounts VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,payload=excluded.payload', (uid, d['name'], encode(d)))
                            audit(db, user['id'], 'discount.updated', uid)
                            result = d
                    elif path in ['/api/quote', '/api/checkout'] and self.command == 'POST':
                        request_id = str(body.get('requestId', ''))
                        existing = db.execute('SELECT payload,staff_id FROM sales WHERE request_id=?', (request_id,)).fetchone() if request_id else None
                        if existing and path == '/api/checkout':
                            require(existing['staff_id'] == user['id'], 'Request already used.', 409)
                            result = json.loads(existing['payload'])
                        else:
                            result = quote(db, body, user)
                            if path == '/api/checkout':
                                require(re.fullmatch(r'[a-zA-Z0-9_-]{16,100}', request_id), 'Request identifier required.')
                                method = body.get('paymentMethod')
                                settings = read(db, 'Settings')
                                require(method in ['Cash', 'GCash'] and settings.get('cashEnabled' if method == 'Cash' else 'gcashEnabled', True), 'Payment method unavailable.')
                                received = cents(body.get('cash', 0)) if method == 'Cash' else cents(result['total'])
                                require(received >= cents(result['total']), 'Cash received is insufficient.')
                                reference = str(body.get('referenceNumber', '')).strip()[:100]
                                require(method != 'GCash' or reference, 'Enter the verified GCash reference.')
                                now = datetime.now(TZ)
                                transaction = 'FC-' + now.strftime('%Y%m%d-') + secrets.token_hex(5).upper()
                                customer_id = body.get('customerId', '')
                                customers = read(db, 'Customers')
                                customer = next((c for c in customers if str(c['id']) == str(customer_id)), {})
                                result.update(transaction=transaction, date=now.strftime('%m/%d/%Y'), time=now.strftime('%I:%M:%S %p'),
                                              timestamp=now.isoformat(), staffId=user['id'], staffName=user['name'], staffUsername=user['username'],
                                              staffRole=user['role'], customerId=customer.get('id', ''), customerName=customer.get('name', 'Walk-in Customer'),
                                              paymentMethod=method, cash=received / 100, change=(received - cents(result['total'])) / 100,
                                              referenceNumber=reference)
                                inventory = read(db, 'Inventory')
                                for item in result['items']:
                                    p = next(p for p in inventory if str(p['id']) == str(item['id']))
                                    p['stock'] -= item['quantity']
                                write(db, 'Inventory', inventory)
                                history = read(db, 'InventoryHistory')
                                for item in result['items']:
                                    current = next(p['stock'] for p in inventory if str(p['id']) == str(item['id']))
                                    history.insert(0, {'id': transaction + '-' + str(item['id']), 'saleId': transaction,
                                        'productId': item['id'], 'productName': item['name'], 'action': 'Sold',
                                        'quantity': item['quantity'], 'change': -item['quantity'],
                                        'oldStock': current + item['quantity'], 'newStock': current, 'reason': 'POS sale',
                                        'date': result['date'], 'time': result['time'], 'timestamp': now.isoformat(), 'staff': user['name']})
                                write(db, 'InventoryHistory', history)
                                if customer:
                                    customer['totalSpent'] = float(customer.get('totalSpent', 0)) + result['total']
                                    customer['purchases'] = int(customer.get('purchases', 0)) + 1
                                    write(db, 'Customers', customers)
                                db.execute('INSERT INTO sales VALUES (?,?,?,?,?,?,?,?,?)',
                                           (transaction, now.date().isoformat(), method, result['discountType'], user['id'], result['total'], result['discount'], encode(result), request_id))
                                audit(db, user['id'], 'sale.completed', transaction)
                    elif path == '/api/sales' and self.command == 'GET':
                        result = self.sales_query(db, args)
                    elif path == '/api/sales-staff' and self.command == 'GET':
                        result = {'staff': [dict(r) for r in db.execute("SELECT DISTINCT staff_id id,json_extract(payload,'$.staffName') name FROM sales ORDER BY name,staff_id")]}
                    elif path == '/api/audit' and self.command == 'GET':
                        require(owner, 'Owner permission required.', 403)
                        result = {'records': [dict(r) for r in db.execute('SELECT * FROM audit ORDER BY id DESC LIMIT 100')]}
                    else:
                        raise Problem('Not found.', 404)
            self.reply(200, result, cookie)
        except Problem as exc:
            self.reply(exc.status, {'error': exc.message})
        except sqlite3.IntegrityError:
            self.reply(409, {'error': 'A record with these details already exists.'})
        except (ValueError, TypeError, KeyError, OverflowError):
            self.reply(400, {'error': 'Invalid request data.'})
        except Exception:
            self.reply(500, {'error': 'Request failed. No partial transaction was saved.'})

    def validate_resource(self, key, value):
        require(isinstance(value, dict if key.endswith('Settings') else list))
        if key.endswith('Inventory'):
            seen = set()
            for p in value:
                require(isinstance(p, dict) and str(p.get('id')) not in seen and str(p.get('name', '')).strip())
                require(re.fullmatch(r'[A-Za-z0-9_.:-]{1,100}', str(p.get('id', ''))), 'Invalid product identifier.')
                seen.add(str(p.get('id')))
                cents(p.get('price'))
                require(type(p.get('stock')) is int and 0 <= p['stock'] <= 1_000_000)
                image = str(p.get('image', ''))
                require(bool(re.fullmatch(r'data:image/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/=\s]+', image)) or
                        not any(c in image for c in '<>"\'&'), 'Unsupported product image.')
        if key.endswith('Settings'):
            require(0 <= float(value.get('taxRate', 0)) <= 100)
        require(len(encode(value)) <= 8_000_000, 'Dataset too large.')

    def sales_query(self, db, args):
        get = lambda k, default='': args.get(k, [default])[0]
        size = int(get('size', '25'))
        require(size in [10, 25, 50, 100])
        where, values = [], []
        for name, column, op in [('start', 'date', '>='), ('end', 'date', '<='), ('payment', 'payment', '='), ('discount', 'discount_type', '='), ('staff', 'staff_id', '=')]:
            if get(name):
                if name == 'discount' and get(name) in ['none', 'legacy']:
                    where.append("discount_type='' AND discount" + ('=0' if get(name) == 'none' else '>0'))
                    continue
                where.append(f'{column}{op}?')
                values.append(get(name))
        if get('q'):
            where.append("(instr(lower(id),lower(?))>0 OR EXISTS (SELECT 1 FROM json_each(sales.payload,'$.items') WHERE instr(lower(json_extract(value,'$.name')),lower(?))>0))")
            values.extend([get('q'), get('q')])
        clause = ' WHERE ' + ' AND '.join(where) if where else ''
        today = datetime.now(TZ).date().isoformat()
        totals = db.execute("""SELECT count(*) count,coalesce(sum(total),0) total,coalesce(sum(discount),0) discount,
            coalesce(sum((SELECT sum(json_extract(value,'$.quantity')) FROM json_each(sales.payload,'$.items'))),0) items,
            coalesce(sum(CASE WHEN date=? THEN total ELSE 0 END),0) todayTotal FROM sales""" + clause, [today] + values).fetchone()
        pages = max(1, (totals['count'] + size - 1) // size)
        page = max(1, min(int(get('page', '1')), pages))
        rows = db.execute('SELECT payload FROM sales' + clause + ' ORDER BY date DESC,id DESC LIMIT ? OFFSET ?', values + [size, (page - 1) * size])
        return {'records': [json.loads(r[0]) for r in rows], 'page': page, 'size': size, 'pages': pages, **dict(totals)}


def make_server(host='127.0.0.1', port=8000):
    migrate()
    server = ThreadingHTTPServer((host, port), Handler)
    server.secure = os.environ.get('FEU_SECURE_COOKIE') == '1'
    server.origins = set(filter(None, os.environ.get('FEU_ALLOWED_ORIGINS', f'http://127.0.0.1:{server.server_port},http://localhost:{server.server_port}').split(',')))
    server.dummy_hash = hash_secret(secrets.token_urlsafe(32))
    return server


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8000)
    parser.add_argument('--approve-recovery', metavar='USERNAME', help='Operator-only recovery after documented identity verification')
    options = parser.parse_args()
    if options.approve_recovery:
        import getpass
        migrate()
        reason = input('Identity verification / approval reference (no sensitive identity data): ').strip()
        require(len(reason) >= 8, 'An approval reference is required.')
        new_password = password(getpass.getpass('New password: '))
        new_pin = pin(getpass.getpass('New recovery PIN: '))
        with connect() as db:
            target = db.execute('SELECT id FROM users WHERE username=?', (options.approve_recovery,)).fetchone()
            require(target, 'Account not found.')
            db.execute('UPDATE users SET password=?,pin=?,version=version+1 WHERE id=?', (hash_secret(new_password), hash_secret(new_pin), target['id']))
            db.execute('DELETE FROM sessions WHERE user_id=?', (target['id'],))
            audit(db, 'server-operator', 'recovery.approved', target['id'] + ':' + reason)
        print('Recovery approved; all sessions invalidated.')
    else:
        service = make_server(options.host, options.port)
        print(f'FEU POS: http://{options.host}:{service.server_port} (Ctrl+C to stop)', flush=True)
        service.serve_forever()
