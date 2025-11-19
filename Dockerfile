FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Expose port
EXPOSE 3000

# Set environment variable for port
ENV PORT=3000

# Start the HTTP server
CMD ["node", "server-http.js"]
