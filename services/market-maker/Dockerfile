FROM node:24-bookworm-slim

WORKDIR /app
COPY services/market-maker/package.json services/market-maker/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY services/market-maker ./services/market-maker

RUN useradd --system --uid 10001 --create-home maker \
  && mkdir -p /app/services/market-maker/data \
  && chown -R maker:maker /app/services/market-maker/data

USER maker
ENV MAKER_HOST=0.0.0.0
EXPOSE 8788
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8788/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "services/market-maker/server.mjs"]
