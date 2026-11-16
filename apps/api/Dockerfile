FROM node:22-alpine AS builder

WORKDIR /app

# Copy root manifests
COPY package*.json ./
COPY tsconfig.json ./
COPY packages/policy/package*.json ./packages/policy/
COPY packages/engine/package*.json ./packages/engine/
COPY apps/api/package*.json ./apps/api/
COPY apps/web/package*.json ./apps/web/

RUN npm install

# Copy source files
COPY packages/policy/ ./packages/policy/
COPY packages/engine/ ./packages/engine/
COPY apps/api/ ./apps/api/

# Build policy and engine packages
RUN npm run build --workspace=@cantill/policy
RUN npm run build --workspace=@cantill/engine

WORKDIR /app/apps/api
RUN npx prisma generate
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app

COPY package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/policy/dist ./packages/policy/dist
COPY --from=builder /app/packages/policy/package.json ./packages/policy/
COPY --from=builder /app/packages/engine/dist ./packages/engine/dist
COPY --from=builder /app/packages/engine/package.json ./packages/engine/
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma
COPY --from=builder /app/apps/api/package.json ./apps/api/

WORKDIR /app/apps/api
ENV PORT=3001
ENV NODE_ENV=production
ENV DATABASE_URL="file:/app/data/dev.db"

EXPOSE 3001

CMD ["sh", "-c", "npx prisma db push && npm run seed && node dist/index.js"]
