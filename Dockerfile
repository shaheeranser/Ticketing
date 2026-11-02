# ==============================================================================
# EVENTPASS PRO - DOCKERFILE
# Node.js 20 Alpine Linux Runtime Environment
# ==============================================================================

FROM node:20-alpine

# Set working directory inside container
WORKDIR /app

# Install curl for healthcheck / debugging utilities
RUN apk add --no-cache curl

# Copy dependency manifests first for Docker layer caching
COPY package*.json ./

# Install production dependencies cleanly
RUN npm install --omit=dev

# Copy application source code and frontend static assets
COPY . .

# Expose HTTP port for Express application
EXPOSE 3000

# Health check to ensure server is responding
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/ || exit 1

# Start Node.js Express server
CMD ["node", "server.js"]
