/**
 * Automated Verification & Diagnostics Script for Supabase
 * Tests connectivity against your live Supabase project.
 * 
 * Usage from Terminal:
 *   node scripts/migrate-supabase.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');

async function runDiagnostics() {
  console.log('====================================================');
  console.log('🚀 HavenWorld / MiniWorld — Supabase Diagnostics');
  console.log('====================================================');

  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const activeKey = serviceKey || anonKey;

  if (!supabaseUrl || !activeKey || supabaseUrl.includes('your-project-id')) {
    console.error('❌ Error: Missing SUPABASE_URL or API keys in .env file.');
    console.log('\n👉 If you just want a working local database immediately:');
    console.log('   Run "npm start" — the server will automatically use the built-in');
    console.log('   native SQLite database (miniworld.db) on your Mac.\n');
    process.exit(1);
  }

  console.log(`📡 Target Supabase URL: ${supabaseUrl}`);
  console.log(`🔑 Using Key Type: ${serviceKey ? 'service_role (Secret Admin Key - Recommended)' : 'anon (Public Key)'}`);

  if (!serviceKey) {
    console.log('⚠️ Note: SUPABASE_SERVICE_ROLE_KEY is not yet in .env.');
    console.log('   Copy it from Supabase Dashboard -> Project Settings -> API -> service_role');
  }

  try {
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(supabaseUrl, activeKey, {
      auth: { persistSession: false }
    });

    console.log('\n⏳ Checking PostgreSQL table readiness...');

    // 1. Check Profiles table
    const { data: profiles, error: pErr } = await supabase.from('profiles').select('id, username').limit(5);
    if (pErr) {
      console.log(`❌ profiles table: ${pErr.message} (code: ${pErr.code})`);
      if (pErr.code === '42P01') {
        console.log('   👉 The tables have not been created yet.');
        console.log('   Please copy supabase/schema.sql and paste it into:');
        console.log(`   https://supabase.com/dashboard/project/ruphxzwfgwtrheprvpdq/sql`);
      }
    } else {
      console.log(`✅ profiles table: Ready (${profiles.length} records found)`);
    }

    // 2. Check Rooms table
    const { data: rooms, error: rErr } = await supabase.from('rooms').select('id, name').limit(5);
    if (rErr) {
      console.log(`❌ rooms table: ${rErr.message}`);
    } else {
      console.log(`✅ rooms table: Ready (${rooms.length} records found)`);
    }

    // 3. Check Placed Furniture table
    const { data: furn, error: fErr } = await supabase.from('placed_furniture').select('id, room_id, item_type').limit(5);
    if (fErr) {
      console.log(`❌ placed_furniture table: ${fErr.message}`);
    } else {
      console.log(`✅ placed_furniture table: Ready (${furn.length} items placed)`);
    }

    console.log('\n====================================================');
    console.log('🎉 Diagnostics complete.');
    console.log('====================================================\n');
  } catch (err) {
    console.error('❌ Connection test encountered an error:', err.message);
  }
}

runDiagnostics();
