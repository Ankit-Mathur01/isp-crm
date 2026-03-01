// seeds/run.js — Sample data seeder
require('dotenv').config();
const { pool, withTransaction } = require('../src/config/database');
const bcrypt = require('bcryptjs');

async function seed() {
  console.log('🌱 Seeding ISP CRM database...\n');

  await withTransaction(async (client) => {
    // ── Users
    const adminHash = await bcrypt.hash('Admin@1234', 12);
    const agentHash = await bcrypt.hash('Agent@1234', 12);

    await client.query(`
      INSERT INTO users (email, password_hash, full_name, phone, role) VALUES
        ('admin@ispcm.com',  $1, 'Admin User',    '+1-555-0001', 'admin'),
        ('manager@ispcm.com',$1, 'Jane Manager',  '+1-555-0002', 'manager'),
        ('agent1@ispcm.com', $2, 'Alice Agent',   '+1-555-0011', 'agent'),
        ('agent2@ispcm.com', $2, 'Bob Agent',     '+1-555-0012', 'agent')
      ON CONFLICT (email) DO NOTHING
    `, [adminHash, agentHash]);

    // ── Packages
    await client.query(`
      INSERT INTO packages (name, description, speed_mbps, price_monthly) VALUES
        ('Basic',      '10 Mbps broadband plan',   10,  29.99),
        ('Standard',   '50 Mbps broadband plan',   50,  49.99),
        ('Premium',    '100 Mbps broadband plan', 100,  79.99),
        ('Business',   '500 Mbps business plan',  500, 149.99),
        ('Enterprise', '1 Gbps dedicated fiber', 1000, 299.99)
      ON CONFLICT DO NOTHING
    `);

    // ── Get IDs for FK references
    const agents   = await client.query("SELECT id FROM users WHERE role = 'agent' LIMIT 2");
    const packages = await client.query("SELECT id FROM packages LIMIT 5");
    const a1 = agents.rows[0]?.id;
    const a2 = agents.rows[1]?.id;
    const p1 = packages.rows[0]?.id;
    const p2 = packages.rows[1]?.id;
    const p3 = packages.rows[2]?.id;

    if (!a1) { console.log('  ⚠  No agents found, skipping leads'); return; }

    // ── Sample Leads
    await client.query(`
      INSERT INTO leads (full_name, email, phone, city, status, source, priority, assigned_to, package_id, score, expected_value) VALUES
        ('John Smith',    'john@example.com',   '+1-555-1001', 'Austin',    'new',         'website',  'high',   $1, $3, 65,  799.99),
        ('Sarah Connor',  'sarah@example.com',  '+1-555-1002', 'Dallas',    'contacted',   'referral', 'urgent', $1, $4, 80, 1199.99),
        ('Mike Johnson',  'mike@example.com',   '+1-555-1003', 'Houston',   'qualified',   'cold_call','medium', $2, $3, 55,  959.88),
        ('Lisa Brown',    'lisa@example.com',   '+1-555-1004', 'Phoenix',   'proposal',    'social',   'high',   $2, $5, 75, 2399.88),
        ('Tom Wilson',    'tom@example.com',    '+1-555-1005', 'Austin',    'negotiation', 'email',    'high',   $1, $4, 90,  599.88),
        ('Emma Davis',    'emma@example.com',   '+1-555-1006', 'San Jose',  'won',         'referral', 'medium', $2, $5, 100, 3599.88),
        ('James Miller',  'james@example.com',  '+1-555-1007', 'Denver',    'lost',        'website',  'low',    $1, $3, 10,  0),
        ('Amy Wilson',    'amy@example.com',    '+1-555-1008', 'Seattle',   'new',         'event',    'medium', $2, $4, 40,  599.88)
      ON CONFLICT DO NOTHING
    `, [a1, a2, p1, p2, p3]);

    // ── Call scripts
    await client.query(`
      INSERT INTO v2_call_scripts (name, content, is_active)
      VALUES
        ('Cold Call Opener',
         'Hi, this is [Name] from [Company]. I''m reaching out because we offer high-speed fiber internet plans starting at just $29.99/month. Do you have a few minutes to discuss how we could improve your internet experience?',
         true),
        ('Follow-up Script',
         'Hi [Lead Name], this is [Name] following up on our previous conversation about upgrading your internet. I wanted to check if you had any questions about the [Package] plan we discussed.',
         true),
        ('Closing Script',
         'Based on everything we''ve discussed, I think the [Package] plan at $[Price]/month would be perfect for your needs. Can we go ahead and get you set up today?',
         true)
      ON CONFLICT DO NOTHING
    `);

    // ── Commission rule
    await client.query(`
      INSERT INTO v2_commission_rules (name, applies_to_role, rate_type, rate, min_payment, is_active)
      VALUES ('Standard Agent Commission', 'agent', 'percentage', 8.5, 30, true)
      ON CONFLICT DO NOTHING
    `);

    console.log('  ✅ Users seeded (admin@ispcm.com / Admin@1234)');
    console.log('  ✅ Packages seeded (5 plans)');
    console.log('  ✅ Leads seeded (8 sample leads)');
    console.log('  ✅ Call scripts seeded');
    console.log('  ✅ Commission rules seeded');
  });

  console.log('\n✨ Seed complete!\n');
  console.log('Default credentials:');
  console.log('  Admin:   admin@ispcm.com   / Admin@1234');
  console.log('  Manager: manager@ispcm.com / Admin@1234');
  console.log('  Agent 1: agent1@ispcm.com  / Agent@1234');
  console.log('  Agent 2: agent2@ispcm.com  / Agent@1234');

  await pool.end();
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
