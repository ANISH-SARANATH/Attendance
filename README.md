# Attendance Web App (React + Node)

## Stack
- Frontend: React + TypeScript + Vite
- Backend: Node.js + Express
- Database: MongoDB Atlas

## Roles
- Volunteer login:
  - username: `volunteer`
  - password: `VolunteerSigmod`
- Admin page URL: `/admin`
  - password: `271939`

## Setup

### 1) Backend
```bash
cd server
copy .env.example .env
npm install
npm run dev
```

### 2) Frontend
```bash
cd client
copy .env.example .env
npm install
npm run dev
```

Frontend runs on Vite default URL and calls backend via `VITE_API_URL`.

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
