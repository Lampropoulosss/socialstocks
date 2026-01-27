# Build stage
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install

# 1. Copy ALL source code first (respecting .dockerignore)
COPY . .

# 2. Generate the client NOW (so it uses the files we just copied)
RUN npx prisma generate

# 3. Build the app
RUN npm run build