# Build stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Runtime stage
FROM node:20-alpine
WORKDIR /app

# ping required for network scanning / online check
RUN apk add --no-cache iputils

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.ts ./next.config.ts

ENV NODE_ENV=production
ENV PORT=3579

# data/ volume for devices.json + auth.json
VOLUME ["/app/data"]

EXPOSE 3000

CMD ["npm", "start"]
