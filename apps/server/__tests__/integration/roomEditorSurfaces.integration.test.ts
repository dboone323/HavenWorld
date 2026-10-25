import request from 'supertest';
import { app } from '../../src/index';
import { prisma } from '../../src/prisma';
import { createTestUser, createTestRoom, createTestItem } from '../helpers/factories';
import { truncateAllTables, seedMinimalData } from '../helpers/dbHelpers';
import { generateTestToken } from '../helpers/jwtHelpers';

describe('Phase 4 Integration: Room Editor Layout Ownership & Surface Customization', () => {
  beforeAll(async () => {
    await truncateAllTables();
    await seedMinimalData();
  });

  afterAll(async () => {
    await truncateAllTables();
  });

  describe('POST /api/rooms/:id/furniture/layout', () => {
    it('should reject bulk layout placement when user does not own all items', async () => {
      const owner = await createTestUser();
      const room = await createTestRoom(owner.id, { isPublic: false });
      const item1 = await createTestItem({ name: 'Owned Rug' });
      const item2 = await createTestItem({ name: 'Unowned Sofa' });
      const token = generateTestToken(owner.id);

      // Only give item1 to owner
      await prisma.inventory.create({
        data: { userId: owner.id, itemId: item1.id, quantity: 1 },
      });

      const res = await request(app)
        .post(`/api/rooms/${room.id}/furniture/layout`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          layout: [
            { id: 'f-1', itemId: item1.id, x: 2, y: 0, z: 3, rotY: 0, scaleX: 1, scaleY: 1, scaleZ: 1 },
            { id: 'f-2', itemId: item2.id, x: 5, y: 0, z: 5, rotY: 1.57, scaleX: 1, scaleY: 1, scaleZ: 1 },
          ],
        });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('ITEM_NOT_OWNED');
      expect(res.body.missingItemIds).toContain(item2.id);

      // Verify no furniture was saved in DB
      const count = await prisma.roomFurniture.count({ where: { roomId: room.id } });
      expect(count).toBe(0);
    });

    it('should successfully save full room layout when user owns all items', async () => {
      const owner = await createTestUser();
      const room = await createTestRoom(owner.id, { isPublic: false });
      const item1 = await createTestItem({ name: 'Table A' });
      const item2 = await createTestItem({ name: 'Chair B' });
      const token = generateTestToken(owner.id);

      await prisma.inventory.createMany({
        data: [
          { userId: owner.id, itemId: item1.id, quantity: 1 },
          { userId: owner.id, itemId: item2.id, quantity: 2 },
        ],
      });

      const res = await request(app)
        .post(`/api/rooms/${room.id}/furniture/layout`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          layout: [
            { id: 'f-10', itemId: item1.id, x: 4.5, y: 0, z: 6.0, rotY: 0, scaleX: 1, scaleY: 1, scaleZ: 1 },
            { id: 'f-11', itemId: item2.id, x: 6.0, y: 0, z: 6.0, rotY: 3.14, scaleX: 1.2, scaleY: 1.2, scaleZ: 1.2 },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.placedCount).toBe(2);

      // Verify records in DB
      const furniture = await prisma.roomFurniture.findMany({
        where: { roomId: room.id },
        orderBy: { x: 'asc' },
      });
      expect(furniture).toHaveLength(2);
      expect(furniture[0].itemId).toBe(item1.id);
      expect(furniture[0].x).toBeCloseTo(4.5);
      expect(furniture[1].itemId).toBe(item2.id);
      expect(furniture[1].rotation).toBeCloseTo(3.14);
      expect(furniture[1].scaleX).toBeCloseTo(1.2);
    });

    it('should reject layout placement from unauthorized non-decorator user', async () => {
      const owner = await createTestUser();
      const intruder = await createTestUser();
      const room = await createTestRoom(owner.id, { isPublic: false });
      const item = await createTestItem({ name: 'Decor Item' });
      const intruderToken = generateTestToken(intruder.id);

      await prisma.inventory.create({
        data: { userId: intruder.id, itemId: item.id, quantity: 1 },
      });

      const res = await request(app)
        .post(`/api/rooms/${room.id}/furniture/layout`)
        .set('Authorization', `Bearer ${intruderToken}`)
        .send({
          layout: [
            { id: 'f-99', itemId: item.id, x: 1, y: 0, z: 1, rotY: 0, scaleX: 1, scaleY: 1, scaleZ: 1 },
          ],
        });

      expect(res.status).toBe(403);
    });

    it('should allow saving layout multiple times idempotently without 403 on already-placed items', async () => {
      const owner = await createTestUser();
      const room = await createTestRoom(owner.id, { isPublic: false });
      const item = await createTestItem({ name: 'Cozy Chair' });
      const token = generateTestToken(owner.id);

      await prisma.inventory.create({
        data: { userId: owner.id, itemId: item.id, quantity: 1 },
      });

      // Save 1: Place the item
      const res1 = await request(app)
        .post(`/api/rooms/${room.id}/furniture/layout`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          layout: [
            { id: 'placed-1', itemId: item.id, x: 2, y: 0, z: 2, rotY: 0, scaleX: 1, scaleY: 1, scaleZ: 1 },
          ],
        });
      expect(res1.status).toBe(200);

      // Save 2: Move the item in the room (same itemId, new coords) — should NOT require additional inventory
      const res2 = await request(app)
        .post(`/api/rooms/${room.id}/furniture/layout`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          layout: [
            { id: 'placed-1', itemId: item.id, x: 4, y: 0, z: 4, rotY: 1.57, scaleX: 1, scaleY: 1, scaleZ: 1 },
          ],
        });
      expect(res2.status).toBe(200);
      expect(res2.body.placedCount).toBe(1);

      const dbFurniture = await prisma.roomFurniture.findMany({ where: { roomId: room.id } });
      expect(dbFurniture).toHaveLength(1);
      expect(dbFurniture[0].x).toBeCloseTo(4);
    });

    it('should allow room owner to place starter furniture without pre-existing inventory entry', async () => {
      const owner = await createTestUser();
      const room = await createTestRoom(owner.id, { isPublic: false });
      const token = generateTestToken(owner.id);

      // Verify owner has 0 furniture in inventory
      const initialInv = await prisma.inventory.count({ where: { userId: owner.id, itemId: 'furniture-chair' } });
      expect(initialInv).toBe(0);

      // Owner places starter chair
      const res = await request(app)
        .post(`/api/rooms/${room.id}/furniture/layout`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          layout: [
            { id: 'starter-chair-1', itemId: 'furniture-chair', x: 3, y: 0, z: 3, rotY: 0, scaleX: 1, scaleY: 1, scaleZ: 1 },
          ],
        });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const placed = await prisma.roomFurniture.findMany({ where: { roomId: room.id } });
      expect(placed).toHaveLength(1);
      expect(placed[0].itemId).toBe('furniture-chair');
    });

    it('should return removed furniture back to player inventory when layout is saved with fewer items', async () => {
      const owner = await createTestUser();
      const room = await createTestRoom(owner.id, { isPublic: false });
      const item = await createTestItem({ name: 'Lamp Item' });
      const token = generateTestToken(owner.id);

      // Give 1 item, place it
      await prisma.inventory.create({
        data: { userId: owner.id, itemId: item.id, quantity: 1 },
      });
      await request(app)
        .post(`/api/rooms/${room.id}/furniture/layout`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          layout: [
            { id: 'lamp-1', itemId: item.id, x: 1, y: 0, z: 1, rotY: 0, scaleX: 1, scaleY: 1, scaleZ: 1 },
          ],
        });

      // Layout is saved with empty array (item removed)
      const res = await request(app)
        .post(`/api/rooms/${room.id}/furniture/layout`)
        .set('Authorization', `Bearer ${token}`)
        .send({ layout: [] });

      expect(res.status).toBe(200);

      // Returned to inventory
      const returnedInv = await prisma.inventory.findUnique({
        where: { userId_itemId: { userId: owner.id, itemId: item.id } },
      });
      expect(returnedInv?.quantity).toBe(1);

      // Room has 0 furniture
      const placed = await prisma.roomFurniture.count({ where: { roomId: room.id } });
      expect(placed).toBe(0);
    });
  });

  describe('PUT /api/rooms/:id/surfaces', () => {
    it('should allow room owner to update floorTexture and wallTexture', async () => {
      const owner = await createTestUser();
      const room = await createTestRoom(owner.id, { isPublic: false });
      const token = generateTestToken(owner.id);

      const res = await request(app)
        .put(`/api/rooms/${room.id}/surfaces`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          floorTexture: 'wood_herringbone',
          wallTexture: 'brick_exposed',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.surfaces.floorTexture).toBe('wood_herringbone');
      expect(res.body.surfaces.wallTexture).toBe('brick_exposed');

      // Verify in DB
      const dbRoom = await prisma.room.findUnique({ where: { id: room.id } });
      expect(dbRoom?.floorTexture).toBe('wood_herringbone');
      expect(dbRoom?.wallTexture).toBe('brick_exposed');
    });

    it('should allow authorized decorator to update surfaces', async () => {
      const owner = await createTestUser();
      const decorator = await createTestUser();
      const room = await createTestRoom(owner.id, { isPublic: false });
      const decoratorToken = generateTestToken(decorator.id);

      // Grant decorator access
      await prisma.roomDecorator.create({
        data: {
          roomId: room.id,
          userId: decorator.id,
        },
      });

      const res = await request(app)
        .put(`/api/rooms/${room.id}/surfaces`)
        .set('Authorization', `Bearer ${decoratorToken}`)
        .send({
          floorTexture: 'tile_checkered',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.surfaces.floorTexture).toBe('tile_checkered');

      const dbRoom = await prisma.room.findUnique({ where: { id: room.id } });
      expect(dbRoom?.floorTexture).toBe('tile_checkered');
    });

    it('should reject surface updates from unauthorized users', async () => {
      const owner = await createTestUser();
      const stranger = await createTestUser();
      const room = await createTestRoom(owner.id, { isPublic: false });
      const strangerToken = generateTestToken(stranger.id);

      const res = await request(app)
        .put(`/api/rooms/${room.id}/surfaces`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .send({
          floorTexture: 'marble_white',
        });

      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/rooms/:id/furniture (Cache and 304 Prevention)', () => {
    it('sets no-cache headers and always returns HTTP 200 without 304 even when If-None-Match is sent', async () => {
      const owner = await createTestUser();
      const room = await createTestRoom(owner.id, { isPublic: false });
      const item = await createTestItem({ name: 'Persistent Chair' });
      const token = generateTestToken(owner.id);

      // Save a furniture piece
      await prisma.inventory.create({
        data: { userId: owner.id, itemId: item.id, quantity: 1 },
      });
      await request(app)
        .post(`/api/rooms/${room.id}/furniture/layout`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          layout: [
            { id: 'f-persistent-1', itemId: item.id, x: 3.5, y: 0, z: 5.5, rotY: 3.14, scaleX: 1, scaleY: 1, scaleZ: 1 },
          ],
        });

      // Request 1: initial load
      const res1 = await request(app)
        .get(`/api/rooms/${room.id}/furniture`)
        .set('Authorization', `Bearer ${token}`);

      expect(res1.status).toBe(200);
      expect(res1.headers['cache-control']).toContain('no-store');
      expect(res1.headers['etag']).toBeUndefined();
      expect(res1.body).toHaveLength(1);
      expect(res1.body[0].itemId).toBe(item.id);

      // Request 2: simulated reload with If-None-Match header from client/intermediary
      const res2 = await request(app)
        .get(`/api/rooms/${room.id}/furniture`)
        .set('Authorization', `Bearer ${token}`)
        .set('If-None-Match', 'W/"some-stale-etag"');

      // MUST return 200 OK (never 304 Not Modified) with full furniture array
      expect(res2.status).toBe(200);
      expect(res2.body).toHaveLength(1);
      expect(res2.body[0].itemId).toBe(item.id);
      expect(res2.body[0].x).toBeCloseTo(3.5);
      expect(res2.body[0].z).toBeCloseTo(5.5);
    });
  });
});
