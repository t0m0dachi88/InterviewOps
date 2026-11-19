# Self-Hosted Judge0 Community Edition Deployment Guide

This guide describes how to deploy and operate an isolated, self-hosted **Judge0 Community Edition (CE)** execution server for **Interview Ops**.

---

## 1. Architectural Overview & Security Boundary

In Interview Ops, candidate code execution is strictly decoupled from the control plane:

```
[ Candidate / Interviewer Browser ]
                 │
                 ▼ HTTPS / WSS
       [ Express API Server ]
                 │
                 ▼ BullMQ / TLS
        [ Upstash Redis ]
                 │
                 ▼ BullMQ Worker
      [ Interview Ops Worker ]
                 │
                 ▼ Private VPC / Internal Network (Port 2358 + X-Auth-Token)
    ╔═══════════════════════════════════════════════════════════╗
    ║          ISOLATED EXECUTION SERVER (VPS)                  ║
    ║                                                           ║
    ║  ┌─────────────────────────────────────────────────────┐  ║
    ║  │  Judge0 CE Server (Port 2358)                       │  ║
    ║  └──────────────┬───────────────────┬──────────────────┘  ║
    ║                 ▼                   ▼                     ║
    ║     ┌───────────────────────┐  ┌───────────────────────┐  ║
    ║     │ Redis (Internal Queue)│  │ Postgres (DB Metadata)│  ║
    ║     └───────────────────────┘  └───────────────────────┘  ║
    ║                 │                                         ║
    ║                 ▼                                         ║
    ║  ┌─────────────────────────────────────────────────────┐  ║
    ║  │  Judge0 Worker (Isolate Sandboxes / cgroups v2)     │  ║
    ║  │  - CPU Quota: 2.0s wall time                        │  ║
    ║  │  - Memory Quota: 256 MB                             │  ║
    ║  │  - Output Limit: 64 KB                              │  ║
    ║  │  - Network Isolation: Disabled inside sandbox       │  ║
    ║  └─────────────────────────────────────────────────────┘  ║
    ╚═══════════════════════════════════════════════════════════╝
```

### Security Invariants
1. **Never host Judge0 on the API server**: Untrusted code must execute on a dedicated VPS instance completely isolated from application databases and production API keys.
2. **Never expose Judge0 to the public internet**: The Judge0 API port (`2358`) must only be reachable by the Interview Ops worker process via private VPC peering, VPN (WireGuard/Tailscale), or strict firewall allowlists.
3. **Never allow outbound network inside execution sandboxes**: Sandboxed candidate code must not initiate outbound TCP/UDP requests (prevents SSRF, port scanning, and cryptomining).
4. **Enforce cgroups v2**: Mandatory for memory containment and CPU accounting.

---

## 2. Server Requirements & OS Prerequisites

### Hardware Recommendations
- **Cloud Provider**: AWS EC2 (t3.medium or c6i.large), DigitalOcean Droplet, Hetzner Cloud (CX31), or GCP Compute Engine.
- **CPU**: 2+ vCPUs (dedicated/compute-optimized instances preferred to minimize CPU throttling).
- **RAM**: 4 GB minimum (8 GB recommended for concurrent compilations).
- **Disk**: 40 GB+ SSD.
- **Operating System**: Ubuntu 22.04 LTS or Ubuntu 24.04 LTS x86_64.

### Verify cgroups v2 Support
Judge0 requires cgroups v2 for isolated sandboxing (`isolate`). Verify on the target host:

```bash
# Check cgroups version
stat -fc %T /sys/fs/cgroup/
# Output should be: cgroup2fs
```

If the output is `tmpfs` (cgroups v1), enable cgroups v2 by updating `/etc/default/grub`:
```bash
sudo sed -i 's/GRUB_CMDLINE_LINUX="/GRUB_CMDLINE_LINUX="systemd.unified_cgroup_hierarchy=1 /' /etc/default/grub
sudo update-grub
sudo reboot
```

---

## 3. Docker & Docker Compose Setup

Install the latest official Docker Engine:

```bash
# Remove older packages
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg lsb-release

# Add Docker GPG key and repository
sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Verify Docker Compose v2
docker compose version
```

---

## 4. Deploying Judge0 Community Edition

Create the service directory:

```bash
sudo mkdir -p /opt/judge0
cd /opt/judge0
```

### Step 4.1: Download Configuration Files

Download the default `judge0.conf` and `docker-compose.yml` from the Judge0 release:

```bash
sudo curl -fsSL -O https://raw.githubusercontent.com/judge0/judge0/v1.13.1/docker-compose.yml
sudo curl -fsSL -O https://raw.githubusercontent.com/judge0/judge0/v1.13.1/judge0.conf
```

### Step 4.2: Production `judge0.conf` Configuration

Edit `/opt/judge0/judge0.conf` with production-grade security values:

```ini
# /opt/judge0/judge0.conf

# ==============================================================================
# Security & Authentication
# ==============================================================================
# Generate a secure 32+ character hex or base64 token:
# Run: openssl rand -hex 24
AUTH_TOKEN=your-high-entropy-judge0-api-token-here

# Require authentication for all submissions and system queries
ENABLE_AUTH=true

# ==============================================================================
# Resource Limits (Conservative Defaults for Interview Ops)
# ==============================================================================
# Max CPU time allowed per execution in seconds (float)
CPU_TIME_LIMIT=2.0
MAX_CPU_TIME_LIMIT=5.0

# Max wall time allowed in seconds
WALL_TIME_LIMIT=5.0
MAX_WALL_TIME_LIMIT=10.0

# Max memory in KB (256 MB = 262144 KB)
MEMORY_LIMIT=262144
MAX_MEMORY_LIMIT=524288

# Max stdout / stderr output size in bytes (64 KB = 65536 bytes)
MAX_EXTRACT_SIZE=65536

# Maximum number of processes per submission (prevents fork bombs)
MAX_PROCESSES_AND_OR_THREADS=60

# Max stack size in KB
STACK_LIMIT=65536

# ==============================================================================
# Sandboxing & Network Isolation
# ==============================================================================
# Disable network access inside candidate sandbox
ENABLE_NETWORK=false

# Auto-cleanup temporary files generated during compilation
ENABLE_WAIT_RESULT=false

# ==============================================================================
# Worker & Database Configuration
# ==============================================================================
POSTGRES_USER=judge0
POSTGRES_PASSWORD=generate_a_secure_postgres_password_here
POSTGRES_DB=judge0
REDIS_PASSWORD=generate_a_secure_redis_password_here
```

### Step 4.3: Verify `docker-compose.yml`

Ensure your `docker-compose.yml` matches the official configuration:

```yaml
version: '3.8'

services:
  server:
    image: judge0/judge0:v1.13.1
    restart: always
    env_file: judge0.conf
    ports:
      - "127.0.0.1:2358:2358" # Bound locally; expose only via reverse proxy or private interface
    depends_on:
      - db
      - redis
    volumes:
      - ./judge0.conf:/judge0.conf:ro

  worker:
    image: judge0/judge0:v1.13.1
    restart: always
    env_file: judge0.conf
    privileged: true # Required for isolate cgroup sandboxing
    depends_on:
      - db
      - redis
    volumes:
      - ./judge0.conf:/judge0.conf:ro

  db:
    image: postgres:13.0
    restart: always
    env_file: judge0.conf
    volumes:
      - postgres-data:/var/lib/postgresql/data

  redis:
    image: redis:6.0
    restart: always
    command: [ "sh", "-c", "exec redis-server --requirepass \"$$REDIS_PASSWORD\"" ]
    env_file: judge0.conf
    volumes:
      - redis-data:/data

volumes:
  postgres-data:
  redis-data:
```

### Step 4.4: Start Judge0

```bash
cd /opt/judge0
sudo docker compose up -d
```

Check container status and logs:
```bash
sudo docker compose ps
sudo docker compose logs -f server
sudo docker compose logs -f worker
```

Verify service responsiveness:
```bash
curl -X GET "http://127.0.0.1:2358/about" \
  -H "X-Auth-Token: your-high-entropy-judge0-api-token-here"
```

Expected JSON response:
```json
{
  "version": "1.13.1",
  "homepage": "https://judge0.com",
  "maintainer": "Herman Zvonimir Došilović <hermanz.dosilovic@gmail.com>"
}
```

---

## 5. Host Firewall & Network Hardening (UFW)

Lock down the VPS host firewall using `ufw`:

```bash
# Allow SSH (restrict to admin IP if static)
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp

# Allow port 2358 ONLY from the Interview Ops worker/API IP
# Replace 198.51.100.50 with your Worker server IP or VPC CIDR (e.g., 10.0.0.0/16)
sudo ufw allow from 198.51.100.50 to any port 2358 proto tcp

# Enable firewall
sudo ufw enable
sudo ufw status verbose
```

---

## 6. Language ID Reference Matrix

Judge0 Community Edition v1.13.1 maps languages to integer IDs. Interview Ops uses the following standard IDs by default:

| Language               | Judge0 Language ID | Version               | Configuration Variable |
| ---------------------- | ------------------ | --------------------- | ---------------------- |
| **JavaScript**         | `63`               | Node.js 12.14.0       | `JUDGE0_LANG_JAVASCRIPT` |
| **Python**             | `71`               | Python 3.8.1          | `JUDGE0_LANG_PYTHON`     |
| **C++**                | `54`               | C++ (GCC 9.2.0)       | `JUDGE0_LANG_CPP`        |

You can inspect the full list of installed compilers on your Judge0 server by querying:
```bash
curl -X GET "http://127.0.0.1:2358/languages" \
  -H "X-Auth-Token: your-high-entropy-judge0-api-token-here"
```

---

## 7. Configuring Interview Ops (`apps/worker` & `apps/api`)

Configure your Interview Ops worker environment (`apps/worker/.env` or container orchestrator):

```ini
# Judge0 Execution Provider
EXECUTION_PROVIDER=judge0
JUDGE0_URL=http://<private-vps-ip>:2358
JUDGE0_API_KEY=your-high-entropy-judge0-api-token-here

# Language IDs (override only if using a custom Judge0 image)
JUDGE0_LANG_JAVASCRIPT=63
JUDGE0_LANG_PYTHON=71
JUDGE0_LANG_CPP=54

# Execution Constraints
MAX_EXECUTION_TIME_MS=2000
MAX_MEMORY_LIMIT_MB=256
MAX_OUTPUT_BUFFER_BYTES=65536
```

---

## 8. Maintenance, Health Checks & Monitoring

### Systemd Service for Auto-Start
To ensure Judge0 restarts automatically across host reboots, create `/etc/systemd/system/judge0.service`:

```ini
[Unit]
Description=Judge0 Code Execution Engine
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/judge0
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
```

Enable and start the service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable judge0
```

### Health Check Monitoring Probe
Add an automated health check (e.g. from Datadog, Prometheus, or Uptime Kuma) against:
- **URL**: `http://<private-ip>:2358/about`
- **Method**: `GET`
- **Header**: `X-Auth-Token: <your-token>`
- **Expected Status Code**: `200`
- **Alert Condition**: Latency > 1500ms or 3 consecutive 5xx/timeout failures.
