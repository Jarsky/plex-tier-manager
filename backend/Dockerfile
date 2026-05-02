FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY . .

# Ensure templates and instance directories are included
COPY templates/ templates/
COPY instance/ instance/
COPY config.py config.py
COPY models.py models.py
COPY migrations/ migrations/
COPY check_db.py check_db.py
COPY test_plex.py test_plex.py
COPY static/ static/

# Create startup script
RUN echo '#!/bin/bash\n\
python -m flask db upgrade\n\
python app.py' > /app/start.sh && chmod +x /app/start.sh

EXPOSE 5000
CMD ["/app/start.sh"]
