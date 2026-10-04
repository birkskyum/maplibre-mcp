# The build is plain JavaScript, so it runs once, on the machine that builds the image, for every platform.
FROM --platform=$BUILDPLATFORM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json build.ts ./
COPY src src
RUN npm run build

FROM node:24-bookworm-slim
LABEL org.opencontainers.image.source=https://github.com/birkskyum/maplibre-mcp
ENV NODE_ENV=production PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npx playwright-core install --with-deps --only-shell chromium && npm cache clean --force
COPY --from=build /app/dist dist
USER node
ENTRYPOINT ["node", "/app/dist/index.js"]
