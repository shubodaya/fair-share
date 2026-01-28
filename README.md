# Fair Share

![Badge](https://img.shields.io/badge/status-live-2ea44f) ![Badge](https://img.shields.io/badge/built_with-React_18-61dafb) ![Badge](https://img.shields.io/badge/deploy-GitHub_Pages-000000)

Live site: https://shubodaya.github.io/fair-share/

![Dashboard](dash.png)

Fair Share is a collaborative expense suite for trips, roommates, teams, and any shared budget. It runs on React + Vite, uses Firebase for auth and data by default, and ships automatically to GitHub Pages.

## Features
- Account options: email/password or Google sign-in, session auto-logout after inactivity, profile editing, password change, dark/light mode.
- Groups & members: create groups with type and currency, track member counts, invite by email, accept/reject invites, and see pending invite metrics.
- Expenses: add/edit/delete expenses with categories, multi-currency amounts, payer selection, dates, notes, and split types (equal/exact/weighted).
- Dashboards & insights: draggable/resizable tiles for spend by period/category/group, monthly tables, top payers, and quick summaries with multi-group totals.
- Data helpers: CSV import (with saved files, currency override, and row counts), dashboard CSV export, search across groups/expenses, and personal notes.
- Activity & audit: real-time feed of group/expense/invite changes, quick clearing, plus Firestore-backed storage for user preferences and dashboard layout.

## Tech Stack
- React 18 + Vite 5 (base path `/fair-share/` for GitHub Pages)
- Firebase (default) for Authentication and Firestore-style data, but you can point the app at any comparable backend you control.
- Styling in `src/index.css`, single-page UI in `src/App.jsx`
- CI/CD: `.github/workflows/pages.yml` builds and deploys `dist` to GitHub Pages on every push to `main`

## Quick Start
- Node 20+ and npm installed.
- Install deps: `npm install`
- If you will connect your own backend (Firebase or similar), copy the env template: `cp .env.example .env` (or PowerShell `Copy-Item .env.example .env`) and add your service keys. If you just want to use the published backend, you can skip this step.
- Run locally: `npm run dev`
- Production build: `npm run build` (preview with `npm run preview`)

## Backend Setup
- Out of the box, the live site already points to a configured backend, so you can use it as-is.
- To run with your own data: set up a hosted database with auth (Firebase is a drop-in choice), enable email/password and Google sign-in, create a database, and copy its client keys into `.env` using the names shown in `.env.example`.
- If you customize Firestore or another backend, adjust `firestore.rules` (or your service rules) to match your security model.

## Deployment (GitHub Pages)
- GitHub Actions workflow `pages.yml` builds the site and publishes `dist` to Pages whenever `main` updates.
- If you use your own backend, add the matching client keys as repo secrets for the workflow. If you rely on the published backend, no extra secrets are needed.
- The Vite `base` is set to `/fair-share/`; keep this if deploying to the same Pages path.

## Project Map
- `src/App.jsx` - application logic, navigation, dashboards, modals, CSV import/export, and Firestore interactions.
- `src/firebase.js` - Firebase initialization (uses `.env` values).
- `src/index.css` - global styles and layout.
- `.github/workflows/pages.yml` - CI/CD to GitHub Pages.
- `firestore.rules` - reference rules for Firestore security.

## Data Model (Firestore)
- `users` - profile data and saved preferences (theme, dashboard layout, imports).
- `groups` - name, type, currency, members, memberUids.
- `expenses` - groupId, category, amount, currency, payer, splitType, timestamps.
- `invites` - group invites with from/to info and status.
- `activity` - audit feed entries tied to memberUids.
- `notes` - personal notes per user.

Fair Share keeps shared spending transparent and fast to reconcile - clone it, point it at your backend (or the published one), and start splitting.
