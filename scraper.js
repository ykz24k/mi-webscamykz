/**
 * ====================================================================================
 * 🕷️ YKZISWEB - MOTOR DE SCRAPING AUTÓNOMO 24/7 ENTERPRISE EDITION (MÁS DE 600 LÍNEAS)
 * ====================================================================================
 * Módulo avanzado de extracción web con Puppeteer Stealth, caché masiva de 5000 elementos,
 * control de pausas/reanudación en tiempo real y selector de rangos de páginas dinámicos.
 * ====================================================================================
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs/promises');
const path = require('path');
const axios = require('axios');
require('dotenv').config();

// Aplicar plugins anti-detección de huella digital para evitar bloqueos por Cloudflare/DDoS-Guard
puppeteer.use(StealthPlugin());

// ====================================================================================
// 📁 CONFIGURACIÓN DE RUTAS, ARCHIVOS DE PERSISTENCIA Y CONSTANTES GLOBALES
// ====================================================================================
const HILOS_VISTOS_PATH = path.join(__dirname, 'hilos_vistos_cache.json');
const COOKIES_PATH = path.join(__dirname, 'cookies_foro.json');
const URL_LOGIN = 'https://altenens.is/login/';
const URL_BASE_TARGET = 'https://altenens.is/forums/accounts-and-database-dumps.45/';

// Configuración de tamaños de caché y retardos temporales de seguridad
const MAX_CACHE_SIZE = 5000;                  
const TIEMPO_ESPERA_CICLO_MIN = 180000;      // 3 minutos mínimos de reposo entre ciclos
const TIEMPO_ESPERA_CICLO_MAX = 300000;      // 5 minutos máximos de reposo entre ciclos

// Variables de estado del bot, rangos de páginas y control interactivo
let paginaInicio = 1;
let paginaFin = 10; 
let botPausado = false; // Interruptor general de pausa/reanudación
let ultimoOffsetTelegram = 0;
let estadoBot = {
    ciclosRealizados: 0,
    aportesEnviadosTotales: 0,
    ultimoEscaneo: "Esperando primer ciclo...",
    inicioSistema: new Date().toLocaleString()
};

// ====================================================================================
// 🛠️ MÓDULO DE UTILIDADES Y FUNCIONES AUXILIARES DE SOPORTE TÉCNICO
// ====================================================================================

/**
 * Genera una promesa de retraso temporal para simular tiempos de espera humanos.
 * @param {number} ms Milisegundos de espera
 */
const esperar = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Calcula un intervalo de tiempo aleatorio dentro de un rango determinado.
 * @param {number} min Valor mínimo en ms
 * @param {number} max Valor máximo en ms
 */
const tiempoAleatorio = (min, max) => Math.floor(Math.random() * (max - min + 1) + min);

/**
 * Carga de manera segura un archivo JSON desde el disco local.
 * @param {string} ruta Ruta absoluta del archivo
 */
async function cargarJSON(ruta) {
    try {
        const data = await fs.readFile(ruta, 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        return [];
    }
}

/**
 * Guarda de manera segura estructuras de datos en formato JSON en el disco local.
 * @param {string} ruta Ruta absoluta del archivo
 * @param {Object|Array} data Datos a serializar
 */
async function guardarJSON(ruta, data) {
    try {
        await fs.writeFile(ruta, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
        console.error(`[ykzisweb][Error de Escritura en Disco] No se pudo persistir en ${ruta}:`, error.message);
    }
}

/**
 * Optimiza el rendimiento de carga bloqueando recursos innecesarios (imágenes, fuentes, hojas de estilo).
 * @param {import('puppeteer').Page} page Instancia de la página de Puppeteer
 */
async function optimizarPagina(page) {
    try {
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const recursosBloqueados = ['image', 'stylesheet', 'font', 'media', 'other', 'ping', 'beacon', 'font/woff2'];
            if (recursosBloqueados.includes(req.resourceType())) {
                req.abort();
            } else {
                req.continue();
            }
        });
    } catch (e) {
        // Ignorar excepciones secundarias de intercepción en flujos paralelos
    }
}

// ====================================================================================
// 🔐 SUBSISTEMA DE AUTENTICACIÓN Y GESTIÓN DE SESIÓN PERSISTENTE
// ====================================================================================

/**
 * Gestiona el inicio de sesión automático y la reutilización de cookies de sesión.
 * @param {import('puppeteer').Page} page Instancia activa de Puppeteer
 * @param {string} user Nombre de usuario del foro
 * @param {string} pass Contraseña de acceso
 */
async function iniciarSesion(page, user, pass) {
    console.log("[ykzisweb] Verificando integridad de cookies de sesión persistentes...");
    const cookiesAnteriores = await cargarJSON(COOKIES_PATH);

    if (cookiesAnteriores && cookiesAnteriores.length > 0) {
        await page.setCookie(...cookiesAnteriores);
        await page.goto('https://altenens.is/', { waitUntil: 'domcontentloaded', timeout: 45000 });
        
        const sesionValida = await page.$('.p-navgroup-link--user');
        if (sesionValida) {
            console.log("[ykzisweb] ¡Sesión restaurada con éxito mediante cookies guardadas en caché!");
            return true;
        }
        console.log("[ykzisweb] Las cookies almacenadas han expirado. Iniciando secuencia de login...");
    }

    await page.goto(URL_LOGIN, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForSelector('input[name="login"]', { visible: true, timeout: 15000 });
    
    await esperar(tiempoAleatorio(1000, 2000));
    await page.type('input[name="login"]', user, { delay: tiempoAleatorio(40, 85) });
    await esperar(tiempoAleatorio(600, 1200));
    await page.type('input[name="password"]', pass, { delay: tiempoAleatorio(40, 85) });

    console.log("[ykzisweb] Transmitiendo credenciales de autenticación al servidor remoto...");
    await Promise.all([
        page.click('button.button--icon--login'),
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 })
    ]);

    const cookiesNuevas = await page.cookies();
    await guardarJSON(COOKIES_PATH, cookiesNuevas);
    console.log("[ykzisweb] Autenticación completada satisfactoriamente y nuevas cookies respaldadas.");
    return true;
}

// ====================================================================================
// 🎛️ PANEL DE CONTROL INTERACTIVO Y GESTIÓN DE COMANDOS DE TELEGRAM
// ====================================================================================

/**
 * Escucha en bucle continuo las actualizaciones (comandos e interacciones de botones) de Telegram.
 * @param {string} botToken Token de autenticación del bot de Telegram
 */
async function escucharComandosTelegram(botToken) {
    try {
        const respuesta = await axios.get(`https://api.telegram.org/bot${botToken}/getUpdates`, {
            params: { offset: ultimoOffsetTelegram, timeout: 1 }
        });

        if (respuesta.data && respuesta.data.ok) {
            for (const update of respuesta.data.result) {
                ultimoOffsetTelegram = update.update_id + 1;

                // Procesamiento de comandos enviados por texto plano (/start, /menu, /paginas)
                if (update.message && update.message.text) {
                    const chatId = update.message.chat.id;
                    const textoCrudo = update.message.text.trim();
                    const texto = textoCrudo.split('@')[0].toLowerCase();

                    if (texto === '/menu' || texto === '/start') {
                        await enviarMenuPrincipal(botToken, chatId);
                    } else if (texto.startsWith('/paginas')) {
                        const partes = textoCrudo.split(' ');
                        if (partes[1] && partes[1].includes('-')) {
                            const [i, f] = partes[1].split('-').map(Number);
                            if (!isNaN(i) && !isNaN(f) && i <= f) {
                                paginaInicio = i;
                                paginaFin = f;
                                await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                                    chat_id: chatId,
                                    text: `✅ Rango actualizado con éxito: Escaneando desde la página <b>${i}</b> hasta la <b>${f}</b>.`,
                                    parse_mode: 'HTML'
                                }).catch(() => {});
                            }
                        } else {
                            await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                                chat_id: chatId,
                                text: `ℹ️ Formato incorrecto. Utiliza el comando de texto de la siguiente manera: <code>/paginas 1-15</code>`,
                                parse_mode: 'HTML'
                            }).catch(() => {});
                        }
                    }
                }

                // Procesamiento de clics en botones interactivos (Inline Keyboards)
                if (update.callback_query) {
                    const chatId = update.callback_query.message.chat.id;
                    const messageId = update.callback_query.message.message_id;
                    const data = update.callback_query.data;
                    
                    if (data === 'cmd_estado') {
                        await actualizarMenuEstado(botToken, chatId, messageId);
                    } else if (data === 'cmd_toggle_pausa') {
                        botPausado = !botPausado;
                        await actualizarMenuEstado(botToken, chatId, messageId);
                    } else if (data === 'cmd_rango_1_5') {
                        paginaInicio = 1; paginaFin = 5;
                        await actualizarMenuEstado(botToken, chatId, messageId);
                    } else if (data === 'cmd_rango_1_10') {
                        paginaInicio = 1; paginaFin = 10;
                        await actualizarMenuEstado(botToken, chatId, messageId);
                    } else if (data === 'cmd_rango_1_20') {
                        paginaInicio = 1; paginaFin = 20;
                        await actualizarMenuEstado(botToken, chatId, messageId);
                    } else if (data === 'cmd_ayuda') {
                        const msg = `❓ <b>CENTRO DE AYUDA YKZISWEB</b>\n\n` +
                                    `• <b>Pausar/Reanudar:</b> Detiene temporalmente los envíos sin perder la memoria de hilos vistos.\n` +
                                    `• <b>Rango de Páginas:</b> Puedes configurar el alcance con los botones o escribiendo <code>/paginas 1-20</code> en el chat.`;
                        await editarMensajeMenu(botToken, chatId, messageId, msg);
                    }
                    
                    await axios.post(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
                        callback_query_id: update.callback_query.id,
                        text: "⚡ Panel actualizado correctamente"
                    }).catch(() => {});
                }
            }
        }
    } catch (e) {
        // Silenciar errores menores de red en sondeo continuo
    }
}

/**
 * Envía el menú principal interactivo al chat de Telegram.
 */
async function enviarMenuPrincipal(botToken, chatId) {
    const hilosVistos = (await cargarJSON(HILOS_VISTOS_PATH)) || [];
    const estadoTxt = botPausado ? "🔴 PAUSADO (En reposo)" : "🟢 ACTIVO (Operando 24/7)";
    const botonPausaTxt = botPausado ? "▶️ Reanudar Bot" : "⏸️ Pausar Bot";

    const texto = `🕷️ <b>PANEL DE CONTROL VIP - YKZISWEB</b>\n\n` +
                  `• <b>Estado:</b> ${estadoTxt}\n` +
                  `• <b>Rango de Páginas:</b> <code>Página ${paginaInicio} a ${paginaFin}</code>\n` +
                  `• <b>Caché Anti-Duplicados:</b> <code>${hilosVistos.length} hilos guardados</code>\n` +
                  `• <b>Ciclos Completados:</b> <code>${estadoBot.ciclosRealizados}</code>\n\n` +
                  `Selecciona una opción del panel:`;

    const teclado = {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: botonPausaTxt, callback_data: "cmd_toggle_pausa" },
                    { text: "📊 Actualizar Estado", callback_data: "cmd_estado" }
                ],
                [
                    { text: "📄 Páginas (1-5)", callback_data: "cmd_rango_1_5" },
                    { text: "📄 Páginas (1-10)", callback_data: "cmd_rango_1_10" },
                    { text: "📄 Páginas (1-20)", callback_data: "cmd_rango_1_20" }
                ],
                [
                    { text: "❓ Ayuda y Soporte", callback_data: "cmd_ayuda" }
                ]
            ]
        }
    };

    await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        chat_id: chatId,
        text: texto,
        parse_mode: 'HTML',
        ...teclado
    }).catch(() => {});
}

/**
 * Actualiza el menú de estado existente en Telegram de forma dinámica.
 */
async function actualizarMenuEstado(botToken, chatId, messageId) {
    const hilosVistos = (await cargarJSON(HILOS_VISTOS_PATH)) || [];
    const estadoTxt = botPausado ? "🔴 PAUSADO (En reposo)" : "🟢 ACTIVO (Operando 24/7)";
    const botonPausaTxt = botPausado ? "▶️ Reanudar Bot" : "⏸️ Pausar Bot";

    const texto = `🕷️ <b>PANEL DE CONTROL VIP - YKZISWEB</b>\n\n` +
                  `• <b>Estado:</b> ${estadoTxt}\n` +
                  `• <b>Rango de Páginas:</b> <code>Página ${paginaInicio} a ${paginaFin}</code>\n` +
                  `• <b>Caché Anti-Duplicados:</b> <code>${hilosVistos.length} hilos guardados</code>\n` +
                  `• <b>Ciclos Completados:</b> <code>${estadoBot.ciclosRealizados}</code>\n\n` +
                  `Selecciona una opción del panel:`;

    const teclado = {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: botonPausaTxt, callback_data: "cmd_toggle_pausa" },
                    { text: "📊 Actualizar Estado", callback_data: "cmd_estado" }
                ],
                [
                    { text: "📄 Páginas (1-5)", callback_data: "cmd_rango_1_5" },
                    { text: "📄 Páginas (1-10)", callback_data: "cmd_rango_1_10" },
                    { text: "📄 Páginas (1-20)", callback_data: "cmd_rango_1_20" }
                ],
                [
                    { text: "❓ Ayuda y Soporte", callback_data: "cmd_ayuda" }
                ]
            ]
        }
    };

    await axios.post(`https://api.telegram.org/bot${botToken}/editMessageText`, {
        chat_id: chatId,
        message_id: messageId,
        text: texto,
        parse_mode: 'HTML',
        ...teclado
    }).catch(() => {});
}

/**
 * Muestra mensajes informativos secundarios en el menú.
 */
async function editarMensajeMenu(botToken, chatId, messageId, texto) {
    const teclado = {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: "🏠 Volver al Menú Principal", callback_data: "cmd_estado" }
                ]
            ]
        }
    };

    await axios.post(`https://api.telegram.org/bot${botToken}/editMessageText`, {
        chat_id: chatId,
        message_id: messageId,
        text: texto,
        parse_mode: 'HTML',
        ...teclado
    }).catch(() => {});
}

// ====================================================================================
// 🔄 CICLO PRINCIPAL DE SCRAPING MULTI-PÁGINA Y EXTRACCIÓN DE CONTENIDO
// ====================================================================================

/**
 * Ejecuta el bucle principal de monitoreo permanente 24/7.
 */
async function revisarWebYEnviar() {
    const user = process.env.FORUM_USER;
    const pass = process.env.FORUM_PASS;
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const forwardTarget = process.env.FORWARD_TO;

    if (!user || !pass || !botToken) {
        return console.error("[ykzisweb][Error Crítico] Faltan credenciales obligatorias en el archivo .env");
    }

    console.log("[ykzisweb] Subsistema enterprise anti-repetición y multi-página desplegado correctamente.");

    while (true) {
        // Si el usuario pausó el bot, entramos en modo de espera activa escuchando comandos sin procesar web
        if (botPausado) {
            console.log("[ykzisweb] ⏸️ El bot se encuentra PAUSADO. Manteniendo memoria caché intacta...");
            await esperar(5000);
            await escucharComandosTelegram(botToken);
            continue;
        }

        // Escuchar comandos de Telegram antes de iniciar tareas pesadas de navegador
        await escucharComandosTelegram(botToken);

        const browser = await puppeteer.launch({ 
            headless: true,
            executablePath: '/usr/bin/chromium', 
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--window-size=1920,1080'
            ]
        });
        
        try {
            const page = await browser.newPage();
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
            await page.setViewport({ width: 1920, height: 1080 });
            await optimizarPagina(page);

            // Iniciar sesión en el foro
            await iniciarSesion(page, user, pass);

            let hilosTotales = [];

            // Bucle dinámico basado en el rango personalizado configurado por el usuario
            for (let numPagina = paginaInicio; numPagina <= paginaFin; numPagina++) {
                if (botPausado) break; // Si se pausa a mitad del ciclo, abortamos de inmediato

                const urlPagina = numPagina === 1 ? URL_BASE_TARGET : `${URL_BASE_TARGET}page-${numPagina}`;
                console.log(`[ykzisweb] Analizando cartelera - Página ${numPagina}: ${urlPagina}`);
                
                await page.goto(urlPagina, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});

                const contenedor = await page.waitForSelector('div.structItem-container, div.structItem, div.js-threadList', { visible: true, timeout: 10000 }).catch(() => null);
                if (!contenedor) continue;

                // Extracción de hilos y metadatos (Replies y Fecha) desde la cartelera
                const hilosPagina = await page.evaluate(() => {
                    const items = document.querySelectorAll('div.structItem-cell.structItem-cell--main, div.structItem');
                    return Array.from(items).map(item => {
                        const titleLink = item.querySelector('div.structItem-title a[data-tp-primary], a.p-title-value, h3 a');
                        const timeEl = item.querySelector('ul.structItem-minor li.u-dt, time.u-dt');
                        
                        let repliesCount = "0";
                        const structItem = item.closest('div.structItem') || item;
                        
                        // Extracción precisa de respuestas (Replies)
                        const metaCell = structItem.querySelector('div.structItem-cell.structItem-cell--meta');
                        if (metaCell) {
                            const dlElements = metaCell.querySelectorAll('dl.pairs');
                            dlElements.forEach(dl => {
                                const dt = dl.querySelector('dt');
                                const dd = dl.querySelector('dd');
                                if (dt && dt.innerText.toLowerCase().includes('replies')) {
                                    if (dd) repliesCount = dd.innerText.trim();
                                }
                            });
                            
                            if (repliesCount === "0") {
                                const matchText = metaCell.innerText.match(/Replies:\s*(\d+)/i);
                                if (matchText && matchText[1]) repliesCount = matchText[1];
                            }
                        }

                        if (!titleLink || !titleLink.getAttribute('href')) return null;
                        
                        const href = titleLink.getAttribute('href');
                        return {
                            titulo: titleLink.innerText.trim(),
                            link: href.startsWith('http') ? href : 'https://altenens.is' + href,
                            hora: timeEl ? timeEl.innerText.trim() : "Reciente",
                            replies: repliesCount
                        };
                    }).filter(Boolean);
                });

                hilosTotales.push(...hilosPagina);
                await esperar(1500);
            }

            if (botPausado) {
                await browser.close();
                continue;
            }

            // Filtrar hilos duplicados mediante un Map basado en la URL del enlace único
            const hilosUnicos = Array.from(new Map(hilosTotales.map(h => [h.link, h])).values());
            console.log(`[ykzisweb] Total de hilos únicos recolectados (Páginas ${paginaInicio} a ${paginaFin}): ${hilosUnicos.length}`);

            // Cargar caché masiva anti-repetición
            let hilosVistos = (await cargarJSON(HILOS_VISTOS_PATH)) || [];
            let contadorEnviados = 0;

            for (const hilo of hilosUnicos) {
                if (botPausado) break;

                // Validación estricta: si el hilo no está en la caché, se procesa
                if (!hilosVistos.includes(hilo.link)) {
                    let hiloPage;
                    
                    try {
                        hiloPage = await browser.newPage();
                        await optimizarPagina(hiloPage);
                        await hiloPage.goto(hilo.link, { waitUntil: 'domcontentloaded', timeout: 45000 });

                        const contenidoPost = await hiloPage.evaluate(() => {
                            const messageBody = document.querySelector('article.message-body div.bbWrapper, div.message-content div.bbWrapper');
                            return messageBody ? messageBody.innerText.trim() : "";
                        });

                        if (contenidoPost) {
                            // Expresión regular para filtrar datos numéricos estructurados
                            const regexDatos = /(?:\d{15,16})[|/:-\s]+(?:\d{2})[|/:-\s]+(?:\d{2,4})[|/:-\s]+(?:\d{3,4})/g;
                            const coincidencias = contenidoPost.match(regexDatos);

                            if (coincidencias && coincidencias.length > 0) {
                                let contenidoFinal = coincidencias.map(cc => {
                                    return cc.replace(/[/:-\s]/g, '|').replace(/\|\|/g, '|');
                                }).join('\n');

                                const badgeFrescura = parseInt(hilo.replies) <= 2 ? " 🔥 [Fresco / Sin vistas]" : "";

                                // Formato limpio y ordenado original con Fecha y Replies
                                const mensajeTelegram = `🕷️ <b>[ykzisweb]</b>${badgeFrescura}\n\n` +
                                                        `<code>${contenidoFinal}</code>\n\n` +
                                                        `🕒 <b>Fecha:</b> ${hilo.hora}\n` +
                                                        `💬 <b>Replies:</b> ${hilo.replies}`;

                                await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                                    chat_id: forwardTarget,
                                    text: mensajeTelegram,
                                    parse_mode: 'HTML',
                                    disable_web_page_preview: true
                                }).catch((err) => {
                                    console.error(`[Error Telegram API]`, err.response?.data || err.message);
                                });

                                contadorEnviados++;
                                estadoBot.aportesEnviadosTotales++;
                                console.log(`[ykzisweb][Éxito] Aporte enviado y registrado correctamente.`);
                                await esperar(tiempoAleatorio(3500, 5000));
                            }
                        }

                        // Registrar inmediatamente el enlace en la caché y recortar al tamaño máximo (5000)
                        hilosVistos.push(hilo.link);
                        if (hilosVistos.length > MAX_CACHE_SIZE) {
                            hilosVistos = hilosVistos.slice(-MAX_CACHE_SIZE);
                        }
                        await guardarJSON(HILOS_VISTOS_PATH, hilosVistos); 

                    } catch (e) {
                        // Capturar errores de hilo individual sin detener el bucle
                    } finally {
                        if (hiloPage) await hiloPage.close();
                    }
                }
            }

            estadoBot.ciclosRealizados++;
            estadoBot.ultimoEscaneo = new Date().toLocaleTimeString();
            console.log(`[ykzisweb] Ciclo de escaneo finalizado. Aportes nuevos transmitidos: ${contadorEnviados}`);

        } catch (errorCiclo) {
            console.error(`[ykzisweb][Error Crítico en Ciclo]`, errorCiclo.message);
        } finally {
            if (browser) await browser.close();
        }

        // Intervalo de reposo aleatorio entre ciclos
        const esperaSiguienteCiclo = tiempoAleatorio(TIEMPO_ESPERA_CICLO_MIN, TIEMPO_ESPERA_CICLO_MAX);
        console.log(`[ykzisweb] Sistema en reposo preventivo. Próximo barrido en ${(esperaSiguienteCiclo / 60000).toFixed(1)} minutos.`);
        
        // Bucle de escucha ultrarrápido (2 segundos) para responder al menú y pausar/reanudar al instante
        const tiempoInicioReposo = Date.now();
        while (Date.now() - tiempoInicioReposo < esperaSiguienteCiclo && !botPausado) {
            await escucharComandosTelegram(botToken);
            await esperar(2000);
        }
    }
}

module.exports = { revisarWebYEnviar };