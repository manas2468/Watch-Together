# ============================================================================
# Multi-stage Dockerfile for Watch Together
# ============================================================================
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package descriptors
COPY package.json ./
COPY client/package*.json ./client/
COPY server/package*.json ./server/

# Install dependencies
RUN npm run install:all

# Copy source code
COPY client ./client
COPY server ./server

# Build frontend and backend
RUN npm run build

# ----------------------------------------------------------------------------
FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001

# Copy package descriptors for server production dependencies
COPY server/package*.json ./server/
RUN cd server && npm install --omit=dev

# Copy compiled files from builder
COPY --from=builder /app/client/dist ./client/dist
COPY --from=builder /app/server/dist ./server/dist

# Expose port
EXPOSE 3001

# Start unified server
CMD ["node", "server/dist/index.js"]
