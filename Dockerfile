FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /app

# No npm dependencies: the server uses only Node's built-in modules.
COPY package.json server.js ./
COPY lib ./lib
COPY public ./public

USER node
EXPOSE 8080
CMD ["node", "server.js"]
