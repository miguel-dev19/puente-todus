const { Bot, InlineKeyboard } = require('grammy');
const axios = require('axios');
const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');

const BOT_TOKEN = "8864221542:AAHAJ_cb_Y1BmotZrx8GzaFKELfLsK3sJDQ";
const S3 = "https://s3.todus.cu/stream";
const DOWNLOAD_PATH = "/tmp/todus_uploads";

fs.ensureDirSync(DOWNLOAD_PATH);

const bot = new Bot(BOT_TOKEN);
const pending = new Map();

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

function getVideoQualities(msg) {
    const qualities = [];
    
    if (msg.video) {
        qualities.push({
            file_id: msg.video.file_id,
            size: msg.video.file_size || 0,
            label: `${msg.video.height || '?'}p ${formatSize(msg.video.file_size || 0)}`
        });
    }
    
    if (msg.document?.alt_documents) {
        for (const alt of msg.document.alt_documents) {
            if (alt.mime_type?.startsWith('video/')) {
                let h = 0;
                for (const attr of alt.attributes || []) {
                    if (attr.h) h = attr.h;
                }
                qualities.push({
                    file_id: alt.id,
                    size: alt.size || 0,
                    label: `${h || '?'}p ${formatSize(alt.size || 0)}`
                });
            }
        }
    }
    
    return qualities;
}

async function downloadAndUpload(ctx, file_id, filename, ext) {
    const status = await ctx.reply("DOWNLOADING...");
    
    try {
        const file = await ctx.api.getFile(file_id);
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
            const pct = Math.floor((downloaded / totalSize) * 100);
            if (pct - lastPct >= 10 || pct === 100) {
                lastPct = pct;
                ctx.api.editMessageText(ctx.chat.id, status.message_id,
                    `┎ DOWNLOADING\n┠ [${progressBar(pct)}]\n┠ PERCENTAGE: ${pct}%\n┖ SIZE: ${formatSize(downloaded)}/${formatSize(totalSize)}`
                ).catch(() => {});
            }
        });

        response.data.pipe(writer);
        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });

        const size = fs.statSync(tempPath).size;
        await ctx.api.editMessageText(ctx.chat.id, status.message_id, "UPLOADING...");

        const remote = `${crypto.randomBytes(4).toString('hex')}_${filename}`;
        const uploadUrl = `${S3}/${remote}`;
        
        const fileStream = fs.createReadStream(tempPath);
        await axios.put(uploadUrl, fileStream, {
            headers: { 'Content-Length': size },
            timeout: 600000
        });

        const name = path.basename(filename, ext).replace(/_/g, ' ');
        await ctx.api.editMessageText(ctx.chat.id, status.message_id,
            `┎ NAME: ${name}\n┠ EXTENSION: ${ext.replace('.', '')}\n┠ SIZE: ${formatSize(size)}\n┖ URL: ${uploadUrl}`
        );

        fs.removeSync(tempPath);

    } catch (e) {
        await ctx.api.editMessageText(ctx.chat.id, status.message_id, `ERROR: ${e.message.slice(0, 200)}`);
    }
}

bot.command('start', async (ctx) => {
    await ctx.reply("Send me a video and choose quality.");
});

bot.on('message', async (ctx) => {
    const msg = ctx.message;
    const userId = ctx.from.id;

    if (msg.video || (msg.document && msg.document.mime_type?.startsWith('video/'))) {
        const qualities = getVideoQualities(msg);
        const filename = msg.video?.file_name || msg.document?.file_name || `video_${Date.now()}.mp4`;
        const ext = path.extname(filename) || '.mp4';

        if (qualities.length > 1) {
            pending.set(userId, { qualities, filename, ext });
            
            const keyboard = new InlineKeyboard();
            qualities.forEach((q, i) => {
                keyboard.text(q.label, `quality_${i}`);
                if (i % 2 === 0) keyboard.row();
            });
            
            await ctx.reply("Selecciona una calidad:", { reply_markup: keyboard });
        } else if (qualities.length === 1) {
            await downloadAndUpload(ctx, qualities[0].file_id, filename, ext);
        }
        return;
    }

    if (msg.document || msg.photo || msg.audio) {
        const file = await ctx.getFile();
        let filename, ext;
        
        if (msg.document) {
            filename = msg.document.file_name || `doc_${Date.now()}`;
            ext = path.extname(filename) || '.bin';
        } else if (msg.photo) {
            filename = `photo_${Date.now()}.jpg`;
            ext = '.jpg';
        } else {
            filename = `audio_${Date.now()}.mp3`;
            ext = '.mp3';
        }
        
        await downloadAndUpload(ctx, file.file_id, filename, ext);
    }
});

bot.on('callback_query', async (ctx) => {
    const userId = ctx.from.id;
    const data = ctx.callbackQuery.data;
    
    if (data.startsWith('quality_') && pending.has(userId)) {
        const idx = parseInt(data.split('_')[1]);
        const info = pending.get(userId);
        pending.delete(userId);
        
        const q = info.qualities[idx];
        await ctx.answerCallbackQuery();
        await ctx.editMessageText("DOWNLOADING...");
        await downloadAndUpload(ctx, q.file_id, info.filename, info.ext);
    }
});

const app = express();
app.get('/', (req, res) => res.json({ status: 'online' }));
app.get('/health', (req, res) => res.status(200).json({ status: 'healthy' }));
app.listen(10000, () => console.log('Web on 10000'));

setInterval(() => {
    axios.get('https://s3-uploader.onrender.com/health', { timeout: 10000 }).catch(() => {});
}, 300000);

bot.start();
console.log('BOT READY');
