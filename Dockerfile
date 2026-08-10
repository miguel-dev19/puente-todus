FROM python:3.11-slim
RUN apt-get update && apt-get install -y ffmpeg && apt-get clean
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
WORKDIR /app
COPY . .
EXPOSE 10000
CMD ["bash", "start.sh"]
