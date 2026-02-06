FROM node:20-alpine AS builder

# Set directory to common root
WORKDIR /app

# 1. Install dependencies (Cached layer)
# We copy package files to the root so modules are installed in /app/node_modules
COPY dashboard/package.json dashboard/package-lock.json* ./
RUN npm ci

# 2. Copy Source Code
COPY prisma ./prisma/
# Copy dashboard source into its subdirectory
COPY dashboard/ ./dashboard/

# 3. Generate Prisma Client
WORKDIR /app/dashboard
# Prisma generate will now find node_modules in /app/node_modules (parent dir)
# resolving the schema dependency correctly.
RUN npx prisma generate --schema=../prisma/schema.prisma

# 4. Build the project
RUN npm run build

# 5. Cleanup
WORKDIR /app
# Prune dependencies in the root
RUN npm prune --production

# --- Final Stage ---
FROM node:20-alpine AS runner

WORKDIR /app

# Install OpenSSL (Required for Prisma on Alpine)
RUN apk add --no-cache openssl

ENV NODE_ENV=production

# Security: Don't run as root
USER node

# Copy files preserving ownership
# Note: node_modules are now at the root /app/node_modules
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
# Dist files are still in the dashboard directory
COPY --chown=node:node --from=builder /app/dashboard/dist ./dist
COPY --chown=node:node --from=builder /app/dashboard/package.json ./package.json
# Optional: Copy schema if your app needs to read it at runtime
COPY --chown=node:node --from=builder /app/prisma ./prisma

EXPOSE 3040

CMD ["node", "dist/index.js"]