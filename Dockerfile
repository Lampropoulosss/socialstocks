# Build stage
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

COPY package*.json ./
COPY prisma ./prisma/
COPY prisma.config.js ./

RUN npm install
ARG DATABASE_URL
ENV DATABASE_URL=$DATABASE_URL
RUN npx prisma generate

COPY . .

RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /usr/src/app

COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/package*.json ./
COPY --from=builder /usr/src/app/dist ./dist
COPY --from=builder /usr/src/app/prisma ./prisma
COPY --from=builder /usr/src/app/prisma.config.js ./

# Install only production dependencies (optional optimization, but might break if devDeps needed for some reason, sticking to safe copy for now or pruning)
# For now, we copied node_modules from builder which includes everything. 
# To be cleaner, we could run npm ci --only=production here, but we need prisma client generated.
# Simplest approach for now is copying node_modules.

EXPOSE 3000

CMD ["npm", "start"]
