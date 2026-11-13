import { defineConfig } from 'astro/config';

// BETA=1 — тестовый контур: /trenazher-beta/, закрыт от поисковиков, без Метрики.
const beta = process.env.BETA !== '0';
export default defineConfig({
  site: 'https://xlplain.ru',
  base: beta ? '/trenazher-beta/' : '/trenazher/',
  outDir: beta ? '../trenazher-beta' : '../trenazher',
  trailingSlash: 'always',
  build: { format: 'directory', assets: '_a' },
  vite: { define: { __BETA__: JSON.stringify(beta) } },
});
