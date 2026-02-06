FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies including devDependencies for building
# Copy package files
COPY package.json package-lock.json* ./
COPY prisma ./prisma/

# Install dependencies
RUN npm install

# Generate Prisma Client
RUN npx prisma generate

# Copy source code
COPY . .

# Build frontend and backend
# Frontend -> dist/client
# Backend -> dist/server
RUN npm run build

# Remove devDependencies for smaller image
RUN npm prune --production

# Final stage
FROM node:20-alpine AS runner

WORKDIR /app

# Install openssl for Prisma
RUN apk -U upgrade \
    && apk add --no-cache openssl

# Copy artifacts from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma ./prisma

# Expose port
EXPOSE 3000

# Start server
CMD ["npm", "start"]
