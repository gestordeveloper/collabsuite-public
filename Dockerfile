FROM node:20-alpine AS builder
RUN apk add --no-cache openssl
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build

FROM node:20-alpine AS runner
# ffmpeg: converte/fatia o áudio das gravações antes de transcrever e monta os vídeos das mini-novelas
# chromium + fontes: renderiza os slides dos carrosséis e as páginas das HQs em PNG (CHROMIUM_PATH abaixo)
RUN apk add --no-cache openssl ffmpeg chromium nss freetype harfbuzz ttf-freefont font-noto font-noto-emoji
# Editor de vídeo (StudioX, pasta studiox/): app Python iniciado pelo servidor. numpy/opencv/pillow vêm do apk
# (o pip não tem rodas musl do OpenCV) e o venv enxerga os pacotes do sistema. Sem mediapipe (sem roda musl): só o rastreio de mãos fica indisponível.
# util-linux: o Remotion abre o Chrome com `setpriv --pdeathsig`, que o BusyBox não tem.
RUN apk add --no-cache python3 py3-pip py3-numpy py3-pillow py3-opencv util-linux
ENV CHROMIUM_PATH=/usr/bin/chromium
ENV STUDIOX_STORAGE_DIR=/data/studiox
WORKDIR /app
COPY studiox/requirements.txt ./studiox/requirements.txt
RUN python3 -m venv --system-site-packages studiox/.venv \
 && grep -viE '^(numpy|opencv-python-headless|pillow)$|^#' studiox/requirements.txt > /tmp/req.txt \
 && studiox/.venv/bin/pip install --no-cache-dir -r /tmp/req.txt
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./
COPY --from=builder /app/studiox ./studiox
# retentativas: o Remotion baixa binários grandes (compositor) e uma queda de rede no build derrubava o deploy
RUN cd studiox/motion && npm ci --omit=dev --no-audit --no-fund \
    --fetch-retries=6 --fetch-retry-factor=2 --fetch-retry-mintimeout=15000 --fetch-retry-maxtimeout=120000 --fetch-timeout=300000
COPY docker-entrypoint.sh ./
RUN chmod +x ./docker-entrypoint.sh
ENV NODE_ENV=production
EXPOSE 3000
CMD ["./docker-entrypoint.sh"]