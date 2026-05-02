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

# ping for scanning, su-exec for permissions
RUN apk add --no-cache iputils su-exec

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/public ./public

ENV NODE_ENV=production
ENV PORT=3579

VOLUME ["/app/data"]

EXPOSE 3579

CMD ["npm", "start"]
