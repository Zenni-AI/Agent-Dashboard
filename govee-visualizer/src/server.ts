import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { ImageStore } from './images.js';
import { LeadStore } from './leads.js';
import { createProvider } from './providers/index.js';
import { StreetView } from './streetview.js';

const config = loadConfig();
const images = new ImageStore(config.dataDir);
await images.init();
const leads = new LeadStore(config.dataDir);
const streetView = new StreetView(config.googleMapsServerKey);
const provider = createProvider(config);

const { app, queue } = createApp({ config, leads, images, streetView, provider });

const server = app.listen(config.port, () => {
  console.log(`Govee visualizer listening on http://localhost:${config.port}`);
  console.log(`  image provider: ${provider.name}${provider.name === 'mock' ? ' (DEMO MODE — set GEMINI_API_KEY for real renders)' : ''}`);
  console.log(`  street view:    ${streetView.enabled ? 'on' : 'off (set GOOGLE_MAPS_SERVER_KEY; visitors must upload a photo)'}`);
  console.log(`  concurrency:    ${config.maxConcurrentGenerations} simultaneous renders, queue up to ${config.maxQueueLength}`);
  if (!config.adminPassword) console.log('  admin export:   disabled (set ADMIN_PASSWORD to enable /admin/leads.csv)');
});
server.requestTimeout = 60_000;

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received: finishing in-flight renders…`);
  server.close();
  await Promise.race([queue.onIdle(), new Promise((r) => setTimeout(r, 30_000))]);
  queue.close();
  leads.close();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
