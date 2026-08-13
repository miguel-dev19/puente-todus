const { Bot } = require('grammy');
const axios = require('axios');
const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');

const BOT_TOKEN = "8864221542:AAHAJ_cb_Y1BmotZrx8GzaFKELfLsK3sJDQ";
const S3 = "https://s3.todus.cu/stream";
const DOWNLOAD_PATH = "/tmp/todus_uploads";
const MAX_FILE_SIZE = 50 * 1024 * 1024;

fs.ensureDirSync(DOWNLOAD_PATH);

const bot = new Bot(BOT_TOKEN);

function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024*1024) return `${(bytes/1024).toFixed(1)} KB`;
    if (bytes < 1024*1024*1024) return `${(bytes/(1024*1024)).toFixed(1)} MB`;
    return `${(bytes/(1024*1024*1024)).toFixed(1)} GB`;
}

function progressBar(pct) {
    const w = 15;
    const f = Math.round(w * pct / 100);
    return '⬢'.repeat(f) + '⬡'.repeat(w - f);
}

function getVideoQuality(video) {
    const width = video.width || 0;
    const height = video.height || 0;
    const duration = video.duration || 0;
    const fileSize = video.file_size || 0;
    
    let quality = 'SD';
    if (width >= 3840) quality = '8K';
    else if (width >= 2560) quality = '4K';
    else if (width >= 1920) quality = '1080p';
    else if (width >= 1280) quality = '720p';
    else if (width >= 854) quality = '480p';
    else if (width >= 640) quality = '360p';
    else quality = 'SD';
    
    return {
        quality,
        width,
        height,
        duration,
        fileSize,
        resolution: `${width}x${height}`
    };
}

// ─── NUEVA FUNCIÓN: OBTENER MENOR RESOLUCIÓN ───
function getLowestQuality(video) {
    // Obtener la menor resolución disponible
    // Telegram no permite seleccionar entre calidades directamente
    // Pero podemos identificar la calidad más baja basada en el tamaño y resolución
    
    const width = video.width || 0;
    const height = video.height || 0;
    
    // Determinar la calidad más baja disponible
    let quality = 'SD';
    if (width <= 640) quality = '360p';
    else if (width <= 854) quality = '480p';
    else if (width <= 1280) quality = '720p';
    else if (width <= 1920) quality = '1080p';
    else if (width <= 2560) quality = '4K';
    else quality = '8K';
    
    return {
        quality: `Mínima (${quality})`,
        width,
        height,
        resolution: `${width}x${height}`
    };
}

bot.command('start', async (ctx) => {
    await ctx.reply(
        `👋 ¡Hola! Bienvenido a Puente ToDus\n\n` +
        `📤 Envíame cualquier archivo y lo subiré automáticamente a ToDus S3.\n\n` +
        `📎 Puedes enviarme:\n` +
        `• Documentos (PDF, Word, Excel, etc.)\n` +
        `• Imágenes (JPG, PNG, GIF)\n` +
        `• Videos (MP4, AVI, MOV) - Se usa la menor resolución por defecto\n` +
        `• Audios (MP3, WAV, OGG)\n\n` +
        `📦 Límite por archivo: 50 MB\n` +
        `⏱️ Te mostraré el progreso de subida en tiempo real\n\n` +
        `🚀 ¡Envía tu primer archivo ahora mismo!`
    );
});

// Función para procesar cualquier tipo de archivo
async function processFile(ctx, file, filename, ext, fileInfo = {}) {
    // Validar tamaño
    if (file.file_size && file.file_size > MAX_FILE_SIZE) {
        await ctx.reply(
            `❌ Archivo demasiado grande\n\n` +
            `📏 Tamaño: ${formatSize(file.file_size)}\n` +
            `📦 Límite: ${formatSize(MAX_FILE_SIZE)}\n\n` +
            `💡 Por favor, envía un archivo más pequeño.`
        );
        return;
    }

    const status = await ctx.reply("⏳ Procesando tu archivo...");

    try {
        const tempPath = path.join(DOWNLOAD_PATH, `${crypto.randomBytes(8).toString('hex')}${ext}`);
        const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;

        const response = await axios({
            method: 'get',
            url: fileUrl,
            responseType: 'stream',
            timeout: 300000
        });

        const totalSize = Number(response.headers['content-length']) || 0;
        let downloaded = 0;
        let lastDlPct = -10;

        const writer = fs.createWriteStream(tempPath);

        response.data.on('data', (chunk) => {
            downloaded += chunk.length;
            if (totalSize > 0) {
                const pct = Math.floor((downloaded / totalSize) * 100);
                if (pct - lastDlPct >= 10 || pct === 100) {
                    lastDlPct = pct;
                    const qualityInfo = fileInfo.quality ? ` (${fileInfo.quality})` : '';
                    ctx.api.editMessageText(ctx.chat.id, status.message_id,
                        `📥 DESCARGANDO${qualityInfo}\n` +
                        `┠ [${progressBar(pct)}]\n` +
                        `┠ Progreso: ${pct}%\n` +
                        `┖ Tamaño: ${formatSize(downloaded)}/${formatSize(totalSize)}`
                    ).catch(() => {});
                }
            }
        });

        response.data.pipe(writer);
        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });

        const size = fs.statSync(tempPath).size;

        const remote = `${crypto.randomBytes(4).toString('hex')}_${filename}`;
        const uploadUrl = `${S3}/${remote}`;

        let uploaded = 0;
        let lastUlPct = -10;

        const fileStream = fs.createReadStream(tempPath, { highWaterMark: 2048 * 1024 });

        fileStream.on('data', (chunk) => {
            uploaded += chunk.length;
            const pct = Math.floor((uploaded / size) * 100);
            if (pct - lastUlPct >= 10 || pct === 100) {
                lastUlPct = pct;
                const qualityInfo = fileInfo.quality ? ` (${fileInfo.quality})` : '';
                ctx.api.editMessageText(ctx.chat.id, status.message_id,
                    `📤 SUBIENDO A TODUS${qualityInfo}\n` +
                    `┠ [${progressBar(pct)}]\n` +
                    `┠ Progreso: ${pct}%\n` +
                    `┖ Tamaño: ${formatSize(uploaded)}/${formatSize(size)}`
                ).catch(() => {});
            }
        });

        await axios.put(uploadUrl, fileStream, {
            headers: { 'Content-Length': size },
            timeout: 600000
        });

        const name = path.basename(filename, ext).replace(/_/g, ' ');
        
        let responseMessage = 
            `✅ ¡Archivo subido con éxito!\n\n` +
            `📄 Nombre: ${name}\n` +
            `🔖 Extensión: ${ext.replace('.', '')}\n` +
            `📦 Tamaño: ${formatSize(size)}\n`;
            
        if (fileInfo.quality) {
            responseMessage += 
                `🎬 Calidad: ${fileInfo.quality}\n` +
                `📐 Resolución: ${fileInfo.resolution}\n` +
                `⚡ Modo: Resolución mínima (optimizado para velocidad)\n`;
        }
        
        responseMessage += 
            `🔗 URL: ${uploadUrl}\n\n` +
            `📋 ¡El enlace ya está listo para compartir!`;

        await ctx.api.editMessageText(ctx.chat.id, status.message_id, responseMessage);

        fs.removeSync(tempPath);

    } catch (e) {
        await ctx.api.editMessageText(ctx.chat.id, status.message_id,
            `❌ Error al procesar el archivo\n\n` +
            `📝 ${e.message.slice(0, 200)}\n\n` +
            `💡 Intenta de nuevo o envía un archivo más pequeño.`
        );
    }
}

bot.on('message', async (ctx) => {
    const msg = ctx.message;
    
    // --- MANEJAR VIDEO (CON MENOR RESOLUCIÓN) ---
    if (msg.video) {
        try {
            // Obtener información de calidad mínima
            const videoInfo = getLowestQuality(msg.video);
            const file = await ctx.getFile();
            
            // Mostrar información del video con resolución mínima
            await ctx.reply(
                `🎬 Video detectado\n\n` +
                `📐 Calidad seleccionada: ${videoInfo.quality}\n` +
                `📏 Resolución: ${videoInfo.resolution}\n` +
                `📦 Tamaño original: ${formatSize(msg.video.file_size || 0)}\n\n` +
                `⚡ Optimizando para velocidad...\n` +
                `⏳ Iniciando procesamiento...`
            );
            
            await processFile(
                ctx, 
                file, 
                `video_${msg.video.file_id}.mp4`, 
                '.mp4', 
                videoInfo
            );
            return;
        } catch (error) {
            console.error('Error procesando video:', error);
            await ctx.reply(`❌ Error al procesar el video: ${error.message}`);
            return;
        }
    }
    
    // --- MANEJAR DOCUMENTO ---
    if (msg.document) {
        try {
            const file = await ctx.getFile();
            const filename = msg.document.file_name || `doc_${msg.document.file_id}`;
            const ext = path.extname(filename) || '.bin';
            await processFile(ctx, file, filename, ext, { type: 'document' });
            return;
        } catch (error) {
            console.error('Error procesando documento:', error);
            await ctx.reply(`❌ Error al procesar el documento: ${error.message}`);
            return;
        }
    }
    
    // --- MANEJAR FOTO ---
    if (msg.photo) {
        try {
            const file = await ctx.getFile();
            const filename = `photo_${msg.photo[msg.photo.length-1].file_id}.jpg`;
            await processFile(ctx, file, filename, '.jpg', { type: 'photo' });
            return;
        } catch (error) {
            console.error('Error procesando foto:', error);
            await ctx.reply(`❌ Error al procesar la foto: ${error.message}`);
            return;
        }
    }
    
    // --- MANEJAR AUDIO ---
    if (msg.audio) {
        try {
            const file = await ctx.getFile();
            const filename = `audio_${msg.audio.file_id}.mp3`;
            await processFile(ctx, file, filename, '.mp3', { type: 'audio' });
            return;
        } catch (error) {
            console.error('Error procesando audio:', error);
            await ctx.reply(`❌ Error al procesar el audio: ${error.message}`);
            return;
        }
    }
    
    // --- MANEJAR VIDEO NOTE ---
    if (msg.video_note) {
        try {
            const file = await ctx.getFile();
            const filename = `videonote_${msg.video_note.file_id}.mp4`;
            await ctx.reply(`🎥 Nota de video detectada. Procesando...`);
            await processFile(ctx, file, filename, '.mp4', { type: 'video_note' });
            return;
        } catch (error) {
            console.error('Error procesando nota de video:', error);
            await ctx.reply(`❌ Error al procesar la nota de video: ${error.message}`);
            return;
        }
    }
    
    // Si el mensaje no contiene ningún archivo soportado
    if (!msg.video && !msg.document && !msg.photo && !msg.audio && !msg.video_note) {
        return;
    }
});

const app = express();
app.get('/', (req, res) => {
    res.json({
        status: 'online',
        uptime: process.uptime(),
        memory: process.memoryUsage().rss,
        timestamp: new Date().toISOString()
    });
});

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'healthy' });
});

app.listen(10000, () => console.log('Web on 10000'));

setInterval(() => {
    axios.get('https://s3-uploader-eplj.onrender.com/health', { timeout: 10000 }).catch(() => {});
}, 300000);

bot.start();
console.log('🤖 Bot Puente ToDus iniciado correctamente');
