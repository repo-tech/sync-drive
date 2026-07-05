# Local-First Collaborative Document Editor

A production-ready collaborative document editor built with **Next.js 16**, designed around a **Local-First Architecture** with offline synchronization, deterministic conflict resolution, granular version history, and real-time collaboration.

This project was developed as part of the **House of Edtech Fullstack Developer Assignment (v2.1 - April 2026)**.

---

## 🚀 Features

### ✨ Core Features

- Local-First Document Editing
- Offline Support
- Automatic Background Synchronization
- Deterministic Conflict Resolution
- Real-Time Collaboration
- Granular Version History
- Time Travel & Restore
- Document Roles (Owner / Editor / Viewer)
- Authentication & Authorization
- Secure API Validation
- Responsive UI
- Accessibility Support

---

## 🛠 Tech Stack

### Frontend

- Next.js 16
- React 19
- TypeScript
- Tailwind CSS
- shadcn/ui
- Radix UI

### Backend

- Next.js API Routes
- PostgreSQL
- Prisma ORM

### Authentication

- Auth.js (NextAuth)

### Storage

- PostgreSQL
- Browser Local Storage / IndexedDB (Offline Cache)

### Realtime

- WebSockets / Server Events

### AI Features

- OpenAI / Gemini Integration *(Optional Add-ons)*

### Deployment

- Vercel

---

# Project Structure

```
app/
components/
hooks/
lib/
prisma/
public/
services/
store/
types/
utils/
```

---

# Getting Started

## Prerequisites

- Node.js 22+
- PostgreSQL
- npm / pnpm / yarn

---

## Installation

Clone the repository

```bash
git clone <repository-url>

cd project-name
```

Install dependencies

```bash
npm install
```

Create environment variables

```bash
cp .env.example .env
```

Configure your environment variables.

Example

```env
DATABASE_URL=

AUTH_SECRET=

AUTH_URL=

OPENAI_API_KEY=

NEXT_PUBLIC_APP_URL=
```

Run database migrations

```bash
npx prisma migrate dev
```

Generate Prisma Client

```bash
npx prisma generate
```

---

# Run Development Server

```bash
npm run dev
```

Visit

```
http://localhost:3000
```

---

# Available Scripts

```bash
npm run dev
```

Starts the development server.

```bash
npm run build
```

Creates a production build.

```bash
npm run start
```

Starts the production server.

```bash
npm run lint
```

Runs ESLint.

---

# Architecture Highlights

## Local-First Design

- Client storage is the primary source of truth.
- Users can create and edit documents completely offline.
- No network request blocks the user interface.

---

## Background Sync Engine

- Queues offline operations.
- Automatically syncs when the connection is restored.
- Prevents overwriting offline changes.

---

## Conflict Resolution

- Deterministic merge strategy.
- Prevents data loss during concurrent edits.
- Ensures consistent document state across collaborators.

---

## Version History

- Snapshot-based versioning.
- Timeline navigation.
- Safe restoration of previous document versions.

---

## Security

- Authentication using Auth.js
- Role-Based Access Control
- Payload Validation
- Protected API Routes
- PostgreSQL Row-Level Security (RLS)
- Tenant Isolation
- Rate Limiting
- Input Sanitization

---

# User Roles

| Role | Permissions |
|------|-------------|
| Owner | Full Access |
| Editor | Edit Documents |
| Viewer | Read-Only Access |

---

# Performance Optimizations

- Server Components
- Route-based Code Splitting
- Lazy Loading
- Optimized Database Queries
- Incremental Rendering
- Client-side Caching
- Background Synchronization Queue

---

# Testing

The project supports

- Unit Testing
- Integration Testing
- End-to-End Testing

---

# Deployment

This application can be deployed on

- Vercel
- Netlify
- Railway
- Render

---

# Future Improvements

- CRDT-based synchronization
- AI-powered writing assistant
- Rich text formatting
- Comments & mentions
- Document sharing
- Presence indicators
- Notifications
- Mobile support

---

# Assignment Requirements Covered

- ✅ Next.js 16
- ✅ TypeScript
- ✅ PostgreSQL
- ✅ Local-First Architecture
- ✅ Offline Editing
- ✅ Background Sync
- ✅ Conflict Resolution
- ✅ Version History
- ✅ Authentication
- ✅ Authorization
- ✅ Role-Based Access
- ✅ Secure APIs
- ✅ Responsive UI
- ✅ Accessibility
- ✅ Deployment Ready

---

# Author

**Himanshu Gupta**

- GitHub: https://github.com/repo-tech

---

# License

This project was developed for the **House of Edtech Fullstack Developer Assignment** and is intended for evaluation purposes.