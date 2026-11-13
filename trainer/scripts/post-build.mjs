// Для боевой сборки дописывает страницы тренажёра в карту сайта. Тестовая сборка карту не трогает.
console.log(process.env.BETA === '0' ? 'prod build: sitemap step pending (на выкатке)' : 'beta build: карта сайта не меняется');
