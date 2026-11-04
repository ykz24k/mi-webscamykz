/**
 * ==============================================================================
 * 🕷️ MÓDULO DE SCRAPING AUTÓNOMO 24/7 + PANEL INTERACTIVO VIP - YKZISWEB
 * ==============================================================================
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs/promises');
const path = require('path');
const axios = require('axios');
require('dotenv').config();

puppeteer.use(StealthPlugin());

const HILOS_VISTOS_PATH = path.join(__dirname, 'hilos_vistos_cache.json');
const COOKIES_PATH = path.join(__dirname, 'cookies_foro.json');
const URL_LOGIN = 'https://altenens.is/login/';
const URL_TARGET = 'https://altenens.is/forums/accounts-and-database-dumps.45/';

const MAX_CACHE_SIZE = 600;                  
const TIEMPO_ESPERA_CICLO_MIN = 180000;      // 3 minutos mínimos
const TIEMPO_ESPERA_CICLO_MAX = 300000;      // 5 minutos máximos

let ultimoOffsetTelegram = 0;
let estadoBot = {
    ciclosRealizados: 0,
    aportesEnviadosTotales: 0,
    ultimoEscaneo: "Esperando primer ciclo...",
    activo: true,
    inicioSistema: new Date().toLocaleString()
};

const esperar = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const tiempoAleatorio = (min, max) => Math.floor(Math.random() * (max - min + 1) + min);

async function cargarJSON(ruta) {
    try {
        const data = await fs.readFile(ruta, 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        return null;
    }
}

async function guardarJSON(ruta, data) {
    try {
        await fs.writeFile(ruta, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
        console.error(`[ykzisweb][Error de Escritura] No se pudo guardar el archivo en ${ruta}:`, error.message);
    }
}

async function optimizarPagina(page) {
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        const recursosBloqueados = ['image', 'stylesheet', 'font', 'media', 'other', 'ping', 'beacon', 'font/woff2'];
        if (recursosBloqueados.includes(req.resourceType())) {
            req.abort();
        } else {
            req.continue();
        }
    });
}

async function iniciarSesion(page, user, pass) {
    console.log("[ykzisweb] Verificando integridad de cookies de sesión persistentes...");
    const cookiesAnteriores = await cargarJSON(COOKIES_PATH);

    if (cookiesAnteriores && cookiesAnteriores.length > 0) {
        await page.setCookie(...cookiesAnteriores);
        await page.goto('https://altenens.is/', { waitUntil: 'domcontentloaded', timeout: 45000 });
        
        const sesionValida = await page.$('.p-navgroup-link--user');
        if (sesionValida) {
            console.log("[ykzisweb] ¡Sesión restaurada con éxito mediante cookies guardadas!");
            return true;
        }
        console.log("[ykzisweb] Las cookies almacenadas han expirado. Iniciando secuencia de login manual...");
    }

    await page.goto(URL_LOGIN, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForSelector('input[name="login"]', { visible: true, timeout: 15000 });
    
    await esperar(tiempoAleatorio(1000, 2000));
    await page.type('input[name="login"]', user, { delay: tiempoAleatorio(40, 85) });
    await esperar(tiempoAleatorio(600, 1200));
    await page.type('input[name="password"]', pass, { delay: tiempoAleatorio(40, 85) });

    console.log("[ykzisweb] Transmitiendo credenciales de autenticación al servidor...");
    await Promise.all([
        page.click('button.button--icon--login'),
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 })
    ]);

    const cookiesNuevas = await page.cookies();
    await guardarJSON(COOKIES_PATH, cookiesNuevas);
    console.log("[ykzisweb] Autenticación completada satisfactoriamente y cookies respaldadas.");
    return true;
}

// ==============================================================================
// 🎛️ PANEL INTERACTIVO VIP Y COMANDOS DE TELEGRAM
// ==============================================================================
async function escucharComandosTelegram(botToken) {
    try {
        const respuesta = await axios.get(`https://api.telegram.org/bot${botToken}/getUpdates`, {
            params: { offset: ultimoOffsetTelegram, timeout: 2 }
        });

        if (respuesta.data && respuesta.data.ok) {
            const updates = respuesta.data.result;
            for (const update of updates) {
                ultimoOffsetTelegram = update.update_id + 1;

                // 1. Manejo de Clics en Botones Inline (Callbacks)
                if (update.callback_query) {
                    const chatId = update.callback_query.message.chat.id;
                    const messageId = update.callback_query.message.message_id;
                    const data = update.callback_query.data;
                    
                    if (data === 'cmd_estado') {
                        const hilosVistos = (await cargarJSON(HILOS_VISTOS_PATH)) || [];
                        const msg = `━━━━━━━━━━━━━━━━━━━━━━\n` +
                                    `📊 <b>PANEL DE ESTADÍSTICAS - YKZISWEB</b>\n` +
                                    `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                                    `🟢 <b>Estado del Motor:</b> <code>En Línea (24/7)</code>\n` +
                                    `🚀 <b>Iniciado el:</b> <code>${estadoBot.inicioSistema}</code>\n` +
                                    `🔄 <b>Barridos completados:</b> <code>${estadoBot.ciclosRealizados}</code>\n` +
                                    `📤 <b>Aportes exitosos:</b> <code>${estadoBot.aportesEnviadosTotales}</code>\n` +
                                    `📦 <b>Caché de hilos vistos:</b> <code>${hilosVistos.length} / ${MAX_CACHE_SIZE}</code>\n` +
                                    `🕒 <b>Último escaneo:</b> <code>${estadoBot.ultimoEscaneo}</code>\n\n` +
                                    `━━━━━━━━━━━━━━━━━━━━━━`;
                        
                        await editarMensajeConMenu(botToken, chatId, messageId, msg);
                    } else if (data === 'cmd_ayuda') {
                        const msg = `━━━━━━━━━━━━━━━━━━━━━━\n` +
                                    `❓ <b>CENTRO DE AYUDA Y ASISTENCIA</b>\n` +
                                    `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                                    `🤖 Este sistema opera de forma totalmente automatizada extrayendo bases de datos y dumps limpios desde Altenens.\n\n` +
                                    `⚙️ <b>Comandos disponibles:</b>\n` +
                                    `• <code>/menu</code> o <code>/start</code> - Muestra este panel VIP.\n` +
                                    `• <code>/estado</code> - Muestra métricas rápidas.\n\n` +
                                    `━━━━━━━━━━━━━━━━━━━━━━`;
                        await editarMensajeConMenu(botToken, chatId, messageId, msg);
                    } else if (data === 'cmd_menu_principal') {
                        const msg = `🕷️ <b>CENTRAL DE MONITOREO - YKZISWEB BOT</b>\n\n` +
                                    `Selecciona una opción de la botonera interactiva para gestionar el sistema en tiempo real:`;
                        await editarMensajeConMenu(botToken, chatId, messageId, msg);
                    }
                    
                    await axios.post(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
                        callback_query_id: update.callback_query.id,
                        text: "⚡ Panel actualizado con éxito"
                    }).catch(() => {});
                }

                // 2. Manejo de Comandos por Texto Plano (/start, /menu, /estado)
                if (update.message && update.message.text) {
                    const chatId = update.message.chat.id;
                    const texto = update.message.text.trim();

                    if (texto.startsWith('/menu') || texto.startsWith('/start')) {
                        const menuText = `🕷️ <b>CENTRAL DE MONITOREO - YKZISWEB BOT</b>\n\n` +
                                         `Selecciona una opción de la botonera interactiva para gestionar el sistema en tiempo real:`;
                        await enviarMensajeConMenu(botToken, chatId, menuText);
                    } else if (texto.startsWith('/estado')) {
                        const hilosVistos = (await cargarJSON(HILOS_VISTOS_PATH)) || [];
                        const msg = `📊 <b>ESTADO RÁPIDO:</b> Ciclos: ${estadoBot.ciclosRealizados} | Aportes: ${estadoBot.aportesEnviadosTotales} | Caché: ${hilosVistos.length}/${MAX_CACHE_SIZE}`;
                        await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, { 
                            chat_id: chatId, 
                            text: msg, 
                            parse_mode: 'HTML' 
                        }).catch(() => {});
                    }
                }
            }
        }
    } catch (error) {
        // Silenciar errores menores de red en el polling
    }
}

async function enviarMensajeConMenu(botToken, chatId, texto) {
    const teclado = {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: "📊 Estadísticas VIP", callback_data: "cmd_estado" },
                    { text: "❓ Ayuda y Guía", callback_data: "cmd_ayuda" }
                ],
                [
                    { text: "🌐 Ir al Foro Objetivo", url: URL_TARGET }
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

async function editarMensajeConMenu(botToken, chatId, messageId, texto) {
    const teclado = {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: "📊 Estadísticas VIP", callback_data: "cmd_estado" },
                    { text: "🏠 Menú Principal", callback_data: "cmd_menu_principal" }
                ],
                [
                    { text: "🌐 Ir al Foro Objetivo", url: URL_TARGET }
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

// ==============================================================================
// 🔄 CICLO PRINCIPAL DE SCRAPING CON RESILIENCIA
// ==============================================================================
async function revisarWebYEnviar() {
    const user = process.env.FORUM_USER;
    const pass = process.env.FORUM_PASS;
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const forwardTarget = process.env.FORWARD_TO;

    if (!user || !pass || !botToken) {
        return console.error("[ykzisweb][Error Crítico] Faltan credenciales obligatorias en el archivo .env");
    }

    console.log("[ykzisweb] Subsistema de monitoreo 24/7 desplegado con Panel Interactivo VIP.");

    while (true) {
        // Monitorear comandos de Telegram antes de iniciar el ciclo de navegador
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

            await iniciarSesion(page, user, pass);
            console.log("[ykzisweb] Accediendo a la cartelera de objetivos:", URL_TARGET);
            await page.goto(URL_TARGET, { waitUntil: 'domcontentloaded', timeout: 60000 });

            const contenedor = await page.waitForSelector('div.structItem-container, div.structItem, div.js-threadList', { visible: true, timeout: 15000 }).catch(() => null);

            if (!contenedor) {
                console.error("[ykzisweb][Advertencia] No se detectó el contenedor principal de hilos. Reintentando...");
                await browser.close();
                await esperar(60000);
                continue;
            }

            const hilosBrutos = await page.evaluate(() => {
                const items = document.querySelectorAll('div.structItem-cell.structItem-cell--main, div.structItem');
                return Array.from(items).map(item => {
                    const titleLink = item.querySelector('div.structItem-title a[data-tp-primary], a.p-title-value, h3 a');
                    const timeEl = item.querySelector('ul.structItem-minor li.u-dt, time.u-dt');
                    
                    let repliesCount = "0";
                    const structItem = item.closest('div.structItem') || item;
                    
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

                    if (repliesCount === "0") {
                        const matchGlobal = structItem.innerText.match(/Replies:\s*(\d+)/i);
                        if (matchGlobal && matchGlobal[1]) repliesCount = matchGlobal[1];
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

            const hilos = Array.from(new Map(hilosBrutos.map(h => [h.link, h])).values());
            console.log(`[ykzisweb] Hilos únicos analizados en cartelera: ${hilos.length}`);

            let hilosVistos = (await cargarJSON(HILOS_VISTOS_PATH)) || [];
            let contadorEnviados = 0;

            for (const hilo of hilos) {
                console.log(`[ykzisweb][Revisando] "${hilo.titulo}" (Replies: ${hilo.replies})`);

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
                            const regexDatos = /(?:\d{15,16})[|/:-\s]+(?:\d{2})[|/:-\s]+(?:\d{2,4})[|/:-\s]+(?:\d{3,4})/g;
                            const coincidencias = contenidoPost.match(regexDatos);

                            if (coincidencias && coincidencias.length > 0) {
                                let contenidoFinal = coincidencias.map(cc => {
                                    return cc.replace(/[/:-\s]/g, '|').replace(/\|\|/g, '|');
                                }).join('\n');

                                const badgeFrescura = parseInt(hilo.replies) <= 2 ? " 🔥 [Fresco / Sin vistas]" : "";

                                const mensajeTelegram = `🕷️ <b>[ykzisweb]</b>${badgeFrescura}\n\n` +
                                                        `<code>${contenidoFinal}</code>\n\n` +
                                                        `🕒 <b>Fecha:</b> ${hilo.hora}\n` +
                                                        `💬 <b>Replies:</b> ${hilo.replies}`;

                                const tecladoAporte = {
                                    reply_markup: {
                                        inline_keyboard: [
                                            [
                                                { text: "📊 Ver Estadísticas", callback_data: "cmd_estado" },
                                                { text: "🌐 Ver Hilo Original", url: hilo.link }
                                            ]
                                        ]
                                    }
                                };

                                // ENVÍO BLINDADO CON MANEJO DE ERRORES HTTP 400
                                try {
                                    await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                                        chat_id: forwardTarget,
                                        text: mensajeTelegram,
                                        parse_mode: 'HTML',
                                        disable_web_page_preview: true,
                                        ...tecladoAporte
                                    });
                                    contadorEnviados++;
                                    estadoBot.aportesEnviadosTotales++;
                                    console.log(`[ykzisweb][Éxito] Aporte transmitido vía HTTP Bot API.`);
                                } catch (errApi) {
                                    console.error(`[ykzisweb][Error Telegram API] No se pudo enviar el aporte:`, errApi.response?.data?.description || errApi.message);
                                }

                                await esperar(tiempoAleatorio(3500, 5000));
                            } else {
                                console.log(`[ykzisweb][Descartado] El hilo no cumple con el patrón numérico.`);
                            }
                        }

                        hilosVistos.push(hilo.link);
                        await guardarJSON(HILOS_VISTOS_PATH, hilosVistos.slice(-MAX_CACHE_SIZE)); 

                    } catch (errorInterno) {
                        console.error(`[ykzisweb][Error de Hilo]`, errorInterno.message);
                    } finally {
                        if (hiloPage) await hiloPage.close();
                    }
                }
            }

            estadoBot.ciclosRealizados++;
            estadoBot.ultimoEscaneo = new Date().toLocaleTimeString();
            console.log(`[ykzisweb] Ciclo de escaneo finalizado. Aportes enviados: ${contadorEnviados}`);

        } catch (errorCiclo) {
            console.error(`[ykzisweb][Error de Ciclo]`, errorCiclo.message);
        } finally {
            if (browser) await browser.close();
        }

        const esperaSiguienteCiclo = tiempoAleatorio(TIEMPO_ESPERA_CICLO_MIN, TIEMPO_ESPERA_CICLO_MAX);
        console.log(`[ykzisweb] En reposo preventivo. Próximo barrido en ${(esperaSiguienteCiclo / 60000).toFixed(1)} minutos.`);
        
        // Espera inteligente dividida para seguir respondiendo al menú de Telegram
        const bloques = 12;
        const intervaloBloque = esperaSiguienteCiclo / bloques;
        for (let i = 0; i < bloques; i++) {
            await esperar(intervaloBloque);
            await escucharComandosTelegram(botToken);
        }
    }
}

module.exports = { revisarWebYEnviar };