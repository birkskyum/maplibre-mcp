FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json build.ts ./
COPY src src
RUN npm run build

FROM node:24-bookworm-slim
ENV NODE_ENV=production PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npx playwright-core install --with-deps --only-shell chromium && npm cache clean --force
COPY --from=build /app/dist dist
USER node
ENTRYPOINT ["node", "dist/index.js"]
