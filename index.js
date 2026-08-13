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

function getAllVideoQualities(videoData) {
    const qualities = [];
    
    if (videoData.document) {
        const attr = videoData.document.attributes.find(a => a._ === 'DocumentAttributeVideo');
        qualities.push({
            file_id: videoData.document.id,
            size: videoData.document.size,
            width: attr?.w || 0,
            height: attr?.h || 0,
            quality: `${attr?.w || 0}p`
        });
    }
    
    if (videoData.alt_documents) {
        for (const doc of videoData.alt_documents) {
            const attr = doc.attributes.find(a => a._ === 'DocumentAttributeVideo');
            if (attr && doc.mime_type === 'video/mp4') {
                qualities.push({
                    file_id: doc.id,
                    size: doc.size,
                    width: attr.w || 0,
                    height: attr.h || 0,
                    quality: `${attr.w || 0}p`
                });
            }
        }
    }
    
    qualities.sort((a, b) => a.size - b.size);
    return qualities;
}

bot.start(async (ctx) => {
    await ctx.reply(
        `👋 Envíame un archivo y lo subo a ToDus S3\n` +
        `📦 Límite: 50 MB\n` +
        `🎬 Videos: puedes elegir la calidad`
    );
});

// ─── PROCESAR ARCHIVO CON getFileLink() ───
async function processFile(ctx, fileId, filename, ext, fileInfo = {}) {
    try {
        // ✅ OBTENER URL DIRECTA (sin límite de tamaño)
        const fileLink = await ctx.telegram.getFileLink(fileId);
        
        const totalSize = fileInfo.size || 0;
        
        if (totalSize > MAX_FILE_SIZE) {
            await ctx.reply(
                `❌ Archivo muy grande\n📏 ${formatSize(totalSize)} > ${formatSize(MAX_FILE_SIZE)}`
            );
            return;
        }

        const status = await ctx.reply("⏳ Procesando...");
        const tempPath = path.join(DOWNLOAD_PATH, `${crypto.randomBytes(8).toString('hex')}${ext}`);

        // Descargar usando la URL directa
        const response = await axios({
            method: 'get',
            url: fileLink.toString(), // ✅ URL directa
            responseType: 'stream',
            timeout: 300000
        });

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

        // Subir a S3
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

// ─── VIDEOS CON BOTONES ───
bot.on('video', async (ctx) => {
    try {
        const videoData = ctx.message.video;
        const qualities = getAllVideoQualities(videoData);
        
        if (qualities.length === 0) {
            await ctx.reply('❌ No se pudo procesar el video');
            return;
        }
        
        if (qualities.length === 1) {
            const q = qualities[0];
            await ctx.reply(`🎬 ${q.quality} - ${formatSize(q.size)}`);
            await processFile(ctx, q.file_id, `video_${q.file_id}.mp4`, '.mp4', {
                quality: q.quality,
                resolution: `${q.width}x${q.height}`,
                size: q.size
            });
            return;
        }
        
        // Múltiples calidades: botones
        const buttons = [];
        for (const q of qualities) {
            let emoji = '📹';
            if (q.quality.includes('720')) emoji = '🎬';
            else if (q.quality.includes('480')) emoji = '📱';
            else if (q.quality.includes('360')) emoji = '📱';
            
            buttons.push([{
                text: `${emoji} ${q.quality} (${formatSize(q.size)})`,
                callback_data: `q_${q.file_id}_${q.quality}_${q.width}_${q.height}_${q.size}`
            }]);
        }
        buttons.push([{ text: '❌ Cancelar', callback_data: 'cancel' }]);
        
        await ctx.reply(
            `🎬 Elige la calidad:`,
            { reply_markup: { inline_keyboard: buttons } }
        );
        
    } catch (e) {
        console.error('Error:', e);
        await ctx.reply(`❌ Error: ${e.message}`);
    }
});

// ─── SELECCIÓN DE CALIDAD ───
bot.action(/q_(.+)_(.+)_(.+)_(.+)_(.+)/, async (ctx) => {
    try {
        const match = ctx.match;
        const fileId = match[1];
        const quality = match[2];
        const width = match[3];
        const height = match[4];
        const size = parseInt(match[5]);
        
        await ctx.answerCbQuery(`✅ ${quality}`);
        await ctx.deleteMessage();
        
        await ctx.reply(`✅ ${quality} - ${formatSize(size)}`);
        await processFile(ctx, fileId, `video_${fileId}.mp4`, '.mp4', {
            quality: quality,
            resolution: `${width}x${height}`,
            size: size
        });
        
    } catch (e) {
        console.error('Error:', e);
        await ctx.reply(`❌ Error: ${e.message}`);
    }
});

bot.action('cancel', async (ctx) => {
    await ctx.answerCbQuery('❌ Cancelado');
    await ctx.deleteMessage();
    await ctx.reply('❌ Cancelado');
});

// ─── DOCUMENTOS ───
bot.on('document', async (ctx) => {
    try {
        const doc = ctx.message.document;
        const filename = doc.file_name || `doc_${doc.file_id}`;
        const ext = path.extname(filename) || '.bin';
        await processFile(ctx, doc.file_id, filename, ext, { 
            type: 'documento',
            size: doc.file_size || 0
        });
    } catch (e) {
        await ctx.reply(`❌ ${e.message}`);
    }
});

// ─── FOTOS ───
bot.on('photo', async (ctx) => {
    try {
        const photos = ctx.message.photo;
        const photo = photos[photos.length - 1];
        await processFile(ctx, photo.file_id, `photo_${photo.file_id}.jpg`, '.jpg', { 
            type: 'foto',
            size: photo.file_size || 0
        });
    } catch (e) {
        await ctx.reply(`❌ ${e.message}`);
    }
});

// ─── AUDIOS ───
bot.on('audio', async (ctx) => {
    try {
        const audio = ctx.message.audio;
        await processFile(ctx, audio.file_id, `audio_${audio.file_id}.mp3`, '.mp3', { 
            type: 'audio',
            size: audio.file_size || 0
        });
    } catch (e) {
        await ctx.reply(`❌ ${e.message}`);
    }
});

// ─── SERVIDOR ───
const app = express();
app.get('/', (req, res) => res.json({ status: 'online', uptime: process.uptime() }));
app.get('/health', (req, res) => res.json({ status: 'healthy' }));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🌐 Web en ${PORT}`));

// ─── KEEP ALIVE ───
setInterval(() => {
    axios.get(`https://s3-uploader-eplj.onrender.com/health`).catch(() => {});
}, 300000);

bot.launch();
console.log('🤖 Bot iniciado');
console.log('✅ Usando getFileLink() para archivos grandes');
