/**
 * Labelled test files: each lists the rules it must trigger, and nothing else may fire. The
 * "clean" ones are hardened configs modelled on public references (Mozilla's nginx and
 * OpenSSH guidance, the Kubernetes "restricted" Pod Security profile), so false alarms on
 * good configs show up as failures.
 */
export type Fixture = { name: string; file: string; expect: string[]; text: string };

export const FIXTURES: Fixture[] = [
  // ───────────── Dockerfile
  {
    name: "Hardened multi-stage Node image",
    file: "Dockerfile",
    expect: [],
    text: `# syntax=docker/dockerfile:1
FROM node:22.13-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=npm_token NPM_TOKEN=$(cat /run/secrets/npm_token) npm ci --omit=dev

FROM node:22.13-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --chown=node:node . .
USER node
EXPOSE 3000
HEALTHCHECK CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["node", "server.js"]
`,
  },
  {
    name: "Clean Python image with pinned digest",
    file: "Dockerfile",
    expect: [],
    text: `FROM python:3.12-slim@sha256:3f1d8a5b0e2c4d6f8a0b2c4d6e8f0a2b4c6d8e0f2a4b6c8d0e2f4a6b8c0d2e4f
RUN apt-get update \\
 && apt-get install -y --no-install-recommends libpq5 \\
 && rm -rf /var/lib/apt/lists/*
WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app/ app/
RUN useradd --uid 10001 --no-create-home app
USER 10001
ENTRYPOINT ["gunicorn", "app.main:app"]
`,
  },
  {
    name: "Untagged base, root user, shell CMD",
    file: "Dockerfile",
    expect: ["DF001", "DF002", "DF011"],
    text: `FROM ubuntu
WORKDIR /opt/app
COPY bin/server /opt/app/server
CMD /opt/app/server --port 8080
`,
  },
  {
    name: "Secrets in ENV and ARG",
    file: "Dockerfile",
    expect: ["DF003", "DF003"],
    text: `FROM node:22-alpine
ARG GITHUB_TOKEN=ghp_8sKq2LmZt7Yv4Nx1Rw9Pc3Hd6Fb0Ja5Ue2Io
ENV DB_PASSWORD=Sup3rS3cret! LOG_LEVEL=info
ENV DB_PASSWORD_FILE=/run/secrets/db
USER node
CMD ["node", "index.js"]
`,
  },
  {
    name: "Remote ADD, piped installer, insecure curl",
    file: "Dockerfile",
    expect: ["DF004", "DF005", "DF012"],
    text: `FROM debian:12-slim
ADD https://example.com/tool.tar.gz /tmp/
RUN curl -sSL https://example.com/setup.sh | sh
RUN curl -k -o /tmp/x https://internal.example/x
USER 1000
CMD ["/usr/local/bin/tool"]
`,
  },
  {
    name: "sudo, chmod 777, SSH and a private key",
    file: "Dockerfile",
    expect: ["DF007", "DF008", "DF009", "DF013", "DF006"],
    text: `FROM ubuntu:24.04
RUN apt-get update && apt-get install -y sudo openssh-server
RUN sudo mkdir /data && chmod 777 /data
COPY deploy/id_rsa /root/.ssh/id_rsa
EXPOSE 22 8080
USER 1000
ENTRYPOINT ["/usr/sbin/sshd", "-D"]
`,
  },
  {
    name: "Deprecated MAINTAINER, loose installs, final stage root",
    file: "Dockerfile",
    expect: ["DF010", "DF014", "DF014", "DF002"],
    text: `FROM node:20-alpine AS build
WORKDIR /app
COPY . .
RUN npm install && npm run build

FROM python:3.12-alpine
MAINTAINER someone@example.com
COPY --from=build /app/dist /srv
RUN pip install flask
CMD ["python", "-m", "http.server"]
`,
  },
  {
    name: "Last USER switches back to root",
    file: "Dockerfile",
    expect: ["DF002"],
    text: `FROM alpine:3.20
RUN adduser -D app
USER app
RUN echo hi
USER root
ENTRYPOINT ["/bin/true"]
`,
  },

  // ───────────── Docker Compose
  {
    name: "Locked-down compose stack",
    file: "compose.yaml",
    expect: [],
    text: `services:
  web:
    image: ghcr.io/example/web:3.2.0
    ports:
      - "443:8443"
    environment:
      DATABASE_PASSWORD: \${DATABASE_PASSWORD}
      API_TOKEN_FILE: /run/secrets/api_token
    read_only: true
    cap_drop: [ALL]
    security_opt:
      - no-new-privileges:true
  db:
    image: postgres:16.4
    ports:
      - "127.0.0.1:5432:5432"
    environment:
      - POSTGRES_PASSWORD_FILE=/run/secrets/db
`,
  },
  {
    name: "Every classic compose mistake",
    file: "docker-compose.yml",
    expect: ["DC001", "DC002", "DC003", "DC004", "DC004", "DC005", "DC006", "DC007", "DC008"],
    text: `services:
  agent:
    image: example/agent
    privileged: true
    network_mode: host
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    cap_add:
      - SYS_ADMIN
    security_opt:
      - seccomp:unconfined
  mongo:
    image: mongo:7
    ports:
      - "27017:27017"
      - target: 6379
        published: 6379
    environment:
      - MONGO_INITDB_ROOT_PASSWORD=example123
`,
  },

  // ───────────── Kubernetes
  {
    name: "Restricted-profile Deployment",
    file: "deploy.yaml",
    expect: [],
    text: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  selector:
    matchLabels: { app: web }
  template:
    metadata:
      labels: { app: web }
    spec:
      automountServiceAccountToken: false
      securityContext:
        runAsNonRoot: true
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: web
          image: ghcr.io/example/web:3.2.0
          env:
            - name: DB_PASSWORD
              valueFrom:
                secretKeyRef: { name: db, key: password }
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
          resources:
            limits:
              memory: 256Mi
`,
  },
  {
    name: "Privileged DaemonSet with host access",
    file: "agent.yaml",
    expect: ["K8S001", "K8S002", "K8S003", "K8S004", "K8S005", "K8S006", "K8S007", "K8S007", "K8S008", "K8S009", "K8S010", "K8S012"],
    text: `apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: node-agent
spec:
  selector:
    matchLabels:
      app: node-agent
  template:
    metadata:
      labels:
        app: node-agent
    spec:
      hostNetwork: true
      hostPID: true
      containers:
        - name: agent
          image: example/agent:latest
          securityContext:
            privileged: true
            capabilities:
              add: ["SYS_ADMIN"]
          volumeMounts:
            - name: root
              mountPath: /host
      volumes:
        - name: root
          hostPath:
            path: /
`,
  },
  {
    name: "CronJob with a literal token and root user",
    file: "cron.yaml",
    expect: ["K8S002", "K8S011", "K8S012"],
    text: `apiVersion: batch/v1
kind: CronJob
metadata:
  name: backup
spec:
  schedule: "0 3 * * *"
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: OnFailure
          containers:
            - name: backup
              image: example/backup:1.4.2
              env:
                - name: S3_ACCESS_KEY
                  value: AKIAIOSFODNN7EXAMPLE
              securityContext:
                runAsUser: 0
                allowPrivilegeEscalation: false
                readOnlyRootFilesystem: true
                capabilities:
                  drop: [ALL]
              resources:
                limits:
                  memory: 512Mi
`,
  },
  {
    name: "Wildcard RBAC, cluster-admin and an exposed database",
    file: "rbac.yaml",
    expect: ["K8S013", "K8S014", "K8S015"],
    text: `apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: do-anything
rules:
  - apiGroups: ["*"]
    resources: ["*"]
    verbs: ["*"]
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: ops
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: cluster-admin
subjects:
  - kind: Group
    name: platform-ops
    apiGroup: rbac.authorization.k8s.io
---
apiVersion: v1
kind: Service
metadata:
  name: redis
spec:
  type: NodePort
  ports:
    - port: 6379
      nodePort: 30079
`,
  },

  // ───────────── nginx
  {
    name: "Mozilla-intermediate nginx",
    file: "nginx.conf",
    expect: [],
    text: `http {
    server_tokens off;

    server {
        listen 80 default_server;
        server_name example.com;
        return 301 https://$host$request_uri;
    }

    server {
        listen 443 ssl;
        http2 on;
        server_name example.com;
        ssl_certificate /etc/ssl/example.pem;
        ssl_certificate_key /etc/ssl/example.key;
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-CHACHA20-POLY1305;
        ssl_prefer_server_ciphers off;

        add_header Strict-Transport-Security "max-age=63072000" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header Content-Security-Policy "default-src 'self'; frame-ancestors 'none'" always;

        root /var/www/example;
        location ~ /\\.(?!well-known) { deny all; }

        location /assets/ {
            alias /var/www/example/assets/;
        }
        location /api/ {
            proxy_pass http://127.0.0.1:8080;
        }
    }
}
`,
  },
  {
    name: "Old TLS, weak ciphers, version on show",
    file: "site.conf",
    expect: ["NG001", "NG002", "NG003", "NG005"],
    text: `server {
    listen 443 ssl;
    server_name legacy.example;
    server_tokens on;
    ssl_certificate /etc/ssl/l.pem;
    ssl_certificate_key /etc/ssl/l.key;
    ssl_protocols SSLv3 TLSv1 TLSv1.2;
    ssl_ciphers "RC4:HIGH:!aNULL:!MD5";
    add_header X-Content-Type-Options nosniff;
    add_header X-Frame-Options SAMEORIGIN;
    location / {
        proxy_pass http://app:3000;
    }
}
`,
  },
  {
    name: "Off-by-slash alias, autoindex and $uri redirect",
    file: "files.conf",
    expect: ["NG001", "NG004", "NG007", "NG009", "NG011"],
    text: `server {
    listen 8080;
    location /files {
        alias /srv/files/;
        autoindex on;
    }
    location /legacy {
        return 302 /new$uri;
    }
}
`,
  },
  {
    name: "Location loses the server's headers; dotfiles served",
    file: "app.conf",
    expect: ["NG008", "NG010"],
    text: `http {
    server_tokens off;
    server {
        listen 80;
        root /var/www/app;
        add_header X-Frame-Options "DENY" always;
        add_header X-Content-Type-Options "nosniff" always;
        location / {
            try_files $uri $uri/ =404;
        }
        location /images/ {
            add_header Cache-Control "max-age=86400";
        }
    }
}
`,
  },
  {
    name: "Port 80 serves the site next to HTTPS",
    file: "both.conf",
    expect: ["NG006"],
    text: `http {
    server_tokens off;
    server {
        listen 80;
        server_name shop.example;
        location / { proxy_pass http://app; }
    }
    server {
        listen 443 ssl;
        server_name shop.example;
        ssl_certificate /etc/ssl/s.pem;
        ssl_certificate_key /etc/ssl/s.key;
        add_header Strict-Transport-Security "max-age=63072000" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-Frame-Options "DENY" always;
        location / { proxy_pass http://app; }
    }
}
`,
  },

  // ───────────── sshd
  {
    name: "Mozilla modern OpenSSH",
    file: "sshd_config",
    expect: [],
    text: `# Based on Mozilla's "modern" OpenSSH guidance
HostKey /etc/ssh/ssh_host_ed25519_key
KexAlgorithms curve25519-sha256@libssh.org,diffie-hellman-group-exchange-sha256
Ciphers chacha20-poly1305@openssh.com,aes256-gcm@openssh.com,aes128-gcm@openssh.com,aes256-ctr
MACs hmac-sha2-512-etm@openssh.com,hmac-sha2-256-etm@openssh.com,umac-128-etm@openssh.com
AuthenticationMethods publickey
LogLevel VERBOSE
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
UsePAM yes
X11Forwarding no
Subsystem sftp /usr/lib/ssh/sftp-server -f AUTHPRIV -l INFO
`,
  },
  {
    name: "Default-ish config with nothing set",
    file: "sshd_config",
    expect: ["SSH002"],
    text: `Port 22
AuthorizedKeysFile .ssh/authorized_keys
Subsystem sftp /usr/lib/openssh/sftp-server
`,
  },
  {
    name: "Password off, but PAM still asks",
    file: "sshd_config",
    expect: ["SSH004"],
    text: `PermitRootLogin no
PasswordAuthentication no
UsePAM yes
`,
  },
  {
    name: "Wide open server",
    file: "sshd_config",
    expect: ["SSH001", "SSH002", "SSH003", "SSH005", "SSH006", "SSH006", "SSH007", "SSH008", "SSH010", "SSH011"],
    text: `Protocol 2,1
PermitRootLogin yes
PasswordAuthentication yes
PermitEmptyPasswords yes
X11Forwarding yes
MaxAuthTries 8
PermitUserEnvironment yes
GatewayPorts yes
MACs hmac-md5,hmac-sha2-256
KexAlgorithms diffie-hellman-group1-sha1,curve25519-sha256
`,
  },
  {
    name: "Hardening appended at the bottom is ignored",
    file: "sshd_config",
    expect: ["SSH009", "SSH012"],
    text: `Include /etc/ssh/sshd_config.d/*.conf
PasswordAuthentication yes
PermitRootLogin no
KbdInteractiveAuthentication no

# added by security
PasswordAuthentication no
`,
  },
  {
    name: "Password login allowed for one group only",
    file: "sshd_config",
    expect: ["SSH002"],
    text: `PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no

Match Group contractors
    PasswordAuthentication yes
`,
  },
];
