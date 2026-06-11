# Sandbox Exec — Secure Code Execution Environment
# Build: docker build -t sandbox-exec -f .agents/skills/sandbox-exec/scripts/sandbox/Dockerfile .
# Usage: docker run --rm -v $(pwd):/workspace --network none sandbox-exec <command>

FROM ubuntu:22.04

LABEL org.opencontainers.image.title="opencode-cowork-proxy sandbox-exec"
LABEL org.opencontainers.image.description="Secure sandbox for agent code execution"
LABEL org.opencontainers.image.source="https://github.com/lizhengguang/opencode-cowork-proxy"

# Prevent timezone prompts
ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=UTC

# Install base tools and runtimes
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Shell & core utils
    bash \
    curl \
    wget \
    ca-certificates \
    git \
    jq \
    # Build essentials
    build-essential \
    python3 \
    python3-pip \
    # Filesystem tools
    findutils \
    grep \
    sed \
    gawk \
    tree \
    # Network tools (for authorized use only)
    dnsutils \
    # Cleanup
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 22 LTS (required for npm/npx compatibility)
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install Bun runtime
RUN curl -fsSL https://bun.sh/install | bash \
    && ln -s /root/.bun/bin/bun /usr/local/bin/bun \
    && ln -s /root/.bun/bin/bunx /usr/local/bin/bunx

# Create unprivileged agent user
RUN useradd -m -s /bin/bash agent \
    && mkdir -p /workspace \
    && chown agent:agent /workspace

# Switch to agent user
USER agent
WORKDIR /workspace

# Default command
CMD ["bash"]
