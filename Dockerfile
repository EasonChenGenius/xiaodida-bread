FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production BREAD_AUTH_MODE=wechat BREAD_STORE=mysql BREAD_HOST=0.0.0.0 PORT=8080
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY server.mjs auth.mjs domain.mjs notifications.mjs storage.mjs mysql-store.mjs seed-products.mjs web-auth.mjs ./
COPY miniprogram/brand.js ./miniprogram/brand.js
COPY imports/ri-chang-products.json ./imports/ri-chang-products.json
COPY web/ ./web/
COPY miniprogram/assets/platform-logo.png ./miniprogram/assets/platform-logo.png
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
