/**
 * seed.js
 * Seeds the database with initial master data, users, and sample leads.
 * Safe to re-run — uses INSERT ... ON CONFLICT DO NOTHING.
 *
 * Run: node seeds/seed.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const bcrypt = require('bcryptjs');
const { pool, withTransaction } = require('../src/config/database');
const logger = require('../src/utils/logger');

async function seed() {
  logger.info('🌱 Starting database seed...');

  await withTransaction(async (client) => {

    // ── 1. Packages ─────────────────────────────────────────────────────────
    logger.info('  Seeding packages...');
    const packages = [
      { name: 'Starter 30 Mbps',   speed: 30,   price: 399,  setup: 500  },
      { name: 'Home 100 Mbps',     speed: 100,  price: 699,  setup: 500  },
      { name: 'Pro 200 Mbps',      speed: 200,  price: 1099, setup: 500  },
      { name: 'Ultra 500 Mbps',    speed: 500,  price: 1799, setup: 1000 },
      { name: 'Giga 1 Gbps',       speed: 1000, price: 2999, setup: 1000 },
      { name: 'Business 2 Gbps',   speed: 2000, price: 4999, setup: 2000 },
    ];
    const pkgIds = {};
    for (const pkg of packages) {
      const res = await client.query(`
        INSERT INTO packages (name, speed_mbps, monthly_price, setup_fee, is_active)
        VALUES ($1, $2, $3, $4, TRUE)
        ON CONFLICT (name) DO UPDATE SET monthly_price = EXCLUDED.monthly_price
        RETURNING id, name
      `, [pkg.name, pkg.speed, pkg.price, pkg.setup]);
      pkgIds[pkg.name] = res.rows[0].id;
    }
    logger.info(`    → ${packages.length} packages`);

    // ── 2. Areas ─────────────────────────────────────────────────────────────
    logger.info('  Seeding areas...');
    const areas = [
      { name: 'Sector 7',       city: 'Delhi',     pincode: '110001' },
      { name: 'Laxmi Nagar',    city: 'Delhi',     pincode: '110092' },
      { name: 'Andheri West',   city: 'Mumbai',    pincode: '400053' },
      { name: 'Salt Lake',      city: 'Kolkata',   pincode: '700091' },
      { name: 'Koramangala',    city: 'Bengaluru', pincode: '560034' },
      { name: 'Banjara Hills',  city: 'Hyderabad', pincode: '500034' },
      { name: 'Connaught Place',city: 'Delhi',     pincode: '110001' },
    ];
    const areaIds = {};
    for (const area of areas) {
      const res = await client.query(`
        INSERT INTO areas (name, city, pincode, is_serviceable)
        VALUES ($1, $2, $3, TRUE)
        ON CONFLICT (name) DO UPDATE SET city = EXCLUDED.city
        RETURNING id, name
      `, [area.name, area.city, area.pincode]);
      areaIds[area.name] = res.rows[0].id;
    }
    logger.info(`    → ${areas.length} areas`);

    // ── 3. Users ─────────────────────────────────────────────────────────────
    logger.info('  Seeding users...');
    const defaultPassword = await bcrypt.hash('Password@123', 12);
    const usersData = [
      { emp: 'EMP-001', name: 'Admin User',    email: 'admin@reliablesoft.in',    role: 'admin',        phone: '9900000001' },
      { emp: 'EMP-002', name: 'Rahul Verma',   email: 'rahul@reliablesoft.in',    role: 'sales',        phone: '9900000002' },
      { emp: 'EMP-003', name: 'Sneha Kapoor',  email: 'sneha@reliablesoft.in',    role: 'sales',        phone: '9900000003' },
      { emp: 'EMP-004', name: 'Ajay Tiwari',   email: 'ajay@reliablesoft.in',     role: 'sales',        phone: '9900000004' },
      { emp: 'EMP-005', name: 'Nidhi Joshi',   email: 'nidhi@reliablesoft.in',    role: 'sales',        phone: '9900000005' },
      { emp: 'EMP-006', name: 'IT Team Lead',  email: 'it@reliablesoft.in',       role: 'it',           phone: '9900000006' },
      { emp: 'EMP-007', name: 'Manoj Kumar',   email: 'manoj@reliablesoft.in',    role: 'installation', phone: '9900000007' },
      { emp: 'EMP-008', name: 'Field Alpha',   email: 'alpha@reliablesoft.in',    role: 'installation', phone: '9900000008' },
      { emp: 'EMP-009', name: 'Accounts Mgr',  email: 'accounts@reliablesoft.in', role: 'accounts',     phone: '9900000009' },
    ];
    const userIds = {};
    for (const u of usersData) {
      const res = await client.query(`
        INSERT INTO users (employee_id, name, email, password_hash, role, phone)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
        RETURNING id, name
      `, [u.emp, u.name, u.email, defaultPassword, u.role, u.phone]);
      userIds[u.name] = res.rows[0].id;
    }
    logger.info(`    → ${usersData.length} users (default password: Password@123)`);

    // ── 4. Sample Leads ───────────────────────────────────────────────────────
    logger.info('  Seeding sample leads...');
    const sampleLeads = [
      {
        source: 'referral',  type: 'residential', priority: 'hot',
        name: 'Arjun Mehta',   mobile: '9876543210', email: 'arjun@email.com',
        address: '12 MG Road, Sector 7', area: 'Sector 7',
        pkg: 'Pro 200 Mbps', salesperson: 'Rahul Verma',
        status: 'activated',
        feas_status: 'feasible', feas_notes: 'Fiber available 60m',
        inst_status: 'installed', inst_notes: 'ONT placed, speed test 195/198 Mbps',
        pay_status: 'completed', pay_mode: 'upi', txn_id: 'UPI4455667',
      },
      {
        source: 'website', type: 'residential', priority: 'warm',
        name: 'Priya Sharma', mobile: '9812345678', email: 'priya@email.com',
        address: 'B-45 Laxmi Nagar', area: 'Laxmi Nagar',
        pkg: 'Home 100 Mbps', salesperson: 'Sneha Kapoor',
        status: 'installation_pending',
        feas_status: 'feasible', feas_notes: 'Good coverage area',
        inst_status: 'pending', inst_notes: null,
        pay_status: 'pending', pay_mode: null, txn_id: null,
      },
      {
        source: 'walkin', type: 'residential', priority: 'cold',
        name: 'Suresh Patel', mobile: '9900112233', email: null,
        address: '7 Gandhi Colony, Salt Lake', area: 'Salt Lake',
        pkg: 'Starter 30 Mbps', salesperson: 'Ajay Tiwari',
        status: 'feasibility_pending',
        feas_status: 'pending', feas_notes: null,
        inst_status: 'pending', inst_notes: null,
        pay_status: 'pending', pay_mode: null, txn_id: null,
      },
      {
        source: 'call', type: 'residential', priority: 'hot',
        name: 'Deepa Nair', mobile: '9871234567', email: 'deepa@email.com',
        address: 'Flat 302, Silver Oak Apts', area: 'Koramangala',
        pkg: 'Ultra 500 Mbps', salesperson: 'Sneha Kapoor',
        status: 'payment_pending',
        feas_status: 'feasible', feas_notes: 'Ready to proceed',
        inst_status: 'installed', inst_notes: 'Done, tested OK',
        pay_status: 'pending', pay_mode: null, txn_id: null,
      },
      {
        source: 'advertisement', type: 'residential', priority: 'cold',
        name: 'Kiran Rao', mobile: '9988776655', email: null,
        address: 'Plot 9, New Town', area: 'Banjara Hills',
        pkg: 'Home 100 Mbps', salesperson: 'Rahul Verma',
        status: 'not_feasible',
        feas_status: 'not_feasible', feas_notes: 'No fiber in zone, 2km gap',
        inst_status: 'pending', inst_notes: null,
        pay_status: 'pending', pay_mode: null, txn_id: null,
      },
      {
        source: 'social_media', type: 'commercial', priority: 'hot',
        name: 'Aarav Joshi', mobile: '9001234567', email: 'aarav@email.com',
        address: 'C-12 Andheri West', area: 'Andheri West',
        pkg: 'Giga 1 Gbps', salesperson: 'Nidhi Joshi',
        status: 'new',
        feas_status: 'pending', feas_notes: null,
        inst_status: 'pending', inst_notes: null,
        pay_status: 'pending', pay_mode: null, txn_id: null,
      },
      {
        source: 'field_visit', type: 'enterprise', priority: 'hot',
        name: 'Sunita Verma', mobile: '9765432109', email: 'sunita@email.com',
        address: '45 Park Avenue, Sector 7', area: 'Sector 7',
        pkg: 'Business 2 Gbps', salesperson: 'Rahul Verma',
        status: 'activated',
        feas_status: 'feasible', feas_notes: 'Enterprise zone',
        inst_status: 'installed', inst_notes: 'Rack mounted, all OK',
        pay_status: 'completed', pay_mode: 'bank_transfer', txn_id: 'NEFT8899001',
      },
    ];

    const adminId     = userIds['Admin User'];
    const itId        = userIds['IT Team Lead'];
    const manoId      = userIds['Manoj Kumar'];
    const accountsId  = userIds['Accounts Mgr'];

    for (const l of sampleLeads) {
      const pkg   = pkgIds[l.pkg];
      const area  = areaIds[l.area];
      const sales = userIds[l.salesperson];
      const price = { 'Starter 30 Mbps':399,'Home 100 Mbps':699,'Pro 200 Mbps':1099,'Ultra 500 Mbps':1799,'Giga 1 Gbps':2999,'Business 2 Gbps':4999 }[l.pkg] || 0;

      const res = await client.query(`
        INSERT INTO leads (
          lead_source, lead_type, priority,
          customer_name, mobile, email,
          address, area_id, package_id,
          assigned_to, status,
          feasibility_status, feasibility_notes,
          feasibility_by, feasibility_at,
          installation_status, installation_notes,
          installation_by, installation_date,
          payment_status, payment_mode, transaction_id,
          amount_due, amount_paid,
          payment_verified_by, payment_verified_at,
          activated_at, activated_by
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
          $12,$13,
          $14, CASE WHEN $12 != 'pending' THEN NOW() - interval '10 days' ELSE NULL END,
          $15,$16,
          $17, CASE WHEN $15 = 'installed' THEN NOW() - interval '5 days' ELSE NULL END,
          $18,$19,$20,
          $21,$22,
          $23, CASE WHEN $18 = 'completed' THEN NOW() - interval '3 days' ELSE NULL END,
          CASE WHEN $11 = 'activated' THEN NOW() - interval '2 days' ELSE NULL END,
          CASE WHEN $11 = 'activated' THEN $24 ELSE NULL END
        )
        ON CONFLICT DO NOTHING
        RETURNING id, ticket_number
      `, [
        l.source, l.type, l.priority,
        l.name, l.mobile, l.email,
        l.address, area, pkg,
        sales, l.status,
        l.feas_status, l.feas_notes,
        l.feas_status !== 'pending' ? itId : null,
        l.inst_status, l.inst_notes,
        l.inst_status === 'installed' ? manoId : null,
        l.pay_status, l.pay_mode, l.txn_id,
        price,
        l.pay_status === 'completed' ? price : 0,
        l.pay_status === 'completed' ? accountsId : null,
        adminId,
      ]);

      if (res.rows.length > 0) {
        const leadId = res.rows[0].id;
        // Seed a comment
        await client.query(`
          INSERT INTO lead_comments (lead_id, user_id, comment)
          VALUES ($1, $2, $3)
        `, [leadId, sales, `Lead created for ${l.name} — ${l.pkg}`]);

        // Seed audit log
        await client.query(`
          INSERT INTO audit_logs (user_id, user_role, action, entity_type, entity_id, new_values, ip_address)
          VALUES ($1, 'sales', 'lead.created', 'lead', $2, $3, '127.0.0.1')
        `, [sales, leadId, JSON.stringify({ status: l.status, customer: l.name })]);

        // Seed invoice for activated leads
        if (l.status === 'activated') {
          await client.query(`
            INSERT INTO invoices (lead_id, amount, tax_amount, discount, total_amount,
              payment_mode, transaction_id, payment_status, paid_at, generated_by)
            VALUES ($1,$2,$3,$4,$5,$6,$7,'completed',NOW() - interval '2 days',$8)
          `, [leadId, price, 0, 0, price, l.pay_mode, l.txn_id, accountsId]);
        }
      }
    }
    logger.info(`    → ${sampleLeads.length} sample leads`);

    // ── 5. Sample Notifications ───────────────────────────────────────────────
    logger.info('  Seeding notifications...');
    await client.query(`
      INSERT INTO notifications (user_id, title, message, type)
      VALUES
        ($1, 'Payment Pending', 'LD-0004 awaiting payment verification', 'warning'),
        ($1, 'New Lead Assigned', 'LD-0006 assigned to your queue', 'info'),
        ($1, 'Feasibility Required', 'LD-0003 pending your review', 'info')
      ON CONFLICT DO NOTHING
    `, [adminId]);
    logger.info('    → 3 notifications');

  });

  logger.info('✅ Seed completed successfully');
  await pool.end();
}

seed().catch((err) => {
  logger.error('❌ Seed failed', { error: err.message, stack: err.stack });
  process.exit(1);
});
