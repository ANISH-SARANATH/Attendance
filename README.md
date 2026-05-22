# Attendance Web App (React + Node)

## Stack
- Frontend: React + TypeScript + Vite
- Backend: Node.js + Express
- Database: MongoDB Atlas

## Roles
- Volunteer login password comes from `server/.env` as `VOLUNTEER_PASSWORD`.
- Admin page URL: `/admin`
  - password comes from `server/.env` as `ADMIN_PASSWORD`.

## Setup

### 1) Backend
```bash
cd server
npm install
npm run dev
```

Keep `HOST=0.0.0.0` in `server/.env` if the backend should accept connections from other devices/networks. To use the same MongoDB Atlas database from any IP, add `0.0.0.0/0` in Atlas Network Access.

Google Sheets live sync reads `GOOGLE_*` settings from `server/.env`. Share the sheet with the service account email, then set either `GOOGLE_SERVICE_ACCOUNT_JSON` or `GOOGLE_SERVICE_ACCOUNT_EMAIL` plus `GOOGLE_PRIVATE_KEY`. Failed sheet writes are queued in `server/data/sheet-sync-queue.json` and can be retried from the backend route.

### 2) Frontend
```bash
cd client
copy .env.example .env
npm install
npm run dev
```

Frontend runs on Vite and calls backend via `VITE_API_URL`. Leave `VITE_API_URL` blank to auto-use the same host as the browser with backend port `4000`.

## Features
- QR scan on volunteer page
- Decodes QR payload and stores attendance in MongoDB
- Student and faculty stored separately:
  - `StudentAttendance` collection
  - `FacultyAttendance` collection
- Admin page to view both datasets
- CSV download:
  - students
  - faculty
  - all
