#!/usr/bin/env python3
"""Bot Telegram: @s3tdupload_bot - uploader to S3 ToDus"""
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

def format_size(b):
    if b < 1024: return f"{b} B"
    elif b < 1024*1024: return f"{b/1024:.1f} KB"
    elif b < 1024*1024*1024: return f"{b/(1024*1024):.1f} MB"
    return f"{b/(1024*1024*1024):.1f} GB"

bot = TelegramClient(SESSION_FILE, API_ID, API_HASH)

def get_filename(event):
    if event.message.file and event.message.file.name:
        return event.message.file.name
    if event.message.photo:
        return f"photo_{event.message.photo.id}.jpg"
    if event.message.video:
        return f"video_{event.message.video.id}.mp4"
    if event.message.audio:
        return f"audio_{event.message.audio.id}.mp3"
    if event.message.document:
        mime = event.message.document.mime_type or ""
        ext_map = {
            "application/pdf": ".pdf", "application/zip": ".zip",
            "application/x-rar": ".rar", "image/jpeg": ".jpg",
            "image/png": ".png", "video/mp4": ".mp4",
            "audio/mpeg": ".mp3",
        }
        ext = ext_map.get(mime, ".bin")
        return f"document_{uuid.uuid4().hex[:6]}{ext}"
    return f"file_{uuid.uuid4().hex[:6]}.bin"

async def upload_async(event, filepath, filename, size):
    msg = await event.reply("PROCESSING...")
    ext = os.path.splitext(filename)[1] or ".bin"

    remote = f"{uuid.uuid4().hex[:8]}_{filename}"
    url = f"{S3}/{remote}"

    # Subir SIN generador - directo
    def subir():
        try:
            with open(filepath, 'rb') as f:
                headers = {"Content-Length": str(size)}
                return requests.put(url, data=f, headers=headers, timeout=300)
        except Exception as e:
            print(f"Upload error: {e}")
            return None

    result = await bot.loop.run_in_executor(None, subir)

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

    if event.message.file or event.message.document or event.message.photo:
        filename = get_filename(event)
        ext = os.path.splitext(filename)[1] or ".bin"
        temp_path = os.path.join(DOWNLOAD_PATH, f"{uuid.uuid4().hex}{ext}")
        filepath = await event.message.download_media(file=temp_path)
        if filepath:
            size = os.path.getsize(filepath)
            asyncio.create_task(upload_async(event, filepath, filename, size))
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
