#!/usr/bin/env python3
"""Bot Telegram: sube archivos a S3 ToDus con progreso"""
import os, uuid, asyncio, requests, time, threading
from telethon import TelegramClient, events

API_ID = 32471788
API_HASH = "cb57130abda56877acf3b3027e569450"
BOT_TOKEN = "8144541638:AAGZq6FDeyvb5qWXiKBW4W-f0KL0fX68CyA"
SESSION_FILE = "bot.session"
S3 = "https://s3.todus.cu/stream"

stats = {
    "start_time": time.time(), "archivos_subidos": 0,
    "total_bytes": 0, "ultimo_archivo": None, "ultimo_error": None
}

def progress_bar(percent, width=15):
    filled = int(width * percent / 100)
    return f"{'⬢' * filled}{'⬡' * (width - filled)}"

def format_size(b):
    if b < 1024*1024: return f"{b/1024:.1f} KB"
    elif b < 1024*1024*1024: return f"{b/(1024*1024):.1f} MB"
    return f"{b/(1024*1024*1024):.1f} GB"

bot = TelegramClient(SESSION_FILE, API_ID, API_HASH)

async def subir_archivo(event, filepath, filename, size):
    msg = await event.reply("Iniciando...")

    await asyncio.sleep(0.5)
    await msg.edit(
        f"┎ DOWNLOADING\n"
        f"┠ [{progress_bar(100)}]\n"
        f"┠ PERCENTAGE: 100.00%\n"
        f"┖ PROCESSED: {format_size(size)}/{format_size(size)}"
    )

    await asyncio.sleep(0.3)
    await msg.edit(
        f"┎ UPLOADING\n"
        f"┠ [{progress_bar(0)}]\n"
        f"┠ PERCENTAGE: 0.00%\n"
        f"┖ PROCESSED: 0 B/{format_size(size)}"
    )

    remote = f"up_{uuid.uuid4().hex[:8]}_{filename}"
    url = f"{S3}/{remote}"
    uploaded = 0
    last_pct = -1

    def gen():
        nonlocal uploaded, last_pct
        with open(filepath, 'rb') as f:
            while True:
                chunk = f.read(256 * 1024)
                if not chunk: break
                uploaded += len(chunk)
                pct = int((uploaded / size) * 100)
                if pct - last_pct >= 10:
                    last_pct = pct
                    bot.loop.create_task(msg.edit(
                        f"┎ UPLOADING\n"
                        f"┠ [{progress_bar(pct)}]\n"
                        f"┠ PERCENTAGE: {pct:.2f}%\n"
                        f"┖ PROCESSED: {format_size(uploaded)}/{format_size(size)}"
                    ))
                yield chunk

    try:
        r = requests.put(url, data=gen(), timeout=300)
        if r.status_code == 200:
            stats["archivos_subidos"] += 1
            stats["total_bytes"] += size
            stats["ultimo_archivo"] = filename
            await msg.edit(
                f"📄 {filename}\n"
                f"📏 {format_size(size)}\n"
                f"🔗 {url}"
            )
        else:
            await msg.edit(f"❌ Error HTTP: {r.status_code}")
    except Exception as e:
        stats["ultimo_error"] = str(e)[:100]
        await msg.edit(f"❌ Error: {str(e)[:200]}")

@bot.on(events.NewMessage)
async def handler(event):
    if event.message.file:
        await event.reply("📥 Recibido, procesando...")
        filepath = await event.message.download_media(file="temp_upload")
        if filepath:
            filename = os.path.basename(filepath)
            size = os.path.getsize(filepath)
            await subir_archivo(event, filepath, filename, size)
            os.remove(filepath)
    elif event.message.text == '/start':
        await event.reply("📤 Envíame cualquier archivo y lo subiré al S3 de ToDus.\nTe daré el enlace de descarga con progreso en tiempo real.")
    elif event.message.text == '/stats':
        uptime = int(time.time() - stats["start_time"])
        h, m = divmod(uptime, 3600); m, s = divmod(m, 60)
        await event.reply(
            f"📊 Estadísticas\n"
            f"⏱️ Uptime: {h}h {m}m {s}s\n"
            f"📤 Archivos: {stats['archivos_subidos']}\n"
            f"📏 Total: {format_size(stats['total_bytes'])}\n"
            f"📄 Último: {stats['ultimo_archivo'] or 'Ninguno'}"
        )

def ping_render():
    while True:
        time.sleep(300)
        try:
            requests.get("https://puente-todus.onrender.com/api/stats", timeout=10)
        except: pass

async def main():
    await bot.start(bot_token=BOT_TOKEN)
    print("✅ @todbrd_bot listo")
    threading.Thread(target=ping_render, daemon=True).start()
    await bot.run_until_disconnected()

asyncio.run(main())
