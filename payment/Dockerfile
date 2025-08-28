FROM python:3.9



WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt   # ← replace pip wheel with this

COPY *.py ./
COPY payment.ini ./

EXPOSE 8080
CMD ["uwsgi","--ini","payment.ini"]
