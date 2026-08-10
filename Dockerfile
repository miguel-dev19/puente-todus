FROM python:3.11-slim

# Instalar ffmpeg
RUN apt-get update && apt-get install -y ffmpeg && apt-get clean

# Instalar dependencias Python
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Crear directorio de trabajo
WORKDIR /app

# Copiar archivos
COPY . .

# Exponer puerto web
EXPOSE 10000

# Iniciar
CMD ["bash", "start.sh"]
