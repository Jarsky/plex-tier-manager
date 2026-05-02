from flask import Flask, request, redirect, session, jsonify
import json
import os
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, login_user, logout_user, login_required, current_user
from flask_mail import Mail
from flask_migrate import Migrate
from config import Config
from models import db, User, Subscription, SiteSettings
from plexapi.myplex import MyPlexAccount
from werkzeug.security import generate_password_hash, check_password_hash
import requests
import time
from datetime import datetime
import locale
import ipaddress
from flask_wtf import CSRFProtect
from flask_wtf.csrf import generate_csrf
import secrets
import string

app = Flask(__name__)
app.config.from_object(Config)

# Enable CSRF protection
csrf = CSRFProtect(app)

# Ensure secret key is set for sessions
if not app.config.get('SECRET_KEY') or app.config['SECRET_KEY'] in ('your-secret-key', ''):
    import sys
    print('WARNING: SECRET_KEY not set or is default. Generating a random key — sessions will be lost on restart. Set SECRET_KEY in your environment.', file=sys.stderr)
    app.config['SECRET_KEY'] = os.urandom(32)


def validate_runtime_config(flask_app):
    env = os.environ.get('FLASK_ENV', 'production').lower()
    if env == 'production':
        if flask_app.config.get('SECRET_KEY') == 'your-secret-key':
            raise RuntimeError('Refusing to start with default SECRET_KEY in production.')
        if os.environ.get('FLASK_DEBUG', '0') == '1':
            raise RuntimeError('Refusing to start with FLASK_DEBUG=1 in production.')


validate_runtime_config(app)

db.init_app(app)
login_manager = LoginManager(app)
mail = Mail(app)
migrate = Migrate(app, db)

# Set login view
login_manager.login_view = 'index'

AUTH_RATE_LIMIT_WINDOW_SECONDS = int(os.environ.get('AUTH_RATE_LIMIT_WINDOW_SECONDS', '600'))
AUTH_RATE_LIMIT_MAX_ATTEMPTS = int(os.environ.get('AUTH_RATE_LIMIT_MAX_ATTEMPTS', '5'))
_failed_auth_attempts = {}


def _client_identifier(email=''):
    ip = request.remote_addr or 'unknown'
    return f"{ip}:{(email or '').strip().lower()}"


def _prune_attempts(identifier):
    now = time.time()
    attempts = _failed_auth_attempts.get(identifier, [])
    attempts = [ts for ts in attempts if now - ts <= AUTH_RATE_LIMIT_WINDOW_SECONDS]
    _failed_auth_attempts[identifier] = attempts
    return attempts


def is_auth_rate_limited(identifier):
    attempts = _prune_attempts(identifier)
    return len(attempts) >= AUTH_RATE_LIMIT_MAX_ATTEMPTS


def record_failed_auth(identifier):
    attempts = _prune_attempts(identifier)
    attempts.append(time.time())
    _failed_auth_attempts[identifier] = attempts


def clear_failed_auth(identifier):
    _failed_auth_attempts.pop(identifier, None)


def frontend_base_url():
        return os.environ.get('FRONTEND_URL', 'http://localhost:5173').rstrip('/')


def frontend_redirect(path='/'):
        return redirect(f"{frontend_base_url()}{path}")


def oauth_success_page():
        return """<!DOCTYPE html>
<html lang='en'>
<head><meta charset='UTF-8'><title>Login Successful</title></head>
<body style='font-family:sans-serif;background:#121212;color:#fff;padding:24px;'>
    <h2 style='color:#34d399;'>Login Successful</h2>
    <p>You have been signed in. This window will close automatically.</p>
    <script>
        if (window.opener && window.opener !== window) {
            window.opener.postMessage({ type: 'login_success' }, '*');
        }
        setTimeout(function () { window.close(); }, 900);
    </script>
</body>
</html>"""


def oauth_error_page(message):
        safe_msg = (message or 'Login failed.').replace('<', '&lt;').replace('>', '&gt;')
        return f"""<!DOCTYPE html>
<html lang='en'>
<head><meta charset='UTF-8'><title>Login Error</title></head>
<body style='font-family:sans-serif;background:#121212;color:#fff;padding:24px;'>
    <h2 style='color:#f87171;'>Login Failed</h2>
    <p>{safe_msg}</p>
    <button onclick='window.close()' style='padding:8px 14px;border:0;border-radius:8px;background:#ff6a00;color:#fff;'>Close</button>
</body>
</html>"""


def plex_iframe_page():
        return """<!DOCTYPE html>
<html lang='en'>
<head><meta charset='UTF-8'><title>Plex Login</title></head>
<body style='font-family:sans-serif;background:#121212;color:#fff;padding:24px;'>
    <h2 style='color:#ff6a00;'>Plex Login</h2>
    <p>Open Plex login in a popup to continue.</p>
    <a href='/login/plex' target='_top' style='color:#ffb366;'>Continue with Plex</a>
</body>
</html>"""

def get_current_theme():
    return SiteSettings.get_setting('theme', 'default')

def set_current_theme(theme):
    try:
        SiteSettings.set_setting('theme', theme)
        return True
    except Exception:
        return False

def get_site_title_func():
    return SiteSettings.get_setting('site_title', 'Plex Tier Manager')

def set_site_title(title):
    try:
        SiteSettings.set_setting('site_title', title)
        return True
    except Exception:
        return False


def list_theme_options():
    css_dir = os.path.join(app.static_folder, 'css')
    options = [('default', 'Default (PTM)')]
    try:
        css_files = [f for f in os.listdir(css_dir) if f.endswith('.css')]
    except Exception:
        return options

    for f in css_files:
        if f == 'main.css':
            continue
        path = os.path.join(css_dir, f)
        try:
            with open(path, 'r', encoding='utf-8') as cssf:
                first_line = cssf.readline().strip()
                if first_line.startswith('/*') and first_line.endswith('*/'):
                    display_name = first_line.strip('/*').strip('*/').strip()
                    theme_key = f.replace('.css', '')
                    options.append((theme_key, display_name))
        except Exception:
            continue
    return options

def get_page_title(page_name=None):
    site_title = get_site_title_func()
    if page_name:
        return f"{site_title} > {page_name}"
    return site_title

def is_local_ip(ip_str):
    """Check if an IP address is in local network ranges"""
    try:
        ip = ipaddress.ip_address(ip_str)
        # Check for local network ranges
        local_ranges = [
            ipaddress.ip_network('192.168.0.0/16'),
            ipaddress.ip_network('172.16.0.0/12'),  # 172.16.0.0 to 172.31.255.255
            ipaddress.ip_network('10.0.0.0/8'),
            ipaddress.ip_network('127.0.0.0/8'),   # localhost
            ipaddress.ip_network('169.254.0.0/16') # link-local
        ]
        
        for network in local_ranges:
            if ip in network:
                return True
        return False
    except ValueError:
        return False

@app.route('/check_client_ip')
def check_client_ip():
    """Check if the client IP is local and return status"""
    client_ip = request.remote_addr
    is_local = is_local_ip(client_ip)
    return jsonify({
        'ip': client_ip,
        'is_local': is_local
    })

@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))

@app.route("/")
def index():
    return frontend_redirect('/')

@app.route("/dashboard")
@login_required
def dashboard():
    return frontend_redirect('/account')

@app.route("/admin")
@login_required
def admin_dashboard():
    if current_user.role != 0:
        return frontend_redirect('/account')
    return frontend_redirect('/admin')

@app.route('/api/auth/status')
def auth_status():
    if current_user.is_authenticated:
        return jsonify({
            'authenticated': True,
            'user': {
                'id': current_user.id,
                'username': current_user.username,
                'email': current_user.email,
                'role': current_user.role,
                'plex_id': current_user.plex_id
            }
        })
    return jsonify({'authenticated': False})


@app.route('/api/site-config')
def api_site_config():
    return jsonify({
        'site_title': get_site_title_func(),
        'theme': get_current_theme(),
        'theme_options': [
            {'key': key, 'label': label} for key, label in list_theme_options()
        ]
    })

@app.route('/api/csrf-token')
def csrf_token():
    token = generate_csrf()
    return jsonify({'csrf_token': token})

def get_site_setting(key, default=None):
    value = SiteSettings.get_setting(key)
    return value if value is not None else default

@app.route('/login/plex')
def plex_login():
    # Check if this is being called from an iframe
    if request.args.get('iframe') == 'true':
        return plex_iframe_page()
    
    # Request a PIN from Plex
    client_id = get_site_setting('PLEX_CLIENT_ID')
    headers = {
        'X-Plex-Client-Identifier': client_id,
        'X-Plex-Product': 'PlexTierManager',
        'X-Plex-Version': '1.0.0',
        'Accept': 'application/json'
    }
    data = {
        'strong': 'true'
    }
    r = requests.post('https://plex.tv/api/v2/pins', headers=headers, data=data)
    if r.status_code != 201:
        app.logger.error(f"Plex PIN request failed: {r.status_code}")
        return frontend_redirect('/login')
    
    pin_data = r.json()
    pin_id = pin_data['id']
    pin_code = pin_data['code']
    
    # Store PIN in session for later retrieval
    session['plex_pin_id'] = pin_id
    session['plex_pin_code'] = pin_code
    
    # Redirect to Plex with the PIN
    redirect_uri = get_site_setting('PLEX_REDIRECT_URI')
    oauth_url = f'https://app.plex.tv/auth#?clientID={client_id}&code={pin_code}&context%5Bdevice%5D%5Bproduct%5D=PlexTierManager&context%5Bdevice%5D%5Bdevice%5D=web&context%5Bdevice%5D%5Bplatform%5D=web&context%5Bdevice%5D%5Bversion%5D=1.0.0&redirect={redirect_uri}'
    return redirect(oauth_url)

@app.route('/login/plex/callback')
def plex_oauth_callback():
    # Check if we have a PIN in session
    pin_id = session.get('plex_pin_id')
    if not pin_id:
        return oauth_error_page('No PIN found. Please try logging in again.')
    client_id = get_site_setting('PLEX_CLIENT_ID')
    headers = {
        'X-Plex-Client-Identifier': client_id,
        'Accept': 'application/json'
    }
    
    # Poll the PIN endpoint to get the token
    max_attempts = 60  # 5 minutes with 5-second intervals
    for attempt in range(max_attempts):
        r = requests.get(f'https://plex.tv/api/v2/pins/{pin_id}', headers=headers)
        if r.status_code == 200:
            pin_data = r.json()
            if pin_data.get('authToken'):
                # We have a token!
                plex_token = pin_data['authToken']
                
                # Clear the PIN from session
                session.pop('plex_pin_id', None)
                session.pop('plex_pin_code', None)
                
                # Authenticate user with PlexAPI
                try:
                    account = MyPlexAccount(token=plex_token)
                    plex_id = str(account.id)
                    
                    # First try to find user by Plex ID
                    user = User.query.filter_by(plex_id=plex_id).first()
                    
                    if not user and account.email:
                        # If no user with Plex ID, try to find by email
                        user = User.query.filter_by(email=account.email).first()
                        if user:
                            # Update existing email user with Plex ID
                            user.plex_id = plex_id
                            user.username = account.username
                            db.session.commit()
                    
                    if not user:
                        # Create new user if none found
                        user = User(plex_id=plex_id, username=account.username, email=account.email, role=2)
                        db.session.add(user)
                        db.session.commit()
                    
                    if not user.active:
                        return oauth_error_page('Your account has been disabled. Please contact the administrator.')
                    
                    login_user(user)
                    return oauth_success_page()
                except Exception as e:
                    app.logger.error(f"Plex OAuth login error: {e}")
                    return oauth_error_page('Plex login failed: ' + str(e))
        
        # Wait 5 seconds before next attempt
        time.sleep(5)
    
    # If we get here, the PIN expired
    session.pop('plex_pin_id', None)
    session.pop('plex_pin_code', None)
    return oauth_error_page('Login timed out. Please try again.')

@app.route('/login/email', methods=['GET', 'POST'])
def email_login():
    if request.method == 'POST':
        email = request.form.get('email', '').strip().lower()
        password = request.form.get('password', '')
        client_key = _client_identifier(email)
        if is_auth_rate_limited(client_key):
            return jsonify({'success': False, 'message': 'Too many login attempts. Please wait and try again.'}), 429
        user = User.query.filter_by(email=email).first()
        if user and user.password_hash and check_password_hash(user.password_hash, password):
            if not user.active:
                return jsonify({'success': False, 'message': 'Your account has been disabled. Please contact the administrator.'})
            login_user(user)
            user.last_login = datetime.utcnow()
            db.session.commit()
            clear_failed_auth(client_key)
            return jsonify({'success': True, 'message': 'Logged in successfully!'})
        else:
            record_failed_auth(client_key)
            return jsonify({'success': False, 'message': 'Invalid email or password.'})
    return frontend_redirect('/login')

@app.route('/signup', methods=['GET', 'POST'])
def signup():
    if request.method == 'POST':
        email = request.form['email']
        password = request.form.get('password')
        generated = False
        if not password:
            # Generate a user-friendly password (10 chars, no ambiguous chars)
            alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
            password = ''.join(secrets.choice(alphabet) for _ in range(10))
            generated = True
        if User.query.filter_by(email=email).first():
            return jsonify({'success': False, 'message': 'Email already registered.'})
        else:
            admin_email = app.config.get('ADMIN_EMAIL')
            role = 0 if admin_email and email == admin_email else 2
            user = User(email=email, password_hash=generate_password_hash(password), role=role)
            db.session.add(user)
            db.session.commit()
            if not user.active:
                return jsonify({'success': False, 'message': 'Your account has been disabled. Please contact the administrator.'})
            login_user(user)
            resp = {'success': True, 'message': 'Signup successful! You are now logged in.'}
            if generated:
                resp['generated_password'] = password
            return jsonify(resp)
    return frontend_redirect('/login')

@app.route('/login/admin', methods=['GET', 'POST'])
def admin_login():
    return frontend_redirect('/login')

@app.route('/logout')
@login_required
def logout():
    logout_user()
    return frontend_redirect('/')

# After login, redirect to dashboard
@login_manager.unauthorized_handler
def unauthorized():
    return frontend_redirect('/login')

@app.route('/login/plex/simple')
def plex_simple_login():
    # Check if client IP is local
    client_ip = request.remote_addr
    if not is_local_ip(client_ip):
        app.logger.warning(f"Simple Plex login blocked for non-local IP: {client_ip}")
        return jsonify({'success': False, 'message': 'Simple Plex login is only available from local network.'}), 403
    
    try:
        plex_token = get_site_setting('PLEX_TOKEN')
        account = MyPlexAccount(token=plex_token)
        plex_id = str(account.id)
        user = User.query.filter_by(plex_id=plex_id).first()
        if not user and account.email:
            user = User.query.filter_by(email=account.email).first()
            if user:
                user.plex_id = plex_id
                user.username = account.username
                db.session.commit()
        if not user:
            user = User(plex_id=plex_id, username=account.username, email=account.email, role=2)
            db.session.add(user)
            db.session.commit()
        if not user.active:
            return jsonify({'success': False, 'message': 'Your account has been disabled. Please contact the administrator.'})
        login_user(user)
        return jsonify({'success': True, 'message': 'Logged in with Plex!'})
    except Exception as e:
        app.logger.error(f"Simple Plex login error: {e}")
        return jsonify({'success': False, 'message': f'Plex login failed: {str(e)}'})

@app.route('/admin/update_role', methods=['POST'])
@login_required
def admin_update_role():
    if current_user.role != 0:
        return jsonify({'success': False, 'message': 'Admins only!'}), 403
    data = request.get_json()
    user_id = data.get('user_id')
    new_role = int(data.get('role'))
    user = User.query.get(user_id)
    if not user:
        return jsonify({'success': False, 'message': 'User not found.'}), 404
    if user.id == current_user.id:
        return jsonify({'success': False, 'message': 'You cannot change your own role.'}), 400
    user.role = new_role
    db.session.commit()
    return jsonify({'success': True, 'message': f'Role updated for {user.email}.'})

@app.route('/admin/save_user', methods=['POST'])
@login_required
def admin_save_user():
    if current_user.role != 0:
        return jsonify({'success': False, 'message': 'Admins only!'}), 403
    data = request.get_json()
    user_id = data.get('user_id')
    new_role = int(data.get('role'))
    new_active = bool(int(data.get('active')))
    user = User.query.get(user_id)
    if not user:
        return jsonify({'success': False, 'message': 'User not found.'}), 404
    if user.id == current_user.id:
        return jsonify({'success': False, 'message': 'You cannot change your own role or status.'}), 400
    user.role = new_role
    user.active = new_active
    user.last_modified = datetime.utcnow()
    db.session.commit()
    return jsonify({'success': True, 'message': f'User {user.email} updated.'})

@app.route('/admin/delete_user', methods=['POST'])
@login_required
def admin_delete_user():
    if current_user.role != 0:
        return jsonify({'success': False, 'message': 'Admins only!'}), 403
    data = request.get_json()
    user_id = data.get('user_id')
    user = User.query.get(user_id)
    if not user:
        return jsonify({'success': False, 'message': 'User not found.'}), 404
    if user.id == current_user.id:
        return jsonify({'success': False, 'message': 'You cannot delete yourself.'}), 400
    db.session.delete(user)
    db.session.commit()
    return jsonify({'success': True, 'message': f'User {user.email} deleted.'})

@app.route('/admin/unlink_plex', methods=['POST'])
@login_required
def admin_unlink_plex():
    if current_user.role != 0:
        return jsonify({'success': False, 'message': 'Admins only!'}), 403
    data = request.get_json()
    user_id = data.get('user_id')
    user = User.query.get(user_id)
    if not user:
        return jsonify({'success': False, 'message': 'User not found.'}), 404
    user.plex_id = None
    user.username = None
    db.session.commit()
    return jsonify({'success': True, 'message': f'Plex account unlinked for {user.email}.'})

@app.route('/admin/change_password', methods=['POST'])
@login_required
def admin_change_password():
    if current_user.role != 0:
        return jsonify({'success': False, 'message': 'Admins only!'}), 403
    data = request.get_json()
    user_id = data.get('user_id')
    new_password = data.get('new_password')
    user = User.query.get(user_id)
    if not user:
        return jsonify({'success': False, 'message': 'User not found.'}), 404
    if not new_password or len(new_password) < 6:
        return jsonify({'success': False, 'message': 'Password must be at least 6 characters.'}), 400
    user.password_hash = generate_password_hash(new_password)
    user.last_password_set = datetime.utcnow()
    db.session.commit()
    return jsonify({'success': True, 'message': f'Password changed for {user.email}.'})

@app.route('/admin/assign_plan', methods=['POST'])
@login_required
def admin_assign_plan():
    if current_user.role != 0:
        return jsonify({'success': False, 'message': 'Admins only!'}), 403
    data = request.get_json()
    user_id = data.get('user_id')
    tier = data.get('tier')
    start_date = data.get('start_date')
    end_date = data.get('end_date')
    if not tier:
        return jsonify({'success': False, 'message': 'Tier is required.'}), 400
    user = User.query.get(user_id)
    if not user:
        return jsonify({'success': False, 'message': 'User not found.'}), 404
    # Create new subscription
    sub = Subscription(user_id=user.id, tier=tier, start_date=datetime.strptime(start_date, '%Y-%m-%d'), end_date=datetime.strptime(end_date, '%Y-%m-%d') if end_date else None, active=True)
    db.session.add(sub)
    db.session.commit()
    return jsonify({'success': True, 'message': f'Plan {tier} assigned to {user.email}.'})

@app.route('/admin/set_theme', methods=['POST'])
@login_required
def admin_set_theme():
    if current_user.role != 0:
        return jsonify({'success': False, 'message': 'Admins only!'}), 403
    theme = request.form.get('theme', 'default')
    allowed_themes = [key for key, _ in list_theme_options()]
    if theme not in allowed_themes:
        return jsonify({'success': False, 'message': 'Invalid theme.'}), 400
    if set_current_theme(theme):
        return jsonify({'success': True, 'message': f'Theme set to {theme}.'})
    else:
        return jsonify({'success': False, 'message': 'Failed to save theme.'}), 500

@app.route('/admin/set_site_title', methods=['POST'])
@login_required
def admin_set_site_title():
    if current_user.role != 0:
        return jsonify({'success': False, 'message': 'Admins only!'}), 403
    title = request.form.get('site_title', '').strip()
    if not title:
        return jsonify({'success': False, 'message': 'Site title cannot be empty.'}), 400
    if set_site_title(title):
        return jsonify({'success': True, 'message': f'Site title set to "{title}".'})
    else:
        return jsonify({'success': False, 'message': 'Failed to save site title.'}), 500

@app.context_processor
def inject_theme():
    return {
        'current_theme': get_current_theme(),
        'get_site_title_func': get_site_title_func,
        'get_page_title': get_page_title,
        'get_setting': lambda key, default='': SiteSettings.get_setting(key, default)
    }

@app.context_processor
def inject_now():
    return {'now': datetime.utcnow()}

@app.context_processor
def inject_css_files():
    css_dir = os.path.join(app.static_folder, 'css')
    css_files = [f for f in os.listdir(css_dir) if f.endswith('.css')]
    current_theme = get_current_theme()
    theme_css = None
    theme_options = [('default', 'Default (PTM)')]
    for f in css_files:
        if f == 'main.css':
            continue
        path = os.path.join(css_dir, f)
        try:
            with open(path, 'r', encoding='utf-8') as cssf:
                first_line = cssf.readline().strip()
                if first_line.startswith('/*') and first_line.endswith('*/'):
                    display_name = first_line.strip('/*').strip('*/').strip()
                    theme_key = f.replace('.css', '')
                    theme_options.append((theme_key, display_name))
                    if current_theme == theme_key:
                        theme_css = f
        except Exception:
            continue
    return dict(
        css_files=css_files,
        current_theme=current_theme,
        theme_css=theme_css,
        theme_options=theme_options
    )

locale.setlocale(locale.LC_TIME, '')

def friendly_dt(dt):
    if not dt:
        return '-'
    return dt.strftime('%-I:%M%p %-d %B %Y').replace('AM', 'am').replace('PM', 'pm')

@app.route('/admin/user_summary', methods=['POST'])
@login_required
def admin_user_summary():
    if current_user.role != 0:
        return jsonify({'success': False, 'message': 'Admins only!'}), 403
    data = request.get_json()
    user_id = data.get('user_id')
    user = User.query.get(user_id)
    if not user:
        return jsonify({'success': False, 'message': 'User not found.'}), 404
    subs = Subscription.query.filter_by(user_id=user.id).order_by(Subscription.start_date.desc()).all()
    # Fetch Plex join date if possible
    plex_joined_at = None
    plex_token = get_site_setting('PLEX_TOKEN')
    if user.plex_id and plex_token:
        try:
            account = MyPlexAccount(token=plex_token)
            if str(account.id) == str(user.plex_id):
                plex_joined_at = getattr(account, 'joinedAt', None)
            else:
                for friend in account.users():
                    if str(friend.id) == str(user.plex_id):
                        plex_joined_at = getattr(friend, 'joinedAt', None)
                        break
        except Exception as e:
            app.logger.warning(f"Could not fetch Plex join date for user {user.id}: {e}")
    html = f"""
    <table class='user-summary-table' style='width:100%; text-align:left;'>
        <tr><th>Email</th><td>{user.email or '-'}</td></tr>
        <tr><th>Plex Username</th><td>{user.username or '-'}</td></tr>
        <tr><th>Role</th><td>{['Admin','Power User','Standard User'][user.role] if user.role in [0,1,2] else user.role}</td></tr>
        <tr><th>Status</th><td>{'Enabled' if user.active else 'Disabled'}</td></tr>
        <tr><th>Joined</th><td>{friendly_dt(user.created_at) if hasattr(user, 'created_at') else '-'}</td></tr>
        """
    if plex_joined_at:
        html += f"<tr><th>Plex Join Date</th><td>{friendly_dt(plex_joined_at)}</td></tr>"
    html += f"""
        <tr><th>Last Modified</th><td>{friendly_dt(user.last_modified) if hasattr(user, 'last_modified') else '-'}</td></tr>
        <tr><th>Last Password Set</th><td>{friendly_dt(user.last_password_set) if hasattr(user, 'last_password_set') else '-'}</td></tr>
        <tr><th>Last Login</th><td>{friendly_dt(user.last_login) if hasattr(user, 'last_login') else '-'}</td></tr>
    </table>
    <b>Subscriptions:</b><br>
    <ul>"""
    if subs:
        for sub in subs:
            html += f"<li>{sub.tier} | {'Enabled' if sub.active else 'Disabled'} | {friendly_dt(sub.start_date)} to {friendly_dt(sub.end_date) if sub.end_date else 'No End'}" \
                    f" | Payment: {sub.payment_status or '-'} | Renewal: {'Yes' if sub.renewal else 'No'}" \
                    f" | Notes: {sub.notes or '-'}" \
                    f"</li>"
    else:
        html += "<li>No subscriptions</li>"
    html += "</ul>"
    return jsonify({'success': True, 'html': html})

@app.before_request
def check_user_active():
    if current_user.is_authenticated:
        session.permanent = True
    if current_user.is_authenticated and hasattr(current_user, 'active') and not current_user.active:
        logout_user()
        if request.endpoint not in ('logout', 'index', 'static'):
            flash('Your account has been disabled. Please contact the administrator.', 'danger')
            return redirect(url_for('index'))

@app.route('/api/user/subscriptions')
@login_required
def api_user_subscriptions():
    subs = Subscription.query.filter_by(user_id=current_user.id).all()
    return jsonify({
        "subscriptions": [sub.as_dict() for sub in subs]
    })

@app.route('/admin/settings', methods=['POST'])
@login_required
def admin_settings():
    if current_user.role != 0:
        return jsonify({'success': False, 'message': 'Admins only!'}), 403
    allowed_keys = [
        'PLEX_TOKEN', 'PLEX_CLIENT_ID', 'PLEX_REDIRECT_URI',
        'TAUTULLI_API_KEY', 'TAUTULLI_URL',
        'STRIPE_PUBLIC_KEY', 'STRIPE_SECRET_KEY'
    ]
    updated = []
    secret_keys = {'PLEX_TOKEN', 'TAUTULLI_API_KEY', 'STRIPE_SECRET_KEY'}
    for key in allowed_keys:
        if key in request.form:
            raw_value = request.form[key]
            value = raw_value.strip()
            # Never overwrite existing secret with placeholder text.
            if key in secret_keys and value in ('', '••••••••••'):
                continue
            SiteSettings.set_setting(key, value)
            updated.append(key)
    return jsonify({'success': True, 'message': f"Updated: {', '.join(updated)}"})


@app.route('/admin/api/site_settings')
@login_required
def admin_api_site_settings():
    if current_user.role != 0:
        return jsonify({'success': False, 'error': 'Admins only!'}), 403

    integrations = {
        'plex': {
            'PLEX_TOKEN': {
                'is_secret': True,
                'has_value': bool(get_site_setting('PLEX_TOKEN')),
                'value': '••••••••••' if get_site_setting('PLEX_TOKEN') else ''
            },
            'PLEX_CLIENT_ID': {
                'is_secret': False,
                'has_value': bool(get_site_setting('PLEX_CLIENT_ID')),
                'value': get_site_setting('PLEX_CLIENT_ID', '')
            },
            'PLEX_REDIRECT_URI': {
                'is_secret': False,
                'has_value': bool(get_site_setting('PLEX_REDIRECT_URI')),
                'value': get_site_setting('PLEX_REDIRECT_URI', '')
            }
        },
        'tautulli': {
            'TAUTULLI_API_KEY': {
                'is_secret': True,
                'has_value': bool(get_site_setting('TAUTULLI_API_KEY')),
                'value': '••••••••••' if get_site_setting('TAUTULLI_API_KEY') else ''
            },
            'TAUTULLI_URL': {
                'is_secret': False,
                'has_value': bool(get_site_setting('TAUTULLI_URL')),
                'value': get_site_setting('TAUTULLI_URL', '')
            }
        },
        'stripe': {
            'STRIPE_PUBLIC_KEY': {
                'is_secret': False,
                'has_value': bool(get_site_setting('STRIPE_PUBLIC_KEY')),
                'value': get_site_setting('STRIPE_PUBLIC_KEY', '')
            },
            'STRIPE_SECRET_KEY': {
                'is_secret': True,
                'has_value': bool(get_site_setting('STRIPE_SECRET_KEY')),
                'value': '••••••••••' if get_site_setting('STRIPE_SECRET_KEY') else ''
            }
        }
    }

    return jsonify({
        'success': True,
        'site_title': get_site_title_func(),
        'theme': get_current_theme(),
        'theme_options': [
            {'key': key, 'label': label} for key, label in list_theme_options()
        ],
        'integrations': integrations
    })


@app.route('/admin/api/users')
@login_required
def admin_api_users():
    if current_user.role != 0:
        return jsonify({'success': False, 'error': 'Admins only!'}), 403

    now = datetime.utcnow()
    users = User.query.order_by(User.id).all()
    payload = []
    plex_joined_map = {}

    plex_token = get_site_setting('PLEX_TOKEN')
    if plex_token:
        try:
            account = MyPlexAccount(token=plex_token)
            owner_joined = getattr(account, 'joinedAt', None)
            plex_joined_map[str(account.id)] = owner_joined
            for friend in account.users():
                friend_id = getattr(friend, 'id', None)
                if friend_id is not None:
                    plex_joined_map[str(friend_id)] = getattr(friend, 'joinedAt', None)
        except Exception as e:
            app.logger.warning(f"Could not connect to Plex for admin users API: {e}")

    for u in users:
        sub = Subscription.query.filter_by(user_id=u.id).order_by(Subscription.start_date.desc()).first()
        if sub:
            if sub.active and (not sub.end_date or sub.end_date >= now) and sub.start_date <= now:
                sub_status = 'Active'
            elif sub.end_date and sub.end_date < now:
                sub_status = 'Expired'
            else:
                sub_status = 'Not Active'
        else:
            sub_status = 'Not Active'

        payload.append({
            'user': {
                'id': u.id,
                'email': u.email,
                'plex_id': u.plex_id,
                'username': u.username,
                'role': u.role,
                'created_at': u.created_at.isoformat() if u.created_at else None,
                'active': u.active,
            },
            'sub_status': sub_status,
            'plex_joined_at': (
                plex_joined_map.get(str(u.plex_id)).isoformat()
                if u.plex_id and plex_joined_map.get(str(u.plex_id))
                else None
            )
        })

    return jsonify({'success': True, 'users': payload})

@app.route('/admin/api/plex_users')
@login_required
def admin_api_plex_users():
    if current_user.role != 0:
        return jsonify({'success': False, 'error': 'Admins only!'}), 403
    plex_token = get_site_setting('PLEX_TOKEN')
    if not plex_token:
        return jsonify({'success': False, 'error': 'No Plex token set. Please set it in Site Settings.'}), 400
    try:
        account = MyPlexAccount(token=plex_token)
        users = []
        # Add the owner (main account) first
        owner_plex_id = str(account.id)
        owner_email = getattr(account, 'email', '')
        owner_name = getattr(account, 'username', '') or getattr(account, 'title', '') or getattr(account, 'friendlyName', '')
        owner_joined = getattr(account, 'joinedAt', None)
        is_member = User.query.filter_by(plex_id=owner_plex_id).first() is not None
        users.append({
            'plex_id': owner_plex_id,
            'email': owner_email,
            'name': owner_name,
            'is_member': is_member,
            'joined_at': owner_joined.strftime('%Y-%m-%d') if owner_joined else None,
            'is_owner': True
        })
        # Add friends/shared users
        for friend in account.users():
            plex_id = str(friend.id) if hasattr(friend, 'id') else ''
            email = getattr(friend, 'email', '')
            username = getattr(friend, 'title', '') or getattr(friend, 'username', '')
            joined = getattr(friend, 'joinedAt', None)
            is_member = User.query.filter_by(plex_id=plex_id).first() is not None
            users.append({
                'plex_id': plex_id,
                'email': email,
                'name': username,
                'is_member': is_member,
                'joined_at': joined.strftime('%Y-%m-%d') if joined else None,
                'is_owner': False
            })
        return jsonify({'success': True, 'users': users})
    except Exception as e:
        msg = str(e)
        if '401' in msg or 'unauthorized' in msg.lower():
            return jsonify({'success': False, 'error': 'Invalid Plex token. Please check your Plex Token in Site Settings.'}), 401
        return jsonify({'success': False, 'error': f'Could not connect to Plex: {msg}'}), 500

@app.route('/admin/get_secret')
@login_required
def admin_get_secret():
    if current_user.role != 0:
        return jsonify({'success': False, 'message': 'Admins only!'}), 403
    return jsonify({'success': False, 'message': 'Direct secret retrieval is disabled for security.'}), 410

@app.route('/user/change_password', methods=['POST'])
@login_required
def user_change_password():
    new_password = request.form.get('new_password')
    confirm_password = request.form.get('confirm_password')
    if not new_password or not confirm_password:
        return jsonify({'success': False, 'message': 'All fields are required.'}), 400
    if new_password != confirm_password:
        return jsonify({'success': False, 'message': 'New passwords do not match.'}), 400
    if len(new_password) < 6:
        return jsonify({'success': False, 'message': 'New password must be at least 6 characters.'}), 400
    current_user.password_hash = generate_password_hash(new_password)
    current_user.last_password_set = datetime.utcnow()
    db.session.commit()
    return jsonify({'success': True, 'message': 'Password changed successfully.'})

@app.errorhandler(400)
def bad_request(e):
    return jsonify({'success': False, 'message': 'Bad request.'}), 400

@app.errorhandler(403)
def forbidden(e):
    return jsonify({'success': False, 'message': 'Forbidden.'}), 403

@app.errorhandler(404)
def not_found(e):
    return jsonify({'success': False, 'message': 'Not found.'}), 404

@app.errorhandler(429)
def too_many_requests(e):
    return jsonify({'success': False, 'message': 'Too many requests. Please slow down.'}), 429

@app.errorhandler(500)
def internal_error(e):
    db.session.rollback()
    return jsonify({'success': False, 'message': 'Internal server error.'}), 500

@app.route('/api/dashboard')
@login_required
def api_dashboard():
    subs = Subscription.query.filter_by(user_id=current_user.id).order_by(Subscription.start_date.desc()).all()
    user_dict = {
        'id': current_user.id,
        'email': current_user.email,
        'plex_id': current_user.plex_id,
        'username': current_user.username,
        'role': current_user.role,
        'created_at': current_user.created_at.isoformat() if current_user.created_at else None,
        'active': current_user.active,
    }
    subs_list = [sub.as_dict() for sub in subs]
    # Convert datetimes to isoformat for JSON
    for sub in subs_list:
        for k in ['start_date', 'end_date', 'last_payment_date']:
            if sub.get(k):
                sub[k] = sub[k].isoformat()
    return jsonify({
        'user': user_dict,
        'subscriptions': subs_list
    })

if __name__ == "__main__":
    debug_mode = os.environ.get('FLASK_DEBUG', '0') == '1'
    app.run(host="0.0.0.0", port=5000, debug=debug_mode, threaded=True)
