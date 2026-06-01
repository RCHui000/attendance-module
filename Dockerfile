FROM python:3.12-slim

WORKDIR /app
COPY frontend/dist /app
COPY serve_spa.py /serve_spa.py

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:80/', timeout=3).read(1)"

CMD ["python", "/serve_spa.py"]
