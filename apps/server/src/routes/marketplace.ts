import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { MarketplaceService } from '../services/MarketplaceService';

const router = Router();

const createListingSchema = z.object({
  itemId: z.string().min(1),
  priceCoins: z.number().int().positive(),
});

// GET /api/marketplace — browse active listings
router.get('/', requireAuth, async (req, res) => {
  const itemId = req.query.itemId as string | undefined;
  const minPrice = req.query.minPrice ? parseInt(req.query.minPrice as string, 10) : undefined;
  const maxPrice = req.query.maxPrice ? parseInt(req.query.maxPrice as string, 10) : undefined;
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
  const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;

  try {
    const data = await MarketplaceService.getActiveListings({
      itemId,
      minPrice,
      maxPrice,
      limit,
      offset,
    });
    return res.json(data);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/marketplace — list an item
router.post('/', requireAuth, async (req: AuthRequest, res) => {
  const parsed = createListingSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid listing data', issues: parsed.error.issues });
  }

  try {
    const listing = await MarketplaceService.listItem(
      req.user!.userId,
      parsed.data.itemId,
      parsed.data.priceCoins
    );
    return res.status(201).json(listing);
  } catch (err: any) {
    const isClientErr = err.message.includes('NOT_OWNED') || err.message.includes('INVALID_PRICE');
    return res.status(isClientErr ? 400 : 500).json({ error: err.message });
  }
});

// POST /api/marketplace/:id/buy — purchase a listing
router.post('/:id/buy', requireAuth, async (req: AuthRequest, res) => {
  const listingId = req.params.id as string;

  try {
    const result = await MarketplaceService.buyListing(req.user!.userId, listingId);
    return res.json(result);
  } catch (err: any) {
    const isClientErr =
      err.message.includes('INSUFFICIENT_FUNDS') ||
      err.message.includes('CANNOT_BUY_OWN') ||
      err.message.includes('LISTING_UNAVAILABLE') ||
      err.message.includes('LISTING_NOT_FOUND');
    return res.status(isClientErr ? 400 : 500).json({ error: err.message });
  }
});

// DELETE /api/marketplace/:id — cancel a listing and reclaim item
router.delete('/:id', requireAuth, async (req: AuthRequest, res) => {
  const listingId = req.params.id as string;

  try {
    const result = await MarketplaceService.cancelListing(req.user!.userId, listingId);
    return res.json(result);
  } catch (err: any) {
    const isClientErr =
      err.message.includes('UNAUTHORIZED') ||
      err.message.includes('INVALID_STATE') ||
      err.message.includes('LISTING_NOT_FOUND');
    return res.status(isClientErr ? 400 : 500).json({ error: err.message });
  }
});

export default router;
