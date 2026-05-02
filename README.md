# Plex Tier Manager

Plex Tier Manager is a web app for running a subscription-based Plex service.

It lets members sign up, log in, and access plans, while giving admins the tools to:
- manage user access and roles
- assign and control subscription tiers
- sync and review Plex user state
- enforce access rules based on active subscriptions

Tautulli is required for usage/monitoring and subscription enforcement workflows.

## Core Features

- Member onboarding: email signup/login and Plex login
- Account management: profile, membership visibility, password update
- Admin dashboard:
  - user management (role, status, plans, password reset, unlink Plex)
  - Plex user visibility and membership status
  - site settings (site title, theme, integration settings)
- Integration settings stored through admin controls

## Project Layout

- backend: Flask API, auth, admin logic, migrations
- frontend: React + TypeScript + Vite SPA
- docker-compose.yml: local stack orchestration

## Quick Start

1. Copy env template:

```bash
cp .env.example .env
```

2. Update required values in .env:
- SECRET_KEY
- Plex and Tautulli settings (can also be configured later in Admin)

3. Start services:

```bash
docker compose up -d --build
```

4. Open the app:
- Frontend: http://localhost:5173
- Backend API: http://localhost:5000

## Configuration Notes

- Environment variables are loaded from the root .env file.
- Do not commit real secrets. Keep only .env.example in source control.
- The compose network is configured as an external network named mediabox.

## Tech Stack

- Frontend: React, TypeScript, Vite, Tailwind CSS
- Backend: Flask, SQLAlchemy, Flask-Login, Flask-WTF
- Integrations: Plex, Tautulli, Stripe (optional for billing workflows)

## Disclaimer

This project manages access and subscription workflows for your Plex environment. You are responsible for complying with Plex terms, local regulations, and any content licensing requirements.
