import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { DesignStore } from './designStore.js';
import { DesignService } from './designs.js';
import { ImageStore } from './images.js';
import { LeadStore } from './leads.js';
import { Notifier } from './notify.js';
import { createProvider } from './providers/index.js';
import { StreetView } from './streetview.js';

const config = loadConfig();
const images = new ImageStore(config.dataDir);
await images.init();
const db = openDb(config.dataDir);
const leads = new LeadStore(db);
const streetView = new StreetView(config.googleMapsServerKey);
const provider = createProvider(config);
const notifier = new Notifier(config);
const designs = new DesignService({ config, leads, designs: new DesignStore(db), images, streetView, provider, notifier });

const app = createApp({ config, leads, images, streetView, provider, notifier, designs });

const server = app.listen(config.port, () => {
  const off = (what: string) => `off (set ${what})`;
  console.log(`Govee visualizer listening on http://localhost:${config.port}`);
  console.log(`  image provider: ${provider.name}${provider.name === 'mock' ? ' (DEMO MODE — set GEMINI_API_KEY for real renders)' : ''}`);
  console.log(`  street view:    ${streetView.enabled ? 'on' : off('GOOGLE_MAPS_SERVER_KEY; visitors must upload a photo')}`);
  console.log(`  text messages:  ${notifier.smsEnabled ? 'on' : off('TWILIO_* and PUBLIC_BASE_URL')}`);
  console.log(`  email:          ${notifier.emailEnabled ? 'on' : off('SMTP_URL, EMAIL_FROM and PUBLIC_BASE_URL')}`);
  console.log(`  concurrency:    ${config.maxConcurrentGenerations} simultaneous AI renders`);
  if (!config.adminPassword) console.log('  admin export:   disabled (set ADMIN_PASSWORD to enable /admin/leads.csv)');
  if (config.publicBaseUrl && !config.publicBaseUrl.startsWith('https://')) {
    console.warn('  warning: PUBLIC_BASE_URL is not https — picture texts need a public https URL');
  }
  designs.resume();
});
server.requestTimeout = 60_000;

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received: finishing in-flight work…`);
  server.close();
  // Anything not finished in time is resumed from the database on next start.
  await Promise.race([designs.onIdle(), new Promise((r) => setTimeout(r, 30_000))]);
  designs.close();
  db.close();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
