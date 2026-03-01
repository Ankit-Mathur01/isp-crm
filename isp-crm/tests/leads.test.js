// tests/leads.test.js
const request = require('supertest');
const app     = require('../src/server');

// Note: These tests require a running PostgreSQL instance with test DB configured
// Run: NODE_ENV=test npm test

let authToken;

beforeAll(async () => {
  // Login to get auth token
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: 'admin@ispcm.com', password: 'Admin@1234' });
  
  authToken = res.body.data?.token;
});

describe('Auth', () => {
  test('POST /api/auth/login — valid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@ispcm.com', password: 'Admin@1234' });
    
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBeDefined();
  });

  test('POST /api/auth/login — invalid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@ispcm.com', password: 'wrongpassword' });
    
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  test('GET /api/auth/me — returns current user', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${authToken}`);
    
    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe('admin@ispcm.com');
  });
});

describe('Leads', () => {
  let createdLeadId;

  test('GET /api/leads — returns paginated list', async () => {
    const res = await request(app)
      .get('/api/leads')
      .set('Authorization', `Bearer ${authToken}`);
    
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.pagination).toBeDefined();
  });

  test('POST /api/leads — creates a lead', async () => {
    const res = await request(app)
      .post('/api/leads')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        full_name: 'Test Lead',
        phone:     '+1-555-9999',
        email:     'test.lead@example.com',
        source:    'website',
        priority:  'medium',
      });
    
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.full_name).toBe('Test Lead');
    createdLeadId = res.body.data.id;
  });

  test('GET /api/leads/:id — returns lead detail', async () => {
    if (!createdLeadId) return;
    const res = await request(app)
      .get(`/api/leads/${createdLeadId}`)
      .set('Authorization', `Bearer ${authToken}`);
    
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(createdLeadId);
  });

  test('GET /api/leads/pipeline — returns pipeline summary', async () => {
    const res = await request(app)
      .get('/api/leads/pipeline')
      .set('Authorization', `Bearer ${authToken}`);
    
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('DELETE /api/leads/:id — deletes lead', async () => {
    if (!createdLeadId) return;
    const res = await request(app)
      .delete(`/api/leads/${createdLeadId}`)
      .set('Authorization', `Bearer ${authToken}`);
    
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('Health', () => {
  test('GET /api/health — returns healthy', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
