const http = require('http');
const PORT = process.env.PORT || 10000;

// Servidor HTTP fantasma para mantener vivo el servicio 24/7 en Render
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot Scraper ykzisweb Operativo 24/7\n');
}).listen(PORT, () => {
    console.log(`🌐 Servidor HTTP fantasma escuchando en el puerto ${PORT}`);
});

// Importamos y arrancamos el gestor del scraper
require('./test_real_5.js');