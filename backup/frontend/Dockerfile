FROM node:18-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
EXPOSE 3000  
# ^--- CAMBIADO DE 5173 A 3000
CMD ["npm", "run", "dev", "--", "--host"]