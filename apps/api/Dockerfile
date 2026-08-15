# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY apps/api/package*.json apps/api/

# Install dependencies
RUN npm ci --legacy-peer-deps

# Copy source
COPY apps/api/src apps/api/src
COPY apps/api/tsconfig.json apps/api/

# Build
RUN cd apps/api && npm run build

# Runtime stage
FROM node:20-alpine

WORKDIR /app

# Install production dependencies only
COPY apps/api/package*.json ./
RUN npm ci --production --legacy-peer-deps

# Copy built app
COPY --from=builder /app/apps/api/dist ./dist

# Database init script
COPY apps/api/schema.sql ./

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

EXPOSE 3001

CMD ["node", "dist/server.js"]
