import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env.test for test suite
dotenv.config({ path: path.resolve(__dirname, '../.env.test') });

// Fallback defaults for safety
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_not_for_production_use_only';
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET;
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test_refresh_secret_not_for_production_use_only';
