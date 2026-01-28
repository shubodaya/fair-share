# Fair Share

![Badge](https://img.shields.io/badge/status-live-2ea44f) ![Badge](https://img.shields.io/badge/built_with-React_18-61dafb) ![Badge](https://img.shields.io/badge/deploy-GitHub_Pages-000000)

Live site: https://shubodaya.github.io/fair-share/

![Dashboard](dash.png)

Fair Share is a collaborative expense suite for trips, roommates, teams, and any shared budget. It runs on React + Vite, uses Firebase for auth and data, and ships automatically to GitHub Pages.

## Features
- Account options: email/password or Google sign-in, session auto-logout after inactivity, profile editing, password change, dark/light mode.
- Groups & members: create groups with type and currency, track member counts, invite by email, accept/reject invites, and see pending invite metrics.
- Expenses: add/edit/delete expenses with categories, multi-currency amounts, payer selection, dates, notes, and split types (equal/exact/weighted).
- Dashboards & insights: draggable/resizable tiles for spend by period/category/group, monthly tables, top payers, and quick summaries with multi-group totals.
- Data helpers: CSV import (with saved files, currency override, and row counts), dashboard CSV export, search across groups/expenses, and personal notes.
- Activity & audit: real-time feed of group/expense/invite changes, quick clearing, plus Firestore-backed storage for user preferences and dashboard layout.

## Tech Stack
- React 18 + Vite 5 (base path `/fair-share/` for GitHub Pages)
- Firebase: Authentication and Firestore (groups, expenses, invites, activity, notes, users)
- Styling in `src/index.css`, single-page UI in `src/App.jsx`
- CI/CD: `.github/workflows/pages.yml` builds and deploys `dist` to GitHub Pages on every push to `main`

## Quick Start
- Node 20+ and npm installed.
- Install deps: `npm install`
- Copy env template: `cp .env.example .env` (or PowerShell `Copy-Item .env.example .env`)
- Fill Firebase keys in `.env` (see next section).
- Run locally: `npm run dev`
- Production build: `npm run build` (preview with `npm run preview`)

## Firebase Setup
- Create a Firebase project and enable Authentication providers: Email/Password and Google.
- Create a Firestore database (production or test mode) and note the project ID.
- Populate `.env` with:
  - `VITE_FIREBASE_API_KEY`
  - `VITE_FIREBASE_AUTH_DOMAIN`
  - `VITE_FIREBASE_PROJECT_ID`
  - `VITE_FIREBASE_STORAGE_BUCKET`
  - `VITE_FIREBASE_MESSAGING_SENDER_ID`
  - `VITE_FIREBASE_APP_ID`
  - `VITE_FIREBASE_MEASUREMENT_ID`
- Optional: deploy `firestore.rules` with `firebase deploy --only firestore:rules` after configuring the Firebase CLI.

## Deployment (GitHub Pages)
- GitHub Actions workflow `pages.yml` builds the site and publishes `dist` to Pages whenever `main` updates.
- Required repository secrets: `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_MEASUREMENT_ID`.
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

Fair Share keeps shared spending transparent and fast to reconcile - clone it, drop in your Firebase project keys, and start splitting.
