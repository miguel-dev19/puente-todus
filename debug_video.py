#!/usr/bin/env python3
"""Debug: ver estructura completa del mensaje recibido"""
from telethon import TelegramClient, events
import json

API_ID = 32471788
API_HASH = "cb57130abda56877acf3b3027e569450"
BOT_TOKEN = "8144541638:AAGZq6FDeyvb5qWXiKBW4W-f0KL0fX68CyA"
SESSION_FILE = "bot.session"

bot = TelegramClient(SESSION_FILE, API_ID, API_HASH)

@bot.on(events.NewMessage)
async def handler(event):
    msg = event.message
    
    # Convertir a diccionario
    msg_dict = msg.to_dict()
    
    print("\n" + "=" * 60)
    print("ESTRUCTURA COMPLETA DEL MENSAJE:")
    print(json.dumps(msg_dict, indent=2, default=str)[:3000])
    print("=" * 60)

async def main():
    await bot.start(bot_token=BOT_TOKEN)
    print("Debug listo. Envía el video...")
    await bot.run_until_disconnected()

import asyncio
asyncio.run(main())
