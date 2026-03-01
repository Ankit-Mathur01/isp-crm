# NetFlow CRM — ISP Management Frontend

A complete, production-ready React + Vite frontend for ISP CRM software.

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

Open http://localhost:5173 in your browser.

**Demo Login:** Any email & password (e.g. `admin@ispcrm.in` / `password`)

---

## 📁 Folder Structure

```
src/
├── components/
│   ├── layout/
│   │   ├── AppLayout.jsx     # Main layout with sidebar
│   │   ├── Header.jsx        # Top header bar
│   │   └── Sidebar.jsx       # Left navigation sidebar
│   └── ui/
│       └── index.jsx         # Reusable UI components (Badge, Modal, etc.)
├── context/
│   └── AuthContext.jsx       # Authentication state management
├── data/
│   └── dummy.js              # All dummy data for the app
├── pages/
│   ├── auth/
│   │   ├── Login.jsx
│   │   └── ForgotPassword.jsx
│   ├── dashboard/
│   │   └── Dashboard.jsx
│   ├── leads/
│   │   └── Leads.jsx
│   ├── subscribers/
│   │   └── Subscribers.jsx
│   ├── payments/
│   │   └── Payments.jsx
│   └── master/
│       ├── PlanMaster.jsx
│       ├── FranchiseMaster.jsx
│       ├── EmployeeMaster.jsx
│       └── LeadStatusMaster.jsx
├── App.jsx
├── main.jsx
└── index.css
```

## 🎨 Tech Stack

- **React 18** + **Vite 5**
- **Tailwind CSS 3** — utility-first styling
- **React Router v6** — client-side routing
- **Recharts** — revenue & subscriber charts
- **Lucide React** — icon library
- **date-fns** — date formatting

## 📄 Pages

| Page | Route |
|------|-------|
| Login | `/login` |
| Forgot Password | `/forgot-password` |
| Dashboard | `/dashboard` |
| Lead Management | `/leads` |
| Subscribers | `/subscribers` |
| Payments | `/payments` |
| Plan Master | `/master/plans` |
| Franchise Master | `/master/franchises` |
| Employee Master | `/master/employees` |
| Lead Status Master | `/master/lead-status` |

## 🔌 Connecting to Backend

To connect to your PostgreSQL backend, update API calls in each page to replace the dummy data operations with actual `fetch()` or `axios` calls to your Express API.

Example:
```js
// Replace dummy data
const [leads, setLeads] = useState(leadsData)

// With API call
const [leads, setLeads] = useState([])
useEffect(() => {
  fetch('/api/leads', { headers: { Authorization: `Bearer ${token}` } })
    .then(r => r.json())
    .then(data => setLeads(data.leads))
}, [])
```
