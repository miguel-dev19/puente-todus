#!/usr/bin/env python3
"""Bot Telegram: @s3tdupload_bot - uploader to S3 ToDus con progreso 100% real"""
import os, uuid, asyncio, requests, time, threading
from telethon import TelegramClient, events

API_ID = 32471788
API_HASH = "cb57130abda56877acf3b3027e569450"
BOT_TOKEN = "8864221542:AAHAJ_cb_Y1BmotZrx8GzaFKELfLsK3sJDQ"
SESSION_FILE = "bot.session"
S3 = "https://s3.todus.cu/stream"
DOWNLOAD_PATH = "/tmp/todus_uploads"
os.makedirs(DOWNLOAD_PATH, exist_ok=True)

stats = {"start_time": time.time(), "archivos_subidos": 0, "total_bytes": 0, "ultimo_archivo": None}

def progress_bar(pct, w=15):
    f = int(w * pct / 100)
    return f"{'⬢' * f}{'⬡' * (w - f)}"

def format_size(b):
    if b < 1024: return f"{b} B"
    elif b < 1024*1024: return f"{b/1024:.1f} KB"
    elif b < 1024*1024*1024: return f"{b/(1024*1024):.1f} MB"
    return f"{b/(1024*1024*1024):.1f} GB"

bot = TelegramClient(SESSION_FILE, API_ID, API_HASH)

def get_filename(event):
    msg = event.message
    if msg.file and msg.file.name:
        return msg.file.name
    if msg.photo:
        return f"photo_{msg.photo.id}.jpg"
    if msg.video:
        return f"video_{msg.video.id}.mp4"
    if msg.audio:
        return f"audio_{msg.audio.id}.mp3"
    if msg.document:
        mime = msg.document.mime_type or ""
        ext_map = {"application/pdf": ".pdf", "application/zip": ".zip", "application/x-rar": ".rar",
                   "image/jpeg": ".jpg", "image/png": ".png", "video/mp4": ".mp4", "audio/mpeg": ".mp3"}
        ext = ext_map.get(mime, ".bin")
        return f"document_{uuid.uuid4().hex[:6]}{ext}"
    return f"file_{uuid.uuid4().hex[:6]}.bin"

async def upload_async(event, filepath, filename, size):
    msg = await event.reply("┎ PROCESSING\n┖ Preparing file...")
    ext = os.path.splitext(filename)[1] or ".bin"

    remote = f"{uuid.uuid4().hex[:8]}_{filename}"
    url = f"{S3}/{remote}"

    # ─── DOWNLOADING (real, del archivo temporal) ───
    downloaded = 0
    dl_last = -10
    with open(filepath, 'rb') as f:
        while True:
            chunk = f.read(2048 * 1024)
            if not chunk: break
            downloaded += len(chunk)
            pct = int((downloaded / size) * 100)
            if pct - dl_last >= 10 or pct == 100:
                dl_last = pct
                await msg.edit(
                    f"┎ DOWNLOADING\n"
                    f"┠ [{progress_bar(pct)}]\n"
                    f"┠ PERCENTAGE: {pct}%\n"
                    f"┖ SIZE: {format_size(downloaded)}/{format_size(size)}"
                )

    # ─── UPLOADING (real) ───
    await msg.edit(
        f"┎ UPLOADING\n"
        f"┠ [{progress_bar(0)}]\n"
        f"┠ PERCENTAGE: 0%\n"
        f"┖ SIZE: 0 B/{format_size(size)}"
    )

    uploaded = 0
    ul_last = -10

    def subir():
        nonlocal uploaded
        with open(filepath, 'rb') as f:
            headers = {"Content-Length": str(size)}
            def gen():
                nonlocal uploaded
                while True:
                    chunk = f.read(2048 * 1024)
                    if not chunk: break
                    uploaded += len(chunk)
                    yield chunk
            return requests.put(url, data=gen(), headers=headers, timeout=300)

    upload_task = bot.loop.run_in_executor(None, subir)

    while not upload_task.done():
        await asyncio.sleep(0.5)
        if size > 0:
            pct = int((uploaded / size) * 100)
            if pct - ul_last >= 10 or pct == 100:
                ul_last = pct
                await msg.edit(
                    f"┎ UPLOADING\n"
                    f"┠ [{progress_bar(pct)}]\n"
                    f"┠ PERCENTAGE: {pct}%\n"
                    f"┖ SIZE: {format_size(uploaded)}/{format_size(size)}"
                )

    result = await upload_task

    if result and result.status_code == 200:
        stats["archivos_subidos"] += 1
        stats["total_bytes"] += size
        stats["ultimo_archivo"] = filename
        name_no_ext = os.path.splitext(filename)[0].replace('_', ' ')
        await msg.edit(
            f"┎ NAME: {name_no_ext}\n"
            f"┠ EXTENSION: {ext.replace('.', '')}\n"
            f"┠ SIZE: {format_size(size)}\n"
            f"┖ URL: {url}"
        )
    else:
        status = result.status_code if result else "failed"
        await msg.edit(f"ERROR: HTTP {status}")

    try: os.remove(filepath)
    except: pass

@bot.on(events.NewMessage)
async def handler(event):
    texto = event.message.text or ""
    msg = event.message

    if msg.media:
        filename = get_filename(event)
        ext = os.path.splitext(filename)[1] or ".bin"
        temp_path = os.path.join(DOWNLOAD_PATH, f"{uuid.uuid4().hex}{ext}")
        try:
            filepath = await msg.download_media(file=temp_path)
            if filepath:
                size = os.path.getsize(filepath)
                asyncio.create_task(upload_async(event, filepath, filename, size))
            else:
                await event.reply("ERROR: Could not download file")
        except Exception as e:
            await event.reply(f"ERROR: {str(e)[:100]}")
    elif texto == '/start':
        await event.reply("Send me any file and I'll upload it to ToDus S3.")
    elif texto == '/stats':
        uptime = int(time.time() - stats["start_time"])
        h, m = divmod(uptime, 3600); m, s = divmod(m, 60)
        await event.reply(
            f"UPTIME: {h}h {m}m {s}s\n"
            f"FILES: {stats['archivos_subidos']}\n"
            f"TOTAL: {format_size(stats['total_bytes'])}\n"
            f"LAST: {stats['ultimo_archivo'] or 'None'}"
        )

def ping_render():
    while True:
        time.sleep(300)
        try: requests.get("https://puente-todus.onrender.com/api/stats", timeout=10)
        except: pass

async def main():
    await bot.start(bot_token=BOT_TOKEN)
    print("BOT READY: @s3tdupload_bot")
    threading.Thread(target=ping_render, daemon=True).start()
    await bot.run_until_disconnected()

asyncio.run(main())
