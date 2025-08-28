FROM node:20
WORKDIR /opt/server

# copy only manifests to leverage cache
COPY package*.json ./

# pick ONE of the two installers below:

# A) If you have package-lock.json (recommended)
# RUN npm ci --omit=dev --no-audit --no-fund

# B) If you do NOT have package-lock.json
RUN npm install --omit=dev --no-audit --no-fund

# now copy the app code
COPY server.js ./

EXPOSE 8080
CMD ["node","server.js"]
