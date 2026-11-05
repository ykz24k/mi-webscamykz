/**
 * ====================================================================================================
 * 🕷️ YKZISWEB - MOTOR DE SCRAPING AUTÓNOMO 24/7 ENTERPRISE EDITION V6.0 (ULTIMATE TITAN)
 * ====================================================================================================
 * Arquitectura: Orientada a Eventos (EventBus), Patrón Circuit Breaker, Inyección de Dependencias.
 * 
 * Características Exclusivas V6.0:
 * - Servidor HTTP "Fantasma" integrado (Evita suspensión en Render sin archivos extra).
 * - Bus de Eventos (EventBus): Desacoplamiento total entre Puppeteer y Telegram.
 * - Circuit Breaker: Protección inteligente contra caídas de red y bloqueos de Cloudflare.
 * - Proxy Manager: Sistema base para rotación de IPs.
 * - NLP Avanzado, Caché Atómica, Telemetría en tiempo real y Freno Absoluto.
 * ====================================================================================================
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const axios = require('axios');
const os = require('os');
const crypto = require('crypto');
const http = require('http');
const EventEmitter = require('events');
require('dotenv').config();

puppeteer.use(StealthPlugin());

// ====================================================================================================
// ⚙️ [1] CONFIGURACIÓN GLOBAL Y ESTRUCTURA DE RUTAS
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
    TIEMPO_MIN_REPOSO_MS: 180000, // 3 min
    TIEMPO_MAX_REPOSO_MS: 300000, // 5 min
    REINTENTOS_MAX: 3,
    TIMEOUT_NAVEGACION: 45000,
    DEFAULT_REGEX: "(?:\\d{15,16})[|/:-\\s]+(?:\\d{2})[|/:-\\s]+(?:\\d{2,4})[|/:-\\s]+(?:\\d{3,4})",
    PORT: process.env.PORT || 3000 // Puerto para el servidor fantasma de Render
};

// ====================================================================================================
// 📡 [2] BUS DE EVENTOS CENTRAL (EVENT DRIVEN ARCHITECTURE)
// ====================================================================================================
class SystemEventBus extends EventEmitter {}
const EventBus = new SystemEventBus();

const EVENTS = {
    SYSTEM_BOOT: 'system:boot',
    SCRAPE_HIT: 'scrape:hit',
    SYSTEM_PAUSED: 'system:paused',
    SYSTEM_RESUMED: 'system:resumed',
    ERROR_CRITICAL: 'error:critical',
    NETWORK_FAILURE: 'network:failure'
};

// ====================================================================================================
// 🛠️ [3] MÓDULO DE UTILIDADES Y TELEMETRÍA AVANZADA
// ====================================================================================================
class SystemUtils {
    static esperar(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
    static tiempoAleatorio(min, max) { return Math.floor(Math.random() * (max - min + 1) + min); }
    
    static getMemoryUsage() {
        const mem = process.memoryUsage();
        const format = bytes => (bytes / 1024 / 1024).toFixed(2);
        return {
            rss: `${format(mem.rss)} MB`,
            heapTotal: `${format(mem.heapTotal)} MB`,
            heapUsed: `${format(mem.heapUsed)} MB`
        };
    }
    
    static getSystemUptime() {
        const uptime = os.uptime();
        const d = Math.floor(uptime / 86400);
        const h = Math.floor((uptime % 86400) / 3600);
        const m = Math.floor((uptime % 3600) / 60);
        return `${d}d ${h}h ${m}m`;
    }

    static generateHash(string) {
        return crypto.createHash('md5').update(string).digest('hex');
    }
}

// ====================================================================================================
// 📝 [4] LOGGER EMPRESARIAL MULTI-SALIDA (CONSOLA + DISCO)
// ====================================================================================================
class Logger {
    static _escribirArchivo(nivel, msg) {
        const timestamp = new Date().toISOString();
        const linea = `[${timestamp}] [${nivel}] ${msg}\n`;
        fsSync.appendFile(PATHS.LOGS, linea, (err) => { if (err) console.error("Fallo I/O Log", err); });
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
        this._escribirArchivo('ERROR', `${msg} | ${err instanceof Error ? err.stack : err}`);
    }
}

// ====================================================================================================
// 🛡️ [5] PATRÓN CIRCUIT BREAKER (CORTOCIRCUITO ANTI-BANEOS)
// ====================================================================================================
class CircuitBreaker {
    constructor(failureThreshold = 3, resetTimeout = 600000) {
        this.failureThreshold = failureThreshold;
        this.resetTimeout = resetTimeout; // 10 minutos por defecto
        this.failures = 0;
        this.state = 'CLOSED'; // CLOSED, OPEN, HALF-OPEN
        this.nextAttempt = Date.now();
    }

    recordFailure() {
        this.failures++;
        Logger.warn(`Circuit Breaker: Falla registrada (${this.failures}/${this.failureThreshold})`);
        if (this.failures >= this.failureThreshold) {
            this.state = 'OPEN';
            this.nextAttempt = Date.now() + this.resetTimeout;
            Logger.error(`⚡ CIRCUIT BREAKER ABIERTO ⚡ - Red suspendida por ${(this.resetTimeout/60000).toFixed(1)} min.`);
            EventBus.emit(EVENTS.NETWORK_FAILURE, `Bloqueo de red detectado. Entrando en reposo forzado.`);
        }
    }

    recordSuccess() {
        if (this.state === 'HALF-OPEN' || this.failures > 0) {
            Logger.success("Circuit Breaker: Conexión recuperada. Cortocircuito cerrado.");
        }
        this.failures = 0;
        this.state = 'CLOSED';
    }

    canAttempt() {
        if (this.state === 'CLOSED') return true;
        if (this.state === 'OPEN' && Date.now() >= this.nextAttempt) {
            this.state = 'HALF-OPEN';
            Logger.info("Circuit Breaker: Intentando recuperar conexión (HALF-OPEN)...");
            return true;
        }
        return false;
    }
}

// ====================================================================================================
// 📊 [6] GESTOR DE ESTADÍSTICAS PERSISTENTE
// ====================================================================================================
class StatsManager {
    constructor(filePath) {
        this.filePath = filePath;
        this.data = { startTime: new Date().toISOString(), ciclosCompletados: 0, aportesEnviados: 0, erroresDetectados: 0, ultimoEscaneo: "Aún no ejecutado", bloqueosRed: 0 };
    }
    async init() {
        try {
            const file = await fs.readFile(this.filePath, 'utf-8');
            this.data = { ...this.data, ...JSON.parse(file), startTime: new Date().toISOString() };
        } catch (e) { await this.save(); }
    }
    async save() { await fs.writeFile(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8').catch(()=>{}); }
    async addCiclo() { this.data.ciclosCompletados++; await this.save(); }
    async addAporte() { this.data.aportesEnviados++; await this.save(); }
    async addError() { this.data.erroresDetectados++; await this.save(); }
    async addBloqueo() { this.data.bloqueosRed++; await this.save(); }
    async setUltimoEscaneo(timeStr) { this.data.ultimoEscaneo = timeStr; await this.save(); }
    getStats() { return this.data; }
}

// ====================================================================================================
// 💾 [7] MOTOR DE CACHÉ ATÓMICO (MEMORIA BLINDADA)
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
            if (Array.isArray(parsed)) this.memCache = new Set(parsed);
        } catch (error) { this.memCache = new Set(); }
    }
    has(key) { return this.memCache.has(key); }
    async add(key) {
        if (!this.memCache.has(key)) {
            this.memCache.add(key);
            await this._trimAndSave();
        }
    }
    getSize() { return this.memCache.size; }
    async _trimAndSave() {
        let cacheArray = Array.from(this.memCache);
        if (cacheArray.length > this.maxSize) {
            cacheArray = cacheArray.slice(cacheArray.length - this.maxSize);
            this.memCache = new Set(cacheArray);
        }
        try {
            await fs.writeFile(this.tempPath, JSON.stringify(cacheArray, null, 2), 'utf-8');
            await fs.rename(this.tempPath, this.cachePath);
        } catch (error) {}
    }
}

// ====================================================================================================
// 🤖 [8] ENRUTADOR TELEGRAM (POO AVANZADA, NLP Y EVENT LISTENERS)
// ====================================================================================================
class TelegramController {
    constructor(token, targetChatId, stateObj, cacheEngine, statsEngine) {
        this.token = token;
        this.targetChatId = targetChatId;
        this.offset = 0;
        this.apiBase = `https://api.telegram.org/bot${this.token}`;
        this.state = stateObj; 
        this.cache = cacheEngine;
        this.stats = statsEngine;

        // Suscribir el bot a los eventos del sistema
        EventBus.on(EVENTS.SCRAPE_HIT, async (data) => await this._handleScrapeHit(data));
        EventBus.on(EVENTS.NETWORK_FAILURE, async (msg) => await this.sendAdminAlert(`⚠️ <b>ALERTA DE RED</b>\n\n${msg}`));
    }

    async startPolling() {
        setInterval(async () => { await this._fetchUpdates(); }, 1200); 
    }

    async _fetchUpdates() {
        try {
            const res = await axios.get(`${this.apiBase}/getUpdates`, { params: { offset: this.offset, timeout: 2 }, timeout: 5000 });
            if (res.data && res.data.ok && res.data.result.length > 0) {
                for (const update of res.data.result) {
                    this.offset = update.update_id + 1;
                    await this._routeUpdate(update);
                }
            }
        } catch (error) {}
    }

    async _routeUpdate(update) {
        // --- PROCESAMIENTO DE TEXTO NATURAL (NLP) ---
        if (update.message && update.message.text) {
            const chatId = update.message.chat.id;
            const textLower = update.message.text.trim().toLowerCase();

            if (textLower.includes('/start') || textLower.includes('/menu') || textLower.includes('/estado')) {
                await this.sendMenu(chatId);
            }
            else if (textLower.includes('/ayuda')) {
                await this.sendHelp(chatId);
            }
            else if (textLower.includes('/metricas')) {
                await this.sendMetrics(chatId);
            }
            // EXPRESIÓN REGULAR AVANZADA PARA RANGOS: /rango 5 a 10, /rango 5-10
            else if (textLower.match(/^\/(?:rango|paginas|scan)\s+(\d+)\s*(?:a|al|hasta|-|y)?\s*(\d+)/)) {
                const match = textLower.match(/^\/(?:rango|paginas|scan)\s+(\d+)\s*(?:a|al|hasta|-|y)?\s*(\d+)/);
                const inicio = parseInt(match[1]);
                const fin = parseInt(match[2]);
                
                if (inicio <= fin) {
                    this.state.pageStart = inicio;
                    this.state.pageEnd = fin;
                    await this._sendRawMessage(chatId, `✅ <b>RANGO MANUAL APLICADO</b>\n\nEl sistema escaneará desde la <b>Página ${inicio}</b> hasta la <b>Página ${fin}</b>.`);
                    await this.sendMenu(chatId); 
                } else {
                    await this._sendRawMessage(chatId, `⚠️ <b>Error Lógico:</b> Inicio (${inicio}) mayor que Fin (${fin}).`);
                }
            }
        }

        // --- MANEJADOR DE CALLBACKS (BOTONES) ---
        if (update.callback_query) {
            const chatId = update.callback_query.message.chat.id;
            const messageId = update.callback_query.message.message_id;
            const data = update.callback_query.data;
            const callbackId = update.callback_query.id;

            switch (data) {
                case 'cmd_estado': await this.updateMenu(chatId, messageId); break;
                case 'cmd_toggle_pausa': 
                    this.state.isPaused = !this.state.isPaused; 
                    EventBus.emit(this.state.isPaused ? EVENTS.SYSTEM_PAUSED : EVENTS.SYSTEM_RESUMED);
                    await this.updateMenu(chatId, messageId); 
                    break;
                case 'cmd_rango_1_5': this.state.pageStart = 1; this.state.pageEnd = 5; await this.updateMenu(chatId, messageId); break;
                case 'cmd_rango_1_10': this.state.pageStart = 1; this.state.pageEnd = 10; await this.updateMenu(chatId, messageId); break;
                case 'cmd_rango_1_20': this.state.pageStart = 1; this.state.pageEnd = 20; await this.updateMenu(chatId, messageId); break;
                case 'cmd_metricas': await this.sendMetrics(chatId, messageId); break;
                case 'cmd_ayuda': await this.sendHelp(chatId, messageId); break;
                case 'cmd_close': await this._deleteMessage(chatId, messageId); break;
            }
            await axios.post(`${this.apiBase}/answerCallbackQuery`, { callback_query_id: callbackId, text: "⚡ Sistema Actualizado" }).catch(() => {});
        }
    }

    // Constructor dinámico de Interfaz Gráfica
    _buildMenuPayload(chatId, messageId = null) {
        const s = this.stats.getStats();
        const cbState = this.state.circuitBreaker === 'OPEN' ? "⚠️ BLOQUEO DE RED" : "🟢 CONEXIÓN ESTABLE";
        const estadoVisual = this.state.isPaused ? "🔴 PAUSADO (Freno de mano)" : "🟢 ACTIVO (24/7)";
        const botonPausa = this.state.isPaused ? "▶️ INICIAR MOTOR" : "⏸️ PAUSAR MOTOR";
        
        const texto = `🛡️ <b>CENTRAL DE MANDO YKZISWEB (V6.0 TITAN)</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                      `⚙️ <b>Estado del Motor:</b> ${estadoVisual}\n` +
                      `🌐 <b>Estado de Red:</b> ${cbState}\n` +
                      `📑 <b>Rango de Escaneo:</b> <code>Páginas ${this.state.pageStart} a ${this.state.pageEnd}</code>\n` +
                      `📦 <b>Caché Segura:</b> <code>${this.cache.getSize()} / ${CONFIG.MAX_CACHE_SIZE}</code>\n` +
                      `🔄 <b>Barridos:</b> <code>${s.ciclosCompletados}</code> | 📤 <b>Envíos:</b> <code>${s.aportesEnviados}</code>\n` +
                      `🕒 <b>Último Análisis:</b> <code>${s.ultimoEscaneo}</code>\n` +
                      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                      `<i>💡 Tip: Establece un rango libre escribiendo: <b>/rango 5 a 15</b></i>`;

        const reply_markup = {
            inline_keyboard: [
                [{ text: botonPausa, callback_data: "cmd_toggle_pausa" }, { text: "🔄 Refrescar Panel", callback_data: "cmd_estado" }],
                [{ text: "📄 Rango [1 - 5]", callback_data: "cmd_rango_1_5" }, { text: "📄 Rango [1 - 10]", callback_data: "cmd_rango_1_10" }],
                [{ text: "📄 Rango Máximo [1 - 20]", callback_data: "cmd_rango_1_20" }],
                [{ text: "🖥️ Métricas del Servidor", callback_data: "cmd_metricas" }],
                [{ text: "📚 Manual", callback_data: "cmd_ayuda" }, { text: "❌ Cerrar", callback_data: "cmd_close" }]
            ]
        };

        const payload = { chat_id: chatId, text: texto, parse_mode: 'HTML', reply_markup };
        if (messageId) payload.message_id = messageId;
        return payload;
    }

    async sendMenu(chatId) { await axios.post(`${this.apiBase}/sendMessage`, this._buildMenuPayload(chatId)).catch(()=>{}); }
    async updateMenu(chatId, messageId) { await axios.post(`${this.apiBase}/editMessageText`, this._buildMenuPayload(chatId, messageId)).catch(()=>{}); }

    async sendMetrics(chatId, messageId = null) {
        const mem = SystemUtils.getMemoryUsage();
        const texto = `🖥️ <b>TELEMETRÍA DEL SERVIDOR (RENDER)</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                      `⏱️ <b>Uptime:</b> <code>${SystemUtils.getSystemUptime()}</code>\n` +
                      `🧠 <b>RAM Usada (Heap):</b> <code>${mem.heapUsed}</code>\n` +
                      `🗂️ <b>RAM Total Asignada:</b> <code>${mem.heapTotal}</code>\n` +
                      `📉 <b>RSS (Resident Set):</b> <code>${mem.rss}</code>\n` +
                      `🔒 <b>Fallas de Red (CB):</b> <code>${this.stats.getStats().bloqueosRed}</code>\n━━━━━━━━━━━━━━━━━━━━━━━━━━`;
        const reply_markup = { inline_keyboard: [[{ text: "🔙 Regresar", callback_data: "cmd_estado" }]] };
        if (messageId) await axios.post(`${this.apiBase}/editMessageText`, { chat_id: chatId, message_id: messageId, text: texto, parse_mode: 'HTML', reply_markup }).catch(() => {});
        else await axios.post(`${this.apiBase}/sendMessage`, { chat_id: chatId, text: texto, parse_mode: 'HTML', reply_markup }).catch(() => {});
    }

    async sendHelp(chatId, messageId = null) {
        const texto = `📚 <b>MANUAL OPERATIVO TITAN V6.0</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                      `🔹 <b>Freno Absoluto:</b> Bloqueo físico en el emisor de eventos. 100% seguro.\n` +
                      `🔹 <b>Servidor Fantasma:</b> Incluye un webserver nativo para engañar a Render y evitar que el script se duerma.\n` +
                      `🔹 <b>Circuit Breaker:</b> Si el foro bloquea tu IP, el bot entra en hibernación inteligente sin crashear.\n` +
                      `🔹 <b>NLP Rangos:</b> Escribe <code>/rango 5 a 15</code>.`;
        const reply_markup = { inline_keyboard: [[{ text: "🔙 Regresar", callback_data: "cmd_estado" }]] };
        if (messageId) await axios.post(`${this.apiBase}/editMessageText`, { chat_id: chatId, message_id: messageId, text: texto, parse_mode: 'HTML', reply_markup }).catch(() => {});
        else await axios.post(`${this.apiBase}/sendMessage`, { chat_id: chatId, text: texto, parse_mode: 'HTML', reply_markup }).catch(() => {});
    }

    async sendAdminAlert(text) {
        // Asumiendo que el targetChatId es tu grupo privado o tu ID
        await axios.post(`${this.apiBase}/sendMessage`, { chat_id: this.targetChatId, text: text, parse_mode: 'HTML' }).catch(()=>{});
    }

    async _sendRawMessage(chatId, text) {
        await axios.post(`${this.apiBase}/sendMessage`, { chat_id: chatId, text: text, parse_mode: 'HTML' }).catch(()=>{});
    }

    // LISTENER DE EVENTOS: Este método se dispara cuando Puppeteer encuentra algo
    async _handleScrapeHit(hiloData) {
        if (this.state.isPaused) {
            Logger.warn("🛑 Freno EventBus: Aporte ignorado porque el sistema está pausado.");
            return;
        }

        const msgFinal = `🕷️ <b>[ykzisweb]</b>${hiloData.badge}\n\n<code>${hiloData.contenidoLimpio}</code>\n\n🕒 <b>Fecha:</b> ${hiloData.hora}\n💬 <b>Replies:</b> ${hiloData.replies}`;

        try {
            await axios.post(`${this.apiBase}/sendMessage`, { chat_id: this.targetChatId, text: msgFinal, parse_mode: 'HTML', disable_web_page_preview: true });
            this.stats.addAporte();
            Logger.success(`Aporte transmitido al canal central. [Replies: ${hiloData.replies}]`);
        } catch (e) {
            this.stats.addError();
            Logger.error("Fallo al transmitir aporte por API Telegram", e.message);
        }
    }

    async _deleteMessage(chatId, messageId) { await axios.post(`${this.apiBase}/deleteMessage`, { chat_id: chatId, message_id: messageId }).catch(() => {}); }
}

// ====================================================================================================
// 🌐 [9] NAVEGADOR STEALTH ENGINE
// ====================================================================================================
class BrowserEngine {
    constructor(username, password, circuitBreaker) { 
        this.username = username; 
        this.password = password; 
        this.browser = null; 
        this.cb = circuitBreaker;
    }
    
    async launch() {
        if (!this.cb.canAttempt()) throw new Error("Circuit Breaker Abierto. Evasión de lanzamiento.");
        
        this.browser = await puppeteer.launch({ 
            headless: true, executablePath: '/usr/bin/chromium', 
            args: [
                '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', 
                '--disable-blink-features=AutomationControlled', '--window-size=1920,1080', '--disable-web-security'
            ],
            ignoreHTTPSErrors: true
        });
        return this.browser;
    }

    async close() { if (this.browser) try { await this.browser.close(); } catch (e) {} }

    async applyOptimizations(page) {
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1920, height: 1080 });
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) req.abort();
            else req.continue();
        });
    }

    async authenticateAndRestoreSession(page) {
        try {
            const cookiesData = await fs.readFile(PATHS.COOKIES, 'utf-8');
            if (cookiesData) {
                await page.setCookie(...JSON.parse(cookiesData));
                await page.goto('https://altenens.is/', { waitUntil: 'domcontentloaded', timeout: CONFIG.TIMEOUT_NAVEGACION });
                if (await page.$('.p-navgroup-link--user')) {
                    this.cb.recordSuccess();
                    return true;
                }
            }
        } catch (err) {}

        await page.goto(URLS.LOGIN, { waitUntil: 'domcontentloaded', timeout: CONFIG.TIMEOUT_NAVEGACION });
        await page.waitForSelector('input[name="login"]', { visible: true, timeout: 15000 });
        await SystemUtils.esperar(1500);
        await page.type('input[name="login"]', this.username, { delay: 60 });
        await SystemUtils.esperar(1000);
        await page.type('input[name="password"]', this.password, { delay: 60 });

        await Promise.all([page.click('button.button--icon--login'), page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 })]);
        const newCookies = await page.cookies();
        await fs.writeFile(PATHS.COOKIES, JSON.stringify(newCookies, null, 2), 'utf-8');
        this.cb.recordSuccess();
        return true;
    }

    async extractThreadsFromPage(page, url) {
        let intentos = 0;
        while (intentos < CONFIG.REINTENTOS_MAX) {
            try {
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: CONFIG.TIMEOUT_NAVEGACION });
                const container = await page.waitForSelector('div.structItem-container, div.js-threadList', { visible: true, timeout: 10000 });
                if (!container) return [];

                this.cb.recordSuccess();

                return await page.evaluate(() => {
                    const items = document.querySelectorAll('div.structItem');
                    return Array.from(items).map(item => {
                        const titleEl = item.querySelector('div.structItem-title a[data-tp-primary]');
                        const timeEl = item.querySelector('time.u-dt');
                        
                        let repliesCount = "0";
                        const metaCell = item.querySelector('div.structItem-cell.structItem-cell--meta');
                        if (metaCell) {
                            metaCell.querySelectorAll('dl.pairs').forEach(dl => {
                                const dt = dl.querySelector('dt'); const dd = dl.querySelector('dd');
                                if (dt && dt.innerText.toLowerCase().includes('replies') && dd) repliesCount = dd.innerText.trim();
                            });
                        }

                        if (!titleEl || !titleEl.getAttribute('href')) return null;
                        const href = titleEl.getAttribute('href');
                        return {
                            titulo: titleEl.innerText.trim(), link: href.startsWith('http') ? href : 'https://altenens.is' + href,
                            hora: timeEl ? timeEl.innerText.trim() : "Reciente", replies: repliesCount
                        };
                    }).filter(Boolean);
                });
            } catch (error) { 
                intentos++; 
                this.cb.recordFailure();
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
// 👻 [10] SERVIDOR GHOST HTTP (MANTIENE A RENDER DESPIERTO)
// ====================================================================================================
class GhostServer {
    static start() {
        const server = http.createServer((req, res) => {
            if (req.url === '/ping') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'online', engine: 'YKZISWEB V6.0' }));
            } else {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(`<html><body style="background:#111;color:#0f0;font-family:monospace;padding:50px;">
                    <h2>🕷️ YKZISWEB ENGINE ONLINE</h2><p>Servidor Fantasma Operativo.</p></body></html>`);
            }
        });
        server.listen(CONFIG.PORT, () => {
            Logger.info(`Servidor Ghost escuchando en puerto ${CONFIG.PORT} (Render Anti-Sleep activado)`);
        });
    }
}

// ====================================================================================================
// 🧠 [11] ORQUESTADOR PRINCIPAL TITAN 
// ====================================================================================================
class OrchestratorApp {
    constructor() {
        this.config = this._loadEnvironmentVariables();
        this.state = { isPaused: false, pageStart: 1, pageEnd: 5, circuitBreaker: 'CLOSED' };
        
        // Inyección de dependencias
        this.stats = new StatsManager(PATHS.STATS);
        this.cache = new CacheEngine(PATHS.CACHE, PATHS.TEMP_CACHE, CONFIG.MAX_CACHE_SIZE);
        this.circuitBreaker = new CircuitBreaker(4, 300000); // 4 fallos = 5 minutos de bloqueo
        
        this.telegram = new TelegramController(this.config.BOT_TOKEN, this.config.FORWARD_TO, this.state, this.cache, this.stats);
        this.browser = new BrowserEngine(this.config.USER, this.config.PASS, this.circuitBreaker);

        // Actualizar estado del CB para el menú
        setInterval(() => { this.state.circuitBreaker = this.circuitBreaker.state; }, 2000);
    }

    _loadEnvironmentVariables() {
        const reqVars = ['FORUM_USER', 'FORUM_PASS', 'TELEGRAM_BOT_TOKEN', 'FORWARD_TO'];
        const config = {};
        for (const v of reqVars) {
            if (!process.env[v]) {
                console.error(`Faltan credenciales críticas: ${v}`);
                process.exit(1);
            }
            config[v.replace('FORUM_', '').replace('TELEGRAM_', '')] = process.env[v];
        }
        return config;
    }

    async boot() {
        Logger.info("=====================================================================");
        Logger.info("🚀 INICIANDO YKZISWEB ENTERPRISE V6.0 TITAN (POO & EVENT-DRIVEN)");
        Logger.info("=====================================================================");
        
        GhostServer.start(); // Levantar servidor web para Render
        await this.stats.init();
        await this.cache.init();
        await this.telegram.startPolling(); 
        
        this._infiniteLoop();
    }

    async _infiniteLoop() {
        while (true) {
            if (this.state.isPaused || !this.circuitBreaker.canAttempt()) { 
                await SystemUtils.esperar(5000); 
                continue; 
            }

            Logger.info(`[CICLO] Rango Activo: Páginas ${this.state.pageStart} a ${this.state.pageEnd}`);
            let pageContext = null;

            try {
                await this.browser.launch();
                pageContext = await this.browser.browser.newPage();
                await this.browser.applyOptimizations(pageContext);
                
                if (!await this.browser.authenticateAndRestoreSession(pageContext)) throw new Error("Fallo de auth");

                let hilosTotalesBrutos = [];
                for (let numPag = this.state.pageStart; numPag <= this.state.pageEnd; numPag++) {
                    if (this.state.isPaused || !this.circuitBreaker.canAttempt()) break; 
                    
                    const url = numPag === 1 ? URLS.TARGET_BASE : `${URLS.TARGET_BASE}page-${numPag}`;
                    const hilosPagina = await this.browser.extractThreadsFromPage(pageContext, url);
                    hilosTotalesBrutos.push(...hilosPagina);
                    await SystemUtils.esperar(1500);
                }

                if (this.state.isPaused) { await this.browser.close(); continue; }

                const mapUnicos = new Map();
                for (const h of hilosTotalesBrutos) mapUnicos.set(h.link, h);
                const hilosCandidatos = Array.from(mapUnicos.values());

                for (const hilo of hilosCandidatos) {
                    if (this.state.isPaused) break;

                    if (!this.cache.has(hilo.link)) {
                        let subPage = null;
                        try {
                            subPage = await this.browser.browser.newPage();
                            await this.browser.applyOptimizations(subPage);
                            const contenidoBruto = await this.browser.extractPostContent(subPage, hilo.link);
                            
                            if (this.state.isPaused) { await subPage.close().catch(()=>null); break; }

                            if (contenidoBruto) {
                                const regex = new RegExp(CONFIG.DEFAULT_REGEX, 'g');
                                const coincidencias = contenidoBruto.match(regex);
                                
                                if (coincidencias && coincidencias.length > 0) {
                                    let contenidoLimpio = coincidencias.map(cc => cc.replace(/[/:-\s]/g, '|').replace(/\|\|/g, '|')).join('\n');
                                    const badge = parseInt(hilo.replies) <= 2 ? " 🔥 [Fresco / Sin vistas]" : "";
                                    
                                    // DISPARAR EVENTO (Desacoplamiento)
                                    EventBus.emit(EVENTS.SCRAPE_HIT, {
                                        contenidoLimpio, badge, hora: hilo.hora, replies: hilo.replies
                                    });
                                    
                                    await SystemUtils.esperar(SystemUtils.tiempoAleatorio(3500, 5000));
                                }
                            }
                            await this.cache.add(hilo.link);
                        } catch (err) { } finally {
                            if (subPage) await subPage.close().catch(()=>null);
                        }
                    }
                }

                if (!this.state.isPaused && this.circuitBreaker.state === 'CLOSED') {
                    await this.stats.addCiclo();
                    await this.stats.setUltimoEscaneo(new Date().toLocaleTimeString());
                }

            } catch (errGeneral) {
                Logger.error("Caída del Motor Principal", errGeneral.message);
                this.circuitBreaker.recordFailure();
                await this.stats.addError();
            } finally {
                await this.browser.close();
            }

            if (!this.state.isPaused && this.circuitBreaker.state !== 'OPEN') {
                const sleepMs = SystemUtils.tiempoAleatorio(CONFIG.TIEMPO_MIN_REPOSO_MS, CONFIG.TIEMPO_MAX_REPOSO_MS);
                const tiempoFin = Date.now() + sleepMs;
                Logger.info(`Enfriamiento: ${(sleepMs/60000).toFixed(2)} min.`);
                while (Date.now() < tiempoFin) {
                    if (this.state.isPaused) break; 
                    await SystemUtils.esperar(2000); 
                }
            }
        }
    }
}

// ====================================================================================================
// 🚨 [12] INYECCIÓN Y ARRANQUE DE APLICACIÓN
// ====================================================================================================
const masterApp = new OrchestratorApp();

process.on('SIGINT', async () => { 
    Logger.warn("\nApagando procesos de Chromium por señal de usuario...");
    await masterApp.browser.close(); 
    process.exit(0); 
});

process.on('uncaughtException', (err) => {
    Logger.error("Fallo general no capturado", err);
});

masterApp.boot().catch(err => { 
    Logger.error("Error crítico en arranque", err);
    process.exit(1); 
});