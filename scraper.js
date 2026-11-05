/**
 * ====================================================================================================
 * 🕷️ YKZISWEB - MOTOR DE SCRAPING AUTÓNOMO 24/7 ENTERPRISE EDITION V3.0
 * ====================================================================================================
 * Descripción: Sistema masivo de extracción con arquitectura orientada a objetos.
 * Incluye: Logger personalizado, Motor de Caché Atómico, Enrutador de Telegram asíncrono,
 * Evasión avanzada (Stealth) y Control de Ciclos con Backoff exponencial.
 * ====================================================================================================
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();

// Aplicar plugins anti-detección
puppeteer.use(StealthPlugin());

// ====================================================================================================
// ⚙️ CONSTANTES Y CONFIGURACIÓN GLOBAL
// ====================================================================================================
const PATHS = {
    CACHE: path.join(__dirname, 'hilos_vistos_cache.json'),
    COOKIES: path.join(__dirname, 'cookies_foro.json'),
    TEMP_CACHE: path.join(__dirname, 'hilos_vistos_cache.tmp.json') // Para escrituras atómicas
};

const URLS = {
    LOGIN: 'https://altenens.is/login/',
    TARGET_BASE: 'https://altenens.is/forums/accounts-and-database-dumps.45/'
};

const CONFIG = {
    MAX_CACHE_SIZE: 5000,
    TELEGRAM_POLL_TIMEOUT: 2, // Segundos para el long-polling
    TIEMPO_MIN_REPOSO_MS: 180000, // 3 minutos
    TIEMPO_MAX_REPOSO_MS: 300000, // 5 minutos
    REINTENTOS_MAX: 3,
    REGEX_DATOS: /(?:\d{15,16})[|/:-\s]+(?:\d{2})[|/:-\s]+(?:\d{2,4})[|/:-\s]+(?:\d{3,4})/g
};

// ====================================================================================================
// 🛠️ CLASE UTILIDAD: LOGGER PROFESIONAL
// ====================================================================================================
class Logger {
    static info(msg) {
        console.log(`\x1b[36m[INFO]\x1b[0m [${new Date().toLocaleTimeString()}] ${msg}`);
    }
    static success(msg) {
        console.log(`\x1b[32m[ÉXITO]\x1b[0m [${new Date().toLocaleTimeString()}] ${msg}`);
    }
    static warn(msg) {
        console.warn(`\x1b[33m[ALERTA]\x1b[0m [${new Date().toLocaleTimeString()}] ${msg}`);
    }
    static error(msg, err = '') {
        console.error(`\x1b[31m[ERROR]\x1b[0m [${new Date().toLocaleTimeString()}] ${msg}`, err);
    }
    static debug(msg) {
        if (process.env.DEBUG === 'true') {
            console.log(`\x1b[90m[DEBUG]\x1b[0m [${new Date().toLocaleTimeString()}] ${msg}`);
        }
    }
}

// ====================================================================================================
// 🛠️ CLASE UTILIDAD: FUNCIONES DE TIEMPO
// ====================================================================================================
class Utils {
    static esperar(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    static tiempoAleatorio(min, max) {
        return Math.floor(Math.random() * (max - min + 1) + min);
    }
    
    static generarIdUnico() {
        return crypto.randomBytes(8).toString('hex');
    }
}

// ====================================================================================================
// 💾 MOTOR DE CACHÉ: ESCRITURA ATÓMICA Y SEGURA
// ====================================================================================================
class CacheEngine {
    constructor(cachePath, tempPath, maxSize) {
        this.cachePath = cachePath;
        this.tempPath = tempPath;
        this.maxSize = maxSize;
        this.memCache = new Set();
        this.isReady = false;
    }

    async init() {
        try {
            const data = await fs.readFile(this.cachePath, 'utf-8');
            const parsed = JSON.parse(data);
            if (Array.isArray(parsed)) {
                this.memCache = new Set(parsed);
                Logger.info(`Motor de caché inicializado con ${this.memCache.size} registros.`);
            }
        } catch (error) {
            if (error.code === 'ENOENT') {
                Logger.warn('No se encontró archivo de caché previo. Iniciando base de datos en blanco.');
            } else {
                Logger.error('Error crítico al leer caché JSON. Reseteando...', error.message);
            }
            this.memCache = new Set();
        }
        this.isReady = true;
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

    async _trimAndSave() {
        // Convertir a array para truncar si supera el tamaño máximo
        let cacheArray = Array.from(this.memCache);
        if (cacheArray.length > this.maxSize) {
            cacheArray = cacheArray.slice(cacheArray.length - this.maxSize);
            this.memCache = new Set(cacheArray);
        }

        // Escritura atómica: Escribe en temp y renombra (evita corrupción si se corta la luz/proceso)
        try {
            await fs.writeFile(this.tempPath, JSON.stringify(cacheArray, null, 2), 'utf-8');
            await fs.rename(this.tempPath, this.cachePath);
        } catch (error) {
            Logger.error('Fallo al persistir la caché en disco.', error.message);
        }
    }
}

// ====================================================================================================
// 🤖 MÓDULO TELEGRAM: ENRUTADOR Y CONTROL DE UI ASÍNCRONO
// ====================================================================================================
class TelegramController {
    constructor(token, targetChatId) {
        this.token = token;
        this.targetChatId = targetChatId;
        this.offset = 0;
        this.apiBase = `https://api.telegram.org/bot${this.token}`;
        
        // Referencias al estado global administrado por el orquestador
        this.state = null; 
        this.cacheEngine = null;
    }

    bindState(stateObj, cacheEngine) {
        this.state = stateObj;
        this.cacheEngine = cacheEngine;
    }

    async startPolling() {
        Logger.info('Iniciando servicio de Long-Polling de Telegram (Enrutador Activo)...');
        setInterval(async () => {
            await this._fetchUpdates();
        }, 1500); // Polling rápido e independiente
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
            Logger.debug(`Error silencioso en polling de Telegram: ${error.message}`);
        }
    }

    async _routeUpdate(update) {
        // Enrutador de Mensajes de Texto
        if (update.message && update.message.text) {
            const chatId = update.message.chat.id;
            const textRaw = update.message.text.trim();
            const cmd = textRaw.split('@')[0].toLowerCase(); // Soporte para grupos (/cmd@bot)

            Logger.debug(`Comando recibido de [${chatId}]: ${cmd}`);

            if (cmd === '/start' || cmd === '/menu') {
                await this.sendMenu(chatId);
            } else if (cmd.startsWith('/paginas')) {
                await this._handleCommandPaginas(chatId, textRaw);
            } else if (cmd === '/estado') {
                await this.sendMenu(chatId);
            }
        }

        // Enrutador de Callbacks (Botones Inline)
        if (update.callback_query) {
            const chatId = update.callback_query.message.chat.id;
            const messageId = update.callback_query.message.message_id;
            const data = update.callback_query.data;
            const callbackId = update.callback_query.id;

            Logger.debug(`Callback recibido: ${data}`);

            switch (data) {
                case 'cmd_estado':
                    await this.updateMenu(chatId, messageId);
                    break;
                case 'cmd_toggle_pausa':
                    this.state.isPaused = !this.state.isPaused;
                    Logger.info(`Estado cambiado por usuario. Pausado: ${this.state.isPaused}`);
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
                default:
                    Logger.warn(`Callback no reconocido: ${data}`);
            }

            // Responder al callback para quitar el estado de carga en el cliente
            await axios.post(`${this.apiBase}/answerCallbackQuery`, {
                callback_query_id: callbackId,
                text: "⚡ Panel de control actualizado"
            }).catch(() => {});
        }
    }

    async _handleCommandPaginas(chatId, textRaw) {
        const partes = textRaw.split(' ');
        if (partes[1] && partes[1].includes('-')) {
            const [inicio, fin] = partes[1].split('-').map(Number);
            if (!isNaN(inicio) && !isNaN(fin) && inicio <= fin) {
                this.state.pageStart = inicio;
                this.state.pageEnd = fin;
                await this.sendMessage(chatId, `✅ <b>Configuración aplicada:</b>\nEl sistema escaneará dinámicamente desde la página <b>${inicio}</b> hasta la <b>${fin}</b>.`);
            } else {
                await this.sendMessage(chatId, `⚠️ Rango inválido. Asegúrate de que el primer número sea menor o igual al segundo.`);
            }
        } else {
            await this.sendMessage(chatId, `ℹ️ <b>Uso correcto:</b>\nPara definir un rango personalizado escribe: <code>/paginas 1-15</code>`);
        }
    }

    _buildMenuPayload(chatId, messageId = null) {
        const estadoVisual = this.state.isPaused ? "🔴 SISTEMA PAUSADO" : "🟢 SISTEMA ACTIVO (24/7)";
        const botonPausa = this.state.isPaused ? "▶️ INICIAR SISTEMA" : "⏸️ PAUSAR SISTEMA";
        const uptime = this.state.startTime.toLocaleString();
        
        const texto = `🛡️ <b>CENTRAL DE MANDO YKZISWEB (V3.0)</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                      `⚙️ <b>Estado del Motor:</b> ${estadoVisual}\n` +
                      `📑 <b>Rango de Escaneo:</b> <code>Páginas ${this.state.pageStart} a ${this.state.pageEnd}</code>\n` +
                      `📦 <b>Caché Anti-Duplicados:</b> <code>${this.cacheEngine.getSize()} / ${CONFIG.MAX_CACHE_SIZE}</code>\n` +
                      `🔄 <b>Barridos Exitosos:</b> <code>${this.state.cyclesCompleted}</code>\n` +
                      `📤 <b>Aportes Transmitidos:</b> <code>${this.state.totalSent}</code>\n` +
                      `🕒 <b>Último Análisis:</b> <code>${this.state.lastScanTime}</code>\n` +
                      `🚀 <b>Uptime desde:</b> <code>${uptime}</code>\n` +
                      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                      `<i>Selecciona una acción operativa:</i>`;

        const reply_markup = {
            inline_keyboard: [
                [
                    { text: botonPausa, callback_data: "cmd_toggle_pausa" },
                    { text: "🔄 Refrescar Monitor", callback_data: "cmd_estado" }
                ],
                [
                    { text: "📄 Rango [1 - 5]", callback_data: "cmd_rango_1_5" },
                    { text: "📄 Rango [1 - 10]", callback_data: "cmd_rango_1_10" }
                ],
                [
                    { text: "📄 Rango Máximo [1 - 20]", callback_data: "cmd_rango_1_20" }
                ],
                [
                    { text: "📚 Manual de Usuario", callback_data: "cmd_ayuda" },
                    { text: "❌ Cerrar Panel", callback_data: "cmd_close" }
                ]
            ]
        };

        const payload = { chat_id: chatId, text: texto, parse_mode: 'HTML', reply_markup };
        if (messageId) payload.message_id = messageId;
        
        return payload;
    }

    async sendMenu(chatId) {
        const payload = this._buildMenuPayload(chatId);
        await axios.post(`${this.apiBase}/sendMessage`, payload).catch(e => Logger.error('Error al enviar menú', e.message));
    }

    async updateMenu(chatId, messageId) {
        const payload = this._buildMenuPayload(chatId, messageId);
        await axios.post(`${this.apiBase}/editMessageText`, payload).catch(e => Logger.error('Error al actualizar menú', e.message));
    }

    async sendHelp(chatId, messageId) {
        const texto = `📚 <b>MANUAL DE OPERACIONES - YKZISWEB</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                      `🔹 <b>Pausar/Reanudar:</b> Permite detener temporalmente el motor de Puppeteer. La caché en memoria no se vacía.\n` +
                      `🔹 <b>Rango Personalizado:</b> Determina la profundidad del barrido. Escribe <code>/paginas X-Y</code> para definir un rango que no esté en los botones.\n` +
                      `🔹 <b>Manejo de Errores:</b> El bot reinicia automáticamente instancias corruptas del navegador.\n\n` +
                      `<i>Nota: Solo administradores deben operar este panel.</i>`;
                      
        const reply_markup = {
            inline_keyboard: [
                [{ text: "🔙 Regresar al Panel Principal", callback_data: "cmd_estado" }]
            ]
        };

        await axios.post(`${this.apiBase}/editMessageText`, {
            chat_id: chatId, message_id: messageId, text: texto, parse_mode: 'HTML', reply_markup
        }).catch(() => {});
    }

    async sendMessage(chatId, text, disablePreview = false) {
        await axios.post(`${this.apiBase}/sendMessage`, {
            chat_id: chatId,
            text: text,
            parse_mode: 'HTML',
            disable_web_page_preview: disablePreview
        }).catch(e => Logger.error(`Error enviando mensaje plano a ${chatId}`, e.message));
    }

    async _deleteMessage(chatId, messageId) {
        await axios.post(`${this.apiBase}/deleteMessage`, {
            chat_id: chatId,
            message_id: messageId
        }).catch(() => {});
    }
}

// ====================================================================================================
// 🌐 NAVEGADOR STEALTH: GESTIÓN DE PUPPETEER Y EXTRACCIÓN
// ====================================================================================================
class BrowserEngine {
    constructor(username, password) {
        this.username = username;
        this.password = password;
        this.browser = null;
    }

    async launch() {
        Logger.info('Lanzando instancia de Chromium aislada (Stealth)...');
        this.browser = await puppeteer.launch({ 
            headless: true, // Cambiar a false si se requiere depuración visual local
            executablePath: '/usr/bin/chromium', 
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--disable-blink-features=AutomationControlled', // Evasión extra
                '--window-size=1920,1080'
            ],
            ignoreHTTPSErrors: true
        });
        return this.browser;
    }

    async close() {
        if (this.browser) {
            try {
                await this.browser.close();
                Logger.debug('Instancia de navegador cerrada exitosamente.');
            } catch (e) {
                Logger.warn('Excepción al forzar el cierre del navegador: ' + e.message);
            }
        }
    }

    async applyOptimizations(page) {
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1920, height: 1080 });
        
        // Interceptación de recursos para ahorrar RAM y Ancho de banda
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const blockedTypes = ['image', 'stylesheet', 'font', 'media', 'ping', 'beacon'];
            if (blockedTypes.includes(req.resourceType())) {
                req.abort();
            } else {
                req.continue();
            }
        });
    }

    async authenticateAndRestoreSession(page) {
        Logger.info("Validando persistencia de sesión...");
        try {
            const cookiesData = await fs.readFile(PATHS.COOKIES, 'utf-8');
            const cookiesArray = JSON.parse(cookiesData);
            
            if (cookiesArray && cookiesArray.length > 0) {
                await page.setCookie(...cookiesArray);
                await page.goto('https://altenens.is/', { waitUntil: 'domcontentloaded', timeout: 45000 });
                
                // Buscar el avatar/link de usuario para confirmar sesión
                const userElement = await page.$('.p-navgroup-link--user');
                if (userElement) {
                    Logger.success("¡Sesión restaurada desde disco! Evitando re-login.");
                    return true;
                }
            }
        } catch (err) {
            Logger.debug('No existen cookies válidas. Procediendo con autenticación manual.');
        }

        // Proceso de Login Manual con retrasos aleatorios (humanización)
        Logger.warn('Cookies caducadas o inexistentes. Navegando al portal de autenticación...');
        await page.goto(URLS.LOGIN, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.waitForSelector('input[name="login"]', { visible: true, timeout: 15000 });
        
        await Utils.esperar(Utils.tiempoAleatorio(1200, 2500));
        await page.type('input[name="login"]', this.username, { delay: Utils.tiempoAleatorio(50, 110) });
        await Utils.esperar(Utils.tiempoAleatorio(800, 1500));
        await page.type('input[name="password"]', this.password, { delay: Utils.tiempoAleatorio(50, 110) });

        Logger.info("Despachando credenciales al servidor de Altenens...");
        await Promise.all([
            page.click('button.button--icon--login'),
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 })
        ]);

        // Respaldo inmediato de la nueva sesión
        const newCookies = await page.cookies();
        await fs.writeFile(PATHS.COOKIES, JSON.stringify(newCookies, null, 2), 'utf-8');
        Logger.success("Autenticación exitosa. Tokens de sesión guardados en bóveda.");
        return true;
    }

    async extractThreadsFromPage(page, url) {
        Logger.info(`Analizando cartelera objetivo: ${url}`);
        let intentos = 0;
        
        while (intentos < CONFIG.REINTENTOS_MAX) {
            try {
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
                
                // Verificar que el contenedor de hilos exista
                const container = await page.waitForSelector('div.structItem-container, div.js-threadList', { visible: true, timeout: 10000 });
                if (!container) return [];

                // Evaluación en el contexto del navegador (Vanilla JS)
                const hilos = await page.evaluate(() => {
                    const items = document.querySelectorAll('div.structItem');
                    return Array.from(items).map(item => {
                        const titleEl = item.querySelector('div.structItem-title a[data-tp-primary], a.p-title-value');
                        const timeEl = item.querySelector('time.u-dt');
                        
                        let repliesCount = "0";
                        const metaCell = item.querySelector('div.structItem-cell.structItem-cell--meta');
                        if (metaCell) {
                            const dls = metaCell.querySelectorAll('dl.pairs');
                            dls.forEach(dl => {
                                const dt = dl.querySelector('dt');
                                const dd = dl.querySelector('dd');
                                if (dt && dt.innerText.toLowerCase().includes('replies')) {
                                    if (dd) repliesCount = dd.innerText.trim();
                                }
                            });
                        }

                        if (!titleEl || !titleEl.getAttribute('href')) return null;
                        
                        const href = titleEl.getAttribute('href');
                        return {
                            titulo: titleEl.innerText.trim(),
                            link: href.startsWith('http') ? href : 'https://altenens.is' + href,
                            hora: timeEl ? timeEl.innerText.trim() : "Recién publicado",
                            replies: repliesCount
                        };
                    }).filter(Boolean); // Remover nulos
                });

                return hilos;

            } catch (error) {
                intentos++;
                Logger.warn(`Fallo al cargar página (Intento ${intentos}/${CONFIG.REINTENTOS_MAX}): ${error.message}`);
                await Utils.esperar(3000 * intentos); // Backoff progresivo
            }
        }
        return [];
    }

    async extractPostContent(page, hiloUrl) {
        try {
            await page.goto(hiloUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
            
            const content = await page.evaluate(() => {
                // Priorizar el cuerpo del primer mensaje (el aporte original)
                const body = document.querySelector('article.message-body div.bbWrapper');
                return body ? body.innerText.trim() : "";
            });
            
            return content;
        } catch (error) {
            Logger.error(`Fallo al extraer contenido del hilo [${hiloUrl}]:`, error.message);
            return null;
        }
    }
}

// ====================================================================================================
// 🧠 ORQUESTADOR PRINCIPAL (THE BRAIN)
// ====================================================================================================
class ScraperApp {
    constructor() {
        this.config = this._loadEnvVars();
        
        // Estado centralizado
        this.state = {
            isPaused: false,
            pageStart: 1,
            pageEnd: 3,
            cyclesCompleted: 0,
            totalSent: 0,
            lastScanTime: "Aún no ejecutado",
            startTime: new Date()
        };

        // Inyección de dependencias
        this.cache = new CacheEngine(PATHS.CACHE, PATHS.TEMP_CACHE, CONFIG.MAX_CACHE_SIZE);
        this.telegram = new TelegramController(this.config.BOT_TOKEN, this.config.FORWARD_TO);
        this.telegram.bindState(this.state, this.cache);
        
        this.browserEngine = new BrowserEngine(this.config.USER, this.config.PASS);
    }

    _loadEnvVars() {
        const reqVars = ['FORUM_USER', 'FORUM_PASS', 'TELEGRAM_BOT_TOKEN', 'FORWARD_TO'];
        const config = {};
        for (const v of reqVars) {
            if (!process.env[v]) {
                Logger.error(`Variable de entorno crítica faltante: ${v}. Revisa tu archivo .env.`);
                process.exit(1);
            }
            config[v.replace('FORUM_', '').replace('TELEGRAM_', '')] = process.env[v];
        }
        return config;
    }

    async boot() {
        Logger.info("==================================================");
        Logger.info("🚀 INICIANDO YKZISWEB ENTERPRISE SCRAPER V3.0");
        Logger.info("==================================================");
        
        await this.cache.init();
        await this.telegram.startPolling(); // Inicia el listener en un hilo separado
        
        // Iniciar el bucle de vida infinito
        this._mainLoop();
    }

    async _mainLoop() {
        while (true) {
            if (this.state.isPaused) {
                Logger.debug("Motor pausado. Saltando ciclo de extracción...");
                await Utils.esperar(10000);
                continue;
            }

            Logger.info(`[CICLO #${this.state.cyclesCompleted + 1}] Iniciando barrido de páginas ${this.state.pageStart} a ${this.state.pageEnd}...`);
            let pageContext = null;

            try {
                // Iniciar Navegador y Sesión
                await this.browserEngine.launch();
                pageContext = await this.browserEngine.browser.newPage();
                await this.browserEngine.applyOptimizations(pageContext);
                
                const isAuthenticated = await this.browserEngine.authenticateAndRestoreSession(pageContext);
                if (!isAuthenticated) throw new Error("Fallo crítico en el túnel de autenticación.");

                // Fase 1: Recolección masiva de hilos en el rango configurado
                let hilosTotalesBrutos = [];
                for (let numPag = this.state.pageStart; numPag <= this.state.pageEnd; numPag++) {
                    if (this.state.isPaused) break; // Salida de emergencia si el admin pausa

                    const url = numPag === 1 ? URLS.TARGET_BASE : `${URLS.TARGET_BASE}page-${numPag}`;
                    const hilosRecogidos = await this.browserEngine.extractThreadsFromPage(pageContext, url);
                    
                    hilosTotalesBrutos.push(...hilosRecogidos);
                    await Utils.esperar(Utils.tiempoAleatorio(1500, 2500)); // Delay entre páginas
                }

                if (this.state.isPaused) {
                    await this.browserEngine.close();
                    continue;
                }

                // Fase 2: Filtrado y Deduplicación en Memoria (URLs únicas de esta pasada)
                const mapUnicos = new Map();
                for (const h of hilosTotalesBrutos) mapUnicos.set(h.link, h);
                const hilosCandidatos = Array.from(mapUnicos.values());
                
                Logger.info(`Barrido completado. Hilos recolectados en esta pasada: ${hilosCandidatos.length}`);

                // Fase 3: Inspección profunda y transmisión de aportes nuevos
                let aportesEnviadosCiclo = 0;

                for (const hilo of hilosCandidatos) {
                    if (this.state.isPaused) break;

                    // Validar contra la Caché Global de 5000 elementos
                    if (!this.cache.has(hilo.link)) {
                        Logger.debug(`Inspeccionando nuevo hilo: "${hilo.titulo}"`);
                        
                        let subPage = null;
                        try {
                            subPage = await this.browserEngine.browser.newPage();
                            await this.browserEngine.applyOptimizations(subPage);
                            
                            const contenidoBruto = await this.browserEngine.extractPostContent(subPage, hilo.link);
                            
                            if (contenidoBruto) {
                                // Procesamiento Regex para tarjetas y bases
                                const coincidencias = contenidoBruto.match(CONFIG.REGEX_DATOS);
                                
                                if (coincidencias && coincidencias.length > 0) {
                                    // Formateo y limpieza de separadores basura
                                    let contenidoLimpio = coincidencias.map(cc => {
                                        return cc.replace(/[/:-\s]/g, '|').replace(/\|\|/g, '|');
                                    }).join('\n');

                                    const badge = parseInt(hilo.replies) <= 2 ? " 🔥 [Fresco / Sin vistas]" : "";
                                    
                                    // Bloque de mensaje Premium
                                    const mensajeTelegram = `🕷️ <b>[ykzisweb]</b>${badge}\n\n` +
                                                            `<code>${contenidoLimpio}</code>\n\n` +
                                                            `🕒 <b>Fecha:</b> ${hilo.hora}\n` +
                                                            `💬 <b>Replies:</b> ${hilo.replies}`;

                                    // Retransmisión al canal/grupo
                                    await this.telegram.sendMessage(this.config.FORWARD_TO, mensajeTelegram, true);
                                    
                                    aportesEnviadosCiclo++;
                                    this.state.totalSent++;
                                    Logger.success(`¡Hit! Datos enviados al grupo principal. (Replies: ${hilo.replies})`);
                                    
                                    await Utils.esperar(Utils.tiempoAleatorio(3500, 5000));
                                }
                            }

                            // Commit inmediato a la caché (incluso si no tiene datos válidos, para no volver a entrar)
                            await this.cache.add(hilo.link);

                        } catch (errSubPage) {
                            Logger.warn(`Error procesando sub-página del hilo: ${errSubPage.message}`);
                        } finally {
                            if (subPage) await subPage.close().catch(()=>null);
                        }
                    }
                }

                // Finalización del ciclo y actualización de estado
                this.state.cyclesCompleted++;
                this.state.lastScanTime = new Date().toLocaleTimeString();
                Logger.info(`Ciclo #${this.state.cyclesCompleted} finalizado con éxito. Aportes generados: ${aportesEnviadosCiclo}.`);

            } catch (errFatal) {
                Logger.error("Fallo crítico durante la ejecución del ciclo principal.", errFatal.stack);
            } finally {
                await this.browserEngine.close();
            }

            // ========================================================================================
            // ⏳ REPOSO INTELIGENTE (SLEEP)
            // ========================================================================================
            if (!this.state.isPaused) {
                const sleepMs = Utils.tiempoAleatorio(CONFIG.TIEMPO_MIN_REPOSO_MS, CONFIG.TIEMPO_MAX_REPOSO_MS);
                const sleepMin = (sleepMs / 60000).toFixed(2);
                Logger.info(`Entrando en fase de reposo preventivo por ${sleepMin} minutos para evadir bloqueos...`);
                
                // Sleep fraccionable: Si se pausa durante el sleep, cortamos la espera
                const tiempoFin = Date.now() + sleepMs;
                while (Date.now() < tiempoFin) {
                    if (this.state.isPaused) break; // Abortar sleep si el usuario pausa la máquina
                    await Utils.esperar(2000); // Check cada 2s
                }
            }
        }
    }
}

// ====================================================================================================
// 🚀 INICIALIZACIÓN DEL SISTEMA Y GESTIÓN DE PROCESOS
// ====================================================================================================
const orquestador = new ScraperApp();

// Atrapar cierres bruscos (Ctrl+C, Render Restart, etc.) para apagar elegantemente
process.on('SIGINT', async () => {
    Logger.warn("\nSeñal SIGINT detectada. Apagando el sistema de forma segura...");
    await orquestador.browserEngine.close();
    process.exit(0);
});
process.on('SIGTERM', async () => {
    Logger.warn("\nSeñal SIGTERM detectada. Apagando motores...");
    await orquestador.browserEngine.close();
    process.exit(0);
});

// Arrancar motor
orquestador.boot().catch(err => {
    Logger.error("Error fatal en el arranque (Boot Sequence).", err.stack);
    process.exit(1);
});