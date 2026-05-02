#!/usr/bin/env python3
import sqlite3
import os
from werkzeug.security import generate_password_hash

# Check if we're in Docker or local
db_path = '/app/instance/app.db' if os.path.exists('/app/instance/app.db') else './data/app.db'

print(f"Checking database at: {db_path}")

if not os.path.exists(db_path):
    print("Database file not found!")
    exit(1)

def create_admin_user(email, password):
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        # Check if user exists
        cursor.execute("SELECT id FROM user WHERE email=?", (email,))
        if cursor.fetchone():
            print(f"Admin user {email} already exists.")
            return
        # Insert admin user
        password_hash = generate_password_hash(password)
        cursor.execute("INSERT INTO user (email, password_hash, role) VALUES (?, ?, 0)", (email, password_hash))
        conn.commit()
        print(f"Admin user {email} created.")
        conn.close()
    except Exception as e:
        print(f"Error creating admin user: {e}")

# Optionally create an admin user via environment variables.
# Example: ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=strongpass python3 check_db.py
admin_email = os.getenv('ADMIN_EMAIL')
admin_password = os.getenv('ADMIN_PASSWORD')
if admin_email and admin_password:
    create_admin_user(admin_email, admin_password)

try:
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Show tables
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
    tables = cursor.fetchall()
    print(f"Tables: {[table[0] for table in tables]}")
    
    # Show users
    if ('user',) in tables:
        cursor.execute("SELECT id, email, plex_id, username, role, created_at FROM user;")
        users = cursor.fetchall()
        print(f"\nUsers ({len(users)} total):")
        for user in users:
            print(f"  ID: {user[0]}, Email: {user[1]}, Plex ID: {user[2]}, Username: {user[3]}, Role: {user[4]}, Created: {user[5]}")
    
    # Show subscriptions
    if ('subscription',) in tables:
        cursor.execute("SELECT id, user_id, tier, active, start_date FROM subscription;")
        subs = cursor.fetchall()
        print(f"\nSubscriptions ({len(subs)} total):")
        for sub in subs:
            print(f"  ID: {sub[0]}, User ID: {sub[1]}, Tier: {sub[2]}, Active: {sub[3]}, Start: {sub[4]}")
    
    # Show audit logs
    if ('audit_log',) in tables:
        cursor.execute("SELECT id, admin_id, action, timestamp, details FROM audit_log ORDER BY timestamp DESC LIMIT 10;")
        logs = cursor.fetchall()
        print(f"\nRecent Audit Logs ({len(logs)} total):")
        for log in logs:
            print(f"  ID: {log[0]}, Admin ID: {log[1]}, Action: {log[2]}, Time: {log[3]}, Details: {log[4]}")
    
    conn.close()
    
except Exception as e:
    print(f"Error reading database: {e}") 