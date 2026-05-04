# Build command (from repo root):
#   docker buildx build --platform linux/arm64 --provenance=false \
#     --build-arg HANDLER_FILE=handlers/docx_to_pdf.py \
#     -f office_image/Dockerfile \
#     -t <ECR_REPO>:docx_to_pdf-latest --push .
#
# --provenance=false is required: buildx otherwise creates an OCI manifest
# list (with attestation layers) that Lambda rejects as an unsupported media
# type. Single-platform images pushed without provenance work correctly.
FROM python:3.12-slim-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates \
      fontconfig \
      fonts-dejavu \
      fonts-liberation \
      libreoffice-calc \
      libreoffice-writer \
      libreoffice-java-common \
    && rm -rf /var/lib/apt/lists/*

COPY office_image/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir awslambdaric -r /tmp/requirements.txt

ENV LAMBDA_TASK_ROOT=/var/task
WORKDIR ${LAMBDA_TASK_ROOT}

COPY layers/superdoc_utils/*.py ${LAMBDA_TASK_ROOT}/
ARG HANDLER_FILE=handlers/docx_to_pdf.py
COPY ${HANDLER_FILE} ${LAMBDA_TASK_ROOT}/handler.py

ENV LIBREOFFICE_BIN=/usr/bin/libreoffice \
    LIBREOFFICE_TIMEOUT_SECONDS=240 \
    HOME=/tmp

ENTRYPOINT ["python", "-m", "awslambdaric"]
CMD ["handler.handler"]
