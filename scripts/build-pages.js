import fs from 'node:fs/promises';

const backend = (process.env.PAGES_API_URL || '').trim().replace(/\/+$/, '');
if (backend) {
  const url = new URL(backend);
  if (url.hostname === 'github.io' || url.hostname.endsWith('.github.io')) {
    throw new Error('PAGES_API_URL points to GitHub Pages, which cannot run the API. Use the HTTPS URL of your deployed Node backend instead.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('PAGES_API_URL must be a public HTTPS backend URL without credentials, query, or fragment.');
  }
}
const output = new URL('../dist/', import.meta.url);
await fs.mkdir(output, { recursive: true });
for (const filename of ['index.html', 'styles.css', 'app.js']) {
  await fs.copyFile(new URL(`../public/${filename}`, import.meta.url), new URL(filename, output));
}
await fs.copyFile(new URL('../participants.json', import.meta.url), new URL('participants.json', output));
await fs.writeFile(new URL('config.js', output), `export const apiBaseUrl = ${JSON.stringify(backend)};\nexport const staticSite = true;\n`);
await fs.writeFile(new URL('.nojekyll', output), '');
console.log(backend ? 'Built GitHub Pages frontend with configured backend.' : 'Built GitHub Pages frontend; live draw requires the PAGES_API_URL repository variable.');
