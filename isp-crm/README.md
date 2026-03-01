# ISP CRM — PostgreSQL Backend Setup Guide
## ReliableSoft Technologies Pvt. Ltd.

---

## 📁 Project Structure

```
isp-crm/
├── backend/
│   ├── src/
│   │   ├── config/
│   │   │   └── database.js          ← pg-pool config, transaction helper
│   │   ├── controllers/
│   │   │   ├── auth.controller.js   ← Login, JWT, refresh tokens
│   │   │   ├── lead.controller.js   ← Full lead lifecycle
│   │   │   └── user.controller.js   ← User CRUD
│   │   ├── middleware/
│   │   │   ├── auth.middleware.js   ← JWT verify + RBAC
│   │   │   ├── audit.middleware.js  ← Auto audit logging
│   │   │   └── error.middleware.js  ← Global error handler
│   │   ├── models/
│   │   │   └── lead.model.js        ← All SQL queries for leads
│   │   ├── routes/
│   │   │   └── index.routes.js      ← All API routes
│   │   ├── utils/
│   │   │   ├── logger.js            ← Winston logger
│   │   │   └── response.js          ← Standardized responses
│   │   └── server.js               ← Express app entry point
│   ├── migrations/
│   │   └── migrate.js              ← DDL: all 15 migrations
│   ├── seeds/
│   │   └── seed.js                 ← Initial data + sample leads
│   ├── .env.example
│   └── package.json
└── frontend/
    └── src/
        └── api.service.js          ← Frontend API client
```

---

## 🗄️ Database Schema

### Tables Created

| Table              | Purpose                                      |
|--------------------|----------------------------------------------|
| `users`            | CRM users with role-based access             |
| `packages`         | Broadband packages (master data)             |
| `areas`            | Service areas (master data)                  |
| `leads`            | Core leads table — full lifecycle            |
| `lead_comments`    | Comments & internal notes per lead           |
| `lead_documents`   | Uploaded files per lead                      |
| `invoices`         | Payment invoices                             |
| `audit_logs`       | Immutable activity log                       |
| `notifications`    | Per-user in-app notifications                |
| `refresh_tokens`   | JWT refresh token store                      |
| `_migrations`      | Migration tracking                           |

### ENUMs
```sql
user_role:          admin | sales | it | installation | accounts
lead_status:        new | feasibility_pending | not_feasible |
                    infrastructure_required | installation_pending |
                    installation_in_progress | installation_failed |
                    payment_pending | payment_partial | activated | closed
lead_priority:      hot | warm | cold
lead_source:        call | website | walkin | referral | advertisement |
                    social_media | field_visit
payment_mode:       upi | cash | bank_transfer | neft_rtgs |
                    cheque | credit_card | demand_draft
```

### PostgreSQL Features Used
- **UUID primary keys** via `uuid-ossp` extension
- **ENUMs** for all categorical fields
- **pg_trgm** extension for fast ILIKE full-text search
- **GIN indexes** on customer_name and address
- **Partial indexes** on status, priority, assigned_to
- **Triggers** for auto `updated_at`, ticket number generation (LD-0001), invoice numbers (INV-0001)
- **Views**: `v_leads_full` (joined), `v_dashboard_stats` (aggregates)
- **Connection pooling** via pg-pool (max 20 connections)
- **Transactions** for atomic multi-table operations
- **JSONB** column for flexible equipment_details storage

---

## 🚀 Installation & Setup

### 1. Prerequisites
```bash
# PostgreSQL 14+
sudo apt install postgresql postgresql-contrib   # Ubuntu/Debian
brew install postgresql                          # macOS

# Node.js 18+
node --version   # Should be >= 18
```

### 2. Create PostgreSQL Database
```bash
# Login to PostgreSQL
sudo -u postgres psql

# Create database and user
CREATE DATABASE isp_crm;
CREATE USER isp_crm_user WITH ENCRYPTED PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE isp_crm TO isp_crm_user;
GRANT ALL ON SCHEMA public TO isp_crm_user;

# Exit
\q
```

### 3. Configure Environment
```bash
cd backend
cp .env.example .env

# Edit .env — fill in your database credentials:
nano .env
```

Required `.env` values:
```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=isp_crm
DB_USER=isp_crm_user
DB_PASSWORD=your_password

JWT_SECRET=change_this_to_a_long_random_string_minimum_32_chars
JWT_REFRESH_SECRET=another_long_random_string_for_refresh_tokens
```

### 4. Install Dependencies
```bash
cd backend
npm install
```

### 5. Run Migrations
```bash
npm run migrate
# Creates all 10 tables, ENUMs, triggers, sequences, views
# Safe to run multiple times
```

### 6. Seed Initial Data
```bash
npm run seed
# Creates packages, areas, users, 7 sample leads, notifications
```

### 7. Start the Server
```bash
# Development (with auto-restart)
npm run dev

# Production
npm start
```

Server starts at: `http://localhost:5000`  
Health check: `http://localhost:5000/api/v1/health`

---

## 🔐 Default Login Credentials

All users seeded with password: **`Password@123`**

| Role         | Email                        |
|--------------|------------------------------|
| Admin        | admin@reliablesoft.in        |
| Sales        | rahul@reliablesoft.in        |
| IT Team      | it@reliablesoft.in           |
| Installation | manoj@reliablesoft.in        |
| Accounts     | accounts@reliablesoft.in     |

**Change all passwords before production deployment!**

---

## 📡 API Reference

### Authentication
```
POST   /api/v1/auth/login              Login → get tokens
POST   /api/v1/auth/refresh            Refresh access token
POST   /api/v1/auth/logout             Logout + revoke refresh token
GET    /api/v1/auth/me                 Current user profile
PATCH  /api/v1/auth/change-password    Change password
```

### Leads
```
GET    /api/v1/leads                   List with pagination + filters
POST   /api/v1/leads                   Create new lead
GET    /api/v1/leads/:id               Get lead + comments + docs
PATCH  /api/v1/leads/:id/feasibility   IT team decision
PATCH  /api/v1/leads/:id/installation  Installation team update
PATCH  /api/v1/leads/:id/payment       Accounts payment verification
PATCH  /api/v1/leads/:id/status        Admin override (any status)
POST   /api/v1/leads/:id/comments      Add comment
GET    /api/v1/leads/:id/documents     List documents
POST   /api/v1/leads/:id/documents     Upload document
GET    /api/v1/leads/dashboard         Role-filtered dashboard stats
GET    /api/v1/leads/reports           Full analytics (admin)
```

### Users (Admin only)
```
GET    /api/v1/users                   List all users
POST   /api/v1/users                   Create user
GET    /api/v1/users/:id               Get user
PATCH  /api/v1/users/:id               Update user
DELETE /api/v1/users/:id               Deactivate user
```

### Other
```
GET    /api/v1/audit                   Audit logs (admin)
GET    /api/v1/notifications           User notifications
PATCH  /api/v1/notifications/read-all  Mark all read
GET    /api/v1/master/packages         Package list
GET    /api/v1/master/areas            Area list
GET    /api/v1/health                  Health + DB status
```

### Query Parameters (GET /leads)
```
status, priority, lead_source, assigned_to, area_id
date_from, date_to, search, page (default:1), limit (default:20)
```

---

## 🔌 Frontend Integration

The `frontend/src/api.service.js` connects your React CRM to the backend:

```javascript
import api from './api.service';

// Login
const { user, accessToken } = await api.auth.login('admin@reliablesoft.in', 'Password@123');

// Get leads
const { data, pagination } = await api.leads.getAll({
  status: 'feasibility_pending',
  page: 1,
  limit: 20
});

// Create lead
const newLead = await api.leads.create({
  lead_source: 'walkin',
  lead_type: 'residential',
  priority: 'hot',
  customer_name: 'John Doe',
  mobile: '9876543210',
  address: '123 Main Street, Sector 7',
  area_id: '<uuid>',
  package_id: '<uuid>',
});

// Feasibility decision
await api.leads.feasibility(leadId, {
  feasibility_status: 'feasible',
  feasibility_notes: 'Fiber available 50m from premises',
});

// Payment verification
await api.leads.payment(leadId, {
  payment_status: 'completed',
  payment_mode: 'upi',
  transaction_id: 'UPI1234567890',
  amount_paid: 1099,
});
```

---

## 🔒 Role-Based Access Matrix

| Endpoint               | Admin | Sales | IT | Install | Accounts |
|------------------------|-------|-------|----|---------|----------|
| GET /leads             | All   | Own   | All| All     | All      |
| POST /leads            | ✅    | ✅    | ❌ | ❌      | ❌       |
| PATCH feasibility      | ✅    | ❌    | ✅ | ❌      | ❌       |
| PATCH installation     | ✅    | ❌    | ❌ | ✅      | ❌       |
| PATCH payment          | ✅    | ❌    | ❌ | ❌      | ✅       |
| PATCH status (override)| ✅    | ❌    | ❌ | ❌      | ❌       |
| GET /users             | ✅    | ❌    | ❌ | ❌      | ❌       |
| GET /audit             | ✅    | ❌    | ❌ | ❌      | ❌       |
| GET /reports           | ✅    | ✅*   | ✅*| ❌      | ✅*      |

---

## 🏭 Production Checklist

```bash
# 1. Change all .env secrets
JWT_SECRET=<64-char random string>
DB_PASSWORD=<strong password>

# 2. Enable SSL for DB
DB_SSL=true

# 3. Set NODE_ENV
NODE_ENV=production

# 4. Use a process manager
npm install -g pm2
pm2 start src/server.js --name isp-crm-api
pm2 startup
pm2 save

# 5. Set up Nginx reverse proxy
# Forward requests from port 80/443 → 5000

# 6. Regular DB backups
pg_dump isp_crm > backup_$(date +%Y%m%d).sql
```
