// Для боевой сборки дописывает страницы тренажёра в карту сайта. Тестовая сборка карту не трогает.
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
if (process.env.BETA !== '0') { console.log('beta build: карта сайта не меняется'); process.exit(0); }
const site = path.resolve(root, '..');
const file = path.join(site, 'sitemap.xml');
const today = new Date().toISOString().slice(0, 10);
const urls = ['https://xlplain.ru/trenazher/'];
for (const mod of ['excel', 'sql', 'pq', 'bi']) {
  const data = JSON.parse(fs.readFileSync(path.join(root, 'src/generated', mod + '.json'), 'utf8'));
  urls.push(`https://xlplain.ru/trenazher/${mod}/`);
  for (const t of data.tasks) urls.push(`https://xlplain.ru/trenazher/${mod}/${t.slug}/`);
}
let xml = fs.readFileSync(file, 'utf8');
const lines = xml.split('\n').filter(l => !l.includes('https://xlplain.ru/trenazher/'));
const at = lines.findIndex(l => l.includes('</urlset>'));
lines.splice(at, 0, ...urls.map(u => `  <url><loc>${u}</loc><lastmod>${today}</lastmod></url>`));
fs.writeFileSync(file, lines.join('\n'));
console.log(`prod build: в карте сайта ${urls.length} страниц тренажёра`);
