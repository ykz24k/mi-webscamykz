/**
 * ==============================================================================
 * 🕷️ MÓDULO DE SCRAPING AUTÓNOMO 24/7 (MULTI-PÁGINA + FORMATO ORIGINAL)
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
const URL_BASE_TARGET = 'https://altenens.is/forums/accounts-and-database-dumps.45/';

const MAX_CACHE_SIZE = 600;                  
const TIEMPO_ESPERA_CICLO_MIN = 180000;      // 3 minutos mínimos
const TIEMPO_ESPERA_CICLO_MAX = 300000;      // 5 minutos máximos
const TOTAL_PAGINAS_A_ESCANEAR = 3;          // Cantidad de páginas del foro a recorrer en cada ciclo

let ultimoOffsetTelegram = 0;
let estadoBot = {
    ciclosRealizados: 0,
    aportesEnviadosTotales: 0,
    ultimoEscaneo: "Esperando primer ciclo...",
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
        console.error(`[ykzisweb][Error de Escritura] No se pudo guardar en ${ruta}:`, error.message);
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
    console.log("[ykzisweb] Verificando cookies de sesión persistentes...");
    const cookiesAnteriores = await cargarJSON(COOKIES_PATH);

    if (cookiesAnteriores && cookiesAnteriores.length > 0) {
        await page.setCookie(...cookiesAnteriores);
        await page.goto('https://altenens.is/', { waitUntil: 'domcontentloaded', timeout: 45000 });
        
        const sesionValida = await page.$('.p-navgroup-link--user');
        if (sesionValida) {
            console.log("[ykzisweb] ¡Sesión restaurada con éxito mediante cookies guardadas!");
            return true;
        }
    }

    await page.goto(URL_LOGIN, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForSelector('input[name="login"]', { visible: true, timeout: 15000 });
    
    await esperar(tiempoAleatorio(1000, 2000));
    await page.type('input[name="login"]', user, { delay: tiempoAleatorio(40, 85) });
    await esperar(tiempoAleatorio(600, 1200));
    await page.type('input[name="password"]', pass, { delay: tiempoAleatorio(40, 85) });

    await Promise.all([
        page.click('button.button--icon--login'),
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 })
    ]);

    const cookiesNuevas = await page.cookies();
    await guardarJSON(COOKIES_PATH, cookiesNuevas);
    console.log("[ykzisweb] Autenticación completada y cookies respaldadas.");
    return true;
}

// ==============================================================================
// 🎛️ PANEL INTERACTIVO (SIN BOTONES DE FORO EXTERNO)
// ==============================================================================
async function escucharComandosTelegram(botToken) {
    try {
        const respuesta = await axios.get(`https://api.telegram.org/bot${botToken}/getUpdates`, {
            params: { offset: ultimoOffsetTelegram, timeout: 2 }
        });

        if (respuesta.data && respuesta.data.ok) {
            for (const update of respuesta.data.result) {
                ultimoOffsetTelegram = update.update_id + 1;

                if (update.callback_query) {
                    const chatId = update.callback_query.message.chat.id;
                    const messageId = update.callback_query.message.message_id;
                    const data = update.callback_query.data;
                    
                    if (data === 'cmd_estado') {
                        const hilosVistos = (await cargarJSON(HILOS_VISTOS_PATH)) || [];
                        const msg = `📊 <b>ESTADO ACTUAL DEL BOT</b>\n\n` +
                                    `🟢 <b>Estado:</b> <code>Ejecutándose 24/7</code>\n` +
                                    `🔄 <b>Ciclos completados:</b> <code>${estadoBot.ciclosRealizados}</code>\n` +
                                    `📤 <b>Aportes enviados:</b> <code>${estadoBot.aportesEnviadosTotales}</code>\n` +
                                    `📦 <b>Hilos en caché:</b> <code>${hilosVistos.length}/${MAX_CACHE_SIZE}</code>\n` +
                                    `🕒 <b>Último escaneo:</b> <code>${estadoBot.ultimoEscaneo}</code>`;
                        
                        await editarMensajeMenu(botToken, chatId, messageId, msg);
                    } else if (data === 'cmd_ayuda') {
                        const msg = `❓ <b>MENÚ DE AYUDA - YKZISWEB</b>\n\n` +
                                    `Este bot rastrea de manera autónoma múltiples páginas del foro y reporta los hilos con formato numérico automáticamente.`;
                        await editarMensajeMenu(botToken, chatId, messageId, msg);
                    }
                    
                    await axios.post(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
                        callback_query_id: update.callback_query.id,
                        text: "Actualizado"
                    }).catch(() => {});
                }

                if (update.message && update.message.text) {
                    const chatId = update.message.chat.id;
                    const texto = update.message.text.trim();

                    if (texto.startsWith('/menu') || texto.startsWith('/start')) {
                        const menuText = `🕷️ <b>PANEL DE CONTROL - YKZISWEB BOT</b>\n\nSelecciona una opción:`;
                        await enviarMensajeMenu(botToken, chatId, menuText);
                    }
                }
            }
        }
    } catch (e) {}
}

async function enviarMensajeMenu(botToken, chatId, texto) {
    const teclado = {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: "📊 Ver Estado", callback_data: "cmd_estado" },
                    { text: "❓ Ayuda", callback_data: "cmd_ayuda" }
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

async function editarMensajeMenu(botToken, chatId, messageId, texto) {
    const teclado = {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: "📊 Ver Estado", callback_data: "cmd_estado" },
                    { text: "❓ Ayuda", callback_data: "cmd_ayuda" }
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
// 🔄 CICLO PRINCIPAL DE SCRAPING MULTI-PÁGINA
// ==============================================================================
async function revisarWebYEnviar() {
    const user = process.env.FORUM_USER;
    const pass = process.env.FORUM_PASS;
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const forwardTarget = process.env.FORWARD_TO;

    if (!user || !pass || !botToken) {
        return console.error("[ykzisweb][Error Crítico] Faltan credenciales en el archivo .env");
    }

    console.log("[ykzisweb] Subsistema de monitoreo 24/7 multi-página iniciado.");

    while (true) {
        await escucharComandosTelegram(botToken);

        const browser = await puppeteer.launch({ 
            headless: true,
            executablePath: '/usr/bin/chromium', 
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
        });
        
        try {
            const page = await browser.newPage();
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
            await optimizarPagina(page);

            await iniciarSesion(page, user, pass);

            let hilosTotales = [];

            // RECORRER MULTIPLES PÁGINAS DEL FORO
            for (let numPagina = 1; numPagina <= TOTAL_PAGINAS_A_ESCANEAR; numPagina++) {
                const urlPagina = numPagina === 1 ? URL_BASE_TARGET : `${URL_BASE_TARGET}page-${numPagina}`;
                console.log(`[ykzisweb] Analizando página ${numPagina}: ${urlPagina}`);
                
                await page.goto(urlPagina, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});

                const contenedor = await page.waitForSelector('div.structItem-container, div.structItem, div.js-threadList', { visible: true, timeout: 10000 }).catch(() => null);
                if (!contenedor) continue;

                const hilosPagina = await page.evaluate(() => {
                    const items = document.querySelectorAll('div.structItem-cell.structItem-cell--main, div.structItem');
                    return Array.from(items).map(item => {
                        const titleLink = item.querySelector('div.structItem-title a[data-tp-primary], a.p-title-value, h3 a');
                        const timeEl = item.querySelector('ul.structItem-minor li.u-dt, time.u-dt');
                        
                        let repliesCount = "0";
                        const structItem = item.closest('div.structItem') || item;
                        
                        const metaCell = structItem.querySelector('div.structItem-cell.structItem-cell--meta');
                        if (metaCell) {
                            const matchText = metaCell.innerText.match(/Replies:\s*(\d+)/i);
                            if (matchText && matchText[1]) repliesCount = matchText[1];
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
                await esperar(2000);
            }

            const hilosUnicos = Array.from(new Map(hilosTotales.map(h => [h.link, h])).values());
            console.log(`[ykzisweb] Total de hilos únicos recolectados en las ${TOTAL_PAGINAS_A_ESCANEAR} páginas: ${hilosUnicos.length}`);

            let hilosVistos = (await cargarJSON(HILOS_VISTOS_PATH)) || [];
            let contadorEnviados = 0;

            for (const hilo of hilosUnicos) {
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

                                // FORMATO ORIGINAL SOLICITADO (SIN BOTONES EXTRA)
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
                                    console.error(`[Error Telegram]`, err.response?.data || err.message);
                                });

                                contadorEnviados++;
                                estadoBot.aportesEnviadosTotales++;
                                console.log(`[ykzisweb][Éxito] Aporte enviado al canal principal.`);
                                await esperar(tiempoAleatorio(3500, 5000));
                            }
                        }

                        hilosVistos.push(hilo.link);
                        await guardarJSON(HILOS_VISTOS_PATH, hilosVistos.slice(-MAX_CACHE_SIZE)); 

                    } catch (e) {
                    } finally {
                        if (hiloPage) await hiloPage.close();
                    }
                }
            }

            estadoBot.ciclosRealizados++;
            estadoBot.ultimoEscaneo = new Date().toLocaleTimeString();
            console.log(`[ykzisweb] Ciclo finalizado. Aportes enviados: ${contadorEnviados}`);

        } catch (errorCiclo) {
            console.error(`[ykzisweb][Error de Ciclo]`, errorCiclo.message);
        } finally {
            if (browser) await browser.close();
        }

        const esperaSiguienteCiclo = tiempoAleatorio(TIEMPO_ESPERA_CICLO_MIN, TIEMPO_ESPERA_CICLO_MAX);
        console.log(`[ykzisweb] En reposo. Próximo barrido en ${(esperaSiguienteCiclo / 60000).toFixed(1)} minutos.`);
        
        const bloques = 12;
        const intervaloBloque = esperaSiguienteCiclo / bloques;
        for (let i = 0; i < bloques; i++) {
            await esperar(intervaloBloque);
            await escucharComandosTelegram(botToken);
        }
    }
}

module.exports = { revisarWebYEnviar };