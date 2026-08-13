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

bot.command('start', async (ctx) => {
    await ctx.reply(
        `👋 ¡Hola! Bienvenido a Puente ToDus\n\n` +
        `📤 Envíame cualquier archivo y lo subiré automáticamente a ToDus S3.\n\n` +
        `📎 Puedes enviarme:\n` +
        `• Documentos (PDF, Word, Excel, etc.)\n` +
        `• Imágenes (JPG, PNG, GIF)\n` +
        `• Videos (MP4, AVI, MOV)\n` +
        `• Audios (MP3, WAV, OGG)\n\n` +
        `📦 Límite por archivo: 50 MB\n` +
        `⏱️ Te mostraré el progreso de subida en tiempo real\n\n` +
        `🚀 ¡Envía tu primer archivo ahora mismo!`
    );
});

bot.on('message', async (ctx) => {
    const msg = ctx.message;
    let file, filename, ext;

    if (msg.video) {
        file = await ctx.getFile();
        filename = `video_${msg.video.file_id}.mp4`;
        ext = '.mp4';
    } else if (msg.document) {
        file = await ctx.getFile();
        filename = msg.document.file_name || `doc_${msg.document.file_id}`;
        ext = path.extname(filename) || '.bin';
    } else if (msg.photo) {
        file = await ctx.getFile();
        filename = `photo_${msg.photo[msg.photo.length-1].file_id}.jpg`;
        ext = '.jpg';
    } else if (msg.audio) {
        file = await ctx.getFile();
        filename = `audio_${msg.audio.file_id}.mp3`;
        ext = '.mp3';
    } else {
        return;
    }

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
                    ctx.api.editMessageText(ctx.chat.id, status.message_id,
                        `📥 DESCARGANDO\n` +
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
                ctx.api.editMessageText(ctx.chat.id, status.message_id,
                    `📤 SUBIENDO A TODUS\n` +
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
        await ctx.api.editMessageText(ctx.chat.id, status.message_id,
            `✅ ¡Archivo subido con éxito!\n\n` +
            `📄 Nombre: ${name}\n` +
            `🔖 Extensión: ${ext.replace('.', '')}\n` +
            `📦 Tamaño: ${formatSize(size)}\n` +
            `🔗 URL: ${uploadUrl}\n\n` +
            `📋 ¡El enlace ya está listo para compartir!`
        );

        fs.removeSync(tempPath);

    } catch (e) {
        await ctx.api.editMessageText(ctx.chat.id, status.message_id, 
            `❌ Error al procesar el archivo\n\n` +
            `📝 ${e.message.slice(0, 200)}\n\n` +
            `💡 Intenta de nuevo o envía un archivo más pequeño.`
        );
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
    axios.get('https://puente-todus.onrender.com/health', { timeout: 10000 }).catch(() => {});
}, 300000);

bot.start();
console.log('🤖 Bot Puente ToDus iniciado correctamente');
