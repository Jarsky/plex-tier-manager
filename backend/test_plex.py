#!/usr/bin/env python3
import os
from plexapi.myplex import MyPlexAccount

# Test Plex API connection
def test_plex_connection():
    print("Testing Plex API connection...")
    plex_token = os.getenv('PLEX_TOKEN')
    if not plex_token:
        print("❌ PLEX_TOKEN is not set.")
        return False
    
    try:
        # Test basic Plex account connection
        account = MyPlexAccount(token=plex_token)
        print(f"✅ Connected to Plex account: {account.username}")
        print(f"   Email: {account.email}")
        print(f"   ID: {account.id}")
        return True
    except Exception as e:
        print(f"❌ Failed to connect to Plex: {e}")
        return False

if __name__ == "__main__":
    test_plex_connection() 