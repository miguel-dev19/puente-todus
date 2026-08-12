#!/usr/bin/env python3
"""Bot Telegram: @s3tdupload_bot - sube el documento ORIGINAL"""
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

async def upload_async(event, filepath, filename, size):
    msg = await event.reply("DOWNLOADING...")
    ext = os.path.splitext(filename)[1] or ".bin"

    await asyncio.sleep(1)
    await msg.edit("UPLOADING...")

    remote = f"{uuid.uuid4().hex[:8]}_{filename}"
    url = f"{S3}/{remote}"

    def subir():
        try:
            with open(filepath, 'rb') as f:
                headers = {"Content-Length": str(size)}
                return requests.put(url, data=f, headers=headers, timeout=600)
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
    msg = event.message

    if msg.media:
        # Obtener documento principal (NO el alternativo)
        if msg.media.document:
            doc = msg.media.document
            filename = "video.mp4"
            size = doc.size
            for attr in doc.attributes:
                if hasattr(attr, 'file_name') and attr.file_name:
                    filename = attr.file_name
                    break
        else:
            filename = f"file_{uuid.uuid4().hex[:6]}.bin"
            size = 0

        ext = os.path.splitext(filename)[1] or ".bin"
        temp_path = os.path.join(DOWNLOAD_PATH, f"{uuid.uuid4().hex}{ext}")
        
        try:
            # Descargar documento PRINCIPAL
            filepath = await msg.download_media(file=temp_path)
            if filepath:
                actual_size = os.path.getsize(filepath)
                print(f"Documento: {size} | Descargado: {actual_size}")
                asyncio.create_task(upload_async(event, filepath, filename, actual_size))
        except Exception as e:
            await event.reply(f"ERROR: {str(e)[:100]}")
    elif texto == '/start':
        await event.reply("Send me any file and I'll upload it to ToDus S3.")
    elif texto == '/stats':
        uptime = int(time.time() - stats["start_time"])
        h, m = divmod(uptime, 3600); m, s = divmod(m, 60)
        await event.reply(f"UPTIME: {h}h {m}m {s}s\nFILES: {stats['archivos_subidos']}")

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
