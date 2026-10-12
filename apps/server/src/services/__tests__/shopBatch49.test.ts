import { ShopService, FlashSaleEntry, CatalogRotationWindow } from '../ShopService';
import { CATALOG_ITEMS } from '@havenworld/shared';

// furniture-sofa has priceCoin: 120 (not a free starter item)
const TEST_ITEM_ID = 'furniture-sofa';
const TEST_ITEM_PRICE = CATALOG_ITEMS.find((i) => i.id === TEST_ITEM_ID)?.priceCoin ?? 120;

describe('Batch 49: Dynamic Shop Catalog Rotation, Flash Sale Discounts, and Stock Quotas', () => {
  afterEach(() => {
    // Reset static state between tests by expiring all sales
    ShopService.expireFlashSales(Date.now() + 999_999_999);
  });

  it('scheduleFlashSale creates an active sale with correct discount and timestamps', () => {
    const sale: FlashSaleEntry = ShopService.scheduleFlashSale(TEST_ITEM_ID, 25, 60_000);

    expect(sale.itemId).toBe(TEST_ITEM_ID);
    expect(sale.discountPercent).toBe(25);
    expect(sale.active).toBe(true);
    expect(sale.endsAt).toBeGreaterThan(sale.startsAt);
  });

  it('getEffectivePrice applies flash sale discount correctly', () => {
    ShopService.scheduleFlashSale(TEST_ITEM_ID, 50, 3_600_000);

    const { price, onSale, discountPercent } = ShopService.getEffectivePrice(TEST_ITEM_ID);

    expect(onSale).toBe(true);
    expect(discountPercent).toBe(50);
    expect(price).toBe(Math.floor(TEST_ITEM_PRICE * 0.5));
    expect(price).toBeLessThan(TEST_ITEM_PRICE);
  });

  it('expireFlashSales marks ended sales inactive and returns expired item IDs', () => {
    // Schedule a sale that ends in 1 ms
    ShopService.scheduleFlashSale(TEST_ITEM_ID, 10, 1);
    const futureNow = Date.now() + 10_000;

    const expired = ShopService.expireFlashSales(futureNow);
    expect(expired).toContain(TEST_ITEM_ID);

    const { onSale } = ShopService.getEffectivePrice(TEST_ITEM_ID, futureNow);
    expect(onSale).toBe(false);
  });

  it('stock quotas enforce sold-out and correctly decrement on consume', () => {
    const LIMITED_ID = 'furniture-fireplace';
    ShopService.setStockQuota(LIMITED_ID, 3);

    expect(ShopService.getStock(LIMITED_ID)).toBe(3);

    ShopService.consumeStock(LIMITED_ID, 2);
    expect(ShopService.getStock(LIMITED_ID)).toBe(1);

    ShopService.consumeStock(LIMITED_ID, 1);
    expect(ShopService.getStock(LIMITED_ID)).toBe(0);

    expect(() => ShopService.consumeStock(LIMITED_ID, 1)).toThrow('SOLD_OUT');
  });

  it('catalog rotation windows are scheduled, active, and upcoming correctly', () => {
    const now = Date.now();
    const w1: CatalogRotationWindow = {
      windowId: 'rot-spring-2026',
      label: 'Spring Bloom',
      featuredItemIds: ['furniture-plant', 'furniture-lamp'],
      startsAt: now - 1_000,
      endsAt: now + 86_400_000,
    };
    const w2: CatalogRotationWindow = {
      windowId: 'rot-summer-2026',
      label: 'Summer Splash',
      featuredItemIds: ['furniture-sofa', 'furniture-tv'],
      startsAt: now + 86_400_001,
      endsAt: now + 172_800_000,
    };

    ShopService.addRotationWindow(w2);
    ShopService.addRotationWindow(w1); // out-of-order to test sorting

    const active = ShopService.getActiveRotation(now);
    expect(active?.windowId).toBe('rot-spring-2026');
    expect(active?.featuredItemIds).toContain('furniture-plant');

    const upcoming = ShopService.getUpcomingRotations(now);
    expect(upcoming.some((w) => w.windowId === 'rot-summer-2026')).toBe(true);
    expect(upcoming.some((w) => w.windowId === 'rot-spring-2026')).toBe(false);
  });
});
