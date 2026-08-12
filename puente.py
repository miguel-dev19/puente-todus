#!/usr/bin/env python3
"""Bot Telegram: @s3tdupload_bot - selector de calidad de video"""
import os, uuid, asyncio, requests, time, threading, json
from telethon import TelegramClient, events
from telethon.tl.types import DocumentAttributeVideo, DocumentAttributeFilename

API_ID = 32471788
API_HASH = "cb57130abda56877acf3b3027e569450"
BOT_TOKEN = "8864221542:AAHAJ_cb_Y1BmotZrx8GzaFKELfLsK3sJDQ"
SESSION_FILE = "bot.session"
S3 = "https://s3.todus.cu/stream"
DOWNLOAD_PATH = "/tmp/todus_uploads"
os.makedirs(DOWNLOAD_PATH, exist_ok=True)

stats = {"start_time": time.time(), "archivos_subidos": 0, "total_bytes": 0, "ultimo_archivo": None}
pending_videos = {}  # {user_id: {original_doc, alt_docs, filename}}

def format_size(b):
    if b < 1024: return f"{b} B"
    elif b < 1024*1024: return f"{b/1024:.1f} KB"
    elif b < 1024*1024*1024: return f"{b/(1024*1024):.1f} MB"
    return f"{b/(1024*1024*1024):.1f} GB"

bot = TelegramClient(SESSION_FILE, API_ID, API_HASH)

def get_video_options(msg):
    """Extrae todas las calidades disponibles"""
    options = []
    if msg.media and msg.media.document:
        doc = msg.media.document
        
        # Documento original
        filename = "video.mp4"
        duration = 0
        w = h = 0
        for attr in doc.attributes:
            if isinstance(attr, DocumentAttributeFilename) and attr.file_name:
                filename = attr.file_name
            if isinstance(attr, DocumentAttributeVideo):
                duration = attr.duration
                w = attr.w
                h = attr.h
        
        options.append({
            "doc": doc,
            "size": doc.size,
            "w": w,
            "h": h,
            "label": f"ORIGINAL {w}x{h} ({format_size(doc.size)})"
        })
        
        # Documentos alternativos
        if msg.media.alt_documents:
            for alt in msg.media.alt_documents:
                aw = ah = 0
                aduration = 0
                for attr in alt.attributes:
                    if isinstance(attr, DocumentAttributeVideo):
                        aw = attr.w
                        ah = attr.h
                        aduration = attr.duration
                options.append({
                    "doc": alt,
                    "size": alt.size,
                    "w": aw,
                    "h": ah,
                    "label": f"COMPRIMIDO {aw}x{ah} ({format_size(alt.size)})"
                })
    
    return options, filename

async def upload_async(event, filepath, filename, size):
    msg = await event.reply("UPLOADING...")
    ext = os.path.splitext(filename)[1] or ".bin"

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

    # ─── VIDEO: mostrar calidades ───
    if msg.video or (msg.media and msg.media.document):
        options, filename = get_video_options(msg)
        
        if len(options) > 1:
            pending_videos[user_id] = {"options": options, "filename": filename}
            
            # Crear botones
            from telethon.tl.types import ReplyInlineMarkup, KeyboardButtonRow, KeyboardButtonCallback
            from telethon.tl.custom import Button
            
            botones = []
            for i, opt in enumerate(options):
                botones.append(Button.inline(opt["label"], f"quality_{i}"))
            
            await event.reply(
                "🎬 SELECT QUALITY:",
                buttons=botones
            )
        else:
            # Solo una calidad - subir directo
            await event.reply("DOWNLOADING...")
            doc = options[0]["doc"]
            ext = os.path.splitext(filename)[1] or ".bin"
            temp_path = os.path.join(DOWNLOAD_PATH, f"{uuid.uuid4().hex}{ext}")
            filepath = await bot.download_file(doc, file=temp_path)
            if filepath:
                size = os.path.getsize(filepath)
                asyncio.create_task(upload_async(event, filepath, filename, size))
        return

    # ─── CALLBACK DE CALIDAD ───
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
    
    if data.startswith("quality_") and user_id in pending_videos:
        idx = int(data.split("_")[1])
        info = pending_videos[user_id]
        opt = info["options"][idx]
        
        await event.answer(f"Selected: {opt['label']}")
        await event.edit("DOWNLOADING...")
        
        doc = opt["doc"]
        filename = info["filename"]
        ext = os.path.splitext(filename)[1] or ".bin"
        temp_path = os.path.join(DOWNLOAD_PATH, f"{uuid.uuid4().hex}{ext}")
        
        filepath = await bot.download_file(doc, file=temp_path)
        if filepath:
            size = os.path.getsize(filepath)
            asyncio.create_task(upload_async(event, filepath, filename, size))
        
        del pending_videos[user_id]

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
