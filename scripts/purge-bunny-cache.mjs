#!/usr/bin/env node

/**
 * Purge the production Bunny Pull Zone after the origin files are deployed.
 * Credentials are read only from the environment and are never printed.
 */

const apiKey = (process.env.BUNNY_API_KEY || '').trim();
const pullZoneId = (process.env.BUNNY_PULL_ZONE_ID || '').trim();

if (!apiKey || !/^\d+$/.test(pullZoneId)) {
  console.error('Set BUNNY_API_KEY and numeric BUNNY_PULL_ZONE_ID before purging.');
  process.exit(2);
}

const endpoint = `https://api.bunny.net/pullzone/${pullZoneId}/purgeCache`;
const response = await fetch(endpoint, {
  method: 'POST',
  headers: { AccessKey: apiKey },
});

if (!response.ok) {
  const detail = (await response.text()).trim();
  throw new Error(`Bunny purge failed (${response.status})${detail ? `: ${detail}` : ''}`);
}

console.log(`Bunny Pull Zone ${pullZoneId} purged successfully.`);
