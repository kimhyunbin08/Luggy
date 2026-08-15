# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY apps/web/package*.json apps/web/

# Install dependencies
RUN npm ci --legacy-peer-deps

# Copy source
COPY apps/web/src apps/web/src
COPY apps/web/index.html apps/web/
COPY apps/web/vite.config.ts apps/web/
COPY apps/web/tsconfig.json apps/web/

# Build
RUN cd apps/web && npm run build

# Runtime stage
FROM node:20-alpine

WORKDIR /app

# Install http-server for serving static files
RUN npm install -g http-server

# Copy built app
COPY --from=builder /app/apps/web/dist ./dist

EXPOSE 3000

CMD ["http-server", "dist", "-p", "3000", "--cors"]
