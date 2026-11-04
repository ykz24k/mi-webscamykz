const { join } = require('path');

/**
 * @type {import('puppeteer').Configuration}
 */
module.exports = {
  // Configura la ruta de caché para que Render la reconozca sin problemas
  cacheDirectory: join('/opt/render/.cache/puppeteer'),
};