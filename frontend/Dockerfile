FROM node:20-alpine AS builder

WORKDIR /app

# Accept API URL for Vite at build time (defaults to relative path for nginx proxy)
ARG VITE_API_BASE_URL=/api/v1
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

# Accept Grafana URL for Vite at build time
ARG VITE_GRAFANA_URL=localhost:3000
ENV VITE_GRAFANA_URL=${VITE_GRAFANA_URL}

# Accept Label Studio URL for Vite at build time (with protocol)
ARG VITE_LABEL_STUDIO_PROJECT_URL=http://localhost:8888/projects/1/data?tab=1
ENV VITE_LABEL_STUDIO_PROJECT_URL=${VITE_LABEL_STUDIO_PROJECT_URL}

# Install dependencies (leverages Docker layer caching)
COPY package.json package-lock.json* bun.lockb* ./
RUN npm ci --no-audit --no-fund

# Copy source
COPY . .

# Verify build environment
RUN echo "Build environment:" && \
    echo "VITE_API_BASE_URL=$VITE_API_BASE_URL" && \
    echo "VITE_GRAFANA_URL=$VITE_GRAFANA_URL" && \
    echo "VITE_LABEL_STUDIO_PROJECT_URL=$VITE_LABEL_STUDIO_PROJECT_URL" && \
    echo "Node version:" && node --version && \
    echo "NPM version:" && npm --version

# Build Vite app with injected env
RUN npm run build

# Verify build output
RUN echo "Build completed. Contents of dist:" && ls -la dist/

FROM nginx:1.27-alpine AS runtime

COPY --from=builder /app/dist /usr/share/nginx/html

# Nginx config with SPA fallback and /api proxy
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

