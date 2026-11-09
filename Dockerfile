# One image, two uses on Cloud Run:
#   service: node scripts/serve-public.js   (default)
#   job:     node scripts/refresh-cloud.js  (daily refresh)
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
# Build the UI shell. The feed data itself comes from Cloud Storage at runtime.
RUN node scripts/build-static.js
ENV NODE_ENV=production
CMD ["node", "scripts/serve-public.js"]
