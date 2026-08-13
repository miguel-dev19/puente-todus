const { Telegraf } = require('telegraf');
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

const bot = new Telegraf(BOT_TOKEN);

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

// ─── OBTENER TODAS LAS CALIDADES DE VIDEO ───
function getAllVideoQualities(videoData) {
    const qualities = [];
    
    // 1. Calidad principal
    if (videoData.document) {
        const attr = videoData.document.attributes.find(a => a._ === 'DocumentAttributeVideo');
        qualities.push({
            file_id: videoData.document.id,
            access_hash: videoData.document.access_hash,
            size: videoData.document.size,
            width: attr?.w || 0,
            height: attr?.h || 0,
            quality: `${attr?.w || 0}p`,
            is_main: true,
            mime_type: videoData.document.mime_type,
            label: `📹 ${attr?.w || 0}p (principal)`
        });
    }
    
    // 2. Calidades alternativas
    if (videoData.alt_documents) {
        for (const doc of videoData.alt_documents) {
            const attr = doc.attributes.find(a => a._ === 'DocumentAttributeVideo');
            if (attr && doc.mime_type === 'video/mp4') {
                // Detectar codec
                let codec = '';
                if (doc.attributes.some(a => a.video_codec === 'av01')) codec = 'AV1';
                else if (doc.attributes.some(a => a.video_codec === 'h264')) codec = 'H264';
                
                qualities.push({
                    file_id: doc.id,
                    access_hash: doc.access_hash,
                    size: doc.size,
                    width: attr.w || 0,
                    height: attr.h || 0,
                    quality: `${attr.w || 0}p`,
                    is_main: false,
                    mime_type: doc.mime_type,
                    codec: codec,
                    label: `📹 ${attr.w || 0}p${codec ? ` (${codec})` : ''}`
                });
            }
        }
    }
    
    // Ordenar por tamaño (menor a mayor)
    qualities.sort((a, b) => a.size - b.size);
    
    return qualities;
}

bot.start(async (ctx) => {
    await ctx.reply(
        `👋 ¡Hola! Bienvenido a Puente ToDus\n\n` +
        `📤 Envíame un video y podrás elegir la calidad\n` +
        `📎 También acepto: documentos, fotos, audios\n` +
        `📦 Límite: 50 MB\n\n` +
        `🚀 ¡Envía tu archivo!`
    );
});

// ─── PROCESAR ARCHIVO ───
async function processFile(ctx, fileId, filename, ext, fileInfo = {}) {
    try {
        const file = await ctx.telegram.getFile(fileId);
        
        if (file.file_size && file.file_size > MAX_FILE_SIZE) {
            await ctx.reply(
                `❌ Archivo demasiado grande\n` +
                `📏 ${formatSize(file.file_size)} > ${formatSize(MAX_FILE_SIZE)}`
            );
            return;
        }

        const status = await ctx.reply("⏳ Procesando...");

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
        let lastPct = -10;

        const writer = fs.createWriteStream(tempPath);

        response.data.on('data', (chunk) => {
            downloaded += chunk.length;
            if (totalSize > 0) {
                const pct = Math.floor((downloaded / totalSize) * 100);
                if (pct - lastPct >= 10 || pct === 100) {
                    lastPct = pct;
                    const quality = fileInfo.quality ? ` (${fileInfo.quality})` : '';
                    ctx.telegram.editMessageText(
                        ctx.chat.id,
                        status.message_id,
                        null,
                        `📥 DESCARGANDO${quality}\n` +
                        `┠ [${progressBar(pct)}]\n` +
                        `┠ ${pct}%\n` +
                        `┖ ${formatSize(downloaded)}/${formatSize(totalSize)}`
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
        lastPct = -10;

        const fileStream = fs.createReadStream(tempPath, { highWaterMark: 1024 * 1024 });

        fileStream.on('data', (chunk) => {
            uploaded += chunk.length;
            const pct = Math.floor((uploaded / size) * 100);
            if (pct - lastPct >= 10 || pct === 100) {
                lastPct = pct;
                const quality = fileInfo.quality ? ` (${fileInfo.quality})` : '';
                ctx.telegram.editMessageText(
                    ctx.chat.id,
                    status.message_id,
                    null,
                    `📤 SUBIENDO${quality}\n` +
                    `┠ [${progressBar(pct)}]\n` +
                    `┠ ${pct}%\n` +
                    `┖ ${formatSize(uploaded)}/${formatSize(size)}`
                ).catch(() => {});
            }
        });

        await axios.put(uploadUrl, fileStream, {
            headers: { 'Content-Length': size },
            timeout: 600000
        });

        const name = path.basename(filename, ext).replace(/_/g, ' ');
        let msg = `✅ ¡Subido!\n\n📄 ${name}\n📦 ${formatSize(size)}\n🔗 ${uploadUrl}`;
        
        if (fileInfo.quality) {
            msg += `\n🎬 ${fileInfo.quality} (${fileInfo.resolution})`;
        }

        await ctx.telegram.editMessageText(ctx.chat.id, status.message_id, null, msg);
        fs.removeSync(tempPath);

    } catch (e) {
        console.error('Error:', e);
        await ctx.reply(`❌ Error: ${e.message.slice(0, 150)}`);
    }
}

// ─── MANEJAR VIDEOS CON BOTONES ───
bot.on('video', async (ctx) => {
    try {
        const videoData = ctx.message.video;
        
        // Obtener todas las calidades
        const qualities = getAllVideoQualities(videoData);
        
        if (qualities.length === 0) {
            await ctx.reply('❌ No se pudo procesar el video');
            return;
        }
        
        // Si solo hay una calidad, procesar directamente
        if (qualities.length === 1) {
            const q = qualities[0];
            await ctx.reply(`🎬 Video detectado\n📹 ${q.quality}\n📦 ${formatSize(q.size)}\n\n⏳ Procesando...`);
            
            await processFile(
                ctx,
                q.file_id,
                `video_${q.file_id}.mp4`,
                '.mp4',
                {
                    quality: q.quality,
                    resolution: `${q.width}x${q.height}`,
                    size: q.size
                }
            );
            return;
        }
        
        // ─── MÚLTIPLES CALIDADES: MOSTRAR BOTONES ───
        const buttons = [];
        
        for (const q of qualities) {
            // Determinar emoji según calidad
            let emoji = '📹';
            if (q.quality.includes('720')) emoji = '🎬';
            else if (q.quality.includes('480')) emoji = '📱';
            else if (q.quality.includes('360')) emoji = '📱';
            
            const label = `${emoji} ${q.quality} (${formatSize(q.size)})`;
            const callbackData = `quality_${q.file_id}_${q.access_hash}_${q.quality}_${q.width}x${q.height}`;
            
            buttons.push([{ text: label, callback_data: callbackData }]);
        }
        
        // Botón para cancelar
        buttons.push([{ text: '❌ Cancelar', callback_data: 'cancel' }]);
        
        await ctx.reply(
            `🎬 Video con múltiples calidades\n\n` +
            `📊 Selecciona la calidad que deseas subir:\n` +
            `⚡ Recomendado: la más ligera (arriba)`,
            {
                reply_markup: {
                    inline_keyboard: buttons
                }
            }
        );
        
    } catch (e) {
        console.error('Error en video:', e);
        await ctx.reply(`❌ Error al procesar el video: ${e.message}`);
    }
});

// ─── MANEJAR SELECCIÓN DE CALIDAD ───
bot.action(/quality_(.+)_(.+)_(.+)_(.+)x(.+)/, async (ctx) => {
    try {
        const match = ctx.match;
        const fileId = match[1];
        const accessHash = match[2];
        const quality = match[3];
        const width = match[4];
        const height = match[5];
        
        // Responder al callback (quita el loading)
        await ctx.answerCbQuery(`✅ Seleccionada calidad ${quality}`);
        
        // Eliminar los botones
        await ctx.deleteMessage();
        
        // Informar al usuario
        await ctx.reply(
            `✅ Calidad seleccionada: ${quality}\n` +
            `📐 Resolución: ${width}x${height}\n` +
            `⏳ Iniciando procesamiento...`
        );
        
        // Procesar el archivo
        await processFile(
            ctx,
            fileId,
            `video_${fileId}.mp4`,
            '.mp4',
            {
                quality: quality,
                resolution: `${width}x${height}`
            }
        );
        
    } catch (e) {
        console.error('Error en acción:', e);
        await ctx.reply(`❌ Error: ${e.message}`);
    }
});

// ─── MANEJAR CANCELAR ───
bot.action('cancel', async (ctx) => {
    await ctx.answerCbQuery('❌ Cancelado');
    await ctx.deleteMessage();
    await ctx.reply('❌ Proceso cancelado');
});

// ─── MANEJAR DOCUMENTOS ───
bot.on('document', async (ctx) => {
    try {
        const doc = ctx.message.document;
        const filename = doc.file_name || `doc_${doc.file_id}`;
        const ext = path.extname(filename) || '.bin';
        await processFile(ctx, doc.file_id, filename, ext, { type: 'documento' });
    } catch (e) {
        await ctx.reply(`❌ Error: ${e.message}`);
    }
});

// ─── MANEJAR FOTOS ───
bot.on('photo', async (ctx) => {
    try {
        const photos = ctx.message.photo;
        const photo = photos[photos.length - 1];
        await processFile(ctx, photo.file_id, `photo_${photo.file_id}.jpg`, '.jpg', { type: 'foto' });
    } catch (e) {
        await ctx.reply(`❌ Error: ${e.message}`);
    }
});

// ─── MANEJAR AUDIOS ───
bot.on('audio', async (ctx) => {
    try {
        const audio = ctx.message.audio;
        await processFile(ctx, audio.file_id, `audio_${audio.file_id}.mp3`, '.mp3', { type: 'audio' });
    } catch (e) {
        await ctx.reply(`❌ Error: ${e.message}`);
    }
});

// ─── SERVIDOR WEB ───
const app = express();
app.get('/', (req, res) => res.json({ 
    status: 'online', 
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
}));
app.get('/health', (req, res) => res.json({ status: 'healthy' }));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🌐 Web en puerto ${PORT}`));

// ─── KEEP ALIVE ───
setInterval(() => {
    axios.get(`https://s3-uploader-eplj.onrender.com/health`).catch(() => {});
}, 300000);

// ─── INICIAR BOT ───
bot.launch();
console.log('🤖 Bot Puente ToDus iniciado correctamente');
console.log('🎬 Modo: Selección interactiva de calidad de video');
