/**
 * ==============================================================================
 * 🚀 PUNTO DE ENTRADA PRINCIPAL - WEB SCRAPER AUTÓNOMO 24/7 (HTTP BOT API)
 * ==============================================================================
 */

require("dotenv").config();
const { revisarWebYEnviar } = require("./scraper");

// Función auxiliar para gestionar esperas seguras ante caídas de red
const esperar = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function iniciarServicioConResiliencia() {
    console.log("======================================================");
    console.log("🚀 INICIANDO SUBSISTEMA YKZISWEB - MODO AUTÓNOMO 24/7");
    console.log("======================================================");
    console.log(`🕒 Hora de inicio: ${new Date().toISOString()}`);
    console.log(`🤖 Usando Telegram Bot API HTTP para transmisiones limpias.`);

    let intentosFallidosConsecutivos = 0;
    const MAX_INTENTOS_CRITICOS = 5;

    while (true) {
        try {
            console.log("[Manager] Iniciando ciclo operativo del scraper...");
            
            // Ejecutamos el núcleo del scraper (que ya maneja su propio bucle interno)
            await revisarWebYEnviar();

        } catch (errorFatal) {
            intentosFallidosConsecutivos++;
            console.error(`[Manager][⚠️ ERROR CRÍTICO] El proceso principal se interrumpió:`, errorFatal.message);
            console.error(`[Manager] Intentos fallidos acumulados: ${intentosFallidosConsecutivos}/${MAX_INTENTOS_CRITICOS}`);

            if (intentosFallidosConsecutivos >= MAX_INTENTOS_CRITICOS) {
                console.error("[Manager][❌ ALERTA MÁXIMA] Demasiados fallos consecutivos en el núcleo. Aplicando pausa de enfriamiento de 15 minutos...");
                await esperar(900000); // 15 minutos de respiro para el servidor
                intentosFallidosConsecutivos = 0; // Reiniciamos el contador tras la pausa
            } else {
                console.log("[Manager] Reiniciando el enlace de ejecución en 30 segundos...");
                await esperar(30000); // Pausa de 30 segundos antes de reintentar
            }
        }
    }
}

// Disparador inicial del servicio global
iniciarServicioConResiliencia().catch((errorGlobal) => {
    console.error("[Fatal] Excepción no controlada en el hilo principal de Node.js:", errorGlobal);
    process.exit(1);
});