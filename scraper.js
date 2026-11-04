/**
 * ====================================================================================
 * 🕷️ YKZISWEB - MOTOR DE SCRAPING AUTÓNOMO 24/7 ENTERPRISE EDITION (MULTI-PÁGINA + VIP)
 * ====================================================================================
 * Descripción: Módulo avanzado para la extracción, filtrado numérico y retransmisión
 * autónoma de hilos con persistencia de sesión, caché masiva anti-repetición y panel
 * de control interactivo en tiempo real integrado con la API HTTP de Telegram.
 * ====================================================================================
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs/promises');
const path = require('path');
const axios = require('axios');
require('dotenv').config();

// Aplicar plugins anti-detección de huella digital
puppeteer.use(StealthPlugin());

// ====================================================================================
// 📁 CONFIGURACIÓN DE RUTAS Y CONSTANTES GLOBALES DEL SISTEMA
// ====================================================================================
const HILOS_VISTOS_PATH = path.join(__dirname, 'hilos_vistos_cache.json');
const COOKIES_PATH = path.join(__dirname, 'cookies_foro.json');
const URL_LOGIN = 'https://altenens.is/login/';
const URL_BASE_TARGET = 'https://altenens.is/forums/accounts-and-database-dumps.45/';

// Caché masiva de 5000 elementos para blindar el sistema contra reenvíos o duplicados
const MAX_CACHE_SIZE = 5000;                  
const TIEMPO_ESPERA_CICLO_MIN = 180000;      // 3 minutos mínimos de reposo
const TIEMPO_ESPERA_CICLO_MAX = 300000;      // 5 minutos máximos de reposo

// Variables de estado del bot y control de paginación dinámica
let configuracionPaginas = 3; 
let ultimoOffsetTelegram = 0;
let estadoBot = {
    ciclosRealizados: 0,
    aportesEnviadosTotales: 0,
    ultimoEscaneo: "Esperando primer ciclo...",
    inicioSistema: new Date().toLocaleString(),
    paginasObjetivo: configuracionPaginas
};

// ====================================================================================
// 🛠️ UTILIDADES Y FUNCIONES AUXILIARES DE SOPORTE TÉCNICO
// ====================================================================================

/**
 * Genera una promesa de retraso temporal para simular tiempos humanos.
 * @param {number} ms Milisegundos de espera
 */
const esperar = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Calcula un intervalo de tiempo aleatorio dentro de un rango determinado.
 * @param {number} min Valor mínimo
 * @param {number} max Valor máximo
 */
const tiempoAleatorio = (min, max) => Math.floor(Math.random() * (max - min + 1) + min);

/**
 * Carga de manera segura un archivo JSON del disco local.
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
 * Guarda de manera segura estructuras de datos en formato JSON en disco.
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
 * Optimiza el rendimiento de la página web bloqueando recursos innecesarios (imágenes, fuentes, etc.)
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
        // Ignorar excepciones secundarias de intercepción
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

                // Procesamiento de comandos enviados por texto plano (/start, /menu)
                if (update.message && update.message.text) {
                    const chatId = update.message.chat.id;
                    const textoCrudo = update.message.text.trim().toLowerCase();
                    const texto = textoCrudo.split('@')[0];

                    console.log(`[Telegram] Mensaje detectado en chat ${chatId}: "${textoCrudo}"`);

                    if (texto === '/menu' || texto === '/start') {
                        const menuText = `🕷️ <b>PANEL DE CONTROL VIP - YKZISWEB BOT</b>\n\nSelecciona una opción del menú interactivo para gestionar el sistema:`;
                        await enviarMensajeMenu(botToken, chatId, menuText);
                    }
                }

                // Procesamiento de clics en botones interactivos (Inline Keyboards)
                if (update.callback_query) {
                    const chatId = update.callback_query.message.chat.id;
                    const messageId = update.callback_query.message.message_id;
                    const data = update.callback_query.data;
                    
                    if (data === 'cmd_estado') {
                        const hilosVistos = (await cargarJSON(HILOS_VISTOS_PATH)) || [];
                        const msg = `📊 <b>ESTADO ACTUAL DEL SISTEMA YKZISWEB</b>\n\n` +
                                    `🟢 <b>Estado del Motor:</b> <code>Operativo 24/7</code>\n` +
                                    `📄 <b>Páginas objetivo por ciclo:</b> <code>1 a ${estadoBot.paginasObjetivo}</code>\n` +
                                    `🔄 <b>Ciclos de barrido completados:</b> <code>${estadoBot.ciclosRealizados}</code>\n` +
                                    `📤 <b>Aportes exitosos enviados:</b> <code>${estadoBot.aportesEnviadosTotales}</code>\n` +
                                    `📦 <b>Caché anti-repetición:</b> <code>${hilosVistos.length}/${MAX_CACHE_SIZE} hilos</code>\n` +
                                    `🕒 <b>Último escaneo registrado:</b> <code>${estadoBot.ultimoEscaneo}</code>\n` +
                                    `🚀 <b>Sistema iniciado el:</b> <code>${estadoBot.inicioSistema}</code>`;
                        
                        await editarMensajeMenu(botToken, chatId, messageId, msg);
                    } else if (data === 'cmd_paginas') {
                        const msg = `📑 <b>SELECTOR DE PROFUNDIDAD DE PÁGINAS</b>\n\n` +
                                    `Actualmente el bot escanea desde la página 1 hasta la <b>página ${configuracionPaginas}</b>.\n` +
                                    `Selecciona el límite de páginas que deseas barrer en cada ciclo automático:`;
                        await editarMensajeSelectorPaginas(botToken, chatId, messageId, msg);
                    } else if (data.startsWith('set_pag_')) {
                        const nuevaPagina = parseInt(data.replace('set_pag_', ''));
                        configuracionPaginas = nuevaPagina;
                        estadoBot.paginasObjetivo = nuevaPagina;

                        const msg = `✅ <b>¡Configuración de páginas actualizada con éxito!</b>\n\nAhora el bot escaneará de forma autónoma desde la página 1 hasta la <b>página ${nuevaPagina}</b> en cada ciclo.`;
                        await editarMensajeMenu(botToken, chatId, messageId, msg);
                    } else if (data === 'cmd_ayuda') {
                        const msg = `❓ <b>CENTRO DE AYUDA Y ASISTENCIA - YKZISWEB</b>\n\n` +
                                    `🤖 Este sistema autónomo rastrea múltiples páginas del foro Altenens de forma continua.\n\n` +
                                    `⚙️ <b>Características principales:</b>\n` +
                                    `• Filtra estrictamente hilos con contenido numérico válido.\n` +
                                    `• Muestra la fecha exacta y los <b>Replies</b> originales.\n` +
                                    `• Caché inteligente de 5000 elementos para garantizar cero duplicados.`;
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
async function enviarMensajeMenu(botToken, chatId, texto) {
    const teclado = {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: "📊 Ver Estado del Sistema", callback_data: "cmd_estado" },
                    { text: "📑 Cambiar Páginas (1-5)", callback_data: "cmd_paginas" }
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
 * Edita un mensaje existente en Telegram con el menú principal.
 */
async function editarMensajeMenu(botToken, chatId, messageId, texto) {
    const teclado = {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: "📊 Ver Estado del Sistema", callback_data: "cmd_estado" },
                    { text: "📑 Cambiar Páginas (1-5)", callback_data: "cmd_paginas" }
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
 * Muestra el selector de páginas interactivo (1 al 5).
 */
async function editarMensajeSelectorPaginas(botToken, chatId, messageId, texto) {
    const teclado = {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: "📄 Página 1", callback_data: "set_pag_1" },
                    { text: "📄 Página 2", callback_data: "set_pag_2" },
                    { text: "📄 Página 3", callback_data: "set_pag_3" }
                ],
                [
                    { text: "📄 Página 4", callback_data: "set_pag_4" },
                    { text: "📄 Página 5", callback_data: "set_pag_5" }
                ],
                [
                    { text: "⬅️ Volver al Menú Principal", callback_data: "cmd_estado" }
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

            // Bucle dinámico para recorrer las páginas seleccionadas por el usuario (1 hasta configuracionPaginas)
            for (let numPagina = 1; numPagina <= configuracionPaginas; numPagina++) {
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

            // Filtrar hilos duplicados mediante un Map basado en la URL del enlace único
            const hilosUnicos = Array.from(new Map(hilosTotales.map(h => [h.link, h])).values());
            console.log(`[ykzisweb] Total de hilos únicos recolectados (Páginas 1 a ${configuracionPaginas}): ${hilosUnicos.length}`);

            // Cargar caché masiva anti-repetición
            let hilosVistos = (await cargarJSON(HILOS_VISTOS_PATH)) || [];
            let contadorEnviados = 0;

            for (const hilo of hilosUnicos) {
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
        
        // Bucle de escucha ultrarrápido: revisa los comandos de Telegram cada 2 segundos durante el reposo
        const tiempoInicioReposo = Date.now();
        while (Date.now() - tiempoInicioReposo < esperaSiguienteCiclo) {
            await escucharComandosTelegram(botToken);
            await esperar(2000);
        }
    }
}

module.exports = { revisarWebYEnviar };