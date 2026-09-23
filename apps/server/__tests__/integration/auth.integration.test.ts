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
    expect(cookies?.some((c) => c.startsWith('refresh_token=') && c.includes('HttpOnly'))).toBe(true);
    expect(cookies?.some((c) => c.startsWith('csrf_token='))).toBe(true);
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
        (c) =>
          c.startsWith('refresh_token=') && (c.includes('Max-Age=0') || c.includes('Expires='))
      )
    ).toBe(true);
  });

  it('should set refresh_token + csrf cookies and return accessToken on register', async () => {
    const invite = await createTestInviteCode({ code: 'REGISTER_SESSION_01', used: false });
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'regsession@test.com',
        username: 'regsession',
        password: 'SecurePass1!',
        inviteCode: invite.code,
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('accessToken');
    expect(res.body).toHaveProperty('csrfToken');

    const cookies = res.headers['set-cookie'] as unknown as string[] | undefined;
    expect(cookies).toBeDefined();
    expect(cookies?.some((c) => c.startsWith('refresh_token=') && c.includes('HttpOnly'))).toBe(true);
    expect(cookies?.some((c) => c.startsWith('csrf_token='))).toBe(true);

    // Regression (audit finding #2): register used to set ZERO cookies, so the
    // session died with the 15-minute access token. The refresh cookie issued
    // at register time must immediately be usable.
    const refreshRes = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', cookies ?? []);
    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body).toHaveProperty('accessToken');
  });

  it('should reject logout without X-CSRF-Token (403) and leave the session alive', async () => {
    await createTestUser({ email: 'logoutcsrf@test.com', emailVerified: true });
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'logoutcsrf@test.com', password: 'SecurePass1!' });
    const loginCookies = loginRes.headers['set-cookie'] as unknown as string[];

    // 1. Missing header → CSRF middleware blocks, session must SURVIVE
    const noCsrf = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', loginCookies);
    expect(noCsrf.status).toBe(403);
    expect(noCsrf.body.error).toBe('CSRF_TOKEN_MISSING');

    const refreshAfterBlocked = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', loginCookies);
    expect(refreshAfterBlocked.status).toBe(200);

    // 2. With matching header → logout succeeds and the session dies
    const login2 = await request(app)
      .post('/api/auth/login')
      .send({ email: 'logoutcsrf@test.com', password: 'SecurePass1!' });
    const login2Cookies = login2.headers['set-cookie'] as unknown as string[];
    const csrfCookie = login2Cookies.find((c) => c.startsWith('csrf_token='));
    const csrfToken = csrfCookie ? csrfCookie.split(';')[0].split('=')[1] : '';

    const ok = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', login2Cookies)
      .set('X-CSRF-Token', csrfToken);
    expect(ok.status).toBe(200);

    const refreshAfterLogout = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', login2Cookies);
    expect(refreshAfterLogout.status).toBe(401);
  });

  it('should inherit familyId across rotations and revoke the whole family on reuse', async () => {
    await createTestUser({ email: 'family@test.com', emailVerified: true });
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'family@test.com', password: 'SecurePass1!' });
    expect(loginRes.status).toBe(200);
    const loginCookies = loginRes.headers['set-cookie'] as unknown as string[];

    const dbUser = await prisma.user.findUnique({ where: { email: 'family@test.com' } });
    const [rowAfterLogin] = await prisma.refreshToken.findMany({
      where: { userId: dbUser!.id },
    });
    expect(rowAfterLogin).toBeDefined();

    // Rotate once — new row must KEEP the same familyId
    const rotate = await request(app).post('/api/auth/refresh').set('Cookie', loginCookies);
    expect(rotate.status).toBe(200);
    const rotateCookies = rotate.headers['set-cookie'] as unknown as string[];
    const newCookie = rotateCookies.find((c) => c.startsWith('refresh_token='));
    expect(newCookie).toBeDefined();

    const [rowAfterRotate] = await prisma.refreshToken.findMany({
      where: { userId: dbUser!.id },
    });
    expect(rowAfterRotate).toBeDefined();
    expect(rowAfterRotate!.familyId).toBe(rowAfterLogin!.familyId);

    // Replay the ROTATED-OUT token → reuse confirmed → family revoked
    const replay = await request(app).post('/api/auth/refresh').set('Cookie', loginCookies);
    expect(replay.status).toBe(401);
    expect(replay.body.error).toBe('TOKEN_REUSE_DETECTED');

    // The successor token must now be dead too (family-wide revocation)
    const successor = await request(app).post('/api/auth/refresh').set('Cookie', [newCookie!]);
    expect(successor.status).toBe(401);

    // And no refresh rows may remain for this user
    const remaining = await prisma.refreshToken.count({ where: { userId: dbUser!.id } });
    expect(remaining).toBe(0);
  });

  it('should accept resend-verification without leaking account existence', async () => {
    // Unknown email → generic 200 (no enumeration)
    const unknown = await request(app)
      .post('/api/auth/resend-verification')
      .send({ email: 'nobody@test.com' });
    expect(unknown.status).toBe(200);
    expect(unknown.body.success).toBe(true);

    // Existing unverified account → verification token regenerated
    const user = await createTestUser({
      email: 'resend@test.com',
      emailVerified: false,
      emailVerifyToken: 'old_token_123',
    });
    const res = await request(app)
      .post('/api/auth/resend-verification')
      .send({ email: 'resend@test.com' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const updated = await prisma.user.findUnique({ where: { id: user.id } });
    expect(updated?.emailVerifyToken).toBeTruthy();
    expect(updated?.emailVerifyToken).not.toBe('old_token_123');

    // Invalid payload → 400
    const bad = await request(app)
      .post('/api/auth/resend-verification')
      .send({ email: 'not-an-email' });
    expect(bad.status).toBe(400);
  });

  it('should change password, revoke all refresh sessions, and require the new password afterwards', async () => {
    await createTestUser({
      email: 'changepw@test.com',
      password: 'SecurePass1!',
      emailVerified: true,
    });

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'changepw@test.com', password: 'SecurePass1!' });
    expect(loginRes.status).toBe(200);
    const cookies = loginRes.headers['set-cookie'] as unknown as string[];
    const accessToken = loginRes.body.accessToken as string;

    // Wrong current password → 403
    const wrongCurrent = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: 'WrongPass1!', newPassword: 'NewPass123!' });
    expect(wrongCurrent.status).toBe(403);
    expect(wrongCurrent.body.code).toBe('CURRENT_PASSWORD_INVALID');

    // Weak new password → 400 (password policy unchanged)
    const weak = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: 'SecurePass1!', newPassword: 'weakpass' });
    expect(weak.status).toBe(400);

    // Garbage Bearer → CSRF exempt (Bearer always is) so we reach requireAuth → 401
    const noAuth = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', 'Bearer definitely-not-a-valid-token')
      .send({ currentPassword: 'SecurePass1!', newPassword: 'NewPass123!' });
    expect(noAuth.status).toBe(401);

    // Valid change → 200, every refresh session revoked
    const ok = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: 'SecurePass1!', newPassword: 'NewPass123!' });
    expect(ok.status).toBe(200);
    expect(ok.body.devicesLoggedOut).toBeGreaterThanOrEqual(1);

    // The pre-change refresh cookie is now dead
    const refreshAfter = await request(app).post('/api/auth/refresh').set('Cookie', cookies);
    expect(refreshAfter.status).toBe(401);

    // Old password rejected, new password accepted
    const oldPw = await request(app)
      .post('/api/auth/login')
      .send({ email: 'changepw@test.com', password: 'SecurePass1!' });
    expect(oldPw.status).toBe(401);

    const newPw = await request(app)
      .post('/api/auth/login')
      .send({ email: 'changepw@test.com', password: 'NewPass123!' });
    expect(newPw.status).toBe(200);
  });
});
