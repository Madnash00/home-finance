FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py ./
COPY static ./static
RUN mkdir -p /data /drive-backup && useradd --create-home appuser && chown -R appuser:appuser /app /data /drive-backup
USER appuser
ENV HOST=0.0.0.0 PORT=8766 DATA_DIR=/data
EXPOSE 8766
CMD ["python", "app.py"]
