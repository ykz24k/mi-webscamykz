/**
 * ====================================================================================================
 * 🕷️ YKZISWEB - MOTOR DE SCRAPING AUTÓNOMO 24/7 ENTERPRISE EDITION V5.0 (ULTIMATE)
 * ====================================================================================================
 * Arquitectura Orientada a Objetos (POO) con Inyección de Dependencias.
 * 
 * Módulos integrados:
 * - Logger Avanzado (Consola + Archivo)
 * - Monitor de Recursos del Sistema (Telemetría de CPU/RAM)
 * - Gestor de Estadísticas Persistentes (Uptime, Ciclos, Errores)
 * - Motor de Caché Atómico (Previene corrupción por cortes de energía)
 * - Enrutador Telegram Asíncrono (Long-Polling paralelo, sin bloqueos)
 * - Freno de Mano Absoluto (Corta envíos en milisegundos si se pausa)
 * - Motor Stealth Puppeteer con Evasión de Fingerprinting
 * ====================================================================================================
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const axios = require('axios');
const crypto = require('crypto');
const os = require('os');
require('dotenv').config();

puppeteer.use(StealthPlugin());

// ====================================================================================================
// ⚙️ CONSTANTES Y CONFIGURACIÓN GLOBAL DEL SISTEMA
// ====================================================================================================
const PATHS = {
    CACHE: path.join(__dirname, 'data_cache.json'),
    TEMP_CACHE: path.join(__dirname, 'data_cache.tmp.json'),
    COOKIES: path.join(__dirname, 'data_cookies.json'),
    STATS: path.join(__dirname, 'data_stats.json'),
    LOGS: path.join(__dirname, 'system.log')
};

const URLS = {
    LOGIN: 'https://altenens.is/login/',
    TARGET_BASE: 'https://altenens.is/forums/accounts-and-database-dumps.45/'
};

const CONFIG = {
    MAX_CACHE_SIZE: 5000,
    TELEGRAM_POLL_TIMEOUT: 2, 
    TIEMPO_MIN_REPOSO_MS: 180000, // 3 minutos
    TIEMPO_MAX_REPOSO_MS: 300000, // 5 minutos
    REINTENTOS_MAX: 3,
    TIMEOUT_NAVEGACION: 45000,
    REGEX_DATOS: /(?:\d{15,16})[|/:-\s]+(?:\d{2})[|/:-\s]+(?:\d{2,4})[|/:-\s]+(?:\d{3,4})/g
};

// ====================================================================================================
// 🛠️ MÓDULO 1: UTILIDADES Y TELEMETRÍA (CPU/RAM)
// ====================================================================================================
class SystemUtils {
    /**
     * Pausa la ejecución asíncrona.
     * @param {number} ms - Milisegundos a esperar.
     * @returns {Promise<void>}
     */
    static esperar(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Genera un retardo aleatorio humano.
     * @param {number} min 
     * @param {number} max 
     * @returns {number}
     */
    static tiempoAleatorio(min, max) {
        return Math.floor(Math.random() * (max - min + 1) + min);
    }

    /**
     * Obtiene el uso actual de memoria RAM del proceso.
     * @returns {string} Formato en MB
     */
    static getMemoryUsage() {
        const used = process.memoryUsage().heapUsed / 1024 / 1024;
        return `${Math.round(used * 100) / 100} MB`;
    }

    /**
     * Calcula el tiempo de actividad (Uptime) del servidor.
     * @returns {string} Formato d, h, m
     */
    static getSystemUptime() {
        const uptime = os.uptime();
        const dias = Math.floor(uptime / 86400);
        const horas = Math.floor((uptime % 86400) / 3600);
        const min = Math.floor((uptime % 3600) / 60);
        return `${dias}d ${horas}h ${min}m`;
    }
}

// ====================================================================================================
// 📝 MÓDULO 2: LOGGER EMPRESARIAL (CONSOLA + ARCHIVO)
// ====================================================================================================
class Logger {
    static _escribirArchivo(nivel, msg) {
        const timestamp = new Date().toISOString();
        const logLine = `[${timestamp}] [${nivel}] ${msg}\n`;
        fsSync.appendFile(PATHS.LOGS, logLine, (err) => { if (err) console.error("Error escribiendo log", err); });
    }

    static info(msg) { 
        console.log(`\x1b[36m[INFO]\x1b[0m [${new Date().toLocaleTimeString()}] ${msg}`);
        this._escribirArchivo('INFO', msg);
    }
    static success(msg) { 
        console.log(`\x1b[32m[ÉXITO]\x1b[0m [${new Date().toLocaleTimeString()}] ${msg}`);
        this._escribirArchivo('SUCCESS', msg);
    }
    static warn(msg) { 
        console.warn(`\x1b[33m[ALERTA]\x1b[0m [${new Date().toLocaleTimeString()}] ${msg}`);
        this._escribirArchivo('WARN', msg);
    }
    static error(msg, err = '') { 
        console.error(`\x1b[31m[ERROR]\x1b[0m [${new Date().toLocaleTimeString()}] ${msg}`, err);
        this._escribirArchivo('ERROR', `${msg} | Detalle: ${err}`);
    }
}

// ====================================================================================================
// 📊 MÓDULO 3: GESTOR DE ESTADÍSTICAS PERSISTENTES
// ====================================================================================================
class StatsManager {
    constructor(filePath) {
        this.filePath = filePath;
        this.data = {
            startTime: new Date().toISOString(),
            ciclosCompletados: 0,
            aportesEnviados: 0,
            erroresDetectados: 0,
            ultimoEscaneo: "Aún no ejecutado"
        };
    }

    async init() {
        try {
            const file = await fs.readFile(this.filePath, 'utf-8');
            const parsed = JSON.parse(file);
            this.data = { ...this.data, ...parsed, startTime: new Date().toISOString() };
        } catch (e) {
            Logger.info("Creando nuevo archivo de estadísticas base.");
            await this.save();
        }
    }

    async save() {
        try {
            await fs.writeFile(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
        } catch (e) {
            Logger.error("No se pudieron guardar las estadísticas", e.message);
        }
    }

    async addCiclo() { this.data.ciclosCompletados++; await this.save(); }
    async addAporte() { this.data.aportesEnviados++; await this.save(); }
    async addError() { this.data.erroresDetectados++; await this.save(); }
    async setUltimoEscaneo(timeStr) { this.data.ultimoEscaneo = timeStr; await this.save(); }
    
    getStats() { return this.data; }
}

// ====================================================================================================
// 💾 MÓDULO 4: MOTOR DE CACHÉ ATÓMICO (ANTI-CORRUPCIÓN)
// ====================================================================================================
class CacheEngine {
    constructor(cachePath, tempPath, maxSize) {
        this.cachePath = cachePath;
        this.tempPath = tempPath;
        this.maxSize = maxSize;
        this.memCache = new Set();
    }

    async init() {
        try {
            const data = await fs.readFile(this.cachePath, 'utf-8');
            const parsed = JSON.parse(data);
            if (Array.isArray(parsed)) {
                this.memCache = new Set(parsed);
                Logger.info(`Motor de caché en línea. Registros en memoria: ${this.memCache.size}`);
            }
        } catch (error) {
            Logger.warn('Caché no encontrada o corrupta. Inicializando base de datos vacía.');
            this.memCache = new Set();
        }
    }

    has(key) { 
        return this.memCache.has(key); 
    }

    async add(key) {
        if (!this.memCache.has(key)) {
            this.memCache.add(key);
            await this._trimAndSave();
        }
    }

    getSize() { 
        return this.memCache.size; 
    }

    async clear() {
        this.memCache.clear();
        await this._trimAndSave();
        Logger.warn('Caché limpiada manualmente.');
    }

    async _trimAndSave() {
        let cacheArray = Array.from(this.memCache);
        // Recortar si excede el tamaño máximo manteniendo los más recientes (al final)
        if (cacheArray.length > this.maxSize) {
            cacheArray = cacheArray.slice(cacheArray.length - this.maxSize);
            this.memCache = new Set(cacheArray);
        }
        try {
            // Escritura atómica para evitar JSON corruptos por caídas
            await fs.writeFile(this.tempPath, JSON.stringify(cacheArray, null, 2), 'utf-8');
            await fs.rename(this.tempPath, this.cachePath);
        } catch (error) {
            Logger.error('Fallo de I/O al persistir la caché', error.message);
        }
    }
}

// ====================================================================================================
// 🤖 MÓDULO 5: ENRUTADOR TELEGRAM ASÍNCRONO Y MENÚ INTERACTIVO
// ====================================================================================================
class TelegramController {
    constructor(token, targetChatId, stateObj, cacheEngine, statsEngine) {
        this.token = token;
        this.targetChatId = targetChatId;
        this.offset = 0;
        this.apiBase = `https://api.telegram.org/bot${this.token}`;
        
        // Referencias a los motores centrales
        this.state = stateObj; 
        this.cache = cacheEngine;
        this.stats = statsEngine;
    }

    async startPolling() {
        Logger.info('Arrancando Router Telegram (Long-Polling independiente)...');
        setInterval(async () => {
            await this._fetchUpdates();
        }, 1200); 
    }

    async _fetchUpdates() {
        try {
            const res = await axios.get(`${this.apiBase}/getUpdates`, {
                params: { offset: this.offset, timeout: CONFIG.TELEGRAM_POLL_TIMEOUT },
                timeout: 5000
            });

            if (res.data && res.data.ok && res.data.result.length > 0) {
                for (const update of res.data.result) {
                    this.offset = update.update_id + 1;
                    await this._routeUpdate(update);
                }
            }
        } catch (error) {
            // Ignorar timeouts normales de long-polling
        }
    }

    async _routeUpdate(update) {
        // ---------------------------------------------------------
        // A. RUTEO DE COMANDOS DE TEXTO PLANO
        // ---------------------------------------------------------
        if (update.message && update.message.text) {
            const chatId = update.message.chat.id;
            const textRaw = update.message.text.trim();
            const textLower = textRaw.toLowerCase();

            // Comando: Menú Principal
            if (textLower.includes('/start') || textLower.includes('/menu') || textLower.includes('/estado')) {
                await this.sendMenu(chatId);
            }
            // Comando: Ayuda
            else if (textLower.includes('/ayuda')) {
                await this.sendHelp(chatId);
            }
            // Comando Libre: Configurar Rango (Regex avanzado soporta: /rango 1 10, /paginas 2-5)
            else if (textLower.match(/^\/(?:rango|paginas|scan)\s+(\d+)[\s-]+(\d+)/)) {
                const match = textLower.match(/^\/(?:rango|paginas|scan)\s+(\d+)[\s-]+(\d+)/);
                const inicio = parseInt(match[1]);
                const fin = parseInt(match[2]);
                
                if (inicio <= fin) {
                    this.state.pageStart = inicio;
                    this.state.pageEnd = fin;
                    Logger.info(`Rango manual modificado vía chat: ${inicio} a ${fin}`);
                    await this._sendRawMessage(chatId, `✅ <b>RANGO MANUAL APLICADO</b>\n\nEl sistema escaneará dinámicamente desde la <b>Página ${inicio}</b> hasta la <b>Página ${fin}</b> en el próximo ciclo.`);
                    await this.sendMenu(chatId); 
                } else {
                    await this._sendRawMessage(chatId, `⚠️ <b>Error Lógico:</b> La página de inicio no puede ser mayor que la página final.`);
                }
            }
        }

        // ---------------------------------------------------------
        // B. RUTEO DE BOTONES INTERACTIVOS (CALLBACKS)
        // ---------------------------------------------------------
        if (update.callback_query) {
            const chatId = update.callback_query.message.chat.id;
            const messageId = update.callback_query.message.message_id;
            const data = update.callback_query.data;
            const callbackId = update.callback_query.id;

            switch (data) {
                case 'cmd_estado':
                    await this.updateMenu(chatId, messageId);
                    break;
                case 'cmd_toggle_pausa':
                    this.state.isPaused = !this.state.isPaused;
                    Logger.warn(this.state.isPaused ? "🛑 SISTEMA PAUSADO MANUALMENTE" : "🟢 SISTEMA REANUDADO");
                    await this.updateMenu(chatId, messageId);
                    break;
                case 'cmd_rango_1_5':
                    this.state.pageStart = 1; this.state.pageEnd = 5;
                    await this.updateMenu(chatId, messageId);
                    break;
                case 'cmd_rango_1_10':
                    this.state.pageStart = 1; this.state.pageEnd = 10;
                    await this.updateMenu(chatId, messageId);
                    break;
                case 'cmd_rango_1_20':
                    this.state.pageStart = 1; this.state.pageEnd = 20;
                    await this.updateMenu(chatId, messageId);
                    break;
                case 'cmd_ayuda':
                    await this.sendHelp(chatId, messageId);
                    break;
                case 'cmd_close':
                    await this._deleteMessage(chatId, messageId);
                    break;
            }

            // Confirmar pulsación a Telegram
            await axios.post(`${this.apiBase}/answerCallbackQuery`, { callback_query_id: callbackId, text: "⚡ Actualizado" }).catch(() => {});
        }
    }

    // Constructor de la Interfaz Visual (Dashboard)
    _buildMenuPayload(chatId, messageId = null) {
        const statsData = this.stats.getStats();
        const estadoVisual = this.state.isPaused ? "🔴 PAUSADO (En reposo absoluto)" : "🟢 ACTIVO (Ejecución 24/7)";
        const botonPausa = this.state.isPaused ? "▶️ INICIAR SISTEMA" : "⏸️ PAUSAR SISTEMA";
        
        const texto = `🛡️ <b>CENTRAL DE MANDO YKZISWEB (V5.0)</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                      `⚙️ <b>Estado del Motor:</b> ${estadoVisual}\n` +
                      `📑 <b>Rango de Escaneo:</b> <code>Páginas ${this.state.pageStart} a ${this.state.pageEnd}</code>\n` +
                      `📦 <b>Caché Anti-Duplicados:</b> <code>${this.cache.getSize()} / ${CONFIG.MAX_CACHE_SIZE}</code>\n` +
                      `📊 <b>RAM en uso:</b> <code>${SystemUtils.getMemoryUsage()}</code>\n` +
                      `🔄 <b>Barridos Exitosos:</b> <code>${statsData.ciclosCompletados}</code>\n` +
                      `📤 <b>Aportes Transmitidos:</b> <code>${statsData.aportesEnviados}</code>\n` +
                      `🕒 <b>Último Análisis:</b> <code>${statsData.ultimoEscaneo}</code>\n` +
                      `🚀 <b>Uptime Global:</b> <code>${SystemUtils.getSystemUptime()}</code>\n` +
                      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                      `<i>💡 Tip: Establece un rango libre escribiendo: <b>/rango 5 25</b></i>`;

        const reply_markup = {
            inline_keyboard: [
                [
                    { text: botonPausa, callback_data: "cmd_toggle_pausa" },
                    { text: "🔄 Refrescar Panel", callback_data: "cmd_estado" }
                ],
                [
                    { text: "📄 Rango Rápido [1 - 5]", callback_data: "cmd_rango_1_5" },
                    { text: "📄 Rango Rápido [1 - 10]", callback_data: "cmd_rango_1_10" }
                ],
                [
                    { text: "📄 Rango Rápido [1 - 20]", callback_data: "cmd_rango_1_20" }
                ],
                [
                    { text: "📚 Manual Técnico", callback_data: "cmd_ayuda" },
                    { text: "❌ Ocultar", callback_data: "cmd_close" }
                ]
            ]
        };

        const payload = { chat_id: chatId, text: texto, parse_mode: 'HTML', reply_markup };
        if (messageId) payload.message_id = messageId;
        
        return payload;
    }

    async sendMenu(chatId) {
        await axios.post(`${this.apiBase}/sendMessage`, this._buildMenuPayload(chatId)).catch(()=>{});
    }

    async updateMenu(chatId, messageId) {
        await axios.post(`${this.apiBase}/editMessageText`, this._buildMenuPayload(chatId, messageId)).catch(()=>{});
    }

    async sendHelp(chatId, messageId = null) {
        const texto = `📚 <b>MANUAL DE OPERACIONES ENTERPRISE</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                      `🔹 <b>Freno Absoluto (Pausa):</b> Al pausar, el bot aborta cualquier envío que se haya quedado en cola. Bloqueo 100% seguro.\n` +
                      `🔹 <b>Rango Manual:</b> Escribe en el chat <code>/rango 1 30</code> para definir límites no incluidos en los botones.\n` +
                      `🔹 <b>Memoria Blindada:</b> El sistema memoriza ${CONFIG.MAX_CACHE_SIZE} hilos. Si reinicias el servidor, la caché se recupera del disco duro para no repetir nada.\n` +
                      `🔹 <b>Monitoreo:</b> Mide uso de RAM, ciclos totales y uptime real.`;
                      
        const reply_markup = { inline_keyboard: [[{ text: "🔙 Regresar al Dashboard", callback_data: "cmd_estado" }]] };
        const payload = { chat_id: chatId, text: texto, parse_mode: 'HTML', reply_markup };
        
        if (messageId) {
            payload.message_id = messageId;
            await axios.post(`${this.apiBase}/editMessageText`, payload).catch(() => {});
        } else {
            await axios.post(`${this.apiBase}/sendMessage`, payload).catch(() => {});
        }
    }

    async _sendRawMessage(chatId, text) {
        await axios.post(`${this.apiBase}/sendMessage`, { chat_id: chatId, text: text, parse_mode: 'HTML' }).catch(()=>{});
    }

    /**
     * Envía los datos scrapeados al grupo principal.
     * INCLUYE FRENO DE MANO: Valida si el bot está pausado justo antes de disparar la petición HTTP.
     */
    async sendScrapedData(text) {
        if (this.state.isPaused) {
            Logger.warn("🛑 Freno de Mano Activado: Se evitó el envío de un aporte porque el bot está en PAUSA.");
            return false; 
        }

        try {
            await axios.post(`${this.apiBase}/sendMessage`, {
                chat_id: this.targetChatId,
                text: text,
                parse_mode: 'HTML',
                disable_web_page_preview: true
            });
            return true;
        } catch (e) {
            Logger.error(`Error de API Telegram enviando aporte final`, e.message);
            this.stats.addError();
            return false;
        }
    }

    async _deleteMessage(chatId, messageId) {
        await axios.post(`${this.apiBase}/deleteMessage`, { chat_id: chatId, message_id: messageId }).catch(() => {});
    }
}

// ====================================================================================================
// 🌐 MÓDULO 6: NAVEGADOR STEALTH (PUPPETEER ENGINE)
// ====================================================================================================
class BrowserEngine {
    constructor(username, password) {
        this.username = username;
        this.password = password;
        this.browser = null;
    }

    async launch() {
        this.browser = await puppeteer.launch({ 
            headless: true, 
            executablePath: '/usr/bin/chromium', 
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--disable-dev-shm-usage', 
                '--disable-gpu',
                '--disable-blink-features=AutomationControlled',
                '--window-size=1920,1080'
            ],
            ignoreHTTPSErrors: true
        });
        return this.browser;
    }

    async close() {
        if (this.browser) {
            try { await this.browser.close(); } catch (e) {}
        }
    }

    async applyOptimizations(page) {
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1920, height: 1080 });
        
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const blockedTypes = ['image', 'stylesheet', 'font', 'media', 'other'];
            if (blockedTypes.includes(req.resourceType())) req.abort();
            else req.continue();
        });
    }

    async authenticateAndRestoreSession(page) {
        try {
            const cookiesData = await fs.readFile(PATHS.COOKIES, 'utf-8');
            const cookiesArray = JSON.parse(cookiesData);
            if (cookiesArray && cookiesArray.length > 0) {
                await page.setCookie(...cookiesArray);
                await page.goto('https://altenens.is/', { waitUntil: 'domcontentloaded', timeout: CONFIG.TIMEOUT_NAVEGACION });
                if (await page.$('.p-navgroup-link--user')) return true;
            }
        } catch (err) {}

        Logger.warn("Cookies vencidas o no encontradas. Autenticando en Altenens...");
        await page.goto(URLS.LOGIN, { waitUntil: 'domcontentloaded', timeout: CONFIG.TIMEOUT_NAVEGACION });
        await page.waitForSelector('input[name="login"]', { visible: true, timeout: 15000 });
        
        await SystemUtils.esperar(1500);
        await page.type('input[name="login"]', this.username, { delay: SystemUtils.tiempoAleatorio(50, 90) });
        await SystemUtils.esperar(1000);
        await page.type('input[name="password"]', this.password, { delay: SystemUtils.tiempoAleatorio(50, 90) });

        await Promise.all([
            page.click('button.button--icon--login'),
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 })
        ]);

        const newCookies = await page.cookies();
        await fs.writeFile(PATHS.COOKIES, JSON.stringify(newCookies, null, 2), 'utf-8');
        Logger.success("Login exitoso. Sesión salvada.");
        return true;
    }

    async extractThreadsFromPage(page, url) {
        let intentos = 0;
        while (intentos < CONFIG.REINTENTOS_MAX) {
            try {
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: CONFIG.TIMEOUT_NAVEGACION });
                const container = await page.waitForSelector('div.structItem-container, div.js-threadList', { visible: true, timeout: 10000 });
                if (!container) return [];

                return await page.evaluate(() => {
                    const items = document.querySelectorAll('div.structItem');
                    return Array.from(items).map(item => {
                        const titleEl = item.querySelector('div.structItem-title a[data-tp-primary]');
                        const timeEl = item.querySelector('time.u-dt');
                        
                        let repliesCount = "0";
                        const metaCell = item.querySelector('div.structItem-cell.structItem-cell--meta');
                        if (metaCell) {
                            metaCell.querySelectorAll('dl.pairs').forEach(dl => {
                                const dt = dl.querySelector('dt');
                                const dd = dl.querySelector('dd');
                                if (dt && dt.innerText.toLowerCase().includes('replies') && dd) {
                                    repliesCount = dd.innerText.trim();
                                }
                            });
                        }

                        if (!titleEl || !titleEl.getAttribute('href')) return null;
                        const href = titleEl.getAttribute('href');
                        
                        return {
                            titulo: titleEl.innerText.trim(),
                            link: href.startsWith('http') ? href : 'https://altenens.is' + href,
                            hora: timeEl ? timeEl.innerText.trim() : "Reciente",
                            replies: repliesCount
                        };
                    }).filter(Boolean);
                });
            } catch (error) {
                intentos++;
                Logger.warn(`Timeout leyendo cartelera. Reintento ${intentos}/${CONFIG.REINTENTOS_MAX}`);
                await SystemUtils.esperar(3000 * intentos);
            }
        }
        return [];
    }

    async extractPostContent(page, hiloUrl) {
        try {
            await page.goto(hiloUrl, { waitUntil: 'domcontentloaded', timeout: CONFIG.TIMEOUT_NAVEGACION });
            return await page.evaluate(() => {
                const body = document.querySelector('article.message-body div.bbWrapper');
                return body ? body.innerText.trim() : "";
            });
        } catch (error) { return null; }
    }
}

// ====================================================================================================
// 🧠 MÓDULO 7: ORQUESTADOR PRINCIPAL (THE CORE)
// ====================================================================================================
class OrchestratorApp {
    constructor() {
        this.config = this._loadEnvironmentVariables();
        
        // Estado Vivo
        this.state = {
            isPaused: false,
            pageStart: 1,
            pageEnd: 3
        };
        
        // Instanciación de dependencias core
        this.stats = new StatsManager(PATHS.STATS);
        this.cache = new CacheEngine(PATHS.CACHE, PATHS.TEMP_CACHE, CONFIG.MAX_CACHE_SIZE);
        this.telegram = new TelegramController(this.config.BOT_TOKEN, this.config.FORWARD_TO, this.state, this.cache, this.stats);
        this.browser = new BrowserEngine(this.config.USER, this.config.PASS);
    }

    _loadEnvironmentVariables() {
        const requiredVars = ['FORUM_USER', 'FORUM_PASS', 'TELEGRAM_BOT_TOKEN', 'FORWARD_TO'];
        const config = {};
        for (const v of requiredVars) {
            if (!process.env[v]) {
                console.error(`\x1b[31m[CRÍTICO]\x1b[0m Faltan credenciales .env: ${v}`);
                process.exit(1);
            }
            config[v.replace('FORUM_', '').replace('TELEGRAM_', '')] = process.env[v];
        }
        return config;
    }

    async boot() {
        Logger.info("=========================================================");
        Logger.info("🚀 INICIANDO YKZISWEB ENTERPRISE V5.0");
        Logger.info("=========================================================");
        
        await this.stats.init();
        await this.cache.init();
        await this.telegram.startPolling(); 
        
        // Entrar al loop infinito asíncrono
        this._infiniteLoop();
    }

    async _infiniteLoop() {
        while (true) {
            if (this.state.isPaused) {
                await SystemUtils.esperar(5000);
                continue; // Saltar todo procesamiento si está pausado
            }

            Logger.info(`[INICIANDO CICLO] Rango Objetivo: Páginas ${this.state.pageStart} a ${this.state.pageEnd}`);
            let pageContext = null;

            try {
                await this.browser.launch();
                pageContext = await this.browser.browser.newPage();
                await this.browser.applyOptimizations(pageContext);
                
                const isAuthenticated = await this.browser.authenticateAndRestoreSession(pageContext);
                if (!isAuthenticated) throw new Error("Túnel de autenticación fallido.");

                // --- FASE 1: RECOLECCIÓN ---
                let hilosTotalesBrutos = [];
                for (let numPag = this.state.pageStart; numPag <= this.state.pageEnd; numPag++) {
                    if (this.state.isPaused) { Logger.warn("Ciclo abortado: Freno de mano aplicado durante paginación."); break; }
                    
                    const url = numPag === 1 ? URLS.TARGET_BASE : `${URLS.TARGET_BASE}page-${numPag}`;
                    Logger.info(`Mapeando URL: ${url}`);
                    const hilosPagina = await this.browser.extractThreadsFromPage(pageContext, url);
                    
                    hilosTotalesBrutos.push(...hilosPagina);
                    await SystemUtils.esperar(1500);
                }

                if (this.state.isPaused) { await this.browser.close(); continue; }

                // --- FASE 2: FILTRADO EN MEMORIA ---
                const mapUnicos = new Map();
                for (const h of hilosTotalesBrutos) mapUnicos.set(h.link, h);
                const hilosCandidatos = Array.from(mapUnicos.values());
                
                Logger.info(`Hilos en bruto capturados: ${hilosCandidatos.length}`);
                let aportesCiclo = 0;

                // --- FASE 3: INSPECCIÓN PROFUNDA ---
                for (const hilo of hilosCandidatos) {
                    if (this.state.isPaused) { Logger.warn("Ciclo abortado: Freno de mano aplicado durante lectura de hilos."); break; }

                    if (!this.cache.has(hilo.link)) {
                        let subPage = null;
                        try {
                            subPage = await this.browser.browser.newPage();
                            await this.browser.applyOptimizations(subPage);
                            
                            const contenidoBruto = await this.browser.extractPostContent(subPage, hilo.link);
                            
                            // Si justo pausaron mientras cargaba la subpágina, salir antes de procesar regex
                            if (this.state.isPaused) { await subPage.close().catch(()=>null); break; }

                            if (contenidoBruto) {
                                const coincidencias = contenidoBruto.match(CONFIG.REGEX_DATOS);
                                
                                if (coincidencias && coincidencias.length > 0) {
                                    let contenidoLimpio = coincidencias.map(cc => cc.replace(/[/:-\s]/g, '|').replace(/\|\|/g, '|')).join('\n');
                                    const badge = parseInt(hilo.replies) <= 2 ? " 🔥 [Fresco / Sin vistas]" : "";
                                    
                                    const msgFinal = `🕷️ <b>[ykzisweb]</b>${badge}\n\n<code>${contenidoLimpio}</code>\n\n🕒 <b>Fecha:</b> ${hilo.hora}\n💬 <b>Replies:</b> ${hilo.replies}`;

                                    // El freno de mano final se aplica dentro de sendScrapedData
                                    const exito = await this.telegram.sendScrapedData(msgFinal);
                                    
                                    if (exito) {
                                        aportesCiclo++;
                                        await this.stats.addAporte();
                                        Logger.success(`Aporte exportado a Telegram. [Replies: ${hilo.replies}]`);
                                        await SystemUtils.esperar(SystemUtils.tiempoAleatorio(3500, 5000));
                                    }
                                }
                            }
                            
                            // Commit a memoria
                            await this.cache.add(hilo.link);

                        } catch (err) {
                            Logger.error(`Error leyendo hilo ${hilo.link}`, err.message);
                        } finally {
                            if (subPage) await subPage.close().catch(()=>null);
                        }
                    }
                }

                if (!this.state.isPaused) {
                    await this.stats.addCiclo();
                    await this.stats.setUltimoEscaneo(new Date().toLocaleTimeString());
                    Logger.info(`✅ Barrido completo finalizado. Nuevos hallazgos: ${aportesCiclo}`);
                }

            } catch (errGeneral) {
                Logger.error("Caída en el hilo de ejecución principal.", errGeneral.message);
                await this.stats.addError();
            } finally {
                await this.browser.close();
            }

            // --- FASE 4: REPOSO (SLEEP FRACCIONADO) ---
            if (!this.state.isPaused) {
                const sleepMs = SystemUtils.tiempoAleatorio(CONFIG.TIEMPO_MIN_REPOSO_MS, CONFIG.TIEMPO_MAX_REPOSO_MS);
                const tiempoFin = Date.now() + sleepMs;
                Logger.info(`Fase de enfriamiento (Cool-down) de ${(sleepMs/60000).toFixed(2)} minutos...`);
                
                // Sleep que puede ser interrumpido si se aplica Pausa
                while (Date.now() < tiempoFin) {
                    if (this.state.isPaused) {
                        Logger.warn("Reposo cancelado por intervención manual (Pausa activada).");
                        break; 
                    }
                    await SystemUtils.esperar(2000); 
                }
            }
        }
    }
}

// ====================================================================================================
// 🚨 GESTIÓN DE PROCESOS (APAGADO SEGURO)
// ====================================================================================================
const masterApp = new OrchestratorApp();

process.on('SIGINT', async () => {
    Logger.warn("Señal de interrupción recibida (SIGINT). Guardando estados...");
    await masterApp.browser.close();
    process.exit(0);
});

process.on('uncaughtException', (err) => {
    Logger.error("Excepción no capturada en Node.js", err.stack);
});

// Arrancar Sistema
masterApp.boot().catch(err => {
    console.error("Fallo crítico en el Boot Loader:", err);
    process.exit(1);
});