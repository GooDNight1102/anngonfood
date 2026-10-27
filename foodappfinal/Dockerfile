FROM node:22-slim
WORKDIR /app
COPY . .
ENV DATA_DIR=/data NODE_ENV=production
EXPOSE 3000
CMD ["node", "start.js"]
