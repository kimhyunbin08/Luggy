# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.base.json ./
COPY apps/web/package*.json apps/web/

# Install dependencies
RUN npm ci --legacy-peer-deps

# Copy source
COPY apps/web/src apps/web/src
COPY apps/web/public apps/web/public
COPY apps/web/index.html apps/web/
COPY apps/web/tsconfig.json apps/web/

# Build (VITE_API_URL/VITE_KAKAO_MAP_KEY are inlined into the static bundle at
# build time; the Kakao key is empty by default so the map tab degrades to a
# "API 키 필요" placeholder instead of failing the build)
ARG VITE_API_URL=http://localhost:3001
ARG VITE_KAKAO_MAP_KEY=
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_KAKAO_MAP_KEY=$VITE_KAKAO_MAP_KEY
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
