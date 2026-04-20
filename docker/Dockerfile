FROM node:20-alpine

WORKDIR /app

# Install backend deps
COPY backend/package*.json ./
RUN npm ci

# Install frontend deps
COPY frontend/package*.json ./
RUN npm ci --prefix frontend

# Copy shared
COPY shared ./shared

# Build backend
COPY backend/src ./src
RUN npm run build --prefix .

# Build frontend
COPY frontend/src ./src
COPY frontend/package*.json ./
RUN npm run build --prefix frontend

EXPOSE 3001

CMD ["node", "dist/gameserver/GameServer.js"]
