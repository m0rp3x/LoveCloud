import {resolve, join} from 'node:path';
import {fileURLToPath} from 'node:url';

// Test credentials and synthetic data never share the operator installation.
export const testRoot = resolve(process.env.LOVECLOUD_TEST_ROOT || fileURLToPath(new URL('../', import.meta.url)));
export const artifact = name => join(testRoot, '.artifacts', name);
export const secret = name => join(testRoot, '.secrets', name);
export function testBase(fallback) {
  const value = process.env.LOVECLOUD_TEST_URL || fallback;
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname) || Number(url.port) < 1024 || url.pathname !== '/') {
    throw new Error('Acceptance tests require an explicitly isolated loopback HTTP installation.');
  }
  if (['3210','3211'].includes(url.port) || (!['3212','3213'].includes(url.port) && process.env.LOVECLOUD_TEST_ISOLATED !== '1')) throw new Error('Refusing a known operator port or an installation without the isolated test marker.');
  return url.origin;
}
