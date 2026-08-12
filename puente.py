#!/usr/bin/env python3
"""Bot Telegram: @s3tdupload_bot - uploader con selector de calidad"""
import os, uuid, asyncio, requests, time, threading
from telethon import TelegramClient, events, Button

API_ID = 32471788
API_HASH = "cb57130abda56877acf3b3027e569450"
BOT_TOKEN = "8864221542:AAHAJ_cb_Y1BmotZrx8GzaFKELfLsK3sJDQ"
SESSION_FILE = "bot.session"
S3 = "https://s3.todus.cu/stream"
DOWNLOAD_PATH = "/tmp/todus_uploads"
os.makedirs(DOWNLOAD_PATH, exist_ok=True)

stats = {"start_time": time.time(), "archivos_subidos": 0, "total_bytes": 0, "ultimo_archivo": None}
pending = {}  # {user_id: {options: [...], filename: str}}

def format_size(b):
    if b < 1024: return f"{b} B"
    elif b < 1024*1024: return f"{b/1024:.1f} KB"
    elif b < 1024*1024*1024: return f"{b/(1024*1024):.1f} MB"
    return f"{b/(1024*1024*1024):.1f} GB"

bot = TelegramClient(SESSION_FILE, API_ID, API_HASH)

async def subir_y_responder(event, doc, filename):
    msg = await event.reply("DOWNLOADING...")
    ext = os.path.splitext(filename)[1] or ".bin"
    temp_path = os.path.join(DOWNLOAD_PATH, f"{uuid.uuid4().hex}{ext}")
    
    filepath = await bot.download_file(doc, file=temp_path)
    size = os.path.getsize(filepath)
    
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
    user_id = event.sender_id

    if msg.video:
        # Video con posible calidad alternativa
        doc_original = msg.video
        size_original = doc_original.size
        w_original = doc_original.w
        h_original = doc_original.h
        
        options = []
        options.append(("ORIGINAL", doc_original))
        
        if msg.media and msg.media.document and msg.media.alt_documents:
            for alt in msg.media.alt_documents:
                options.append(("COMPRIMIDO", alt))
        
        filename = f"video_{msg.video.id}.mp4"
        
        if len(options) == 2:
            pending[user_id] = {"options": options, "filename": filename}
            
            orig_size = format_size(size_original)
            alt_size = format_size(msg.media.alt_documents[0].size) if msg.media.alt_documents else "?"
            
            await event.reply(
                f"🎬 SELECT QUALITY:\n"
                f"┎ ORIGINAL {w_original}x{h_original} ({orig_size})\n"
                f"┖ COMPRIMIDO ({alt_size})",
                buttons=[
                    [Button.inline(f"ORIGINAL ({orig_size})", "quality_0")],
                    [Button.inline(f"COMPRIMIDO ({alt_size})", "quality_1")]
                ]
            )
        else:
            # Solo una calidad
            asyncio.create_task(subir_y_responder(event, doc_original, filename))
        return

    if texto == '/start':
        await event.reply("Send me a video and choose quality.")
    elif texto == '/stats':
        uptime = int(time.time() - stats["start_time"])
        h, m = divmod(uptime, 3600); m, s = divmod(m, 60)
        await event.reply(f"UPTIME: {h}h {m}m {s}s\nFILES: {stats['archivos_subidos']}")

@bot.on(events.CallbackQuery)
async def callback_handler(event):
    user_id = event.sender_id
    data = event.data.decode()
    
    if data.startswith("quality_") and user_id in pending:
        idx = int(data.split("_")[1])
        info = pending.pop(user_id)
        doc = info["options"][idx][1]
        filename = info["filename"]
        
        await event.answer(f"Descargando...")
        await event.edit("DOWNLOADING...")
        
        asyncio.create_task(subir_y_responder(event, doc, filename))

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
