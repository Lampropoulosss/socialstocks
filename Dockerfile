# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
# Install ALL dependencies (including dev) to build
RUN npm ci 
COPY prisma ./prisma/
COPY . .
RUN npx prisma generate
RUN npm run build

# Stage 2: Run (Tiny Image)
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Copy only necessary files from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/prisma.config.ts ./
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules ./node_modules

# Clean up dev dependencies to save space
RUN npm prune --production

CMD ["npm", "start"]