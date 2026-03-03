FROM node:20-alpine
WORKDIR /app
COPY package.json server.js tests.json ./
RUN npm install --omit=dev
EXPOSE 3001
CMD ["node", "server.js"]
