import request from 'supertest';
import { app } from '../../src/index';
import { prisma } from '../../src/prisma';
import { createTestUser, createTestInviteCode } from '../helpers/factories';
import { truncateAllTables, seedMinimalData } from '../helpers/dbHelpers';

describe('Auth Integration — Full HTTP Flow', () => {
  beforeAll(async () => {
    process.env.ALPHA_INVITE_ONLY = 'true';
    await truncateAllTables();
    await seedMinimalData();
  });

  afterAll(async () => {
    await truncateAllTables();
  });

  it('should register a new user and return 201 when given a valid unused invite code', async () => {
    const invite = await createTestInviteCode({ code: 'VALID_CODE_001', used: false });
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'alice@test.com',
        username: 'alice',
        password: 'SecurePass1!',
        inviteCode: invite.code,
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('message');

    const dbUser = await prisma.user.findUnique({ where: { email: 'alice@test.com' } });
    expect(dbUser).not.toBeNull();
    expect(dbUser?.emailVerified).toBe(false);
  });

  it('should return 400 or 403 when registering with an already-used invite code', async () => {
    const invite = await createTestInviteCode({ code: 'USED_CODE_001', used: true });
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'bob@test.com',
        username: 'bob',
        password: 'SecurePass1!',
        inviteCode: invite.code,
      });

    expect([400, 403]).toContain(res.status);
    expect(res.body.error).toMatch(/invite/i);
  });

  it('should return 409 when registering with an email that already exists', async () => {
    await createTestUser({ email: 'existing@test.com' });
    const invite = await createTestInviteCode({ code: 'FRESH_CODE_001', used: false });

    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'existing@test.com',
        username: 'newuser',
        password: 'SecurePass1!',
        inviteCode: invite.code,
      });

    expect(res.status).toBe(409);
  });

  it('should verify email and return 200 when given a valid verification token', async () => {
    const user = await createTestUser({
      email: 'verify@test.com',
      emailVerified: false,
      emailVerifyToken: 'tok_abc123456789',
    });

    const res = await request(app).get('/api/auth/verify?token=tok_abc123456789');
    expect([200, 302]).toContain(res.status); // Accepts 200 or redirect to login

    const updated = await prisma.user.findUnique({ where: { id: user.id } });
    expect(updated?.emailVerified).toBe(true);
  });

  it('should return 200 with accessToken and set httpOnly refresh cookie on valid login', async () => {
    await createTestUser({ email: 'login@test.com', password: 'SecurePass1!', emailVerified: true });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'login@test.com', password: 'SecurePass1!' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('accessToken');

    const cookies = res.headers['set-cookie'] as unknown as string[] | undefined;
    expect(cookies).toBeDefined();
    expect(cookies?.some((c) => c.includes('refreshToken') && c.includes('HttpOnly'))).toBe(true);
  });

  it('should return 401 when login is attempted with an incorrect password', async () => {
    await createTestUser({ email: 'wrongpass@test.com', emailVerified: true });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'wrongpass@test.com', password: 'WrongPassword!' });

    expect(res.status).toBe(401);
  });

  it('should return 403 when a user with an unverified email attempts to login', async () => {
    await createTestUser({ email: 'unverified@test.com', emailVerified: false });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'unverified@test.com', password: 'SecurePass1!' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/verif/i);
  });

  it('should issue a new accessToken when a valid refresh cookie is provided', async () => {
    await createTestUser({ email: 'refresh@test.com', emailVerified: true });

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'refresh@test.com', password: 'SecurePass1!' });

    const cookies = loginRes.headers['set-cookie'];

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', cookies);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('accessToken');
  });

  it('should return 401 when the refresh token cookie has expired or is invalid', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', ['refreshToken=invalid.token.here; HttpOnly']);

    expect(res.status).toBe(401);
  });

  it('should clear the refresh cookie on logout', async () => {
    await createTestUser({ email: 'logout@test.com', emailVerified: true });

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'logout@test.com', password: 'SecurePass1!' });

    // Extract CSRF token from login response cookies (login sets csrf_token cookie)
    const loginCookies = loginRes.headers['set-cookie'] as unknown as string[] | undefined;
    const csrfCookie = loginCookies?.find((c) => c.startsWith('csrf_token='));
    const csrfToken = csrfCookie ? csrfCookie.split(';')[0].split('=')[1] : '';

    const res = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', loginCookies || [])
      .set('X-CSRF-Token', csrfToken);

    expect(res.status).toBe(200);
    const setCookieHeader = res.headers['set-cookie'] as unknown as string[] | undefined;
    expect(setCookieHeader).toBeDefined();
    expect(
      setCookieHeader?.some(
        (c) => c.includes('refreshToken') && (c.includes('Max-Age=0') || c.includes('Expires='))
      )
    ).toBe(true);
  });
});
