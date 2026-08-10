import socket, ssl, re, base64, uuid, time, asyncio, os, requests, subprocess
from telethon import TelegramClient, events
from PIL import Image
import blurhash
from app import stats, actualizar_estadisticas

API_ID = int(os.getenv("API_ID", "32471788"))
API_HASH = os.getenv("API_HASH", "cb57130abda56877acf3b3027e569450")
CANAL_ID = int(os.getenv("CANAL_ID", "-1001158018148"))
SESSION_FILE = "userbot.session"
TODUS_PHONE = os.getenv("TODUS_PHONE", "5351430352")
TODUS_SECRET = os.getenv("TODUS_SECRET", "1234567890abcdef1234567890abcdef")
GRUPO_TODUS = os.getenv("GRUPO_TODUS", "duploxxxgayporn@muclight.im.todus.cu")

def conectar_todus():
    ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
    s = socket.socket(); s.settimeout(10); s.connect(('auth.todus.cu', 443))
    ss = ctx.wrap_socket(s, server_hostname='auth.todus.cu')
    body = bytes([0x0a, len(TODUS_PHONE)]) + TODUS_PHONE.encode() + bytes([0x12, 32]) + TODUS_SECRET.encode()[:32]
    req = f"POST /v2/auth/token HTTP/1.1\r\nHost: auth.todus.cu\r\nContent-Type: application/x-protobuf\r\nUser-Agent: ToDus 2.1.2 Auth\r\nContent-Length: {len(body)}\r\nConnection: close\r\n\r\n".encode() + body
    ss.send(req)
    resp = b''
    while True:
        try:
            c = ss.recv(4096)
            if not c: break
            resp += c
        except: break
    ss.close()
    jwt = re.search(rb'eyJ[\w.\-]+', resp).group(0).decode()
    ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
    sock = socket.socket(); sock.settimeout(15); sock.connect(('ws.todus.cu', 1756))
    sock = ctx.wrap_socket(sock, server_hostname='ws.todus.cu')
    def S(x): sock.send(x.encode())
    def R(t=5):
        d=b''; sock.settimeout(t)
        for _ in range(50):
            try:
                c=sock.recv(4096)
                if not c: break
                d+=c
                if b'</iq>' in d or b'<success' in d or b'<ok' in d: break
            except: break
        return d.decode(errors='ignore')
    S('<?xml version="1.0"?><stream:stream to="im.todus.cu" xmlns="jc" xmlns:stream="x1" version="1.0">'); R()
    auth_str = "\x00" + TODUS_PHONE + "\x00" + jwt
    S(f'<auth xmlns="urn:ietf:params:xml:ns:xmpp-sasl" mechanism="PLAIN">{base64.b64encode(auth_str.encode()).decode()}</auth>'); R()
    S('<?xml version="1.0"?><stream:stream to="im.todus.cu" xmlns="jc" xmlns:stream="x1" version="1.0">'); R()
    S(f'<iq type="set" id="b"><bind xmlns="urn:ietf:params:xml:ns:xmpp-bind"><resource>puente</resource></bind></iq>'); R()
    S(f'<iq type="set" id="s"><session xmlns="urn:ietf:params:xml:ns:xmpp-session"/></iq>'); R()
    S('<presence/>'); time.sleep(0.3)
    return sock, S

def calcular_blurhash(fp):
    try:
        img = Image.open(fp).convert('RGB'); img.thumbnail((32, 32))
        w, h = img.size; pixels = list(img.getdata())
        return blurhash.encode(pixels, w, h, 4, 4)
    except: return ""

def subir_a_s3(fp, fn):
    url = f"https://s3.todus.cu/stream/puente_{uuid.uuid4().hex[:8]}_{fn}"
    try:
        with open(fp, 'rb') as f: r = requests.put(url, data=f.read(), timeout=120)
        return url if r.status_code == 200 else None
    except: return None

def get_video_info(fp):
    try:
        r1 = subprocess.run(['ffprobe','-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',fp], capture_output=True, text=True, timeout=10)
        r2 = subprocess.run(['ffprobe','-v','error','-select_streams','v:0','-show_entries','stream=width,height','-of','csv=s=x:p=0',fp], capture_output=True, text=True, timeout=10)
        d = int(float(r1.stdout.strip())); w, h = map(int, r2.stdout.strip().split('x'))
        return d, w, h
    except: return 0, 720, 1280

def extract_thumbnail(fp):
    thumb = f"thumb_{uuid.uuid4().hex[:8]}.jpg"
    try:
        subprocess.run(['ffmpeg','-y','-i',fp,'-vframes','1','-q:v','5',thumb], capture_output=True, timeout=15)
        if os.path.exists(thumb):
            url = subir_a_s3(thumb, thumb); os.remove(thumb)
            return url or ""
    except: pass
    return ""

def escapar(t): return t.replace('&','&amp;').replace('<','&lt;').replace('>','&gt;')

def enviar_texto(sock, S, texto):
    if not texto.strip(): return
    S(f'<m to="{GRUPO_TODUS}" t="gc" i="{uuid.uuid4().hex[:16]}" xmlns="jc"><k xmlns="x8"/><b>{escapar(texto)}</b></m>')
    time.sleep(0.2)

def enviar_imagen(sock, S, fp, caption=""):
    fn = os.path.basename(fp); size = os.path.getsize(fp)
    img = Image.open(fp); w, h = img.size
    tnail = calcular_blurhash(fp)
    url = subir_a_s3(fp, fn)
    if not url: return enviar_texto(sock, S, caption or "Imagen")
    mid = uuid.uuid4().hex[:16]; fid = uuid.uuid4().hex[:16]
    body = f"<b>{escapar(caption)}</b>" if caption.strip() else "<b/>"
    S(f'<m to="{GRUPO_TODUS}" t="gc" i="{mid}" xmlns="jc"><k xmlns="x8"/><image xmlns="image:n" i="{fid}" mi="{mid}" url="{url}" n="{fn}" s="{size}" h="" w="{w}" he="{h}" tnail="{tnail}"/>{body}</m>')
    time.sleep(0.2)

def enviar_video(sock, S, fp, caption=""):
    fn = os.path.basename(fp); size = os.path.getsize(fp)
    d, w, h = get_video_info(fp)
    tnail_url = extract_thumbnail(fp)
    url = subir_a_s3(fp, fn)
    if not url: return enviar_texto(sock, S, caption or "Video")
    mid = uuid.uuid4().hex[:16]; fid = uuid.uuid4().hex[:16]
    body = f"<b>{escapar(caption)}</b>" if caption.strip() else "<b/>"
    S(f'<m to="{GRUPO_TODUS}" t="gc" i="{mid}" xmlns="jc"><k xmlns="x8"/><video xmlns="video:n" i="{fid}" mi="{mid}" url="{url}" n="{fn}" s="{size}" h="" d="{d}" w="{w}" he="{h}" tnail="{tnail_url}"/>{body}</m>')
    time.sleep(0.2)

client = TelegramClient(SESSION_FILE, API_ID, API_HASH)

@client.on(events.NewMessage(chats=CANAL_ID))
async def handler(event):
    texto = event.message.text or ""
    try:
        if event.message.photo:
            fp = await event.message.download_media(file="temp_img.jpg")
            if fp: enviar_imagen(sock, S, fp, texto); os.remove(fp); actualizar_estadisticas("imagen", texto)
        elif event.message.video:
            fp = await event.message.download_media(file="temp_vid.mp4")
            if fp: enviar_video(sock, S, fp, texto); os.remove(fp); actualizar_estadisticas("video", texto)
        elif texto.strip():
            enviar_texto(sock, S, texto); actualizar_estadisticas("texto", texto)
    except Exception as e: actualizar_estadisticas("error", error=str(e))

async def main():
    global sock, S
    sock, S = conectar_todus(); stats["conectado_todus"] = True
    await client.start(); stats["conectado_telegram"] = True
    await client.run_until_disconnected()

if __name__ == "__main__":
    try: asyncio.run(main())
    except KeyboardInterrupt: pass
    finally:
        try: sock.send(b'</stream:stream>'); sock.close()
        except: pass

# ─── KEEPALIVE (evitar suspensión en plan free) ───
import threading
import requests as req_keep

def keepalive():
    """Hace ping a la URL pública cada 5 minutos"""
    url = os.getenv("RENDER_EXTERNAL_URL", "https://puente-todus.onrender.com")
    while True:
        time.sleep(300)  # 5 minutos
        try:
            r = req_keep.get(f"{url}/api/stats", timeout=10)
            print(f"Keepalive: {r.status_code}")
        except Exception as e:
            print(f"Keepalive error: {e}")

# Iniciar keepalive en segundo plano
threading.Thread(target=keepalive, daemon=True).start()

# ─── KEEPALIVE RENDER (evitar sleep en plan free) ───
import threading as thr_keep
import requests as req_keep

def ping_render():
    """Hace ping a la URL pública cada 5 minutos"""
    url = os.getenv("RENDER_EXTERNAL_URL", "https://puente-todus.onrender.com")
    while True:
        time.sleep(300)  # 5 minutos
        try:
            r = req_keep.get(f"{url}/api/stats", timeout=10)
            print(f"Keepalive Render: {r.status_code}")
        except Exception as e:
            print(f"Keepalive Render error: {e}")

thr_keep.Thread(target=ping_render, daemon=True).start()
