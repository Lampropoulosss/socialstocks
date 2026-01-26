# Build stage
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

COPY package*.json ./
COPY prisma ./prisma/

# --- NEW: Copy the config file before generation ---
COPY prisma.config.ts ./ 

RUN npm install

# 1. Generate Client
# Prisma 7 will now read prisma.config.ts to validate the schema
RUN npx prisma generate

COPY . .

# 2. Compile TS
RUN npm run build