FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY shared ./shared
COPY web ./web
USER node
EXPOSE 3000
CMD ["node", "web/server.js"]
