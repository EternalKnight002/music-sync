# Dockerfile - repo root
FROM node:18-alpine
WORKDIR /app

# copy package files first for caching
COPY package*.json ./

# install production deps only
RUN npm ci --production

# copy the rest of the source files
COPY . .

# expose port (Railway will set PORT env)
EXPOSE 8080

# healthcheck uses /health endpoint defined in server.js
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 8080) + '/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1) })"

CMD ["node", "server.js"]
