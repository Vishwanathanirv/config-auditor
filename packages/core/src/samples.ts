/**
 * A small made-up shop's deployment files, written the way they often look in real projects:
 * mostly fine, with the mistakes people actually make.
 */
export type Sample = { name: string; note: string; text: string };

export const SAMPLES: Sample[] = [
  {
    name: "Dockerfile",
    note: "The API image",
    text: `FROM node:latest
MAINTAINER Shopfront Team <ops@shopfront.example>

ENV NODE_ENV=production
ENV STRIPE_SECRET_KEY=sk_live_51Hc8xRvQm2pLk7yT0aZq
ARG NPM_TOKEN=npm_9fT2kLmQ8xVzR4wY

RUN apt-get update && apt-get install -y curl imagemagick
RUN curl -fsSL https://get.example-cli.dev/install.sh | bash

WORKDIR /app
COPY package*.json ./
RUN npm install
ADD . .
COPY .env /app/.env
RUN chmod -R 777 /app/uploads

EXPOSE 3000
CMD npm start
`,
  },
  {
    name: "docker-compose.yml",
    note: "Local and staging stack",
    text: `services:
  api:
    build: .
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgres://shop:\${DB_PASSWORD}@db:5432/shop
      REDIS_URL: redis://cache:6379
    depends_on: [db, cache]

  db:
    image: postgres:16
    ports:
      - "5432:5432"
    environment:
      POSTGRES_USER: shop
      POSTGRES_PASSWORD: hunter2-shop
    volumes:
      - pgdata:/var/lib/postgresql/data

  cache:
    image: redis
    ports:
      - "6379:6379"

  monitor:
    image: containrrr/watchtower:1.7.1
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    privileged: true

volumes:
  pgdata:
`,
  },
  {
    name: "k8s/deployment.yaml",
    note: "Production on Kubernetes",
    text: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: shop-api
  labels:
    app: shop-api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: shop-api
  template:
    metadata:
      labels:
        app: shop-api
    spec:
      containers:
        - name: api
          image: registry.shopfront.example/api:2.4.1
          ports:
            - containerPort: 3000
          env:
            - name: NODE_ENV
              value: production
            - name: JWT_SECRET
              value: "s3cr3t-signing-key-2024"
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
---
apiVersion: v1
kind: Service
metadata:
  name: shop-db
spec:
  type: LoadBalancer
  selector:
    app: shop-db
  ports:
    - port: 5432
      targetPort: 5432
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: ci-deployer
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: cluster-admin
subjects:
  - kind: ServiceAccount
    name: default
    namespace: shop
`,
  },
  {
    name: "nginx/shop.conf",
    note: "The public web server",
    text: `server {
    listen 80;
    server_name shop.example.com;
    root /var/www/shop;

    location / {
        try_files $uri $uri/ /index.html;
    }
}

server {
    listen 443 ssl http2;
    server_name shop.example.com;

    ssl_certificate     /etc/letsencrypt/live/shop.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/shop.example.com/privkey.pem;
    ssl_protocols TLSv1 TLSv1.1 TLSv1.2;
    ssl_ciphers HIGH:!aNULL:RC4-SHA:DES-CBC3-SHA;

    root /var/www/shop;
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /static {
        alias /var/www/shop/static/;
        add_header Cache-Control "public, max-age=31536000";
    }

    location /downloads/ {
        autoindex on;
    }

    location /old-shop {
        return 301 https://$host/shop$uri;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
    }
}
`,
  },
  {
    name: "sshd_config",
    note: "The VM that runs it all",
    text: `# Shopfront web VM
Include /etc/ssh/sshd_config.d/*.conf

Port 22
PermitRootLogin yes
PasswordAuthentication yes
UsePAM yes
X11Forwarding yes
MaxAuthTries 10
Ciphers aes256-gcm@openssh.com,aes128-ctr,aes256-cbc,3des-cbc
Subsystem sftp /usr/lib/openssh/sftp-server

# Hardening, added after the security review
PasswordAuthentication no
PermitRootLogin prohibit-password
`,
  },
];
