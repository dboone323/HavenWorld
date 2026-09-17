#!/usr/bin/env node
/**
 * HavenWorld — Automated Uptime & Health Monitor Script
 *
 * Usage:
 *   node scripts/health-check.mjs [url] [discord_webhook_url]
 *
 * Examples:
 *   node scripts/health-check.mjs http://localhost:3000
 *   node scripts/health-check.mjs https://havenworld.me https://discord.com/api/webhooks/...
 */

const targetUrl = process.argv[2] || process.env.PUBLIC_GAME_URL || 'http://localhost:3000';
const discordWebhook = process.argv[3] || process.env.DISCORD_WEBHOOK_URL || null;

async function checkHealth() {
  const start = Date.now();
  console.log(`🩺 Checking health for: ${targetUrl}...`);

  try {
    const healthRes = await fetch(`${targetUrl}/api/health`, { signal: AbortSignal.timeout(8000) });
    const latency = Date.now() - start;

    if (!healthRes.ok) {
      throw new Error(`HTTP status ${healthRes.status} ${healthRes.statusText}`);
    }

    const data = await healthRes.json();
    if (data.status !== 'ok') {
      throw new Error(`Unhealthy payload status: ${data.status}`);
    }

    const statusRes = await fetch(`${targetUrl}/api/status`, { signal: AbortSignal.timeout(5000) });
    const statusData = statusRes.ok ? await statusRes.json() : {};

    const uptimeHrs = (data.uptime / 3600).toFixed(1);
    const memMb = Math.round((data.memory?.rss || 0) / (1024 * 1024));

    console.log(`✅ Health check PASSED! (${latency}ms)`);
    console.log(`   Uptime:    ${uptimeHrs} hrs`);
    console.log(`   Memory:    ${memMb} MB RSS`);
    console.log(`   Players:   ${data.connections || 0} WebSocket connections`);
    console.log(`   DB Mode:   ${statusData.dbMode || 'unknown'}`);

    return { healthy: true, latency, data, statusData };
  } catch (err) {
    const latency = Date.now() - start;
    console.error(`❌ Health check FAILED: ${err.message} (${latency}ms)`);

    if (discordWebhook) {
      await sendDiscordAlert(targetUrl, err.message, latency);
    }
    process.exit(1);
  }
}

async function sendDiscordAlert(url, errorMessage, latency) {
  try {
    const payload = {
      embeds: [{
        title: '🚨 HavenWorld Server Alert: Health Check Failed',
        description: `**Target URL**: \`${url}\`\n**Error**: \`${errorMessage}\`\n**Response Time**: \`${latency}ms\``,
        color: 0xef4444,
        timestamp: new Date().toISOString()
      }]
    };
    await fetch(discordWebhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    console.log(`📢 Dispatched alert to Discord webhook.`);
  } catch (e) {
    console.error(`Failed to dispatch Discord webhook alert:`, e.message);
  }
}

checkHealth();
