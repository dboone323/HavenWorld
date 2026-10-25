import request from 'supertest';
import { app } from '../../src/index';
import { prisma } from '../../src/prisma';
import { createTestUser, createTestItem } from '../helpers/factories';
import { truncateAllTables, seedMinimalData } from '../helpers/dbHelpers';
import { generateTestToken } from '../helpers/jwtHelpers';

describe('Integration: 3D & Chibi Wardrobe Avatar Customization (/api/users/me/avatar)', () => {
  beforeAll(async () => {
    await truncateAllTables();
    await seedMinimalData();
  });

  afterAll(async () => {
    await truncateAllTables();
  });

  it('should successfully save avatar with string defaults (bodyType: "default", skinTone: "light")', async () => {
    const user = await createTestUser();
    const token = generateTestToken(user.id);

    // Initial avatar in DB from registration has string defaults
    const payload = {
      bodyType: 'default',
      skinTone: 'light',
      hairColor: 'brown',
      eyeColor: 'brown',
      hairStyle: 'wavy-hair',
      eyeStyle: 'basic-blue-eyes',
      gender: 'female',
      outfitHead: 'trapper-hat',
      outfitBody: 'pink-llama-sweater',
      outfitLegs: 'olive-shorts',
      outfitFeet: 'purple-sneakers',
    };

    const res = await request(app)
      .put('/api/users/me/avatar')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.avatar).toBeDefined();

    const dbAvatar = await prisma.avatar.findUnique({ where: { userId: user.id } });
    expect(dbAvatar?.bodyType).toBe('default');
    expect(dbAvatar?.skinTone).toBe('light');
    expect(dbAvatar?.hairColor).toBe('brown');
    expect(dbAvatar?.eyeColor).toBe('brown');
    expect(dbAvatar?.outfitBody).toBe('pink-llama-sweater');
    expect(dbAvatar?.outfitLegs).toBe('olive-shorts');
  });

  it('should successfully save avatar with numeric morph values and hex color strings', async () => {
    const user = await createTestUser();
    const token = generateTestToken(user.id);

    const payload = {
      bodyType: 0.75,
      height: 0.8,
      build: 0.6,
      skinTone: '#F5CBA7',
      hairColor: '#1C1C1C',
      eyeColor: '#4A3728',
      topColor: '#FF5733',
      bottomColor: '#33FF57',
      hairStyle: 'hair-short-02',
      eyeStyle: 'eyes-round',
      gender: 'male',
      outfitHead: null,
      outfitBody: 'shirt-white',
      outfitLegs: 'pants-blue',
      outfitFeet: 'shoes-black',
    };

    const res = await request(app)
      .put('/api/users/me/avatar')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const dbAvatar = await prisma.avatar.findUnique({ where: { userId: user.id } });
    expect(dbAvatar?.bodyTypeVal).toBeCloseTo(0.75);
    expect(dbAvatar?.heightVal).toBeCloseTo(0.8);
    expect(dbAvatar?.buildVal).toBeCloseTo(0.6);
    expect(dbAvatar?.skinTone).toBe('#F5CBA7');
    expect(dbAvatar?.topColor).toBe('#FF5733');
    expect(dbAvatar?.bottomColor).toBe('#33FF57');
  });

  it('should reject non-starter wardrobe items when player does not own them', async () => {
    const user = await createTestUser();
    const token = generateTestToken(user.id);

    const res = await request(app)
      .put('/api/users/me/avatar')
      .set('Authorization', `Bearer ${token}`)
      .send({
        outfitBody: 'golden-dragon-armor', // Not a starter item, not in inventory
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain('not in your inventory');
  });

  it('should allow non-starter wardrobe items when player owns them in inventory', async () => {
    const user = await createTestUser();
    const token = generateTestToken(user.id);
    const customItem = await createTestItem({
      name: 'Golden Dragon Armor',
    });

    await prisma.inventory.create({
      data: {
        userId: user.id,
        itemId: customItem.id,
        quantity: 1,
      },
    });

    const res = await request(app)
      .put('/api/users/me/avatar')
      .set('Authorization', `Bearer ${token}`)
      .send({
        outfitBody: customItem.id,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const dbAvatar = await prisma.avatar.findUnique({ where: { userId: user.id } });
    expect(dbAvatar?.outfitBody).toBe(customItem.id);
  });

  it('should successfully clear unequipped wardrobe slots when null is sent in PUT /api/users/me/avatar', async () => {
    const user = await createTestUser();
    const token = generateTestToken(user.id);

    // Initial avatar with headwear, body and legs equipped
    await prisma.avatar.update({
      where: { userId: user.id },
      data: {
        outfitHead: 'trapper-hat',
        outfitBody: 'pink-llama-sweater',
        outfitLegs: 'olive-shorts',
        outfitFeet: 'purple-sneakers',
        outfitBack: 'black-wings',
      },
    });

    // Unequip hat and wings by setting them to null
    const res = await request(app)
      .put('/api/users/me/avatar')
      .set('Authorization', `Bearer ${token}`)
      .send({
        outfitHead: null,
        outfitBack: null,
        outfitBody: 'shirt-white',
        outfitLegs: 'denim-jeans',
        outfitFeet: 'shoes-white',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const dbAvatar = await prisma.avatar.findUnique({ where: { userId: user.id } });
    expect(dbAvatar?.outfitHead).toBeNull();
    expect(dbAvatar?.outfitBack).toBeNull();
    expect(dbAvatar?.outfitLegs).toBe('denim-jeans');
  });

  it('should return normalized eyes and hair fields from GET /api/users/me and GET /api/users/me/avatar', async () => {
    const user = await createTestUser();
    const token = generateTestToken(user.id);

    await prisma.avatar.update({
      where: { userId: user.id },
      data: {
        hairStyle: 'hair-short-01',
        eyeStyle: 'eyes-default',
      },
    });

    const resMe = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${token}`);
    expect(resMe.status).toBe(200);
    expect(resMe.body.avatar.eyes).toBe('eyes-default');
    expect(resMe.body.avatar.hair).toBe('hair-short-01');

    const resAvatar = await request(app)
      .get('/api/users/me/avatar')
      .set('Authorization', `Bearer ${token}`);
    expect(resAvatar.status).toBe(200);
    expect(resAvatar.body.eyes).toBe('eyes-default');
    expect(resAvatar.body.hair).toBe('hair-short-01');
  });
});
